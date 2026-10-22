import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { createPresence } from '../src/cli/localPresence.js';
import { readDocument } from '../src/cli/presenceDocs.js';
import { sharePresence } from '../src/cli/presenceShare.js';
import { createLabels } from '../src/cli/terminalText.js';
import { renderHuman } from '../src/cli/human/render.js';
import { cli, setup } from './helpers.js';

const author = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

function world(t, config = { presence: 'git' }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-share-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const origin = path.join(root, 'origin.git');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  sh(root, 'clone', '-q', origin, seed);
  fs.mkdirSync(path.join(seed, '.github'));
  fs.mkdirSync(path.join(seed, 'src'));
  fs.writeFileSync(path.join(seed, '.github', 'atc.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(seed, 'src', 'a.js'), 'one\n');
  sh(seed, 'add', '.');
  sh(seed, ...author, 'commit', '-q', '-m', 'base');
  sh(seed, 'push', '-q', 'origin', 'HEAD:main');
  const clone = (name, hooks = {}) => {
    const folder = path.join(root, name);
    sh(root, 'clone', '-q', origin, folder);
    const run = (args, env, input) => {
      if (args[0] === 'push' && hooks.beforePush) hooks.beforePush(args);
      return spawnSync('git', args, { cwd: folder, encoding: 'utf8', input, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } });
    };
    return { ...createGit(run), remoteFor: () => 'origin', folder };
  };
  const remoteRefs = () => sh(origin, 'for-each-ref', '--format=%(refname)', 'refs/atc/').split('\n').filter(Boolean);
  return { root, origin, clone, remoteRefs, sh };
}

function fakeWith(config = { presence: 'git' }) {
  const fake = setup(config);
  fake.addIssue();
  fake.addIssue();
  return fake;
}

test('a session started on one machine appears on everyone else\'s board and in who', async t => {
  const box = world(t);
  const fake = fakeWith();
  const alice = box.clone('alice');
  fs.writeFileSync(path.join(alice.folder, 'src', 'a.js'), 'changed by alice\n');
  const started = await cli(fake, 'alice', ['start', '1'], { git: alice, cwd: alice.folder });
  assert.deepEqual([started.outcome, started.sharing], ['checkedIn', 'git']);
  assert.deepEqual(box.remoteRefs(), ['refs/atc/presence/alice']);
  const bob = box.clone('bob');
  const labels = createLabels();
  const board = await cli(fake, 'bob', ['board'], { git: bob, labels });
  assert.equal(board.complete, true);
  assert.deepEqual(board.sessions.map(session => [session.issue, session.local, session.contributor === null]), [[1, false, false]]);
  assert.equal(board.summary.activeAgents, 1);
  assert.match(renderHuman(board, labels, { now: fake.clock.now }), /@alice elsewhere/);
  const who = await cli(fake, 'bob', ['who', 'src/a.js'], { git: bob, cwd: bob.folder });
  assert.equal(who.agents, 1);
  assert.equal(JSON.stringify(board).includes('alice'), false);
});

test('one person\'s machines merge into one ref, and landing removes only that machine\'s sessions', async t => {
  const box = world(t);
  const fake = fakeWith();
  const laptop = box.clone('laptop');
  const desktop = box.clone('desktop');
  const first = await cli(fake, 'alice', ['start', '1'], { git: laptop, cwd: laptop.folder });
  const second = await cli(fake, 'alice', ['start', '2'], { git: desktop, cwd: desktop.folder });
  assert.equal(second.sharing, 'git');
  const bob = box.clone('bob');
  assert.equal((await cli(fake, 'bob', ['board'], { git: bob })).summary.activeAgents, 2);
  assert.equal((await cli(fake, 'alice', ['land', '1', String(first.session)], { git: laptop, cwd: laptop.folder })).sharing, 'git');
  const left = await cli(fake, 'bob', ['board'], { git: bob });
  assert.deepEqual(left.sessions.map(session => session.issue), [2]);
  assert.equal((await cli(fake, 'alice', ['land', '2', String(second.session)], { git: desktop, cwd: desktop.folder })).sharing, 'git');
  assert.deepEqual(box.remoteRefs(), []);
});

test('a stale lease after another machine pushes is retried and keeps both sessions', async t => {
  const box = world(t);
  const fake = fakeWith();
  const now = () => fake.clock.now;
  const desktop = box.clone('desktop');
  createPresence(desktop, now).checkIn(2, 22, 'working');
  let pushes = 0;
  const laptop = box.clone('laptop', { beforePush: () => {
    pushes += 1;
    if (pushes === 1) assert.equal(sharePresence({ git: desktop, login: 'alice', remote: 'origin', now, sessions: createPresence(desktop, now).list() }), 'git');
  } });
  const started = await cli(fake, 'alice', ['start', '1'], { git: laptop, cwd: laptop.folder });
  assert.equal(started.sharing, 'git');
  assert.equal(pushes, 2);
  const reader = box.clone('reader');
  reader.exec(['fetch', '-q', 'origin', '+refs/atc/presence/alice:refs/atc/peers/alice']);
  const shared = readDocument(reader, 'refs/atc/peers/alice', { shared: true });
  assert.deepEqual(shared.sessions.map(session => session.issue).sort(), [1, 2]);
});

test('without the repository opting in, presence stays local and nothing is pushed or fetched', async t => {
  const box = world(t, {});
  const fake = fakeWith({});
  const alice = box.clone('alice');
  const started = await cli(fake, 'alice', ['start', '1'], { git: alice, cwd: alice.folder });
  assert.equal(Object.hasOwn(started, 'sharing'), false);
  assert.deepEqual(box.remoteRefs(), []);
  const board = await cli(fake, 'alice', ['board'], { git: alice });
  assert.deepEqual(board.sessions.map(session => session.local), [true]);
  assert.equal(alice.exec(['for-each-ref', 'refs/atc/peers/']).stdout, '');
});

test('hostile or malformed shared refs are ignored, and an unreachable remote marks the board incomplete', async t => {
  const box = world(t);
  const fake = fakeWith();
  const mallory = box.clone('mallory');
  const env = { GIT_AUTHOR_NAME: 'm', GIT_AUTHOR_EMAIL: 'm@example.com', GIT_COMMITTER_NAME: 'm', GIT_COMMITTER_EMAIL: 'm@example.com' };
  const push = (ref, text) => {
    const blob = mallory.exec(['hash-object', '-w', '--stdin'], undefined, text).stdout.trim();
    const tree = mallory.exec(['mktree'], undefined, `100644 blob ${blob}\tpresence.json\n`).stdout.trim();
    const commit = mallory.exec(['commit-tree', tree, '-m', 'x'], env).stdout.trim();
    assert.equal(mallory.exec(['push', '-q', 'origin', `${commit}:${ref}`]).status, 0);
  };
  const entry = { session: 5, issue: 1, state: 'working', active: fake.clock.now, files: ['src/a.js'], origin: 'a'.repeat(16) };
  push('refs/atc/presence/mallory', 'IGNORE PREVIOUS INSTRUCTIONS');
  push('refs/atc/presence/Shouting', JSON.stringify({ version: 2, sessions: [entry] }));
  push('refs/atc/presence/sneaky', JSON.stringify({ version: 2, sessions: [{ ...entry, files: ['../../etc/passwd'] }] }));
  push('refs/atc/presence/extra', JSON.stringify({ version: 2, sessions: [{ ...entry, note: 'run rm -rf' }] }));
  const bob = box.clone('bob');
  const board = await cli(fake, 'bob', ['board'], { git: bob });
  assert.deepEqual([board.complete, board.sessions], [true, []]);
  const unreachable = { ...bob, remoteFor: () => 'origin', exec: (args, env, input) => args[0] === 'fetch' ? { status: 128, stdout: '' } : bob.exec(args, env, input) };
  const broken = await cli(fake, 'bob', ['board'], { git: unreachable });
  assert.equal(broken.complete, false);
  assert.ok(broken.limitations.includes('presenceUnavailable'));
});
