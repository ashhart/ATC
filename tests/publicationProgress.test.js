import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './publicationFixture.js';

async function prepare(t, count = 11, conflict = false) {
  const f = fixture(t);
  f.pulls = Array.from({ length: count }, (_, i) => f.peer('bob', ['src/b.js'],
    conflict && i === count - 1 ? f.original.replace('value = 1', 'value = 99') : f.original.replace('// line 29', `// peer ${i}`)));
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true);
  f.change(f.original.replace('value = 1', 'value = 40'));
  return f;
}

async function settle(f, attempts = 6) {
  let result;
  for (let i = 0; i < attempts; i++) {
    result = await f.run(['guard', '--publish']);
    if (result.outcome !== 'incomplete') break;
  }
  return result;
}

test('normal publication advances beyond the first ten clean overlaps', async t => {
  const f = await prepare(t);
  const first = await f.run(['guard', '--publish']);
  assert.deepEqual([first.ready, first.complete, first.outcome], [false, false, 'incomplete']);
  const second = await f.run(['guard', '--publish']);
  assert.deepEqual([second.ready, second.complete, second.outcome], [true, true, 'ready']);
});

test('a conflict after the tenth of 42 overlaps is discovered without clearing unknowns', async t => {
  const f = await prepare(t, 42, true);
  const result = await settle(f);
  assert.equal(result.ready, false);
  assert.equal(result.outcome, 'mergeConflicts');
});

test('a changed PR head invalidates a clean checkpoint even without an update timestamp change', async t => {
  const f = await prepare(t);
  assert.equal((await settle(f)).ready, true);
  const updatedAt = f.pulls[0].updated_at;
  f.command(['stash', 'push', '-qu']);
  f.update(f.pulls[0], ['src/b.js'], f.original.replace('value = 1', 'value = 99'));
  f.command(['stash', 'pop', '-q']);
  assert.equal(f.pulls[0].updated_at, updatedAt);
  const result = await settle(f);
  assert.deepEqual([result.ready, result.outcome], [false, 'mergeConflicts']);
});

test('changed local bytes invalidate clean publication checks', async t => {
  const f = await prepare(t);
  assert.equal((await settle(f)).ready, true);
  f.change(f.original.replace('value = 1', 'value = 40').replace('// line 29', '// local changed'));
  assert.deepEqual((await settle(f)).outcome, 'mergeConflicts');
});

test('missing current PR metadata cannot reuse a prior clean checkpoint', async t => {
  const f = await prepare(t);
  assert.equal((await settle(f)).ready, true);
  delete f.pulls[0].head;
  const result = await settle(f, 2);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
});

test('an unavailable merge stays unknown across progress calls', async t => {
  const f = await prepare(t);
  const exec = f.git.exec;
  f.git.exec = (args, ...rest) => args[0] === 'merge-tree' ? { status: 2, stdout: '' } : exec(args, ...rest);
  const result = await settle(f, 2);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
});

test('a newly discovered PR during the scan prevents publication readiness', async t => {
  const f = await prepare(t, 1);
  const run = f.fake.runGh;
  let reads = 0;
  f.fake.runGh = args => {
    const result = run(args);
    if (args.some(value => value.startsWith('repos/acme/widgets/pulls?')) && ++reads === 1) {
      f.fake.addPull({ author: 'carol', files: [] });
    }
    return result;
  };
  const result = await f.run(['guard', '--publish']);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
  assert.equal((await settle(f)).ready, true);
});

test('local edits during a merge check cannot be cleared by its earlier snapshot', async t => {
  const f = await prepare(t, 1);
  const exec = f.git.exec;
  let edited = false;
  f.git.exec = (args, ...rest) => {
    const result = exec(args, ...rest);
    if (!edited && args[0] === 'merge-tree') {
      edited = true;
      f.change(f.original.replace('value = 1', 'value = 40').replace('// line 29', '// changed during scan'));
    }
    return result;
  };
  const result = await f.run(['guard', '--publish']);
  assert.equal(edited, true);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
});

test('publication sees a conflict in the twenty-first local worktree', async t => {
  const f = await prepare(t, 0);
  const folders = [];
  t.after(() => folders.forEach(folder => fs.rmSync(folder, { recursive: true, force: true })));
  for (let i = 0; i < 21; i++) {
    const folder = f.folder + '-peer-' + i;
    folders.push(folder);
    f.command(['worktree', 'add', '-qb', 'worktree-' + i, folder, 'main']);
    if (i === 20) fs.writeFileSync(path.join(folder, 'src/b.js'), f.original.replace('value = 1', 'value = 99'));
  }
  assert.deepEqual((await f.run(['guard', '--publish'])).outcome, 'mergeConflicts');
});

test('failed worktree discovery remains incomplete', async t => {
  const f = await prepare(t, 0);
  const exec = f.git.exec;
  f.git.exec = (args, ...rest) => args[0] === 'worktree' ? { status: 1, stdout: '' } : exec(args, ...rest);
  const result = await f.run(['guard', '--publish']);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
});

test('publication bounds git operations to the remaining transport budget', async t => {
  const f = await prepare(t, 1);
  const exec = f.git.exec;
  const limits = [];
  f.git.exec = (args, env, input, options) => {
    if (options) limits.push(options.timeout);
    return exec(args, env, input, options);
  };
  assert.equal((await f.run(['guard', '--publish'])).ready, true);
  assert.ok(limits.length > 0);
  assert.ok(limits.every(timeout => Number.isInteger(timeout) && timeout > 0 && timeout <= 10000));
  for (const timeout of [0, 30001, '1000', NaN]) {
    assert.throws(() => exec(['status'], undefined, undefined, { timeout }), /Invalid git request limits/);
  }
});

test('files added during the snapshot cannot escape the earlier file scope check', async t => {
  const f = await prepare(t, 0);
  const exec = f.git.exec;
  let added = false;
  f.git.exec = (args, ...rest) => {
    if (!added && args[0] === 'add' && args.includes('-A')) {
      added = true;
      fs.writeFileSync(path.join(f.folder, 'src/outside.js'), 'export const outside = true;\n');
    }
    return exec(args, ...rest);
  };
  const result = await f.run(['guard', '--publish']);
  assert.equal(added, true);
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
});

test('a short remaining deadline cannot turn cached progress into readiness', async t => {
  const f = await prepare(t, 1);
  assert.equal((await settle(f)).ready, true);
  const exec = f.git.exec;
  const limits = [];
  f.git.exec = (args, env, input, options) => {
    if (options) limits.push(options.timeout);
    return exec(args, env, input, options);
  };
  const result = await f.run(['guard', '--publish'], { transport: { now: () => 0, deadlineMs: 2000 } });
  assert.deepEqual([result.ready, result.complete, result.outcome], [false, false, 'incomplete']);
  assert.ok(limits.length > 0 && limits.every(timeout => timeout <= 1500));
});

test('disabled checkpoints still inspect every overlap within the normal deadline', async t => {
  const f = await prepare(t);
  const result = await f.run(['guard', '--publish'], { env: { ATC_CACHE: '0' } });
  assert.deepEqual([result.ready, result.complete, result.outcome], [true, true, 'ready']);
});
