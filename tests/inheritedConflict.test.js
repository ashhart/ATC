import test from 'node:test';
import assert from 'node:assert/strict';
import { inheritedFixture } from './inheritedFixture.js';

for (const edit of ['before', 'after']) test(`unchanged inherited hunk stays clean with a distant local edit ${edit} it`, t => {
  const f = inheritedFixture(t);
  f.write(edit === 'before' ? `local addition\n${f.baseline}` : f.baseline.replace('unique line 55', 'local edit'));
  const local = f.trees.snapshot();
  assert.equal(f.trees.mergeConflicts(f.base, f.pull.head.sha).conflict, 'conflicts');
  assert.equal(f.trees.mergeConflicts(local.commit, f.pull.head.sha).conflict, 'conflicts');
  assert.deepEqual(f.inspect(), { conflict: 'clean', files: new Set(), cacheable: false });
});

for (const kind of ['inside', 'new', 'adjacent']) test(`local ${kind} conflict remains blocking`, t => {
  const f = inheritedFixture(t);
  if (kind === 'inside') f.write(f.baseline.replace('main conflict', 'local conflict'));
  else if (kind === 'adjacent') f.write(f.baseline.replace('unique line 31', 'local adjacent'));
  else {
    f.update(f.pull, [f.file], f.baseline.replace('main conflict', 'peer conflict').replace('unique line 55', 'peer second'));
    f.command(['checkout', '-q', 'main']);
    f.write(f.baseline.replace('unique line 55', 'local second'));
  }
  assert.equal(f.inspect().conflict, 'conflicts');
});
