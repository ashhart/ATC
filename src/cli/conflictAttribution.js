import { workBase } from './workBase.js';

export function attributeConflicts(trees, { commit, other, base, mine }) {
  const result = trees.mergeConflicts(commit, other);
  if (result.conflict !== 'conflicts') return result;
  if (!(mine instanceof Set) || !(result.files instanceof Set)) return unknown();
  const files = plainPaths(result.files, commit);
  const direct = new Set([...files].filter(file => mine.has(file)));
  if (direct.size > 0) return { conflict: 'conflicts', files: direct };
  const start = trees.mergeBaseOf(commit, base());
  const without = start && trees.mergeConflicts(start, other);
  if (!without || without.conflict === 'unknown') return unknown();
  const before = plainPaths(without.files, start);
  const added = new Set([...files].filter(file => !before.has(file)));
  return added.size > 0 ? { conflict: 'conflicts', files: added } : { conflict: 'clean', files: new Set() };
}

export function comparisonBase(context, flags) {
  let value;
  return () => {
    if (value === undefined) value = flags.base || currentTip(context);
    return value;
  };
}

function currentTip(context) {
  try { return workBase(context, null, { fetchMissing: true }); } catch { return null; }
}

function plainPaths(files, side) {
  const label = `~${side}`;
  return new Set([...files].map(file => (file.endsWith(label) ? file.slice(0, -label.length) : file)));
}

function unknown() {
  return { conflict: 'unknown', files: null };
}
