import fs from 'node:fs';
import path from 'node:path';
import { privateDirectory, readPrivate, atomicWrite, requireOutsideCheckout } from './disk.js';
import { validateState } from './stateSchema.js';
import { digest, isKey, isNumber, isId, isRequestInput, isResultInput, isResolutionInput,
  isHead, evidenceKinds, maximumEvidence, iso, requireValue } from './values.js';

export function createExchangeStore({ folder, repository, origin, now = Date.now }) {
  requireOutsideCheckout(folder);
  privateDirectory(folder);
  const blobs = path.join(folder, 'evidence');
  privateDirectory(blobs);
  const lock = path.join(folder, 'lock');
  const handle = fs.openSync(lock, 'wx', 0o600);
  const file = path.join(folder, 'state.json');
  let closed = false;
  function read() {
    requireValue(!closed, 'storage', 503);
    privateDirectory(folder); privateDirectory(blobs);
    const state = validateState(JSON.parse(readPrivate(file, 16 * 1024 * 1024)));
    requireValue(state.repository === repository && state.origin === origin, 'storage', 503);
    return state;
  }
  function save(state) { atomicWrite(file, JSON.stringify(validateState(state))); }
  function findRequest(state, pull, id) {
    const request = state.requests.find(x => x.id === id && x.pull === pull);
    requireValue(request, 'notFound', 404);
    return request;
  }
  function authorize(session, pull) { requireValue(isNumber(pull) && session.pull === pull && isId(session.author), 'unauthorized', 401); }
  function sweep() {
    const state = read();
    const time = iso(now());
    const live = new Set(state.evidence.filter(x => x.expiresAt > time).map(x => x.id));
    for (const name of fs.readdirSync(blobs)) {
      requireValue(isKey(name) || /^[a-f0-9]{32}\.[a-f0-9]{16}\.tmp$/.test(name), 'storage', 503);
      if (!live.has(name)) fs.unlinkSync(path.join(blobs, name));
    }
    const sessions = state.sessions.filter(x => x.expiresAt > time);
    if (sessions.length !== state.sessions.length) { state.sessions = sessions; save(state); }
  }
  try {
    if (!fs.existsSync(file)) save({ version: 1, repository, origin, sessions: [], requests: [], evidence: [] });
    sweep();
  } catch (error) { fs.closeSync(handle); fs.unlinkSync(lock); throw error; }
  return {
    close() { if (!closed) { closed = true; fs.closeSync(handle); fs.unlinkSync(lock); } },
    sweep,
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
      atomicWrite(path.join(blobs, id), bytes);
      state.evidence.push(item); save(state);
      return publicEvidence(item);
    },
    download(session, pull, id) {
      authorize(session, pull); requireValue(isKey(id));
      const item = read().evidence.find(x => x.id === id && x.pull === pull);
      requireValue(item, 'notFound', 404);
      requireValue(item.expiresAt > iso(now()), 'evidenceUnavailable', 410);
      const bytes = readPrivate(path.join(blobs, id), maximumEvidence);
      requireValue(bytes.length === item.size && digest(bytes) === item.digest, 'storage', 503);
      return { bytes, digest: item.digest };
    }
  };
}

function publicEvidence(item) {
  return { outcome: 'uploaded', id: item.id, digest: item.digest, size: item.size, expiresAt: item.expiresAt };
}
