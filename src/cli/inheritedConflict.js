import { conflictSource } from './conflictSource.js';
import { conflictBlocks, uniqueRange, mappedRanges, same } from './conflictBlocks.js';
import { isCommit } from '../core/plans.js';
import { isFilePath } from './reader.js';

export function inheritedConflict(git, { start, commit, other, actual, baseline, files }) {
  if (![start, commit, other, actual?.tree, baseline?.tree].every(isCommit) || !(files instanceof Set)
    || files.size === 0 || files.size > 20 || ![...files].every(isFilePath)) return false;
  const source = conflictSource(git);
  if (!source.config()) return false;
  const ancestor = source.ancestor(start, other);
  if (!ancestor || source.ancestor(commit, other) !== ancestor) return false;
  for (const file of files) {
    const refs = [ancestor, start, commit, other, baseline.tree, actual.tree];
    if (!source.attributes(null, file) || !refs.every(ref => source.attributes(ref, file))) return false;
    const inputs = refs.map((ref, index) => source.text(ref, file, index < 4));
    if (inputs.some(input => !input) || !inputs.every(input => input.mode === inputs[0].mode)) return false;
    const [, before, after, peer, oldMerge, newMerge] = inputs;
    const oldBlocks = conflictBlocks(oldMerge.lines, start, other);
    const newBlocks = conflictBlocks(newMerge.lines, commit, other);
    if (!oldBlocks || !newBlocks || oldBlocks.length !== newBlocks.length) return false;
    const ranges = [];
    for (let i = 0; i < oldBlocks.length; i++) {
      const old = oldBlocks[i];
      const current = newBlocks[i];
      if (!same(old.ours, current.ours) || !same(old.theirs, current.theirs)) return false;
      const prior = uniqueRange(before.lines, old.ours);
      const local = uniqueRange(after.lines, old.ours);
      if (!prior || !local || !uniqueRange(peer.lines, old.theirs)) return false;
      ranges.push(prior);
    }
    const diff = source.run(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--no-prefix', '--unified=0',
      '--no-indent-heuristic', '--diff-algorithm=myers', '--inter-hunk-context=0', start, commit, '--', `:(literal)${file}`]);
    if (!mappedRanges(diff, before.lines, after.lines, ranges)) return false;
  }
  return source.config();
}
