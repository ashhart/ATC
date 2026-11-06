import { digest, iso } from './values.js';
import { receiptFreshness } from './freshness.js';

export const helpStates = ['available', 'running', 'reported', 'passed', 'failed', 'blocked', 'inconclusive', 'stale', 'expired', 'closed', 'selfReview'];

export function helpView(store, request, current, now, snapshot = store.collaborationData()) {
  const data = snapshot.collaboration, offer = data.offers.find(x => x.id === request.id);
  const lease = data.leases.find(x => x.id === request.id && x.expiresAt > iso(now));
  const result = request.results.find(x => x.id === request.resolution?.result);
  let state = !current || receiptFreshness(request, current) !== 'current' ? 'stale'
    : current.state === 'closed' ? 'closed' : lease ? 'running' : request.results.length ? 'reported' : 'available';
  if (result && state !== 'stale' && state !== 'closed' && request.resolution.decision === 'accepted') {
    const evidence = snapshot.evidence.filter(x => x.pull === request.pull);
    const expired = result.evidence.some(id => !evidence.some(x => x.id === id && x.expiresAt > iso(now)));
    state = receiptFreshness(result, current) !== 'current' ? 'stale' : expired ? 'expired'
      : offer?.independent && result.author === request.author ? 'selfReview'
        : { pass: 'passed', fail: 'failed', blocked: 'blocked', inconclusive: 'inconclusive' }[result.status];
  }
  return { id: request.id, pull: request.pull, kind: request.kind, capability: offer?.capability || 'any',
    required: offer?.required || false, independent: offer?.independent || false, public: offer?.public || false,
    head: request.head, base: request.base ?? null, state, expiresAt: state === 'running' ? lease.expiresAt : null,
    createdAt: request.createdAt };
}

export function collaborationView(store, session, current, now, snapshot = store.collaborationData()) {
  const data = snapshot.collaboration;
  const items = snapshot.requests.filter(x => x.pull === session.pull && data.offers.some(y => y.id === x.id)).map(x => helpView(store, x, current, now, snapshot));
  const required = items.filter(x => x.required);
  const handoffs = data.handoffs.filter(x => x.pull === session.pull).map(x => ({ id: x.id, pull: x.pull, issue: x.issue,
    head: x.head, base: x.base, report: x.report, digest: x.digest, size: x.size, createdAt: x.createdAt,
    decision: x.decision?.decision || 'offered', stale: x.head !== current.head || x.base !== current.base,
    mine: x.author === session.author, forMe: x.recipient === session.comment }));
  const pickups = data.leases.filter(x => x.expiresAt > iso(now) && x.head === current.head && x.base === current.base
    && snapshot.requests.some(r => r.id === x.id && r.pull === session.pull && r.resolution === null))
    .map(x => ({ id: x.id, proof: x.proof, consumer: x.consumer, expiresAt: x.expiresAt, mine: x.author === session.author }));
  return { type: 'collaboration', view: 'matrix', version: 1, pull: session.pull, head: current.head, base: current.base,
    observedAt: iso(now), qualified: required.length > 0 && required.every(x => x.state === 'passed'), items, handoffs, pickups };
}

export function catchupSnapshot(store, session, current, observation, now) {
  const snapshot = store.collaborationData();
  const matrix = collaborationView(store, session, current, now, snapshot);
  const parts = [{ kind: 'head', id: null, revision: digest(current.head) }, { kind: 'base', id: null, revision: digest(current.base) },
    { kind: 'feedback', id: null, revision: observation.feedback }, { kind: 'dependencies', id: null, revision: observation.dependencies }];
  for (const request of snapshot.requests.filter(x => x.pull === session.pull)) {
    parts.push({ kind: 'request', id: request.id, revision: digest(JSON.stringify(request)) });
  }
  for (const item of matrix.items) parts.push({ kind: 'help', id: item.id,
    revision: digest(JSON.stringify({ item, pickup: matrix.pickups.find(x => x.id === item.id) || null })) });
  for (const item of matrix.handoffs) parts.push({ kind: 'handoff', id: item.id, revision: digest(JSON.stringify(item)) });
  parts.sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
  return { type: 'collaboration', view: 'snapshot', version: 1, pull: session.pull, observedAt: iso(now),
    cursor: digest(JSON.stringify(parts)), parts };
}
