import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { inspectScopedOverlap } from '../src/cli/scopedOverlap.js';
import { createLabels } from '../src/cli/terminalText.js';
import { readConfig } from '../src/core/config.js';
import { cli, setup } from './helpers.js';

const author = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];
const text = 'one\ntwo\nthree\nfour\nfive\nsix\n';

function staleClone(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-stale-base-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const clone = path.join(root, 'clone');
  const other = path.join(root, 'other');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const write = (folder, name, value) => fs.writeFileSync(path.join(folder, name), value);
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, clone);
  write(clone, 'f.txt', text);
  write(clone, 'g.txt', text);
  sh(clone, 'add', '.');
  sh(clone, ...author, 'commit', '-q', '-m', 'base');
  sh(clone, 'push', '-q', 'origin', 'HEAD:main');
  const run = (args, env) => spawnSync('git', args, { cwd: clone, encoding: 'utf8', env: { ...process.env, ...env } });
  return { root, origin, clone, other, sh, write, git: { ...createGit(run), remoteFor: () => 'origin' } };
}

function commitPeer(box, change) {
  box.sh(box.clone, 'checkout', '-q', '-b', 'peer', 'main');
  change();
  box.sh(box.clone, 'add', '-A');
  box.sh(box.clone, ...author, 'commit', '-q', '-m', 'peer');
  const head = box.sh(box.clone, 'rev-parse', 'HEAD').trim();
  box.sh(box.clone, 'checkout', '-q', 'main');
  return head;
}

function advanceMain(box) {
  box.sh(box.root, 'clone', '-q', box.origin, box.other);
  box.write(box.other, 'f.txt', text.replace('one', 'MAIN'));
  box.sh(box.other, ...author, 'commit', '-q', '-am', 'main moved');
  box.sh(box.other, 'push', '-q', 'origin', 'HEAD:main');
  return box.sh(box.other, 'rev-parse', 'HEAD').trim();
}

function commitMine(box, change) {
  box.sh(box.clone, 'fetch', '-q', box.origin, 'main');
  box.sh(box.clone, 'checkout', '-q', '-b', 'mine', 'FETCH_HEAD');
  change();
  box.sh(box.clone, 'add', '-A');
  box.sh(box.clone, ...author, 'commit', '-q', '-m', 'mine');
  const head = box.sh(box.clone, 'rev-parse', 'HEAD').trim();
  box.sh(box.clone, 'checkout', '-q', 'main');
  return head;
}

function nativeUnmerged(box, first, second) {
  box.sh(box.clone, 'checkout', '-q', '--detach', first);
  spawnSync('git', [...author, 'merge', '--no-commit', '--no-ff', second], { cwd: box.clone, encoding: 'utf8' });
  const rows = box.sh(box.clone, 'ls-files', '-u').split('\n').filter(Boolean);
  spawnSync('git', ['merge', '--abort'], { cwd: box.clone, encoding: 'utf8' });
  box.sh(box.clone, 'checkout', '-q', 'main');
  return [...new Set(rows.map(row => row.split('\t')[1]))].sort();
}

function pulls(box, mine, peer, peerFiles, mineFiles = ['g.txt']) {
  const fake = setup();
  const own = fake.addPull({ author: 'alice', files: mineFiles });
  const theirs = fake.addPull({ author: 'bob', files: peerFiles });
  box.sh(box.clone, 'push', '-q', 'origin', `${mine}:refs/pull/${own.number}/head`, `${peer}:refs/pull/${theirs.number}/head`);
  return fake;
}

const verdict = report => report.overlaps.map(row => [row.conflict, row.conflictFiles]);
const editPeer = box => () => { box.write(box.clone, 'f.txt', text.replace('one', 'PEER')); box.write(box.clone, 'g.txt', text.replace('one', 'PEER')); };
const editMine = box => () => box.write(box.clone, 'g.txt', text.replace('six', 'MINE'));

function mainOnlyConflict(t) {
  const box = staleClone(t);
  const peer = commitPeer(box, editPeer(box));
  const tip = advanceMain(box);
  const mine = commitMine(box, editMine(box));
  assert.notEqual(box.sh(box.clone, 'rev-parse', 'origin/main').trim(), tip);
  return { box, peer, tip, mine, fake: pulls(box, mine, peer, ['f.txt', 'g.txt']) };
}

test('overlap stays clean when a stale local base would make a conflict from main look like yours', async t => {
  const { box, peer, tip, mine, fake } = mainOnlyConflict(t);
  fake.store.tip = tip;
  const report = await cli(fake, 'alice', ['overlap'], { git: box.git });
  assert.deepEqual(nativeUnmerged(box, tip, peer), ['f.txt']);
  assert.deepEqual(nativeUnmerged(box, mine, peer), ['f.txt']);
  assert.deepEqual(verdict(report), [['clean', 0]]);
});

test('overlap reports unknown, not clean or a conflict, when the current tip cannot be read', async t => {
  const { box, fake } = mainOnlyConflict(t);
  assert.deepEqual(verdict(await cli(fake, 'alice', ['overlap'], { git: box.git })), [['unknown', null]]);
});

test('overlap takes an explicit base as given', async t => {
  const { box, tip, fake } = mainOnlyConflict(t);
  fake.store.tip = tip;
  const report = await cli(fake, 'alice', ['overlap', '--base', 'origin/main'], { git: box.git });
  assert.deepEqual(verdict(report), [['conflicts', 1]]);
  assert.equal(fake.store.calls.some(call => call.includes('/commits/main')), false);
});

test('overlap still reports your conflict on a renamed file with a stale local base', async t => {
  const box = staleClone(t);
  const peer = commitPeer(box, () => box.sh(box.clone, 'mv', 'g.txt', 'r.txt'));
  const tip = advanceMain(box);
  const mine = commitMine(box, () => fs.rmSync(path.join(box.clone, 'g.txt')));
  const fake = pulls(box, mine, peer, ['g.txt', 'r.txt']);
  fake.store.tip = tip;
  const report = await cli(fake, 'alice', ['overlap'], { git: box.git });
  assert.deepEqual(nativeUnmerged(box, mine, peer), ['r.txt']);
  assert.deepEqual(verdict(report), [['conflicts', 1]]);
});

test('overlap fetches the current tip when your clone does not have it yet', async t => {
  const box = staleClone(t);
  const peer = commitPeer(box, () => box.sh(box.clone, 'mv', 'g.txt', 'r.txt'));
  box.sh(box.clone, 'checkout', '-q', '-b', 'mine', 'main');
  fs.rmSync(path.join(box.clone, 'g.txt'));
  box.sh(box.clone, 'add', '-A');
  box.sh(box.clone, ...author, 'commit', '-q', '-m', 'mine');
  const mine = box.sh(box.clone, 'rev-parse', 'HEAD').trim();
  box.sh(box.clone, 'checkout', '-q', 'main');
  const tip = advanceMain(box);
  const fake = pulls(box, mine, peer, ['g.txt', 'r.txt']);
  fake.store.tip = tip;
  assert.notEqual(box.git.exec(['cat-file', '-e', `${tip}^{commit}`]).status, 0);
  assert.deepEqual(verdict(await cli(fake, 'alice', ['overlap'], { git: box.git })), [['conflicts', 1]]);
});

test('scoped overlap compares with the current tip, not a stale local base', t => {
  const box = staleClone(t);
  const peer = commitPeer(box, () => {
    box.sh(box.clone, 'mv', 'f.txt', 'r.txt');
    box.write(box.clone, 'r.txt', text.replace('one', 'PEER'));
    box.write(box.clone, 'g.txt', text.replace('one', 'PEER'));
  });
  const tip = advanceMain(box);
  box.sh(box.clone, 'push', '-q', 'origin', `${peer}:refs/pull/7/head`);
  box.sh(box.clone, 'fetch', '-q', box.origin, 'main');
  box.sh(box.clone, 'merge', '-q', '--ff-only', 'FETCH_HEAD');
  assert.deepEqual(nativeUnmerged(box, tip, peer), ['r.txt']);
  editMine(box)();
  const pull = { number: 7, state: 'open', user: { type: 'User', login: 'bob' }, head: { sha: peer },
    base: { sha: 'a'.repeat(40), repo: { full_name: 'example/project' } }, changed_files: 3 };
  const context = { repository: 'example/project', git: box.git, config: readConfig({}), cache: false, labels: createLabels(),
    gh: { getOptional: () => pull, get: () => ({ sha: tip }) },
    reader: { defaultBranch: () => 'main', pullFiles: () => ({ files: ['f.txt', 'g.txt', 'r.txt'], partial: false, invalid: false }) } };
  const result = inspectScopedOverlap(context, { pulls: '7' });
  assert.deepEqual(result.overlaps.map(row => [row.conflict, row.conflictFiles]), [['clean', 0]]);
});
