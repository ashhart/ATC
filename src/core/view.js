import { linkedPulls, sharedFiles } from './pulls.js';
import { isLogin } from './values.js';

export function statusView({ state, pulls, config, partial }, { me, repository, now }) {
  const myIssues = new Set(state.claims.filter(claim => claim.login === me && claim.role === 'work').map(claim => claim.issue));
  return {
    repository,
    areas: Object.keys(config.areas).sort(),
    complete: !partial,
    claims: state.claims.map(claim => ({ issue: claim.issue, role: claim.role, areas: claim.areas, mine: claim.login === me,
      since: iso(claim.since), lastActivity: iso(claim.active), pullRequests: linkedPulls(state, pulls, claim) })),
    proposalsForMe: state.proposals.filter(proposal => myIssues.has(proposal.issue)).map(proposalView),
    myProposals: state.proposals.filter(proposal => proposal.from === me).map(proposalView),
    refreshDue: state.claims.filter(claim => claim.login === me && claim.active < now - config.idleDays * 43200000).map(claim => claim.issue)
  };
}

export function checkView({ state, pulls }, { me, issue, areas, details }) {
  const here = state.claims.filter(claim => claim.issue === issue);
  const work = here.filter(claim => claim.role === 'work');
  const mine = work.some(claim => claim.login === me);
  const open = Boolean(details) && details.state === 'open' && !details.pull_request;
  const assignees = Array.isArray(details?.assignees) ? details.assignees : [];
  const assignedToOthers = assignees.filter(user => isLogin(user?.login) && user.login !== me).length;
  const otherPullRequests = pulls.filter(pull => pull.author !== me && pull.issues.includes(issue)).map(pull => pull.number);
  const areaOverlaps = areas.length === 0 ? [] : state.claims
    .filter(claim => claim.issue !== issue && claim.role === 'work')
    .map(claim => ({ issue: claim.issue, areas: claim.areas.filter(area => areas.includes(area)), mine: claim.login === me }))
    .filter(overlap => overlap.areas.length > 0);
  const advice = !open ? 'notOpen' : mine ? 'yours' : work.length > 0 ? 'proposeInstead'
    : assignedToOthers > 0 || otherPullRequests.length > 0 ? 'takenOutside' : 'free';
  return { issue, open, claimed: work.length > 0, claimedByMe: mine, claimants: work.length, reviewers: here.length - work.length,
    pendingProposals: state.proposals.filter(proposal => proposal.issue === issue).length, assignedToOthers, otherPullRequests,
    areaOverlaps, advice };
}

export function overlapView({ workingTree, myPulls, otherPulls }, config) {
  const sources = [...(workingTree ? [{ source: 'workingTree', files: workingTree }] : []),
    ...myPulls.map(pull => ({ source: pull.number, files: pull.files }))];
  const overlaps = [];
  for (const { source, files } of sources) {
    for (const other of otherPulls) {
      const shared = sharedFiles(files, other.files, config);
      if (shared.sharedFiles > 0) overlaps.push({ source, pullRequest: other.number, ...shared });
    }
  }
  return { changedFiles: workingTree ? workingTree.size : null, myPullRequests: myPulls.map(pull => pull.number), overlaps };
}

function proposalView(proposal) {
  return { id: proposal.id, issue: proposal.issue, kind: proposal.kind, areas: proposal.areas };
}

function iso(time) {
  return new Date(time).toISOString();
}
