import { iso, requireValue } from './values.js';

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
    id: request.id, proof: request.proof, head: request.head, kind: request.kind, createdAt: request.createdAt,
    mine: request.author === session.author, stale: request.head !== current.head,
    evidence: request.evidence.map(evidenceView),
    resolution: request.resolution,
    results: request.results.map(result => ({ id: result.id, proof: result.proof, head: result.head, status: result.status,
      selfReview: result.author === request.author,
      mine: result.author === session.author, createdAt: result.createdAt,
      evidence: result.evidence.map(evidenceView) }))
  }));
  return { version: 1, repository: 'selected', pull, head: current.head, state: current.state, observedAt,
    counts: { pending: requests.filter(x => !x.stale && x.resolution === null).length,
      resolved: requests.filter(x => !x.stale && x.resolution !== null).length,
      stale: requests.filter(x => x.stale).length }, requests };
}

export function renderInbox(view) {
  const lines = [`PR #${view.pull} at ${view.head}`, `${view.counts.pending} pending, ${view.counts.resolved} resolved, ${view.counts.stale} stale`];
  for (const request of view.requests) {
    lines.push(`${request.id} ${request.kind}: ${request.stale ? 'stale' : request.resolution?.decision || 'pending'} at ${request.head}`);
    lines.push(`  Request proof comment ${request.proof}`);
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
