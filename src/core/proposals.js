import { addClaim, configuredAreas, knownAreas } from './claims.js';
import { assign, comment, result, unassign } from './effects.js';
import { caps, claimsOn, pruneAfterRemoval } from './state.js';

export function proposeWork(state, { login, issue, kind, areas, open }, config, now) {
  if (!open) return result('notClaimable');
  const work = claimsOn(state, issue, 'work');
  if (work.length === 0) return result('notClaimed');
  if (state.claims.some(claim => claim.issue === issue && claim.login === login)) return result('alreadyInvolved');
  if (!knownAreas(areas, config)) return result('unknownArea', [comment(issue, 'unknownArea', { areas: configuredAreas(config) })]);
  if (state.proposals.some(proposal => proposal.issue === issue && proposal.from === login && proposal.kind === kind)) {
    return result('proposalExists');
  }
  const mine = state.proposals.filter(proposal => proposal.from === login).length;
  const here = state.proposals.filter(proposal => proposal.issue === issue).length;
  if (mine >= config.maxPendingProposalsPerUser || here >= 10) return result('proposalLimit');
  if (state.proposals.length >= caps.proposals) return result('boardFull');
  const id = state.nextProposal;
  state.nextProposal += 1;
  state.proposals.push({ id, issue, from: login, kind, areas, at: now });
  return result('proposed', [comment(issue, 'proposed', { id, from: login, kind, areas, claimants: work.map(claim => claim.login) })]);
}

export function decideProposal(state, { login, issue, proposal: id, verb }, config, now) {
  const proposal = state.proposals.find(entry => entry.id === id && entry.issue === issue);
  if (!proposal) return result('proposalNotFound');
  if (verb === 'withdraw') {
    if (proposal.from !== login) return result('notAuthorized');
    state.proposals = state.proposals.filter(entry => entry.id !== id);
    return result('withdrawn');
  }
  const work = claimsOn(state, issue, 'work');
  const decider = work.find(claim => claim.login === login);
  if (!decider) return result('notAuthorized');
  if (verb === 'decline') {
    state.proposals = state.proposals.filter(entry => entry.id !== id);
    return result('declined', [comment(issue, 'declined', { id, from: proposal.from })]);
  }
  return acceptProposal(state, { proposal, work, decider }, config, now);
}

function acceptProposal(state, { proposal, work, decider }, config, now) {
  const { issue, from, kind } = proposal;
  const held = state.claims.filter(claim => claim.login === from && claim.role === 'work').length;
  if (kind !== 'review' && held >= config.maxClaimsPerUser) return result('proposerAtLimit');
  if (state.claims.length >= caps.claims) return result('boardFull');
  const effects = [];
  if (kind === 'split') {
    const kept = work.map(claim => (claim.areas.length ? claim.areas : configuredAreas(config)).filter(area => !proposal.areas.includes(area)));
    if (kept.some(areas => areas.length === 0)) return result('splitLeavesNothing');
    work.forEach((claim, index) => { claim.areas = kept[index]; });
    addClaim(state, { issue, login: from, role: 'work', areas: proposal.areas }, now);
    effects.push(assign(issue, [from]));
  } else if (kind === 'pair') {
    addClaim(state, { issue, login: from, role: 'work', areas: decider.areas }, now);
    effects.push(assign(issue, [from]));
  } else if (kind === 'takeover') {
    const areas = work.some(claim => claim.areas.length === 0) ? [] : [...new Set(work.flatMap(claim => claim.areas))];
    state.claims = state.claims.filter(claim => !(claim.issue === issue && claim.role === 'work'));
    addClaim(state, { issue, login: from, role: 'work', areas }, now);
    effects.push(unassign(issue, work.map(claim => claim.login)), assign(issue, [from]));
  } else {
    addClaim(state, { issue, login: from, role: 'review', areas: [] }, now);
  }
  state.proposals = state.proposals.filter(entry => !(entry.issue === issue && entry.from === from));
  decider.active = now;
  pruneAfterRemoval(state, issue);
  return result('accepted', [...effects, comment(issue, 'accepted', { id: proposal.id, from, kind })]);
}
