import { iso, requireValue } from './values.js';
import { receiptFreshness } from './freshness.js';

export function inboxView(store, session, pull, current, now) {
  requireValue(session.pull === pull, 'unauthorized', 401);
  const observedAt = iso(now);
  const evidence = store.evidenceList(pull);
  const evidenceView = id => {
    const item = evidence.find(x => x.id === id);
    return { id, digest: item.digest, size: item.size, kind: item.kind, expiresAt: item.expiresAt,
      availability: item.expiresAt > observedAt ? 'available' : 'expired' };
  };
  const requests = store.inbox(pull).map(request => ({
    id: request.id, proof: request.proof, head: request.head, base: request.base ?? null, kind: request.kind, createdAt: request.createdAt,
    mine: request.author === session.author, stale: receiptFreshness(request, current) !== 'current', freshness: receiptFreshness(request, current),
    evidence: request.evidence.map(evidenceView),
    resolution: request.resolution,
    results: request.results.map(result => ({ id: result.id, proof: result.proof, head: result.head, base: result.base ?? null, status: result.status,
      stale: receiptFreshness(result, current) !== 'current', freshness: receiptFreshness(result, current),
      selfReview: result.author === request.author,
      mine: result.author === session.author, createdAt: result.createdAt,
      evidence: result.evidence.map(evidenceView) }))
  }));
  return { version: 2, repository: 'selected', pull, head: current.head, base: current.base, state: current.state, observedAt,
    counts: { pending: requests.filter(x => !x.stale && x.resolution === null).length,
      resolved: requests.filter(x => !x.stale && x.resolution !== null).length,
      stale: requests.filter(x => x.stale).length }, requests };
}

export function legacyInboxView(view) {
  const { base, ...legacy } = view;
  return { ...legacy, version: 1, requests: view.requests.map(({ base, freshness, ...request }) => ({ ...request,
    results: request.results.map(({ base, stale, freshness, ...result }) => result) })) };
}

export function upgradeLegacyInbox(view, current) {
  const requests = view.requests.map(request => ({ ...request, base: null,
    freshness: receiptFreshness({ ...request, base: null }, current), stale: true,
    results: request.results.map(result => ({ ...result, base: null,
      freshness: receiptFreshness({ ...result, base: null }, current), stale: true })) }));
  return { ...view, version: 2, head: current.head, base: current.base, state: current.state, requests,
    counts: { pending: 0, resolved: 0, stale: requests.length } };
}

export function renderInbox(view) {
  const lines = [`PR #${view.pull} at ${view.head}`, `Base ${view.base || 'unknown'}`, `${view.counts.pending} pending, ${view.counts.resolved} resolved, ${view.counts.stale} stale`];
  for (const request of view.requests) {
    lines.push(`${request.id} ${request.kind}: ${request.stale ? 'stale' : request.resolution?.decision || 'pending'} at ${request.head}`);
    lines.push(`  Request proof comment ${request.proof}`);
    lines.push(`  Tested base ${request.base || 'unknown'}, ${request.freshness || (request.stale ? 'unknownBase' : 'current')}`);
    for (const result of request.results) {
      const expired = result.evidence.filter(x => x.availability === 'expired').length;
      lines.push(`  ${result.id} ${result.status}, ${result.evidence.length} evidence, ${expired} expired, proof comment ${result.proof}`);
      if (result.selfReview) lines.push('  Request and response use the same GitHub account.');
      for (const item of result.evidence) lines.push(`    ${item.id} sha256 ${item.digest}, ${item.availability}`);
    }
  }
  lines.push('Exchange results are reports, not GitHub approvals.');
  return lines.join('\n');
}
