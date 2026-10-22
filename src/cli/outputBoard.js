import { actor, limitations, proposal, scopedClaim } from './outputRecords.js';
import { areaList, booleanValue, contributorId, count, enumValue, issueList, issueNumber, list, nullable, numberRange, record, rejectUnless, sessionId, timestamp } from './outputTypes.js';

const contributor = record({ id: nullable(contributorId), mine: booleanValue, workingIssues: issueList(1000), reviewingIssues: issueList(1000),
  assignedIssues: issueList(1000), pullRequests: issueList(300) });
const issue = record({ issue: issueNumber, state: enumValue('open', 'unknown'), helpWanted: booleanValue, goodFirstIssue: booleanValue,
  assignees: list(record(actor), 100), claims: list(scopedClaim, 3000), pullRequests: issueList(300) });
const pull = record({ pullRequest: issueNumber, ...actor, draft: booleanValue, issues: issueList(20), areas: areaList,
  changedFiles: nullable(count(600)), createdAt: timestamp, updatedAt: timestamp });
const pair = list(issueNumber, 2, 2, true);
const fileOverlap = record({ pullRequests: pair, sharedFiles: numberRange(1, 600), areas: areaList });
const areaOverlap = record({ pullRequests: pair, areas: areaList });
const opportunity = record({ issue: issueNumber, reason: enumValue('helpWanted', 'goodFirstIssue', 'unassigned', 'activeClaim'),
  signal: enumValue('request', 'candidate'), actions: list(enumValue('check', 'claim', 'proposePair', 'proposeReview', 'proposeSplit'), 5, 1, true) });
const session = record({ session: sessionId, contributor: nullable(contributorId), issue: issueNumber,
  state: enumValue('working', 'reviewing', 'blocked'), active: timestamp, expiresAt: timestamp });
const summary = record({ contributors: count(20000), issues: count(7000), openIssues: count(1000), openPullRequests: count(300),
  fileOverlaps: count(19900), opportunities: count(4000), activeAgents: count(60000), duplicateAttempts: count(1000), staleClaims: count(12000) });
const duplicateAttempt = record({ issue: issueNumber, pullRequests: list(issueNumber, 300, 2, true) });
const staleClaim = record({ issue: issueNumber, ...actor, lastActivity: timestamp, expiresAt: timestamp });

const boardSchema = record({ repository: enumValue('selected'), observedAt: timestamp, complete: booleanValue, limitations,
  coordinationEnabled: booleanValue, summary,
  contributors: list(contributor, 20000), issues: list(issue, 7000), pullRequests: list(pull, 300), fileOverlaps: list(fileOverlap, 19900),
  areaOverlaps: list(areaOverlap, 19900), opportunities: list(opportunity, 4000), sessions: list(session, 60000), proposals: list(proposal, 10000),
  duplicateAttempts: list(duplicateAttempt, 1000), staleClaims: list(staleClaim, 12000) });

export function boardOutput(value, context) {
  const result = boardSchema(value, context);
  const { summary } = result;
  rejectUnless(summary.contributors === result.contributors.length && summary.issues === result.issues.length
    && summary.openIssues === result.issues.filter(issue => issue.state === 'open').length
    && summary.openPullRequests === result.pullRequests.length && summary.fileOverlaps === result.fileOverlaps.length
    && summary.opportunities === result.opportunities.length);
  rejectUnless(summary.activeAgents === result.sessions.filter(session => session.state !== 'blocked').length);
  rejectUnless(summary.duplicateAttempts === result.duplicateAttempts.length && summary.staleClaims === result.staleClaims.length);
  const openNumbers = new Set(result.issues.filter(issue => issue.state === 'open').map(issue => issue.issue));
  rejectUnless(result.duplicateAttempts.every(entry => openNumbers.has(entry.issue)));
  rejectUnless(result.staleClaims.every(entry => Date.parse(entry.lastActivity) < Date.parse(entry.expiresAt)));
  rejectUnless(new Set(result.sessions.map(session => session.session)).size === result.sessions.length);
  const contributors = result.contributors.map(row => row.id).filter(id => id !== null);
  rejectUnless(new Set(contributors).size === contributors.length);
  const references = [...result.pullRequests, ...result.sessions, ...result.staleClaims,
    ...result.issues.flatMap(issue => [...issue.assignees, ...issue.claims])];
  rejectUnless(references.every(row => row.contributor === null ? !result.complete : contributors.includes(row.contributor)));
  for (const session of result.sessions) {
    const active = Date.parse(session.active);
    const expiresAt = Date.parse(session.expiresAt);
    const observedAt = Date.parse(result.observedAt);
    rejectUnless(active <= observedAt && observedAt < expiresAt && expiresAt - active === 300000);
  }
  return result;
}
