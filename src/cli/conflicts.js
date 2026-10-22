import { sharedFiles } from '../core/pulls.js';

const maxChecks = 10;

export function checkConflicts({ trees, remote, base, overlaps, workingFiles, sourceFiles = new Map(), config, labels }) {
  const checked = overlaps.map(overlap => ({ ...overlap, conflict: 'unknown', conflictFiles: null }));
  if (!trees) return { overlaps: checked, worktrees: 0, worktreeOverlaps: [] };
  const local = workingFiles ? trees.snapshot() : null;
  const heads = new Map();
  const head = number => {
    if (!heads.has(number)) heads.set(number, remote ? trees.fetchPull(remote, number) : null);
    return heads.get(number);
  };
  for (const overlap of checked.slice(0, maxChecks)) {
    const source = overlap.source === 'workingTree' ? local?.commit : head(overlap.source);
    const other = head(overlap.pullRequest);
    if (!source || !other) continue;
    const mine = overlap.source === 'workingTree' ? workingFiles : sourceFiles.get(overlap.source);
    const result = yours(trees.mergeConflicts(source, other), mine);
    overlap.conflict = result.conflict;
    overlap.conflictFiles = result.files ? result.files.size : null;
    labels?.conflicts.set(`${overlap.source}:${overlap.pullRequest}`, result.files ? [...result.files].sort() : []);
  }
  const worktrees = base && workingFiles ? trees.worktrees() : [];
  const worktreeOverlaps = [];
  worktrees.forEach((worktree, index) => {
    labels?.worktrees.set(index + 1, worktree.branch);
    const theirs = trees.snapshot(worktree.path);
    const files = theirs && trees.changedSince(base, theirs.commit, worktree.path);
    if (!files) return;
    const shared = sharedFiles(workingFiles, files, config);
    if (shared.sharedFiles === 0) return;
    const result = local ? yours(trees.mergeConflicts(local.commit, theirs.commit), workingFiles) : { conflict: 'unknown', files: null };
    labels?.conflicts.set(`worktree:${index + 1}`, result.files ? [...result.files].sort() : []);
    labels?.shared.set(`worktree:${index + 1}`, [...workingFiles].filter(file => files.has(file)).sort());
    worktreeOverlaps.push({ worktree: index + 1, ...shared, conflict: result.conflict, conflictFiles: result.files ? result.files.size : null });
  });
  return { overlaps: checked, worktrees: worktrees.length, worktreeOverlaps };
}

function yours(result, mine) {
  if (result.conflict !== 'conflicts') return result;
  if (!(mine instanceof Set)) return { conflict: 'unknown', files: null };
  const files = new Set([...result.files].filter(file => mine.has(file)));
  return files.size > 0 ? { conflict: 'conflicts', files } : { conflict: 'clean', files };
}
