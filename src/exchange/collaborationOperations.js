import { digest, iso, isKey, requireValue } from './values.js';
import { collaborationState, isOfferInput, isLeaseInput, isHandoffInput, isDecisionInput } from './collaborationSchema.js';

export function createCollaborationOperations({ read, save, readBytes, putPacket, readPacket, now }) {
  function request(state, session, id) {
    const found = state.requests.find(x => x.id === id && x.pull === session.pull);
    requireValue(found, 'notFound', 404);
    return found;
  }
  function currentRequest(state, session, id, current) {
    const found = request(state, session, id);
    requireValue(found.head === current.head && found.base === current.base, 'stale', 409);
    requireValue(found.resolution === null, 'conflict', 409);
    return found;
  }
  return {
    collaboration() { return collaborationState(read()); },
    collaborationData() { const state = read(); return { ...state, collaboration: collaborationState(state) }; },
    requests() { return read().requests; },
    offer(session, id, input) {
      requireValue(isKey(id) && isOfferInput(input));
      const state = read(), found = request(state, session, id), data = collaborationState(state);
      requireValue(found.author === session.author, 'forbidden', 403);
      const previous = data.offers.find(x => x.id === id);
      const value = { id, ...input, createdAt: previous?.createdAt || iso(now()) };
      data.offers = [...data.offers.filter(x => x.id !== id), value];
      save(state);
      return { type: 'collaboration', outcome: 'offered', id };
    },
    take(session, id, input, current) {
      requireValue(isKey(id) && isLeaseInput(input));
      const state = read(), found = currentRequest(state, session, id, current), data = collaborationState(state);
      const offer = data.offers.find(x => x.id === id);
      requireValue(offer, 'notFound', 404);
      requireValue(!offer.independent || found.author !== session.author, 'forbidden', 403);
      const old = data.leases.find(x => x.id === id);
      requireValue(!old || old.expiresAt <= iso(now()) || old.author === session.author
        && old.proof === session.comment && old.consumer === input.consumer, 'conflict', 409);
      const value = { id, author: session.author, proof: session.comment, consumer: input.consumer, head: current.head,
        base: current.base, createdAt: iso(now()), expiresAt: iso(now() + input.seconds * 1000) };
      data.leases = [...data.leases.filter(x => x.id !== id), value];
      save(state);
      return { type: 'collaboration', outcome: 'taken', id, expiresAt: value.expiresAt };
    },
    releaseHelp(session, id, consumer) {
      const state = read(), data = collaborationState(state);
      request(state, session, id);
      const old = data.leases.find(x => x.id === id);
      requireValue(!old || old.author === session.author && old.proof === session.comment && old.consumer === consumer, 'forbidden', 403);
      data.leases = data.leases.filter(x => x.id !== id);
      save(state);
      return { type: 'collaboration', outcome: 'released', id };
    },
    handoff(session, input) {
      requireValue(isHandoffInput(input));
      const state = read(), data = collaborationState(state);
      const old = data.handoffs.find(x => x.id === input.id);
      if (old) {
        requireValue(old.author === session.author && old.proof === session.comment && old.pull === session.pull
          && ['issue', 'head', 'base', 'recipient', 'report'].every(key => old[key] === input[key]), 'conflict', 409);
        return { type: 'collaboration', outcome: 'handoffOffered', id: old.id };
      }
      requireValue(data.handoffs.length < 100, 'capacity', 429);
      const report = state.evidence.find(x => x.id === input.report && x.pull === session.pull && x.author === session.author
        && x.head === input.head && x.kind === 'report' && x.expiresAt > iso(now()));
      requireValue(report, 'evidenceUnavailable', 409);
      const bytes = readBytes(report.id);
      requireValue(bytes.length === report.size && digest(bytes) === report.digest, 'storage', 503);
      putPacket(input.id, bytes);
      data.handoffs.push({ ...input, pull: session.pull, author: session.author, proof: session.comment,
        digest: report.digest, size: report.size, createdAt: iso(now()), decision: null });
      save(state);
      return { type: 'collaboration', outcome: 'handoffOffered', id: input.id };
    },
    decideHandoff(session, id, input, current) {
      requireValue(isKey(id) && isDecisionInput(input));
      const state = read(), data = collaborationState(state), found = data.handoffs.find(x => x.id === id && x.pull === session.pull);
      requireValue(found, 'notFound', 404);
      requireValue(input.decision === 'accepted' ? found.recipient === session.comment : found.author === session.author, 'forbidden', 403);
      if (input.decision === 'accepted') requireValue(found.head === current.head && found.base === current.base, 'stale', 409);
      requireValue(!found.decision || found.decision.decision === input.decision, 'conflict', 409);
      if (!found.decision) { found.decision = { ...input, at: iso(now()) }; save(state); }
      return { type: 'collaboration', outcome: 'handoffDecided', id };
    },
    packet(session, id) {
      const found = collaborationState(read()).handoffs.find(x => x.id === id && x.pull === session.pull);
      requireValue(found, 'notFound', 404);
      requireValue(found.author === session.author || found.recipient === session.comment, 'forbidden', 403);
      const bytes = readPacket(id);
      requireValue(bytes.length === found.size && digest(bytes) === found.digest, 'storage', 503);
      return { bytes, digest: found.digest };
    }
  };
}
