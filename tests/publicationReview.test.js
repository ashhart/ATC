import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './publicationFixture.js';
import { createTrees } from '../src/cli/gitTrees.js';
import { createPublicationCache } from '../src/cli/publicationCache.js';

for (const phase of ['diff', 'ls-files', 'base']) test(`publication refuses a deadline crossed during the final ${phase} read`, async t => {
  const f = fixture(t);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true);
  f.change(f.original.replace('value = 1', 'value = 40'));
  let elapsed = 0;
  let diffs = 0;
  let afterDiff = false;
  let triggered = false;
  const budgets = [];
  f.steps.afterGit = (args, limits) => {
    if (args[0] === 'diff') {
      diffs++;
      if (diffs === 2) {
        afterDiff = true;
        if (phase === 'diff') { triggered = true; elapsed = 30001; }
        if (phase === 'ls-files') elapsed = 29000;
        budgets.push(limits?.timeout);
      }
    }
    if (phase === 'ls-files' && afterDiff && args[0] === 'ls-files') {
      triggered = true; elapsed = 30001; budgets.push(limits?.timeout);
    }
    if (phase === 'base' && afterDiff && args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'HEAD^{commit}') {
      triggered = true; elapsed = 30001; budgets.push(limits?.timeout);
    }
  };
  const result = await f.run(['guard', '--publish'], { transport: { now: () => elapsed } });
  assert.equal(triggered, true);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
  assert.ok(budgets.length && budgets.every(value => Number.isInteger(value) && value > 0 && value <= 10000));
  if (phase === 'ls-files') assert.ok(budgets.at(-1) <= 500);
});

function write(folder, name, contents) {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

test('checkpoints from the old exact-path policy cannot clear a file/directory conflict', async t => {
  const f = fixture(t);
  const pull = f.peer('bob', ['src/newdir'], 'peer\n');
  assert.equal((await f.run(['begin', '1', 'src/newdir/leaf.js', '--base', 'HEAD'])).ready, true);
  write(f.folder, 'src/newdir/leaf.js', 'local\n');
  const local = createTrees(f.git).snapshot();
  const base = f.command(['rev-parse', 'HEAD']);
  const old = createHash('sha256').update(JSON.stringify([1, f.fake.repository.toLowerCase(), base, local.head, local.tree,
    pull.number, pull.head.sha, pull.base.sha])).digest('hex');
  createPublicationCache(f.git, f.fake.repository, {}).write(new Set([old]));
  const result = await f.run(['guard', '--publish']);
  assert.equal(result.ready, false);
  assert.equal(result.outcome, 'mergeConflicts');
});

for (const source of ['pull', 'worktree']) for (const directory of [true, false]) {
  test(`publication detects a ${source} file/directory conflict when the local path is a ${directory ? 'directory' : 'file'}`, async t => {
    const f = fixture(t);
    const localPath = directory ? 'src/newdir/leaf.js' : 'src/newdir';
    const otherPath = directory ? 'src/newdir' : 'src/newdir/leaf.js';
    let other;
    let peerFolder;
    if (source === 'pull') other = f.peer('bob', [otherPath], 'peer\n').head.sha;
    else {
      peerFolder = f.folder + '-review-peer';
      t.after(() => fs.rmSync(peerFolder, { recursive: true, force: true }));
      f.command(['worktree', 'add', '-qb', 'review-peer', peerFolder, 'main']);
      write(peerFolder, otherPath, 'peer\n');
    }
    assert.equal((await f.run(['begin', '1', localPath, '--base', 'HEAD'])).ready, true);
    write(f.folder, localPath, 'local\n');
    const trees = createTrees(f.git);
    const local = trees.snapshot();
    if (peerFolder) other = trees.snapshot(peerFolder).commit;
    const mine = f.git.changedFiles(f.command(['rev-parse', 'HEAD']));
    const theirs = trees.changedSince(f.command(['rev-parse', 'HEAD']), other);
    assert.equal([...mine].some(file => theirs.has(file)), false, 'there are no exactly shared paths');
    assert.equal(trees.mergeConflicts(local.commit, other).conflict, 'conflicts', 'real git detects the file/directory conflict');
    const result = await f.run(['guard', '--publish']);
    assert.equal(result.ready, false);
    assert.equal(result.outcome, 'mergeConflicts');
  });
}
