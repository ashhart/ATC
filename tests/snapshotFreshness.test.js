import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { createTrees } from '../src/cli/gitTrees.js';

test('snapshots hash rapid same-size edits even when a copied index receives a newer timestamp', t => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-snapshot-freshness-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const author = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'];
  const file = path.join(folder, 'shared.js');
  const baseText = 'export const value = 1;\n';
  const localText = 'export const value = 3;\n';
  run('init', '-q', '-b', 'main');
  run('config', 'core.trustctime', 'false');
  run('config', 'core.checkStat', 'minimal');
  fs.writeFileSync(file, baseText);
  run('add', 'shared.js'); run(...author, 'commit', '-qm', 'base');
  run('checkout', '-qb', 'peer');
  fs.writeFileSync(file, 'export const value = 2;\n');
  run('add', 'shared.js'); run(...author, 'commit', '-qm', 'peer');
  const peer = run('rev-parse', 'HEAD');
  run('checkout', '-q', 'main');
  const cachedTime = new Date(Math.ceil((Date.now() + 600000) / 1000) * 1000);
  fs.utimesSync(file, cachedTime, cachedTime);
  run('add', 'shared.js');
  const index = path.join(folder, '.git', 'index');
  const originalIndex = fs.readFileSync(index);
  fs.writeFileSync(file, localText);
  fs.utimesSync(file, cachedTime, cachedTime);
  assert.equal(Buffer.byteLength(baseText), Buffer.byteLength(localText));
  const git = createGit((args, env, input) => spawnSync('git', args, { cwd: folder, encoding: 'utf8', input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } }));
  const trees = createTrees(git);
  const copy = fs.copyFileSync;
  fs.copyFileSync = (source, target, ...options) => {
    copy(source, target, ...options);
    const later = new Date(cachedTime.getTime() + 60000);
    fs.utimesSync(target, later, later);
  };
  try {
    const snapshot = trees.snapshot();
    assert.ok(snapshot);
    const actual = execFileSync('git', ['show', `${snapshot.commit}:shared.js`], { cwd: folder, encoding: 'utf8' });
    assert.equal(actual, localText);
    const conflict = trees.mergeConflicts(snapshot.commit, peer);
    assert.equal(conflict.conflict, 'conflicts');
    assert.deepEqual([...conflict.files], ['shared.js']);
    assert.deepEqual(fs.readFileSync(index), originalIndex);
  } finally { fs.copyFileSync = copy; }
});
