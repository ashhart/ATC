export function claimIssue(state, { login, issue, areas, open }, config, now) {
  if (!open) return 'notClaimable';
  if (!knownAreas(areas, config)) return 'unknownArea';
  const own = state.claims.find(claim => claim.issue === issue && claim.login === login);
  if (own?.role === 'work') {
    own.areas = [...areas];
    own.active = now;
    return 'claimUpdated';
  }
  if (workOn(state, issue).length > 0) return 'claimTaken';
  if (state.claims.filter(claim => claim.login === login && claim.role === 'work').length >= config.maxClaimsPerUser) return 'claimLimit';
  addClaim(state, { issue, login, role: 'work', areas }, now);
  return 'claimed';
}

export function releaseClaim(state, { login, issue }) {
  if (!state.claims.some(claim => claim.issue === issue && claim.login === login)) return 'nothingToRelease';
  state.claims = state.claims.filter(claim => !(claim.issue === issue && claim.login === login));
  state.proposals = state.proposals.filter(proposal => !(proposal.issue === issue && proposal.from === login));
  tidy(state, issue);
  return 'released';
}

export function resetIssue(state, issue) {
  dropIssue(state, issue);
  return 'reset';
}

export function dropIssue(state, issue) {
  state.claims = state.claims.filter(claim => claim.issue !== issue);
  state.proposals = state.proposals.filter(proposal => proposal.issue !== issue);
}

export function proposeWork(state, { id, login, issue, kind, areas, open }, config, now) {
  if (!open) return 'notClaimable';
  if (workOn(state, issue).length === 0) return 'notClaimed';
  if (state.claims.some(claim => claim.issue === issue && claim.login === login)) return 'alreadyInvolved';
  if (!knownAreas(areas, config)) return 'unknownArea';
  if (state.proposals.some(proposal => proposal.issue === issue && proposal.from === login && proposal.kind === kind)) return 'proposalExists';
  if (state.proposals.filter(proposal => proposal.from === login).length >= config.maxPendingProposalsPerUser) return 'proposalLimit';
  if (state.proposals.filter(proposal => proposal.issue === issue).length >= 10) return 'proposalLimit';
  state.proposals.push({ id, issue, from: login, kind, areas: [...areas], at: now });
  return 'proposed';
}

export function decideProposal(state, { login, issue, proposal: id, verb }, config, now) {
  const proposal = state.proposals.find(entry => entry.id === id && entry.issue === issue);
  if (!proposal) return 'proposalNotFound';
  if (verb === 'withdraw') {
    if (proposal.from !== login) return 'notAuthorized';
    state.proposals = state.proposals.filter(entry => entry.id !== id);
    return 'withdrawn';
  }
  const work = workOn(state, issue);
  const decider = work.find(claim => claim.login === login);
  if (!decider) return 'notAuthorized';
  if (verb === 'decline') {
    state.proposals = state.proposals.filter(entry => entry.id !== id);
    return 'declined';
  }
  return acceptProposal(state, { proposal, work, decider }, config, now);
}

export function tidy(state, issue) {
  if (workOn(state, issue).length === 0) state.proposals = state.proposals.filter(proposal => proposal.issue !== issue);
}

function acceptProposal(state, { proposal, work, decider }, config, now) {
  const { issue, from, kind } = proposal;
  const held = state.claims.filter(claim => claim.login === from && claim.role === 'work').length;
  if (kind !== 'review' && held >= config.maxClaimsPerUser) return 'proposerAtLimit';
  if (kind === 'split') {
    const kept = work.map(claim => (claim.areas.length ? claim.areas : Object.keys(config.areas).sort()).filter(area => !proposal.areas.includes(area)));
    if (kept.some(areas => areas.length === 0)) return 'splitLeavesNothing';
    work.forEach((claim, index) => { claim.areas = kept[index]; });
    addClaim(state, { issue, login: from, role: 'work', areas: proposal.areas }, now);
  } else if (kind === 'pair') {
    addClaim(state, { issue, login: from, role: 'work', areas: decider.areas }, now);
  } else if (kind === 'takeover') {
    const areas = work.some(claim => claim.areas.length === 0) ? [] : [...new Set(work.flatMap(claim => claim.areas))];
    state.claims = state.claims.filter(claim => !(claim.issue === issue && claim.role === 'work'));
    addClaim(state, { issue, login: from, role: 'work', areas }, now);
  } else {
    addClaim(state, { issue, login: from, role: 'review', areas: [] }, now);
  }
  state.proposals = state.proposals.filter(entry => !(entry.issue === issue && entry.from === from));
  decider.active = now;
  return 'accepted';
}

function addClaim(state, { issue, login, role, areas }, now) {
  state.claims = state.claims.filter(claim => !(claim.issue === issue && claim.login === login));
  state.claims.push({ issue, login, role, areas: [...areas].sort(), since: now, active: now });
}

function workOn(state, issue) {
  return state.claims.filter(claim => claim.issue === issue && claim.role === 'work');
}

function knownAreas(areas, config) {
  return areas.every(area => Object.hasOwn(config.areas, area));
}
