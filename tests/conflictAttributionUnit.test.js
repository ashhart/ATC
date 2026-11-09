import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeConflicts, comparisonBase } from '../src/cli/conflictAttribution.js';
import { createTrees } from '../src/cli/gitTrees.js';

test('conflict attribution prefers your own files and treats a missing baseline as unknown', () => {
  const sha = digit => digit.repeat(40);
  const trees = (merge, baseline) => ({ mergeConflicts: (first, second) => (first === sha('b') ? baseline : merge),
    mergeBaseOf: () => sha('b') });
  const conflicts = files => ({ conflict: 'conflicts', files: new Set(files) });
  const call = (host, local) => attributeConflicts(host, { commit: sha('c'), other: sha('d'), base: () => 'main', mine: local });
  assert.deepEqual(call(trees(conflicts(['x.txt', 'y.txt']), null), new Set(['x.txt'])), conflicts(['x.txt']));
  assert.deepEqual(call(trees(conflicts(['y.txt']), conflicts(['y.txt'])), new Set(['x.txt'])), { conflict: 'clean', files: new Set() });
  assert.deepEqual(call(trees(conflicts(['y.txt']), { conflict: 'clean', files: new Set() }), new Set(['x.txt'])), conflicts(['y.txt']));
  assert.deepEqual(call(trees(conflicts(['y.txt']), conflicts(['z.txt'])), new Set(['x.txt'])), conflicts(['y.txt']));
  assert.deepEqual(call(trees(conflicts(['y.txt']), { conflict: 'unknown', files: null }), new Set(['x.txt'])), { conflict: 'unknown', files: null });
  assert.deepEqual(call(trees(conflicts(['y.txt']), null), new Set(['x.txt'])), { conflict: 'unknown', files: null });
  assert.deepEqual(call({ ...trees(conflicts(['y.txt']), conflicts([])), mergeBaseOf: () => null }, new Set(['x.txt'])), { conflict: 'unknown', files: null });
  assert.deepEqual(call(trees(conflicts(['y.txt']), conflicts([])), null), { conflict: 'unknown', files: null });
  assert.deepEqual(call(trees({ conflict: 'clean', files: new Set() }, null), new Set(['x.txt'])), { conflict: 'clean', files: new Set() });
  assert.deepEqual(call(trees({ conflict: 'conflicts', files: null }, null), new Set(['x.txt'])), { conflict: 'unknown', files: null });
  assert.deepEqual(call(trees(conflicts([`y.txt~${sha('c')}`]), conflicts([`y.txt~${sha('b')}`])), new Set(['x.txt'])), { conflict: 'clean', files: new Set() });
  assert.deepEqual(call(trees(conflicts([`x.txt~${sha('c')}`]), null), new Set(['x.txt'])), conflicts(['x.txt']));
});

test('the comparison base uses an explicit base, or reads the current tip once and fails to null', () => {
  const tip = 'a'.repeat(40);
  let reads = 0;
  const context = { repository: 'acme/widgets', reader: { defaultBranch: () => 'main' }, gh: { get: () => { reads++; return { sha: tip }; } },
    git: { exec: () => ({ status: 0 }) } };
  assert.equal(comparisonBase(context, { base: 'release' })(), 'release');
  assert.equal(reads, 0);
  const current = comparisonBase(context, {});
  assert.equal(current(), tip);
  assert.equal(current(), tip);
  assert.equal(reads, 1);
  const failed = comparisonBase({ ...context, gh: { get: () => { reads++; throw new Error('offline'); } } }, {});
  assert.equal(failed(), null);
  assert.equal(failed(), null);
  assert.equal(reads, 2);
});

test('the merge base lookup accepts only a commit id and a safe ref name', () => {
  const calls = [];
  const trees = createTrees({ exec: args => { calls.push(args); return { status: 0, stdout: `${'e'.repeat(40)}\n` }; } });
  assert.equal(trees.mergeBaseOf('c'.repeat(40), 'main'), 'e'.repeat(40));
  assert.deepEqual(calls, [['merge-base', 'c'.repeat(40), 'main']]);
  for (const [commit, base] of [['--all', 'main'], ['c'.repeat(40), '--upload-pack=x'], ['c'.repeat(40), 'a\nb'], ['c'.repeat(40), null]]) {
    assert.equal(trees.mergeBaseOf(commit, base), null);
  }
  assert.equal(calls.length, 1);
});
