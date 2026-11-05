import { ensure } from '../core/failure.js';
import { areaReference, readConfig } from '../core/config.js';
import { isNumber, isRepository } from '../core/values.js';
import { sharedFiles } from '../core/pulls.js';
import { createTrees } from './gitTrees.js';
import { isFilePath } from './reader.js';
import { readScopedPulls } from './scopedPullRead.js';
import { isPullHead } from './scopedPullCache.js';
import { hasTime } from './timeBudget.js';
import { validateScopedOverlapResult } from './scopedOverlapOutput.js';

export { validateScopedOverlapResult } from './scopedOverlapOutput.js';

export function selectedPullNumbers(value) {
  ensure(typeof value === 'string' && value.length <= 500 && !/[\r\n]/.test(value)
    && /^[1-9][0-9]{0,8}(?:,[1-9][0-9]{0,8}){0,49}$/.test(value), '--pulls must name up to fifty pull request numbers.');
  const numbers = value.split(',').map(Number);
  ensure(numbers.every(isNumber) && new Set(numbers).size === numbers.length, '--pulls must name up to fifty pull request numbers.');
  return numbers.sort((first, second) => first - second);
}

export function inspectScopedOverlap(context, flags) {
  ensure(isRepository(context.repository), 'Invalid repository');
  const requested = selectedPullNumbers(flags.pulls);
  const config = context.config || readConfig(context.reader.config());
  const limitations = config.areasPinned ? [] : ['configurationUnpinned'];
  let workingFiles = null;
  let base = null;
  let remote = null;
  try {
    remote = context.git.remoteFor(context.repository);
    base = flags.base || (remote && `${remote}/${context.reader.defaultBranch()}`);
    ensure(base, 'No git remote points at the repository. Pass --base.');
    const source = context.git.changedFiles(context.git.mergeBase(base));
    ensure(source instanceof Set && source.size <= 1000000, 'Could not inspect the working tree.');
    workingFiles = new Set([...source].filter(isFilePath));
    if (source.size !== workingFiles.size) limitations.push('invalidFiles');
  } catch (error) {
    if (flags.base) throw error;
    limitations.push('workingTreeUnavailable');
  }
  const read = readScopedPulls(context, requested);
  limitations.push(...read.limitations);
  const trees = workingFiles ? createTrees(context.git) : null;
  const local = trees?.snapshot();
  const overlaps = [];
  if (workingFiles) for (const pull of read.files) {
    const shared = sharedFiles(workingFiles, pull.files, config);
    if (shared.sharedFiles === 0) continue;
    let result = { conflict: 'unknown', files: null };
    if (local && remote && hasTime(context.gh, 2000)) {
      const head = cachedHead(context.git, pull.head) || trees.fetchPull(remote, pull.number);
      if (head === pull.head) result = ownConflicts(trees.mergeConflicts(local.commit, head), workingFiles);
      else if (head) limitations.push('selectedPullChanged');
    }
    if (result.conflict === 'unknown') limitations.push('conflictChecksUnavailable');
    overlaps.push({ source: 'workingTree', pullRequest: pull.number, sharedFiles: shared.sharedFiles,
      areas: numericAreas(shared.areas, config), conflict: result.conflict, conflictFiles: result.files?.size ?? null });
    context.labels?.shared.set(`workingTree:${pull.number}`, [...workingFiles].filter(file => pull.files.has(file)).sort());
    context.labels?.conflicts.set(`workingTree:${pull.number}`, result.files ? [...result.files].sort() : []);
  }
  const worktrees = trees && base && workingFiles ? trees.worktrees() : [];
  const worktreeOverlaps = [];
  worktrees.forEach((worktree, index) => {
    const theirs = trees.snapshot(worktree.path);
    const files = theirs && trees.changedSince(base, theirs.commit, worktree.path);
    if (!files) { limitations.push('conflictChecksUnavailable'); return; }
    const shared = sharedFiles(workingFiles, files, config);
    if (shared.sharedFiles === 0) return;
    const result = local ? ownConflicts(trees.mergeConflicts(local.commit, theirs.commit), workingFiles) : { conflict: 'unknown', files: null };
    if (result.conflict === 'unknown') limitations.push('conflictChecksUnavailable');
    worktreeOverlaps.push({ worktree: index + 1, sharedFiles: shared.sharedFiles, areas: numericAreas(shared.areas, config),
      conflict: result.conflict, conflictFiles: result.files?.size ?? null });
    context.labels?.worktrees.set(index + 1, worktree.branch);
    context.labels?.shared.set(`worktree:${index + 1}`, [...workingFiles].filter(file => files.has(file)).sort());
    context.labels?.conflicts.set(`worktree:${index + 1}`, result.files ? [...result.files].sort() : []);
  });
  const reasons = [...new Set(limitations)].sort();
  return validateScopedOverlapResult({ complete: reasons.length === 0, limitations: reasons,
    changedFiles: workingFiles?.size ?? null, myPullRequests: [], overlaps, worktrees: worktrees.length, worktreeOverlaps,
    coverage: { scope: 'selectedPullRequests', requested, inspected: read.inspected, repositoryComplete: false } });
}

function numericAreas(areas, config) {
  return config.areasPinned ? areas.map(area => areaReference(config, area)).sort((first, second) => first - second) : [];
}

function cachedHead(git, head) {
  if (!isPullHead(head) || typeof git?.exec !== 'function') return null;
  const result = git.exec(['cat-file', '-t', head]);
  return result?.status === 0 && result.stdout === 'commit\n' ? head : null;
}

function ownConflicts(result, workingFiles) {
  if (result.conflict !== 'conflicts') return result;
  const files = result.files instanceof Set ? new Set([...result.files].filter(file => workingFiles.has(file))) : null;
  return files ? { conflict: files.size > 0 ? 'conflicts' : 'clean', files } : { conflict: 'unknown', files: null };
}
