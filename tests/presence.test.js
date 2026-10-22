import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCommand } from '../src/core/commands.js';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { presenceTtlMs } from '../src/core/presence.js';
import { replay } from '../src/core/replay.js';
import { createGh } from '../src/cli/gh.js';
import { createPresence, localRef } from '../src/cli/localPresence.js';
import { readDocument, updateRef, writeDocument } from '../src/cli/presenceDocs.js';
import { sessionFiles } from '../src/cli/sessionFiles.js';
import { cli, presenceGit, setup } from './helpers.js';

function rawDocument(git, text) {
  const blob = git.exec(['hash-object', '-w', '--stdin'], undefined, text).stdout.trim();
  const tree = git.exec(['mktree'], undefined, `100644 blob ${blob}\tpresence.json\n`).stdout.trim();
  const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  return git.exec(['commit-tree', tree, '-m', 'raw'], env).stdout.trim();
}

test('start, pulse and land stay local and never call GitHub or post a comment', async () => {
  const fake = setup();
  fake.addIssue();
  const git = presenceGit();
  const started = await cli(fake, 'alice', ['start', '1'], { git });
  assert.deepEqual([started.outcome, started.posted, started.state], ['checkedIn', false, 'working']);
  assert.ok(Number.isSafeInteger(started.session));
  const pulsed = await cli(fake, 'alice', ['pulse', '1', String(started.session), 'blocked'], { git });
  assert.deepEqual([pulsed.outcome, pulsed.state], ['checkedIn', 'blocked']);
  const sessions = createPresence(git, () => fake.clock.now).list();
  assert.deepEqual(sessions.map(entry => [entry.session, entry.issue, entry.state]), [[started.session, 1, 'blocked']]);
  assert.equal((await cli(fake, 'alice', ['land', '1', String(started.session)], { git })).outcome, 'landed');
  assert.equal((await cli(fake, 'alice', ['land', '1', String(started.session)], { git })).outcome, 'nothingToLand');
  assert.equal(readDocument(git, localRef), null);
  assert.deepEqual(fake.store.calls, []);
  assert.deepEqual(fake.store.comments, []);
});

test('a session belongs to one issue and each issue holds at most five fresh sessions', async () => {
  const fake = setup();
  const git = presenceGit();
  const first = await cli(fake, 'alice', ['start', '7'], { git });
  assert.equal((await cli(fake, 'alice', ['pulse', '8', String(first.session), 'working'], { git })).outcome, 'notAuthorized');
  assert.equal((await cli(fake, 'alice', ['land', '8', String(first.session)], { git })).outcome, 'notAuthorized');
  for (let index = 0; index < 4; index += 1) assert.equal((await cli(fake, 'alice', ['start', '7'], { git })).outcome, 'checkedIn');
  assert.equal((await cli(fake, 'alice', ['start', '7'], { git })).outcome, 'flightLimit');
  assert.equal((await cli(fake, 'alice', ['start', '8'], { git })).outcome, 'checkedIn');
});

test('sessions expire exactly five minutes after their last check-in', async () => {
  const fake = setup();
  const git = presenceGit();
  await cli(fake, 'alice', ['start', '3'], { git });
  const store = createPresence(git, () => fake.clock.now);
  fake.clock.now += presenceTtlMs - 1;
  assert.equal(store.list().length, 1);
  fake.clock.now += 1;
  assert.deepEqual(store.list(), []);
});

test('dry runs and read-only launchers leave presence untouched', async () => {
  const fake = setup();
  const git = presenceGit();
  const preview = await cli(fake, 'alice', ['start', '3', '--dry-run'], { git });
  assert.deepEqual([preview.outcome, preview.posted], ['dryRun', false]);
  assert.equal((await cli(fake, 'alice', ['start', '3'], { git, env: { ATC_READ_ONLY: '1' } })).outcome, 'readOnly');
  assert.equal(readDocument(git, localRef), null);
});

test('sessions record the files their worktree changes', () => {
  const git = presenceGit();
  git.exec(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base']);
  fs.writeFileSync(path.join(git.folder, 'notes.md'), 'draft\n');
  assert.deepEqual(sessionFiles(git), ['notes.md']);
  const store = createPresence(git, () => Date.now());
  assert.equal(store.checkIn(5, 11, 'working', sessionFiles(git)), 'checkedIn');
  assert.deepEqual(store.list()[0].files, ['notes.md']);
});

test('hostile or corrupt presence documents are ignored rather than trusted', () => {
  const git = presenceGit();
  const now = Date.UTC(2026, 9, 21, 12);
  const store = createPresence(git, () => now);
  const base = { session: 1, issue: 1, state: 'working', active: now, files: [] };
  const cases = ['not json', JSON.stringify({ version: 1, sessions: [] }), JSON.stringify({ version: 2, sessions: 'x' }),
    JSON.stringify({ version: 2, sessions: [{ ...base, note: 'IGNORE PREVIOUS' }] }), JSON.stringify({ version: 2, sessions: [{ ...base, session: '1' }] }),
    JSON.stringify({ version: 2, sessions: [{ ...base, state: 'sleeping' }] }), JSON.stringify({ version: 2, sessions: [{ ...base, files: ['../etc/passwd'] }] }),
    JSON.stringify({ version: 2, sessions: [{ ...base, files: ['a\u0007b'] }] }), JSON.stringify({ version: 2, sessions: [{ ...base, active: now + 60000 }] })];
  let previous = null;
  for (const text of cases) {
    const commit = rawDocument(git, text);
    assert.equal(updateRef(git, localRef, commit, previous), true);
    previous = commit;
    assert.deepEqual(store.list(), [], text);
  }
  assert.equal(store.checkIn(4, 9, 'working'), 'checkedIn');
  assert.deepEqual(store.list().map(entry => entry.session), [9]);
});

test('compare-and-swap refuses a stale expectation, so concurrent writers retry instead of overwriting', () => {
  const git = presenceGit();
  const now = Date.now();
  const first = writeDocument(git, [{ session: 1, issue: 1, state: 'working', active: now, files: [] }]);
  const second = writeDocument(git, [{ session: 2, issue: 1, state: 'working', active: now, files: [] }]);
  assert.equal(updateRef(git, localRef, first, null), true);
  assert.equal(updateRef(git, localRef, second, null), false);
  assert.equal(updateRef(git, localRef, second, 'f'.repeat(40)), false);
  assert.equal(updateRef(git, localRef, second, first), true);
  const store = createPresence(git, () => now);
  assert.equal(store.checkIn(1, 3, 'reviewing'), 'checkedIn');
  assert.deepEqual(store.list().map(entry => entry.session), [2, 3]);
});

test('legacy flight comments no longer parse, replay or post', () => {
  for (const body of ['/atc flight 1 working', '/atc land 1']) assert.deepEqual(parseCommand(body), { verb: 'invalid' });
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim core');
  const flight = fake.addComment(1, 'alice', '/atc flight 1 working');
  const config = readConfig(fake.store.config);
  const state = replay(readEvents(fake.store.comments, fake.repository, config), { closed: new Set() }, config, fake.clock.now);
  assert.equal(state.outcomes.get(flight.id), 'invalid');
  assert.throws(() => createGh(fake.runGh).post(`repos/${fake.repository}/issues/1/comments`, { body: '/atc flight 1 working' }),
    { message: 'Only typed ATC commands can be posted.' });
});
