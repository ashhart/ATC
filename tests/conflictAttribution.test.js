import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { inspectScopedOverlap } from '../src/cli/scopedOverlap.js';
import { renderHuman } from '../src/cli/human/render.js';
import { createLabels } from '../src/cli/terminalText.js';
import { readConfig } from '../src/core/config.js';
import { cli, setup } from './helpers.js';

const author = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];
const original = 'one\ntwo\nthree\nfour\nfive\nsix\n';
const renamedEdit = 'one\nTHEIRS\nthree\nfour\nfive\nsix\n';
const mine = 'one\nMINE\nthree\nfour\nfive\nsix\n';

function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-attribution-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const clone = path.join(root, 'clone');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, clone);
  fs.writeFileSync(path.join(clone, 'a.txt'), original);
  fs.writeFileSync(path.join(clone, 'g.txt'), 'alpha\n');
  sh(clone, 'add', '.');
  sh(clone, ...author, 'commit', '-q', '-m', 'base');
  sh(clone, 'push', '-q', 'origin', 'HEAD:main');
  const run = (args, env) => spawnSync('git', args, { cwd: clone, encoding: 'utf8', env: { ...process.env, ...env } });
  const git = { ...createGit(run), remoteFor: () => 'origin' };
  return { root, clone, sh, git };
}

function renameOn(box, branch, edited) {
  box.sh(box.clone, 'checkout', '-q', '-b', branch, 'main');
  box.sh(box.clone, 'mv', 'a.txt', 'b.txt');
  if (edited) fs.writeFileSync(path.join(box.clone, 'b.txt'), renamedEdit);
  box.sh(box.clone, ...author, 'commit', '-q', '-am', branch);
  const head = box.sh(box.clone, 'rev-parse', 'HEAD').trim();
  box.sh(box.clone, 'checkout', '-q', 'main');
  return head;
}

function nativeUnmerged(box, branch, name = 'mine') {
  box.sh(box.clone, 'checkout', '-q', '-b', name);
  box.sh(box.clone, 'add', '-A');
  box.sh(box.clone, ...author, 'commit', '-q', '--allow-empty', '-m', name);
  spawnSync('git', [...author, 'merge', '--no-commit', '--no-ff', branch], { cwd: box.clone, encoding: 'utf8' });
  const rows = box.sh(box.clone, 'ls-files', '-u').split('\n').filter(Boolean);
  spawnSync('git', ['merge', '--abort'], { cwd: box.clone, encoding: 'utf8' });
  return [...new Set(rows.map(row => row.split('\t')[1]))].sort();
}

function directoryOn(box) {
  box.sh(box.clone, 'checkout', '-q', '-b', 'peer', 'main');
  fs.rmSync(path.join(box.clone, 'g.txt'));
  fs.mkdirSync(path.join(box.clone, 'g.txt'));
  fs.writeFileSync(path.join(box.clone, 'g.txt', 'x.txt'), 'x\n');
  fs.writeFileSync(path.join(box.clone, 'a.txt'), original.replace('one', 'PEER'));
  box.sh(box.clone, 'add', '-A');
  box.sh(box.clone, ...author, 'commit', '-q', '-m', 'peer');
  const head = box.sh(box.clone, 'rev-parse', 'HEAD').trim();
  box.sh(box.clone, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(box.clone, 'g.txt'), 'main moved on\n');
  box.sh(box.clone, ...author, 'commit', '-q', '-am', 'main');
  return head;
}

async function unscoped(box, branch, head, files = ['a.txt', 'b.txt']) {
  const fake = setup();
  const pull = fake.addPull({ author: 'bob', files });
  box.sh(box.clone, 'push', '-q', 'origin', `${head}:refs/pull/${pull.number}/head`);
  const labels = createLabels();
  const report = await cli(fake, 'alice', ['overlap', '--base', 'main'], { git: box.git, labels });
  return { report, labels, pull, branch };
}

const verdict = report => report.overlaps.map(row => [row.conflict, row.conflictFiles]);

test('overlap reports a conflict when you delete a file that the other pull request renamed', async t => {
  const box = sandbox(t);
  const head = renameOn(box, 'peer', false);
  fs.rmSync(path.join(box.clone, 'a.txt'));
  const { report, labels, pull } = await unscoped(box, 'peer', head);
  const files = nativeUnmerged(box, 'peer');
  assert.deepEqual(files, ['b.txt']);
  assert.deepEqual(verdict(report), [['conflicts', 1]]);
  assert.deepEqual(labels.conflicts.get(`workingTree:${pull.number}`), files);
  assert.match(renderHuman(report, labels, { color: false, now: Date.now() }), /will conflict in b\.txt/);
});

test('overlap reports a conflict when you edit a line in a file that the other pull request renamed and edited', async t => {
  const box = sandbox(t);
  const head = renameOn(box, 'peer', true);
  fs.writeFileSync(path.join(box.clone, 'a.txt'), mine);
  const { report, labels, pull } = await unscoped(box, 'peer', head);
  const files = nativeUnmerged(box, 'peer');
  assert.deepEqual(files, ['b.txt']);
  assert.deepEqual(verdict(report), [['conflicts', 1]]);
  assert.deepEqual(labels.conflicts.get(`workingTree:${pull.number}`), files);
});

test('overlap stays clean when the other pull request renames a file and Git carries your edit across', async t => {
  const box = sandbox(t);
  const head = renameOn(box, 'peer', false);
  fs.writeFileSync(path.join(box.clone, 'a.txt'), mine);
  const { report } = await unscoped(box, 'peer', head);
  assert.deepEqual(nativeUnmerged(box, 'peer'), []);
  assert.deepEqual(verdict(report), [['clean', 0]]);
});

test('overlap stays clean when a file and directory conflict exists without your work', async t => {
  const box = sandbox(t);
  const head = directoryOn(box);
  const without = nativeUnmerged(box, 'peer', 'without');
  fs.writeFileSync(path.join(box.clone, 'a.txt'), original.replace('six', 'MINE'));
  const { report } = await unscoped(box, 'peer', head);
  assert.deepEqual(without, ['g.txt~HEAD']);
  assert.deepEqual(nativeUnmerged(box, 'peer'), without);
  assert.deepEqual(verdict(report), [['clean', 0]]);
});

test('overlap names the plain path when you changed a file that the other pull request made a directory', async t => {
  const box = sandbox(t);
  const head = directoryOn(box);
  fs.writeFileSync(path.join(box.clone, 'g.txt'), 'mine\n');
  const { report, labels, pull } = await unscoped(box, 'peer', head, ['a.txt', 'g.txt', 'g.txt/x.txt']);
  assert.deepEqual(verdict(report), [['conflicts', 1]]);
  assert.deepEqual(labels.conflicts.get(`workingTree:${pull.number}`), ['g.txt']);
});

test('overlap reports unknown, never clean, when the merge without your work cannot be run', async t => {
  const box = sandbox(t);
  const head = renameOn(box, 'peer', false);
  fs.rmSync(path.join(box.clone, 'a.txt'));
  const blind = { ...box.git, exec: (args, env, input) => (args[0] === 'merge-base' && args.some(arg => /^[0-9a-f]{40}$/.test(arg))
    ? { status: 128, stdout: '', stderr: '' } : box.git.exec(args, env, input)) };
  const { report } = await unscoped({ ...box, git: blind }, 'peer', head);
  assert.deepEqual(verdict(report), [['unknown', null]]);
});

test('overlap reports a conflict with another local worktree that renamed the file you deleted', async t => {
  const box = sandbox(t);
  const other = path.join(box.root, 'other');
  box.sh(box.clone, 'worktree', 'add', '-q', '-b', 'agent-two', other, 'main');
  box.sh(other, 'mv', 'a.txt', 'b.txt');
  box.sh(other, ...author, 'commit', '-q', '-am', 'rename');
  fs.rmSync(path.join(box.clone, 'a.txt'));
  const report = await cli(setup(), 'alice', ['overlap', '--base', 'main'], { git: box.git });
  assert.deepEqual(nativeUnmerged(box, 'agent-two'), ['b.txt']);
  assert.deepEqual(report.worktreeOverlaps.map(row => [row.conflict, row.conflictFiles]), [['conflicts', 1]]);
});

function scopedContext(box, head, files) {
  return { repository: 'example/project', git: box.git, config: readConfig({}), cache: false, labels: createLabels(),
    gh: { getOptional: () => ({ number: 7, state: 'open', user: { type: 'User', login: 'bob' }, head: { sha: head },
      base: { sha: 'a'.repeat(40), repo: { full_name: 'example/project' } }, changed_files: 1 }) },
    reader: { defaultBranch: () => 'main', pullFiles: () => ({ files, partial: false, invalid: false }) } };
}

test('scoped overlap reports a conflict when you delete a file that the selected pull request renamed', async t => {
  const box = sandbox(t);
  const head = renameOn(box, 'peer', false);
  box.sh(box.clone, 'push', '-q', 'origin', `${head}:refs/pull/7/head`);
  fs.rmSync(path.join(box.clone, 'a.txt'));
  const context = scopedContext(box, head, ['a.txt', 'b.txt']);
  const result = inspectScopedOverlap(context, { pulls: '7', base: 'main' });
  assert.deepEqual(nativeUnmerged(box, 'peer'), ['b.txt']);
  assert.deepEqual(result.overlaps.map(row => [row.conflict, row.conflictFiles]), [['conflicts', 1]]);
  assert.deepEqual(context.labels.conflicts.get('workingTree:7'), ['b.txt']);
});

test('scoped overlap reports a conflict with a local worktree that renamed the file you deleted', async t => {
  const box = sandbox(t);
  const other = path.join(box.root, 'other');
  box.sh(box.clone, 'worktree', 'add', '-q', '-b', 'agent-two', other, 'main');
  box.sh(other, 'mv', 'a.txt', 'b.txt');
  box.sh(other, ...author, 'commit', '-q', '-am', 'rename');
  fs.rmSync(path.join(box.clone, 'a.txt'));
  const result = inspectScopedOverlap(scopedContext(box, 'b'.repeat(40), ['elsewhere.txt']), { pulls: '7', base: 'main' });
  assert.deepEqual(nativeUnmerged(box, 'agent-two'), ['b.txt']);
  assert.deepEqual(result.worktreeOverlaps.map(row => [row.conflict, row.conflictFiles]), [['conflicts', 1]]);
});

test('scoped overlap stays clean when the pull request conflicts with main only in files you did not touch', async t => {
  const box = sandbox(t);
  box.sh(box.clone, 'checkout', '-q', '-b', 'peer', 'main');
  fs.writeFileSync(path.join(box.clone, 'a.txt'), renamedEdit.replace('THEIRS', 'two').replace('six', 'BOB'));
  fs.writeFileSync(path.join(box.clone, 'g.txt'), 'bob\n');
  box.sh(box.clone, ...author, 'commit', '-q', '-am', 'bob');
  const head = box.sh(box.clone, 'rev-parse', 'HEAD').trim();
  box.sh(box.clone, 'push', '-q', 'origin', `${head}:refs/pull/7/head`);
  box.sh(box.clone, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(box.clone, 'g.txt'), 'main moved on\n');
  box.sh(box.clone, ...author, 'commit', '-q', '-am', 'main');
  fs.writeFileSync(path.join(box.clone, 'a.txt'), mine.replace('MINE', 'two').replace('one', 'MINE'));
  const result = inspectScopedOverlap(scopedContext(box, head, ['a.txt', 'g.txt']), { pulls: '7', base: 'main' });
  assert.deepEqual(result.overlaps.map(row => [row.sharedFiles, row.conflict, row.conflictFiles]), [[1, 'clean', 0]]);
});
