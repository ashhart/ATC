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
    f.command(['checkout', '-qB', `peer-${f.pull.number}`, f.ancestor]);
    f.write(f.baseline.replace('main conflict', 'peer conflict').replace('unique line 55', 'peer second'));
    f.command(['add', '.']); f.command(['commit', '-qm', 'Peer adds second conflict']);
    f.pull.head.sha = f.command(['rev-parse', 'HEAD']);
    f.command(['push', '-q', '--force', 'origin', `HEAD:refs/pull/${f.pull.number}/head`]);
    f.command(['checkout', '-q', 'main']);
    f.write(f.baseline.replace('unique line 55', 'local second'));
    const baseline = f.trees.mergeConflicts(f.base, f.pull.head.sha);
    const actual = f.trees.mergeConflicts(f.trees.snapshot().commit, f.pull.head.sha);
    assert.equal(baseline.conflict, 'conflicts');
    assert.equal(actual.conflict, 'conflicts');
    const blocks = result => f.git.exec(['show', `${result.tree}:${f.file}`]).stdout.match(/^<<<<<<< /gm)?.length;
    assert.equal(blocks(baseline), 1);
    assert.equal(blocks(actual), 2);
  }
  assert.equal(f.inspect().conflict, 'conflicts');
});
