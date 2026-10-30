import { exact, isDigest, isHead, isId, isKey, isNumber, isOrigin, isRepository, isTime,
  kinds, statuses, decisions, evidenceKinds, maximumEvidence, requireValue, isEvidenceIds } from './values.js';

const size = value => Number.isInteger(value) && value > 0 && value <= maximumEvidence;
const resultFields = { id: isKey, author: isId, proof: isId, head: isHead, status: x => statuses.includes(x), createdAt: isTime,
  evidence: x => Array.isArray(x) && x.length <= 8 && x.every(isKey) && new Set(x).size === x.length };
const requestFields = { id: isKey, pull: isNumber, author: isId, proof: isId, head: isHead, kind: x => kinds.includes(x), createdAt: isTime,
  evidence: isEvidenceIds,
  results: x => Array.isArray(x) && x.length <= 20 && x.every(v => exact(v, resultFields)),
  resolution: x => x === null || exact(x, { result: isKey, decision: x => decisions.includes(x), createdAt: isTime }) };
const evidenceFields = { id: isKey, pull: isNumber, author: isId, head: isHead, kind: x => evidenceKinds.includes(x),
  digest: isDigest, size, createdAt: isTime, expiresAt: isTime };
const sessionFields = { hash: isDigest, pull: isNumber, author: isId, comment: isId, expiresAt: isTime };

export function validateState(state) {
  requireValue(exact(state, { version: x => x === 1, repository: isRepository, origin: isOrigin,
    sessions: x => Array.isArray(x) && x.length <= 500 && x.every(v => exact(v, sessionFields)),
    requests: x => Array.isArray(x) && x.length <= 1000 && x.every(v => exact(v, requestFields)),
    evidence: x => Array.isArray(x) && x.length <= 4000 && x.every(v => exact(v, evidenceFields)) }), 'storage', 503);
  for (const [records, key] of [[state.sessions, 'hash'], [state.requests, 'id'], [state.evidence, 'id']]) {
    requireValue(new Set(records.map(x => x[key])).size === records.length, 'storage', 503);
  }
  for (const request of state.requests) {
    requireValue(state.requests.filter(x => x.pull === request.pull).length <= 100, 'storage', 503);
    requireValue(request.evidence.every(id => state.evidence.some(item => item.id === id && item.pull === request.pull
      && item.head === request.head && item.author === request.author))
      && new Set(request.results.map(x => x.id)).size === request.results.length
      && request.results.every(result => result.head === request.head && result.createdAt >= request.createdAt
        && result.evidence.every(id => state.evidence.some(item => item.id === id && item.pull === request.pull
          && item.head === request.head && item.author === result.author)))
      && (request.resolution === null || request.results.some(result => result.id === request.resolution.result
        && request.resolution.createdAt >= result.createdAt)), 'storage', 503);
  }
  requireValue(state.evidence.every(x => x.expiresAt > x.createdAt
    && Date.parse(x.expiresAt) - Date.parse(x.createdAt) <= 720 * 3600000), 'storage', 503);
  return state;
}
