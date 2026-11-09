import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { setup } from './helpers.js';
import { createGh } from '../src/cli/gh.js';
import { createGit } from '../src/cli/git.js';
import { createReader } from '../src/cli/reader.js';
import { inspectOverlap } from '../src/cli/overlap.js';
import { parseCliArgs } from '../src/cli/args.js';
import { runCli } from '../src/cli/actions.js';

function fixture(t) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-publication-scope-')));
  const origin = folder + '-origin.git';
  t.after(() => { fs.rmSync(folder, { recursive: true, force: true }); fs.rmSync(origin, { recursive: true, force: true }); });
  const command = args => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  command(['init', '-q', '-b', 'main']); command(['init', '-q', '--bare', origin]);
  command(['config', 'user.name', 'Fixture']); command(['config', 'user.email', 'fixture@example.invalid']);
  fs.mkdirSync(path.join(folder, 'src'));
  for (const file of ['a.js', 'b.js']) fs.writeFileSync(path.join(folder, 'src', file), 'export const value = 1;\n');
  command(['add', '.']); command(['commit', '-qm', 'Fixture']); command(['remote', 'add', 'origin', origin]);
  const git = createGit((args, env, input) => spawnSync('git', args, { cwd: folder, encoding: 'utf8', input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } }));
  git.remoteFor = () => 'origin';
  const fake = setup(); fake.addIssue();
  const run = args => runCli(parseCliArgs(args), { gh: createGh(fake.runGh), git, now: () => fake.clock.now,
    sleep: async () => { fake.clock.now += 1000; }, cwd: folder, doctorCheck: () => ({ ready: true }) });
  const peer = (author, files, value, body = '') => {
    const pull = fake.addPull({ author, files, body });
    command(['checkout', '-qb', 'peer-' + pull.number, 'main']);
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), `export const value = ${value};\n`);
    }
    command(['add', '.']); command(['commit', '-qm', 'Peer change']);
    command(['push', '-q', 'origin', `HEAD:refs/pull/${pull.number}/head`]); command(['checkout', '-q', 'main']);
    return pull;
  };
  const change = () => fs.writeFileSync(path.join(folder, 'src/b.js'), 'export const value = 40;\n');
  return { folder, fake, run, peer, change };
}

test('publication checks the worktree while ordinary overlap retains unrelated portfolio conflicts', async t => {
  const f = fixture(t); f.fake.addIssue();
  f.peer('alice', ['src/a.js'], 20, 'Refs #2'); f.peer('bob', ['src/a.js'], 30);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const overview = await f.run(['overlap', '--base', 'HEAD']);
  assert.ok(overview.overlaps.some(row => row.source !== 'workingTree' && row.conflict === 'conflicts'));
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, true); assert.equal(guard.complete, true);
});

test('a same-account peer still blocks conflicting worktree publication', async t => {
  const f = fixture(t); f.fake.addIssue(); f.peer('alice', ['src/b.js'], 20, 'Refs #2');
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.outcome, 'mergeConflicts');
});

test('a foreign peer cannot exempt itself by referencing the ticket issue', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true);
  f.peer('bob', ['src/b.js'], 20, 'Refs #1'); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.outcome, 'mergeConflicts');
});

test('same-account issue references cannot exempt an unavailable peer head', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true);
  f.fake.addPull({ author: 'alice', files: ['src/b.js'], body: 'Fixes #1' }); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.outcome, 'incomplete');
});

test('unrelated same-account PR count does not make a ticket guard incomplete', async t => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++) f.fake.addPull({ author: 'alice', files: [] });
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, true); assert.equal(guard.complete, true);
});

test('publication reads a larger peer file list before deciding its actual conflict', async t => {
  const f = fixture(t);
  const files = [...Array.from({ length: 301 }, (_, i) => `extra/file-${i}.js`), 'src/b.js'];
  f.peer('bob', files, 20);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.outcome, 'mergeConflicts');
});

test('ticket publication covers more than two hundred peer PRs', async t => {
  const f = fixture(t);
  for (let i = 0; i < 203; i++) f.fake.addPull({ author: 'bob', files: [] });
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, true); assert.equal(guard.complete, true);
});

test('ticket publication still denies an incomplete repository PR set', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true);
  for (let i = 0; i < 301; i++) f.fake.addPull({ author: 'bob', files: [] });
  f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.complete, false); assert.equal(guard.outcome, 'incomplete');
});

test('the larger publication file budget remains bounded and fails closed', async t => {
  const f = fixture(t);
  f.fake.addPull({ author: 'bob', files: Array.from({ length: 3001 }, (_, i) => `extra/file-${i}.js`) });
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.complete, false); assert.equal(guard.outcome, 'incomplete');
});

test('publication reader rejects malformed budgets and internal ticket issue values', () => {
  const fake = setup(); const reader = createReader(createGh(fake.runGh), fake.repository);
  for (const value of [0, 31, '30', null, NaN]) assert.throws(() => reader.pullFiles(1, value), /Invalid pull request budget/);
  for (const value of [0, -1, '1', null]) assert.throws(() => inspectOverlap({}, {}, { workingTreeOnly: value }), /Invalid publication scope/);
});
