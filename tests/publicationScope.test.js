import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './publicationFixture.js';
import { setup } from './helpers.js';
import { createGh } from '../src/cli/gh.js';
import { createReader } from '../src/cli/reader.js';
import { inspectOverlap } from '../src/cli/overlap.js';

test('publication checks the worktree while ordinary overlap retains unrelated portfolio conflicts', async t => {
  const f = fixture(t); f.fake.addIssue();
  f.peer('alice', ['src/a.js'], 20, 'Refs #2'); f.peer('bob', ['src/a.js'], 30);
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const overview = await f.run(['overlap', '--base', 'HEAD']);
  assert.ok(overview.overlaps.some(row => row.source !== 'workingTree' && row.conflict === 'conflicts'));
  const cache = join(f.folder, '.git', 'atc', 'traffic.json');
  const before = readFileSync(cache, 'utf8');
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, true); assert.equal(guard.complete, true);
  assert.equal(readFileSync(cache, 'utf8'), before);
});

test('a same-account peer still blocks conflicting worktree publication', async t => {
  const f = fixture(t); f.fake.addIssue(); f.peer('alice', ['src/b.js'], 20, 'Refs #2');
  assert.equal((await f.run(['begin', '1', 'src/b.js', '--base', 'HEAD'])).ready, true); f.change();
  const guard = await f.run(['guard', '--publish']);
  assert.equal(guard.ready, false); assert.equal(guard.outcome, 'mergeConflicts');
  assert.equal(existsSync(join(f.folder, '.git', 'atc', 'traffic.json')), false);
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
