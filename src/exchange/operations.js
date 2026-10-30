import { digest, isKey, isNumber, isId, isRequestInput, isResultInput, isResolutionInput,
  isHead, evidenceKinds, maximumEvidence, iso, requireValue } from './values.js';

export function createExchangeOperations({ read, save, putBytes, readBytes, now = Date.now }) {
  function findRequest(state, pull, id) {
    const request = state.requests.find(x => x.id === id && x.pull === pull);
    requireValue(request, 'notFound', 404);
    return request;
  }
  function authorize(session, pull) { requireValue(isNumber(pull) && session.pull === pull && isId(session.author), 'unauthorized', 401); }
  return {
    session(token) {
      const session = read().sessions.find(x => x.hash === digest(token) && x.expiresAt > iso(now()));
      requireValue(session, 'unauthorized', 401);
      return session;
    },
    connect(input, author) {
      const state = read();
      const hash = digest(input.token);
      state.sessions = state.sessions.filter(x => x.expiresAt > iso(now()) && x.hash !== hash);
      requireValue(state.sessions.length < 500, 'capacity', 429);
      const expiresAt = iso(now() + 86400000);
      state.sessions.push({ hash, pull: input.pull, comment: input.comment, author, expiresAt });
      save(state);
      return { outcome: 'connected', expiresAt };
    },
    inbox(pull) { return read().requests.filter(x => x.pull === pull); },
    evidenceList(pull) { return read().evidence.filter(x => x.pull === pull); },
    request(session, pull, input) {
      authorize(session, pull); requireValue(isRequestInput(input));
      const state = read();
      const previous = state.requests.find(x => x.id === input.id);
      if (previous) {
        requireValue(previous.pull === pull && previous.author === session.author && previous.head === input.head
          && previous.kind === input.kind && JSON.stringify(previous.evidence) === JSON.stringify(input.evidence), 'conflict', 409);
        return { outcome: 'requested', id: input.id };
      }
      requireValue(state.requests.length < 1000 && state.requests.filter(x => x.pull === pull).length < 100, 'capacity', 429);
      requireValue(input.evidence.every(id => state.evidence.some(item => item.id === id && item.pull === pull
        && item.head === input.head && item.author === session.author && item.expiresAt > iso(now()))), 'evidenceUnavailable', 409);
      state.requests.push({ ...input, pull, author: session.author, proof: session.comment, createdAt: iso(now()), results: [], resolution: null });
      save(state);
      return { outcome: 'requested', id: input.id };
    },
    respond(session, pull, id, input) {
      authorize(session, pull); requireValue(isKey(id) && isResultInput(input));
      const state = read();
      const request = findRequest(state, pull, id);
      const previous = request.results.find(x => x.id === input.id);
      if (previous) {
        requireValue(previous.author === session.author && previous.head === input.head && previous.status === input.status
          && JSON.stringify(previous.evidence) === JSON.stringify(input.evidence), 'conflict', 409);
        return { outcome: 'responded', id: input.id };
      }
      requireValue(request.resolution === null && request.head === input.head, 'conflict', 409);
      requireValue(request.results.length < 20, 'capacity', 429);
      requireValue(input.evidence.every(key => state.evidence.some(item => item.id === key && item.pull === pull
        && item.head === input.head && item.author === session.author && item.expiresAt > iso(now()))), 'evidenceUnavailable', 409);
      request.results.push({ ...input, author: session.author, proof: session.comment, createdAt: iso(now()) });
      save(state);
      return { outcome: 'responded', id: input.id };
    },
    resolve(session, pull, id, input) {
      authorize(session, pull); requireValue(isKey(id) && isResolutionInput(input));
      const state = read();
      const request = findRequest(state, pull, id);
      requireValue(request.author === session.author, 'forbidden', 403);
      requireValue(request.results.some(x => x.id === input.result), 'notFound', 404);
      if (request.resolution) requireValue(request.resolution.result === input.result
        && request.resolution.decision === input.decision, 'conflict', 409);
      else { request.resolution = { ...input, createdAt: iso(now()) }; save(state); }
      return { outcome: 'resolved', id };
    },
    upload(session, pull, id, head, kind, bytes, retentionHours) {
      authorize(session, pull);
      requireValue(isKey(id) && isHead(head) && evidenceKinds.includes(kind) && Buffer.isBuffer(bytes)
        && bytes.length > 0 && bytes.length <= maximumEvidence
        && Number.isInteger(retentionHours) && retentionHours >= 1 && retentionHours <= 720);
      const state = read();
      const hash = digest(bytes);
      const previous = state.evidence.find(x => x.id === id);
      if (previous) {
        requireValue(previous.pull === pull && previous.author === session.author && previous.head === head
          && previous.kind === kind && previous.digest === hash, 'conflict', 409);
        requireValue(previous.expiresAt > iso(now()), 'evidenceUnavailable', 410);
        return publicEvidence(previous);
      }
      requireValue(state.evidence.length < 4000 && state.evidence.filter(x => x.expiresAt > iso(now())).length < 256
        && state.evidence.filter(x => x.pull === pull && x.expiresAt > iso(now())).length < 64, 'capacity', 429);
      const item = { id, pull, author: session.author, head, kind, digest: hash, size: bytes.length,
        createdAt: iso(now()), expiresAt: iso(now() + retentionHours * 3600000) };
      putBytes(id, bytes);
      state.evidence.push(item); save(state);
      return publicEvidence(item);
    },
    download(session, pull, id) {
      authorize(session, pull); requireValue(isKey(id));
      const item = read().evidence.find(x => x.id === id && x.pull === pull);
      requireValue(item, 'notFound', 404);
      requireValue(item.expiresAt > iso(now()), 'evidenceUnavailable', 410);
      const bytes = readBytes(id);
      requireValue(bytes.length === item.size && digest(bytes) === item.digest, 'storage', 503);
      return { bytes, digest: item.digest };
    }
  };
}

function publicEvidence(item) {
  return { outcome: 'uploaded', id: item.id, digest: item.digest, size: item.size, expiresAt: item.expiresAt };
}
