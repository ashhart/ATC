import { claim, limitations, proposal } from './outputRecords.js';
import { areaList, booleanValue, count, enumValue, issueList, issueNumber, list, nullable, numberRange, record, timestamp } from './outputTypes.js';

const areaOverlap = record({ issue: issueNumber, areas: areaList, mine: booleanValue });
const overlapSource = value => value === 'workingTree' ? value : issueNumber(value);
const conflict = enumValue('clean', 'conflicts', 'unknown');
const overlap = record({ source: overlapSource, pullRequest: issueNumber, sharedFiles: numberRange(1, 600), areas: areaList,
  conflict, conflictFiles: nullable(count(100000)) });
const worktreeOverlap = record({ worktree: numberRange(1, 20), sharedFiles: numberRange(1, 1000000), areas: areaList,
  conflict, conflictFiles: nullable(count(1000000)) });

export const statusOutput = record({ repository: enumValue('selected'), areas: areaList, complete: booleanValue, limitations,
  summary: record({ issues: count(1000), claims: count(12000), mine: count(1000), pendingProposals: count(10000) }),
  claims: list(claim, 12000), proposalsForMe: list(proposal, 10000), myProposals: list(proposal, 10000), refreshDue: issueList(1000) });

export const checkOutput = record({ issue: issueNumber, open: booleanValue, complete: booleanValue, limitations, coordinationEnabled: booleanValue,
  claimed: booleanValue, claimedByMe: booleanValue, claimants: count(10), reviewers: count(3000), pendingProposals: count(10),
  assignedToOthers: count(100), otherPullRequests: issueList(300), myPullRequests: issueList(300), areaOverlaps: list(areaOverlap, 12000),
  advice: enumValue('free', 'yours', 'proposeInstead', 'takenOutside', 'notOpen', 'incomplete') });

export const overlapOutput = record({ complete: booleanValue, limitations, changedFiles: nullable(count(1000000)),
  myPullRequests: issueList(10), overlaps: list(overlap, 2210), worktrees: count(20), worktreeOverlaps: list(worktreeOverlap, 20) });

export const whoOutput = record({ command: enumValue('who'), complete: booleanValue, limitations, observedAt: nullable(timestamp),
  pullRequests: issueList(300), worktrees: count(20) });
