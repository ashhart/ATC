import test from 'node:test';
import assert from 'node:assert/strict';
import { inheritedFixture, customDefault } from './inheritedFixture.js';
import { createPublicationCache } from '../src/cli/publicationCache.js';
import { inspectScopedOverlap } from '../src/cli/scopedOverlap.js';
import { readConfig } from '../src/core/config.js';

test('normal guard clears unchanged inherited hunks without storing permissive checkpoints', async t => {
  const f = inheritedFixture(t);
  assert.equal((await f.run(['begin', '1', f.file, '--base', 'HEAD'])).ready, true);
  f.write(`local addition\n${f.baseline}`);
  let merges = 0;
  f.steps.afterGit = args => { if (args[0] === 'merge-tree') merges++; };
  const result = await f.run(['guard', '--publish']);
  assert.deepEqual([result.ready, result.complete], [true, true]);
  assert.ok(merges >= 2);
  assert.equal(createPublicationCache(f.git, f.fake.repository).read().size, 0);
  merges = 0;
  assert.equal((await f.run(['guard', '--publish'])).ready, true);
  assert.ok(merges >= 2, 'inherited proof is recomputed on another invocation');
  f.command(['config', 'merge.conflictstyle', 'diff3']);
  assert.equal((await f.run(['guard', '--publish'])).ready, false, 'changed merge policy cannot reuse inherited clean');
});

test('a real deadline expiring during inherited source reads cannot grant publication', async t => {
  const f = inheritedFixture(t);
  assert.equal((await f.run(['begin', '1', f.file, '--base', 'HEAD'])).ready, true);
  f.write(`local addition\n${f.baseline}`);
  let elapsed = 0;
  let crossed = false;
  f.steps.afterGit = args => {
    if (args[0] === 'check-attr') { elapsed = 30001; crossed = true; }
  };
  const result = await f.run(['guard', '--publish'], { transport: { now: () => elapsed } });
  assert.equal(crossed, true);
  assert.equal(result.ready, false);
});

test('a configured custom default driver cannot grant publication despite ordinary matching conflict blocks', async t => {
  const f = inheritedFixture(t);
  assert.equal((await f.run(['begin', '1', f.file, '--base', 'HEAD'])).ready, true);
  f.write(`local addition\n${f.baseline}`);
  assert.equal((await f.run(['guard', '--publish'])).ready, true);
  customDefault(f);
  const result = await f.run(['guard', '--publish']);
  assert.equal(result.ready, false);
});

test('scoped diagnostics retain conservative same-file conflicts without running the expanded proof', async t => {
  const f = inheritedFixture(t);
  f.write(`local addition\n${f.baseline}`);
  let elapsed = 0;
  let expandedReads = 0;
  f.steps.afterGit = args => {
    if (args[0] === 'check-attr') { expandedReads++; elapsed = 30001; }
  };
  const repository = 'example/project';
  const context = { repository, git: f.git, cache: false, config: readConfig({}),
    gh: { timeLeft: () => 30000 - elapsed, getOptional: () => ({ number: 7, state: 'open', user: { type: 'User', login: 'bob' },
      head: { sha: f.pull.head.sha }, base: { sha: f.ancestor, repo: { full_name: repository } }, changed_files: 1 }) },
    reader: { defaultBranch: () => 'main', pullFiles: () => ({ files: [f.file], partial: false, invalid: false }) } };
  const result = inspectScopedOverlap(context, { pulls: '7', base: f.base });
  assert.equal(result.overlaps[0].conflict, 'conflicts');
  assert.equal(expandedReads, 0);
});
