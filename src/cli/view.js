export function statusView(state, me, repository) {
  const myWork = new Set(state.claims.filter(claim => claim.login === me && claim.role === 'work').map(claim => claim.issue));
  const myPulls = new Set(state.claims.filter(claim => claim.login === me).flatMap(claim => claim.prs));
  return {
    repository,
    areas: state.areas,
    updatedAt: iso(state.updatedAt),
    claims: state.claims.map(claim => ({ issue: claim.issue, role: claim.role, areas: claim.areas, mine: claim.login === me,
      pullRequests: claim.prs, lastActivity: iso(claim.active) })),
    proposalsForMe: state.proposals.filter(proposal => myWork.has(proposal.issue)).map(proposalView),
    myProposals: state.proposals.filter(proposal => proposal.from === me).map(proposalView),
    overlaps: state.overlaps.map(overlap => ({ pullRequests: overlap.prs, sharedFiles: overlap.files, areas: overlap.areas,
      mine: overlap.prs.some(number => myPulls.has(number)) }))
  };
}

export function checkView(state, me, issue, areas) {
  const here = state.claims.filter(claim => claim.issue === issue);
  const work = here.filter(claim => claim.role === 'work');
  const mine = work.some(claim => claim.login === me);
  const areaOverlaps = areas.length === 0 ? [] : state.claims
    .filter(claim => claim.issue !== issue && claim.role === 'work')
    .map(claim => ({ issue: claim.issue, areas: claim.areas.filter(area => areas.includes(area)), mine: claim.login === me }))
    .filter(overlap => overlap.areas.length > 0);
  return {
    issue,
    claimed: work.length > 0,
    claimedByMe: mine,
    claimants: work.length,
    reviewers: here.length - work.length,
    pendingProposals: state.proposals.filter(proposal => proposal.issue === issue).length,
    areaOverlaps,
    advice: mine ? 'yours' : work.length > 0 ? 'proposeInstead' : 'free'
  };
}

function proposalView(proposal) {
  return { id: proposal.id, issue: proposal.issue, kind: proposal.kind, areas: proposal.areas };
}

function iso(time) {
  return new Date(time).toISOString();
}
