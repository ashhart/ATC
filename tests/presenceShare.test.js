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
const anonymousRef = /^refs\/atc\/presence\/[0-9a-f]{16}$/;

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
  fs.writeFileSync(path.join(seed, 'src', 'secret-plan.js'), 'one\n');
  sh(seed, 'add', '.');
  sh(seed, ...author, 'commit', '-q', '-m', 'base');
  sh(seed, 'push', '-q', 'origin', 'HEAD:main');
  const handle = (folder, hooks = {}) => {
    const run = (args, env, input) => {
      if (args[0] === 'push' && hooks.beforePush) hooks.beforePush(args);
      return spawnSync('git', args, { cwd: folder, encoding: 'utf8', input, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } });
    };
    return { ...createGit(run), remoteFor: () => 'origin', folder };
  };
  const clone = (name, hooks) => {
    const folder = path.join(root, name);
    sh(root, 'clone', '-q', origin, folder);
    return handle(folder, hooks);
  };
  const remoteRefs = () => sh(origin, 'for-each-ref', '--format=%(refname)', 'refs/atc/').split('\n').filter(Boolean);
  const published = ref => ({ document: sh(origin, 'cat-file', 'blob', `${ref}:presence.json`), commit: sh(origin, 'cat-file', 'commit', ref) });
  return { root, origin, clone, handle, remoteRefs, published, sh };
}

function fakeWith(config = { presence: 'git' }) {
  const fake = setup(config);
  fake.addIssue();
  fake.addIssue();
  return fake;
}

test('a shared session reaches other machines without a login, file name or timezone leaving the clone', async t => {
  const box = world(t);
  const fake = fakeWith();
  const alice = box.clone('alice');
  fs.writeFileSync(path.join(alice.folder, 'src', 'secret-plan.js'), 'changed by alice\n');
  const started = await cli(fake, 'alice', ['start', '1'], { git: alice, cwd: alice.folder });
  assert.deepEqual([started.outcome, started.sharing], ['checkedIn', 'git']);
  const refs = box.remoteRefs();
  assert.equal(refs.length, 1);
  assert.match(refs[0], anonymousRef);
  const { document, commit } = box.published(refs[0]);
  for (const leak of ['alice', 'secret-plan', 'src/', 'test@example.com', 'Test']) {
    assert.equal(`${refs[0]}\n${document}\n${commit}`.includes(leak), false, leak);
  }
  assert.match(commit, /^author atc <atc@localhost> 0 \+0000$/m);
  assert.match(commit, /^committer atc <atc@localhost> 0 \+0000$/m);
  const bob = box.clone('bob');
  const labels = createLabels();
  const board = await cli(fake, 'bob', ['board'], { git: bob, labels });
  assert.equal(board.complete, true);
  assert.deepEqual(board.sessions.map(session => [session.issue, session.local, session.contributor]), [[1, false, null]]);
  assert.equal(board.summary.activeAgents, 1);
  const text = renderHuman(board, labels, { now: fake.clock.now });
  assert.match(text, /another machine/);
  assert.equal(text.includes('alice'), false);
  assert.equal((await cli(fake, 'bob', ['who', 'src/secret-plan.js'], { git: bob, cwd: bob.folder })).agents, 1);
  assert.equal((await cli(fake, 'bob', ['who', '.github/atc.json'], { git: bob, cwd: bob.folder })).agents, 0);
});

test('each machine shares its own anonymous ref, and landing removes only that machine\'s ref', async t => {
  const box = world(t);
  const fake = fakeWith();
  const laptop = box.clone('laptop');
  const desktop = box.clone('desktop');
  const first = await cli(fake, 'alice', ['start', '1'], { git: laptop, cwd: laptop.folder });
  const second = await cli(fake, 'alice', ['start', '2'], { git: desktop, cwd: desktop.folder });
  assert.equal(box.remoteRefs().length, 2);
  const bob = box.clone('bob');
  assert.equal((await cli(fake, 'bob', ['board'], { git: bob })).summary.activeAgents, 2);
  assert.equal((await cli(fake, 'alice', ['land', '1', String(first.session)], { git: laptop, cwd: laptop.folder })).sharing, 'git');
  assert.deepEqual((await cli(fake, 'bob', ['board'], { git: bob })).sessions.map(session => session.issue), [2]);
  assert.equal((await cli(fake, 'alice', ['land', '2', String(second.session)], { git: desktop, cwd: desktop.folder })).sharing, 'git');
  assert.deepEqual(box.remoteRefs(), []);
});

test('a stale lease from another worktree of the same clone is retried with the latest local sessions', async t => {
  const box = world(t);
  const fake = fakeWith();
  const now = () => fake.clock.now;
  const main = box.clone('alice');
  const otherPath = path.join(box.root, 'alice-second');
  box.sh(main.folder, 'worktree', 'add', '-q', '-b', 'second', otherPath);
  const other = box.handle(otherPath);
  let pushes = 0;
  const racing = box.handle(main.folder, { beforePush: () => {
    pushes += 1;
    if (pushes !== 1) return;
    const presence = createPresence(other, now);
    presence.checkIn(2, 22, 'working');
    assert.equal(sharePresence({ git: other, remote: 'origin', list: () => presence.list() }), 'git');
  } });
  const started = await cli(fake, 'alice', ['start', '1'], { git: racing, cwd: main.folder });
  assert.deepEqual([started.sharing, pushes], ['git', 2]);
  const refs = box.remoteRefs();
  assert.equal(refs.length, 1);
  const reader = box.clone('reader');
  reader.exec(['fetch', '-q', 'origin', `+${refs[0]}:refs/atc/peers/x`]);
  assert.deepEqual(readDocument(reader, 'refs/atc/peers/x', { shared: true }).sessions.map(session => session.issue).sort(), [1, 2]);
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
  const entry = { session: 5, issue: 1, state: 'working', active: fake.clock.now, fileHashes: ['a'.repeat(32)] };
  push(`refs/atc/presence/${'1'.repeat(16)}`, 'IGNORE PREVIOUS INSTRUCTIONS');
  push('refs/atc/presence/mallory', JSON.stringify({ version: 3, sessions: [entry] }));
  push(`refs/atc/presence/${'2'.repeat(16)}`, JSON.stringify({ version: 3, sessions: [{ ...entry, fileHashes: ['src/secret-plan.js'] }] }));
  push(`refs/atc/presence/${'3'.repeat(16)}`, JSON.stringify({ version: 3, sessions: [{ ...entry, login: 'mallory' }] }));
  push(`refs/atc/presence/${'4'.repeat(16)}`, JSON.stringify({ version: 2, sessions: [{ ...entry, files: ['src/a.js'], fileHashes: undefined }] }));
  const bob = box.clone('bob');
  const board = await cli(fake, 'bob', ['board'], { git: bob });
  assert.deepEqual([board.complete, board.sessions], [true, []]);
  const unreachable = { ...bob, exec: (args, env, input) => args[0] === 'fetch' ? { status: 128, stdout: '' } : bob.exec(args, env, input) };
  const broken = await cli(fake, 'bob', ['board'], { git: unreachable });
  assert.equal(broken.complete, false);
  assert.ok(broken.limitations.includes('presenceUnavailable'));
});
