import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { createTrees } from '../src/cli/gitTrees.js';
import { cli, setup } from './helpers.js';

const author = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-conflicts-'));
  const origin = path.join(root, 'origin.git');
  const clone = path.join(root, 'clone');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, clone);
  fs.writeFileSync(path.join(clone, 'f.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\n');
  fs.writeFileSync(path.join(clone, 'g.txt'), 'alpha\n');
  sh(clone, 'add', '.');
  sh(clone, ...author, 'commit', '-q', '-m', 'base');
  sh(clone, 'push', '-q', 'origin', 'HEAD:main');
  const branch = (name, file, content, ref) => {
    sh(clone, 'checkout', '-q', '-b', name, 'main');
    fs.writeFileSync(path.join(clone, file), content);
    sh(clone, ...author, 'commit', '-q', '-am', name);
    sh(clone, 'push', '-q', 'origin', `HEAD:${ref}`);
    sh(clone, 'checkout', '-q', 'main');
  };
  const run = (args, env) => spawnSync('git', args, { cwd: clone, encoding: 'utf8', env: { ...process.env, ...env } });
  const git = { ...createGit(run), remoteFor: () => 'origin' };
  return { root, clone, sh, branch, git, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('overlap test-merges your working tree against overlapping pull requests', async () => {
  const box = sandbox();
  try {
    const fake = setup();
    const conflicting = fake.addPull({ author: 'bob', files: ['f.txt'] });
    const clean = fake.addPull({ author: 'carol', files: ['f.txt'] });
    box.branch('bob', 'f.txt', 'one\nBOB\nthree\nfour\nfive\nsix\n', `refs/pull/${conflicting.number}/head`);
    box.branch('carol', 'f.txt', 'one\ntwo\nthree\nfour\nfive\nCAROL\n', `refs/pull/${clean.number}/head`);
    fs.writeFileSync(path.join(box.clone, 'f.txt'), 'one\nMINE\nthree\nfour\nfive\nsix\n');
    const report = await cli(fake, 'alice', ['overlap', '--base', 'main'], { git: box.git });
    assert.deepEqual(report.overlaps.map(row => [row.pullRequest, row.conflict, row.conflictFiles]).sort((first, second) => first[0] - second[0]),
      [[conflicting.number, 'conflicts', 1], [clean.number, 'clean', 0]]);
    assert.equal(JSON.stringify(report).includes('f.txt'), false);
    assert.equal(box.sh(box.clone, 'for-each-ref', 'refs/atc/').trim(), '');
    assert.equal(box.sh(box.clone, 'status', '--porcelain').trim(), 'M f.txt');
    const who = await cli(fake, 'alice', ['who', 'f.txt'], { git: box.git, cwd: box.clone });
    assert.deepEqual([who.complete, who.pullRequests, who.worktrees], [true, [conflicting.number, clean.number], 0]);
  } finally {
    box.cleanup();
  }
});

test('overlap and who see another local worktree editing the same lines', async () => {
  const box = sandbox();
  try {
    const fake = setup();
    const other = path.join(box.root, 'other');
    box.sh(box.clone, 'worktree', 'add', '-q', '-b', 'agent-two', other, 'main');
    fs.writeFileSync(path.join(other, 'f.txt'), 'one\nTHEIRS\nthree\nfour\nfive\nsix\n');
    fs.writeFileSync(path.join(other, 'new.txt'), 'untracked\n');
    fs.writeFileSync(path.join(box.clone, 'f.txt'), 'one\nMINE\nthree\nfour\nfive\nsix\n');
    const indexBefore = fs.readFileSync(path.join(box.clone, '.git', 'worktrees', 'other', 'index'));
    const report = await cli(fake, 'alice', ['overlap', '--base', 'main'], { git: box.git });
    assert.equal(report.worktrees, 1);
    assert.deepEqual(report.worktreeOverlaps, [{ worktree: 1, sharedFiles: 1, areas: [], conflict: 'conflicts', conflictFiles: 1 }]);
    assert.deepEqual(fs.readFileSync(path.join(box.clone, '.git', 'worktrees', 'other', 'index')), indexBefore);
    const who = await cli(fake, 'alice', ['who', path.join(box.clone, 'f.txt')], { git: box.git, cwd: box.clone });
    assert.equal(who.worktrees, 1);
    assert.equal((await cli(fake, 'alice', ['who', 'g.txt'], { git: box.git, cwd: box.clone })).worktrees, 0);
  } finally {
    box.cleanup();
  }
});

test('a pull request that conflicts with main only in files you did not touch is not your conflict', async () => {
  const box = sandbox();
  try {
    const fake = setup();
    const stale = fake.addPull({ author: 'bob', files: ['f.txt', 'g.txt'] });
    box.sh(box.clone, 'checkout', '-q', '-b', 'bob', 'main');
    fs.writeFileSync(path.join(box.clone, 'f.txt'), 'one\ntwo\nthree\nfour\nfive\nBOB\n');
    fs.writeFileSync(path.join(box.clone, 'g.txt'), 'bob\n');
    box.sh(box.clone, ...author, 'commit', '-q', '-am', 'bob');
    box.sh(box.clone, 'push', '-q', 'origin', `HEAD:refs/pull/${stale.number}/head`);
    box.sh(box.clone, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(box.clone, 'g.txt'), 'main moved on\n');
    box.sh(box.clone, ...author, 'commit', '-q', '-am', 'main');
    fs.writeFileSync(path.join(box.clone, 'f.txt'), 'MINE\ntwo\nthree\nfour\nfive\nsix\n');
    const report = await cli(fake, 'alice', ['overlap', '--base', 'main'], { git: box.git });
    assert.deepEqual(report.overlaps.map(row => [row.pullRequest, row.sharedFiles, row.conflict, row.conflictFiles]), [[stale.number, 1, 'clean', 0]]);
  } finally {
    box.cleanup();
  }
});

test('who rejects paths outside the clone and reports a missing cache as incomplete', async () => {
  const box = sandbox();
  try {
    const fake = setup();
    for (const bad of ['../escape.txt', '/etc/passwd', 'a\u0007b']) {
      await assert.rejects(cli(fake, 'alice', ['who', bad], { git: box.git, cwd: box.clone }), { message: 'Give a file path inside this clone.' });
    }
    const who = await cli(fake, 'alice', ['who', 'g.txt'], { git: box.git, cwd: box.clone });
    assert.deepEqual([who.complete, who.limitations, who.observedAt], [false, ['pullFilesUnavailable'], null]);
  } finally {
    box.cleanup();
  }
});

test('merge checks fail closed on unknown commits and hostile refs', () => {
  const box = sandbox();
  try {
    const trees = createTrees(box.git);
    assert.deepEqual(trees.mergeConflicts('a'.repeat(40), 'b'.repeat(40)), { conflict: 'unknown', files: null });
    assert.deepEqual(trees.mergeConflicts('HEAD', '--output=x'), { conflict: 'unknown', files: null });
    assert.equal(trees.fetchPull('--upload-pack=touch', 1), null);
    assert.equal(trees.fetchPull('origin', 999), null);
    assert.equal(createTrees({ remoteFor: () => null }), null);
  } finally {
    box.cleanup();
  }
});
