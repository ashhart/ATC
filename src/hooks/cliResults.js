import { isNumberIn, isRecord, isTimestamp, readNumbers } from './hookValues.js';

const conflictStates = ['clean', 'conflicts', 'unknown'];
const summaryFields = ['openIssues', 'openPullRequests', 'fileOverlaps', 'opportunities', 'activeAgents'];

export function readWhoResult(value) {
  if (!isRecord(value) || typeof value.complete !== 'boolean') return null;
  const pullRequests = readNumbers(value.pullRequests, 300, 1, 999999999);
  if (pullRequests === null || !isNumberIn(value.worktrees, 0, 1000)) return null;
  return { complete: value.complete, pullRequests, worktrees: value.worktrees };
}

export function readOverlapResult(value) {
  if (!isRecord(value) || typeof value.complete !== 'boolean' || !Array.isArray(value.overlaps) || value.overlaps.length > 330) return null;
  const worktreeRows = value.worktreeOverlaps === undefined ? [] : value.worktreeOverlaps;
  if (!Array.isArray(worktreeRows) || worktreeRows.length > 1000) return null;
  const pulls = value.overlaps.map(row => readRow(row, 'pullRequest', 999999999));
  const worktrees = worktreeRows.map(row => readRow(row, 'worktree', 1000));
  if (pulls.includes(null) || worktrees.includes(null)) return null;
  return { complete: value.complete, pulls: mergeRows(pulls), worktrees: mergeRows(worktrees) };
}

export function readBoardSummary(value) {
  if (!isRecord(value) || typeof value.complete !== 'boolean' || !isTimestamp(value.observedAt) || !isRecord(value.summary)) return null;
  const summary = { observedAt: value.observedAt, complete: value.complete };
  for (const field of summaryFields) {
    if (!isNumberIn(value.summary[field], 0, 100000)) return null;
    summary[field] = value.summary[field];
  }
  return summary;
}

function readRow(row, key, highest) {
  if (!isRecord(row) || !isNumberIn(row[key], 1, highest) || !isNumberIn(row.sharedFiles, 1, 1000000)) return null;
  if (row.source !== undefined && row.source !== 'workingTree' && !isNumberIn(row.source, 1, 999999999)) return null;
  const conflict = row.conflict === undefined ? 'unknown' : row.conflict;
  const conflictFiles = row.conflictFiles === undefined ? null : row.conflictFiles;
  if (!conflictStates.includes(conflict) || (conflictFiles !== null && !isNumberIn(conflictFiles, 0, 1000000))) return null;
  return { id: row[key], conflict, conflictFiles };
}

function mergeRows(rows) {
  const ranks = { clean: 0, unknown: 1, conflicts: 2 };
  const merged = new Map();
  for (const row of rows) {
    const known = merged.get(row.id);
    if (!known || ranks[row.conflict] > ranks[known.conflict]) merged.set(row.id, row);
    else if (row.conflict === known.conflict && (row.conflictFiles ?? -1) > (known.conflictFiles ?? -1)) merged.set(row.id, row);
  }
  return [...merged.values()].sort((first, second) => first.id - second.id);
}
