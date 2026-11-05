import { booleanValue, count, enumValue, issueList, issueNumber, list, nullable, numberRange, record, rejectUnless } from './outputTypes.js';

const limitation = enumValue('workingTreeUnavailable', 'invalidFiles', 'pullFilesLimit', 'timeLimit', 'configurationUnpinned',
  'selectedPullUnavailable', 'selectedPullChanged', 'conflictChecksUnavailable');
const areas = list(numberRange(1, 24), 24, 0, true);
const conflict = enumValue('clean', 'conflicts', 'unknown');
const overlap = record({ source: enumValue('workingTree'), pullRequest: issueNumber, sharedFiles: numberRange(1, 600),
  areas, conflict, conflictFiles: nullable(count(1000000)) });
const worktree = record({ worktree: numberRange(1, 20), sharedFiles: numberRange(1, 1000000), areas,
  conflict, conflictFiles: nullable(count(1000000)) });
const schema = record({ complete: booleanValue, limitations: list(limitation, 8, 0, true),
  changedFiles: nullable(count(1000000)), myPullRequests: issueList(0), overlaps: list(overlap, 50),
  worktrees: count(20), worktreeOverlaps: list(worktree, 20), coverage: record({ scope: enumValue('selectedPullRequests'),
    requested: list(issueNumber, 50, 1, true), inspected: issueList(50), repositoryComplete: enumValue(false) }) });

export function validateScopedOverlapResult(value) {
  const result = schema(value, { nodes: 0 });
  rejectUnless(result.complete === (result.limitations.length === 0));
  rejectUnless(result.changedFiles !== null || result.limitations.includes('workingTreeUnavailable'));
  rejectUnless(result.coverage.inspected.every(number => result.coverage.requested.includes(number))
    && result.overlaps.every(row => result.coverage.requested.includes(row.pullRequest))
    && (!result.complete || result.coverage.inspected.length === result.coverage.requested.length));
  const validConflict = row => row.conflict === 'unknown' ? row.conflictFiles === null
    : row.conflict === 'clean' ? row.conflictFiles === 0 : row.conflictFiles > 0;
  rejectUnless(result.overlaps.every(row => validConflict(row) && row.sharedFiles <= result.changedFiles)
    && result.worktreeOverlaps.every(row => validConflict(row) && row.worktree <= result.worktrees && row.sharedFiles <= result.changedFiles)
    && new Set(result.worktreeOverlaps.map(row => row.worktree)).size === result.worktreeOverlaps.length);
  return result;
}
