export const observedAt = '2026-10-21T12:00:00.000Z';

export function outputStatus() {
  return { repository: 'selected', areas: ['first', 'second'], complete: true, limitations: [],
    summary: { issues: 1, claims: 1, mine: 1, pendingProposals: 1 },
    claims: [{ issue: 1, role: 'work', areas: ['second'], mine: true, since: observedAt, lastActivity: observedAt, pullRequests: [2] }],
    proposalsForMe: [{ id: 100, issue: 1, kind: 'pair', areas: [] }], myProposals: [], refreshDue: [1] };
}

export function outputCheck() {
  return { issue: 1, open: true, complete: true, limitations: [], coordinationEnabled: true, claimed: true, claimedByMe: false, claimants: 1,
    reviewers: 0, pendingProposals: 0, assignedToOthers: 0, otherPullRequests: [2], myPullRequests: [],
    areaOverlaps: [{ issue: 2, areas: ['second'], mine: false }], advice: 'proposeInstead' };
}

export function outputBoard() {
  return { repository: 'selected', observedAt, complete: true, limitations: [], coordinationEnabled: true,
    summary: { contributors: 1, issues: 1, openIssues: 1, openPullRequests: 1, fileOverlaps: 0, opportunities: 1, activeAgents: 0,
      duplicateAttempts: 0, staleClaims: 0 },
    contributors: [{ id: 1, mine: true, workingIssues: [1], reviewingIssues: [], assignedIssues: [], pullRequests: [2] }],
    issues: [{ issue: 1, state: 'open', helpWanted: false, goodFirstIssue: false, assignees: [],
      claims: [{ contributor: 1, mine: true, role: 'work', areas: ['first'], since: observedAt, lastActivity: observedAt }], pullRequests: [2] }],
    pullRequests: [{ pullRequest: 2, contributor: 1, mine: true, draft: false, issues: [1], areas: ['first'],
      changedFiles: 1, createdAt: observedAt, updatedAt: observedAt }], fileOverlaps: [], areaOverlaps: [],
    opportunities: [{ issue: 1, reason: 'activeClaim', signal: 'candidate', actions: ['check'] }], sessions: [], proposals: [],
    duplicateAttempts: [], staleClaims: [] };
}
