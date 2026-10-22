export function claimIssue(state, { login, issue, areas, open }, config, now) {
  if (!open) return 'notClaimable';
  if (!knownAreas(areas, config)) return 'unknownArea';
  const own = state.claims.find(claim => claim.issue === issue && claim.login === login);
  if (own?.role === 'work') {
    if (areas.length > 0 && workOn(state, issue).length > 1 && !sameAreas(own.areas, areas)) return 'sharedClaim';
    if (areas.length > 0) own.areas = [...areas];
    own.active = now;
    return 'claimUpdated';
  }
  if (workOn(state, issue).length > 0) return 'claimTaken';
  addClaim(state, { issue, login, role: 'work', areas }, now);
  return 'claimed';
}

export function renewClaim(state, { login, issue, open }, now) {
  if (!open) return 'notClaimable';
  const own = state.claims.find(claim => claim.issue === issue && claim.login === login);
  if (!own) return 'nothingToRenew';
  own.active = now;
  return 'renewed';
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
  if (['pair', 'split'].includes(kind) && work.length >= 10) return 'participantLimit';
  if (kind === 'split') {
    const effective = claim => claim.areas.length ? claim.areas : Object.keys(config.areas);
    if (work.some(claim => claim !== decider && effective(claim).some(area => proposal.areas.includes(area)))) return 'sharedClaim';
    if (proposal.areas.some(area => !effective(decider).includes(area))) return 'splitUnavailable';
    const kept = effective(decider).filter(area => !proposal.areas.includes(area));
    if (kept.length === 0) return 'splitLeavesNothing';
    decider.areas = kept;
    addClaim(state, { issue, login: from, role: 'work', areas: proposal.areas }, now);
  } else if (kind === 'pair') {
    addClaim(state, { issue, login: from, role: 'work', areas: decider.areas }, now);
  } else if (kind === 'takeover') {
    if (work.length > 1) return 'sharedClaim';
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

function sameAreas(first, second) {
  return first.length === second.length && first.every(area => second.includes(area));
}
