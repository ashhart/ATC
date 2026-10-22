import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCommand } from '../src/core/commands.js';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { presenceTtlMs } from '../src/core/presence.js';
import { replay } from '../src/core/replay.js';
import { createGh } from '../src/cli/gh.js';
import { createPresence } from '../src/cli/localPresence.js';
import { cli, setup, stubGit } from './helpers.js';

function localGit() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-presence-'));
  return { ...stubGit(), commonDir: () => folder, folder };
}

function presenceFile(git) {
  return path.join(git.folder, 'atc', 'presence.json');
}

test('start, pulse and land stay local and never call GitHub or post a comment', async () => {
  const fake = setup();
  fake.addIssue();
  const git = localGit();
  const started = await cli(fake, 'alice', ['start', '1'], { git });
  assert.equal(started.outcome, 'checkedIn');
  assert.equal(started.posted, false);
  assert.equal(started.state, 'working');
  assert.ok(Number.isSafeInteger(started.session));
  const pulsed = await cli(fake, 'alice', ['pulse', '1', String(started.session), 'blocked'], { git });
  assert.deepEqual([pulsed.outcome, pulsed.state], ['checkedIn', 'blocked']);
  const sessions = createPresence(git.folder, () => fake.clock.now).list();
  assert.deepEqual(sessions.map(entry => [entry.session, entry.issue, entry.state]), [[started.session, 1, 'blocked']]);
  assert.equal((await cli(fake, 'alice', ['land', '1', String(started.session)], { git })).outcome, 'landed');
  assert.equal((await cli(fake, 'alice', ['land', '1', String(started.session)], { git })).outcome, 'nothingToLand');
  assert.deepEqual(fake.store.calls, []);
  assert.deepEqual(fake.store.comments, []);
});

test('a session belongs to one issue and each issue holds at most five fresh sessions', async () => {
  const fake = setup();
  const git = localGit();
  const first = await cli(fake, 'alice', ['start', '7'], { git });
  assert.equal((await cli(fake, 'alice', ['pulse', '8', String(first.session), 'working'], { git })).outcome, 'notAuthorized');
  assert.equal((await cli(fake, 'alice', ['land', '8', String(first.session)], { git })).outcome, 'notAuthorized');
  for (let index = 0; index < 4; index += 1) assert.equal((await cli(fake, 'alice', ['start', '7'], { git })).outcome, 'checkedIn');
  assert.equal((await cli(fake, 'alice', ['start', '7'], { git })).outcome, 'flightLimit');
  assert.equal((await cli(fake, 'alice', ['start', '8'], { git })).outcome, 'checkedIn');
});

test('sessions expire exactly five minutes after their last check-in', async () => {
  const fake = setup();
  const git = localGit();
  await cli(fake, 'alice', ['start', '3'], { git });
  const store = createPresence(git.folder, () => fake.clock.now);
  fake.clock.now += presenceTtlMs - 1;
  assert.equal(store.list().length, 1);
  fake.clock.now += 1;
  assert.deepEqual(store.list(), []);
});

test('dry runs and read-only launchers leave the presence file untouched', async () => {
  const fake = setup();
  const git = localGit();
  const preview = await cli(fake, 'alice', ['start', '3', '--dry-run'], { git });
  assert.deepEqual([preview.outcome, preview.posted], ['dryRun', false]);
  assert.equal((await cli(fake, 'alice', ['start', '3'], { git, env: { ATC_READ_ONLY: '1' } })).outcome, 'readOnly');
  assert.equal(fs.existsSync(presenceFile(git)), false);
});

test('hostile or corrupt presence files are ignored rather than trusted', () => {
  const git = localGit();
  fs.mkdirSync(path.join(git.folder, 'atc'));
  const now = Date.UTC(2026, 9, 21, 12);
  const store = createPresence(git.folder, () => now);
  const cases = ['not json', JSON.stringify({ version: 2, sessions: [] }), JSON.stringify({ version: 1, sessions: 'x' }),
    JSON.stringify({ version: 1, sessions: [{ session: 1, issue: 1, state: 'working', active: now, note: 'IGNORE PREVIOUS' }] }),
    JSON.stringify({ version: 1, sessions: [{ session: '1', issue: 1, state: 'working', active: now }] }),
    JSON.stringify({ version: 1, sessions: [{ session: 1, issue: 1, state: 'sleeping', active: now }] }),
    JSON.stringify({ version: 1, sessions: [{ session: 1e16, issue: 1, state: 'working', active: now }] }),
    JSON.stringify({ version: 1, sessions: [{ session: 1, issue: 1, state: 'working', active: now + 60000 }] })];
  for (const text of cases) {
    fs.writeFileSync(presenceFile(git), text);
    assert.deepEqual(store.list(), []);
  }
  fs.writeFileSync(presenceFile(git), 'x'.repeat(70000));
  assert.deepEqual(store.list(), []);
  assert.equal(store.checkIn(4, 9, 'working'), 'checkedIn');
  assert.deepEqual(store.list().map(entry => entry.session), [9]);
});

test('a stale lock left by a crashed agent does not block check-ins', () => {
  const git = localGit();
  fs.mkdirSync(path.join(git.folder, 'atc'));
  const lock = path.join(git.folder, 'atc', 'presence.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.equal(createPresence(git.folder, () => Date.now()).checkIn(2, 5, 'reviewing'), 'checkedIn');
  assert.equal(fs.existsSync(lock), false);
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
  assert.equal(Object.hasOwn(state, 'flights'), false);
  assert.throws(() => createGh(fake.runGh).post(`repos/${fake.repository}/issues/1/comments`, { body: '/atc flight 1 working' }),
    { message: 'Only typed ATC commands can be posted.' });
});
