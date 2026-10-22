import { areaList, artifactId, booleanValue, contributorId, enumValue, issueList, issueNumber, list, nullable, record, timestamp } from './outputTypes.js';

export const limitations = list(enumValue('commentsLimit', 'openIssuesLimit', 'pullRequestsLimit', 'invalidPulls', 'boardPullRequestsLimit',
  'pullFilesLimit', 'invalidFiles', 'contributorReferencesUnavailable', 'pullFilesUnavailable', 'workingTreeUnavailable',
  'myPullRequestsLimit', 'otherPullRequestsLimit', 'configurationUnpinned', 'inconsistentComments'), 14, 0, true);

export const proposalKind = enumValue('pair', 'split', 'takeover', 'review');
export const role = enumValue('work', 'review');
export const actor = { contributor: nullable(contributorId), mine: booleanValue };
export const proposal = record({ id: artifactId, issue: issueNumber, kind: proposalKind, areas: areaList });
export const claim = record({ issue: issueNumber, role, areas: areaList, mine: booleanValue,
  since: timestamp, lastActivity: timestamp, pullRequests: issueList(300) });
export const scopedClaim = record({ ...actor, role, areas: areaList, since: timestamp, lastActivity: timestamp });
