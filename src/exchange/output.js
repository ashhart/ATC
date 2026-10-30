import { exact, isKey, isDigest, isHead, isId, isNumber, isTime, evidenceKinds, kinds, statuses, decisions, maximumEvidence } from './values.js';

const count = x => Number.isInteger(x) && x >= 0 && x <= 100;
const boolean = x => typeof x === 'boolean';
const size = x => Number.isInteger(x) && x > 0 && x <= maximumEvidence;
const list = (check, maximum) => x => Array.isArray(x) && x.length <= maximum && x.every(check);
const resolution = x => x === null || exact(x, { result: isKey, decision: x => decisions.includes(x), createdAt: isTime });
const evidence = x => exact(x, { id: isKey, digest: isDigest, size, kind: x => evidenceKinds.includes(x), expiresAt: isTime,
  availability: x => ['available', 'expired'].includes(x) });
const result = x => exact(x, { id: isKey, proof: isId, head: isHead, status: x => statuses.includes(x), mine: boolean, selfReview: boolean,
  createdAt: isTime, evidence: list(evidence, 8) });
const request = x => exact(x, { id: isKey, proof: isId, head: isHead, kind: x => kinds.includes(x), createdAt: isTime,
  mine: boolean, stale: boolean, resolution, results: list(result, 20), evidence: list(evidence, 8) });

export function isInbox(value) {
  return exact(value, { version: x => x === 1, repository: x => x === 'selected', pull: isNumber, head: isHead,
    state: x => ['open', 'closed'].includes(x), observedAt: isTime,
    counts: x => exact(x, { pending: count, resolved: count, stale: count }), requests: list(request, 100) });
}

export function isExchangeOutput(value) {
  if (isInbox(value)) return true;
  if (value?.outcome === 'connected') return exact(value, { outcome: x => x === 'connected', expiresAt: isTime });
  if (['requested', 'responded', 'resolved'].includes(value?.outcome)) {
    return exact(value, { outcome: x => ['requested', 'responded', 'resolved'].includes(x), id: isKey });
  }
  if (value?.outcome === 'uploaded') return exact(value, { outcome: x => x === 'uploaded', id: isKey, digest: isDigest, size, expiresAt: isTime });
  if (value?.outcome === 'downloaded') return exact(value, { outcome: x => x === 'downloaded', id: isKey, digest: isDigest, size });
  if (value?.outcome === 'exported') return exact(value, { outcome: x => x === 'exported', pull: isNumber });
  return false;
}
