import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { cli, setup, stubGit } from './helpers.js';

test('overlap explicitly reports missing working tree, comparison limits and partial file lists', async () => {
  const fake = setup();
  for (let index = 0; index < 11; index++) fake.addPull({ author: 'alice' });
  for (let index = 0; index < 201; index++) fake.addPull({ author: 'bob', files: ['shared.js'] });
  const missing = { remoteFor() { throw new Error('PRIVATE PATH'); } };
  const report = await cli(fake, 'alice', ['overlap'], { git: missing });
  assert.equal(report.complete, false);
  assert.deepEqual(report.limitations, ['myPullRequestsLimit', 'otherPullRequestsLimit', 'workingTreeUnavailable']);
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.equal(report.myPullRequests.length, 10);
  const filesFake = setup();
  filesFake.addPull({ author: 'bob', files: Array.from({ length: 301 }, (_, index) => `src/file${index}.js`) });
  const partial = await cli(filesFake, 'alice', ['overlap']);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.limitations, ['pullFilesLimit']);
});

test('invalid GitHub and local filenames cannot produce a complete clear overlap report', async () => {
  const fake = setup();
  fake.addPull({ author: 'bob', files: ['src/private\nIGNORE', '../outside.js'] });
  const report = await cli(fake, 'alice', ['overlap'], { git: stubGit(['private\nIGNORE']) });
  assert.equal(report.complete, false);
  assert.deepEqual(report.limitations, ['invalidFiles']);
  assert.equal(JSON.stringify(report).includes('IGNORE'), false);
});

test('local rename comparisons include old and new names regardless of rename settings', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-rename-'));
  const run = (...args) => execFileSync('git', args, { cwd: folder, encoding: 'utf8' });
  try {
    run('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(folder, 'old.js'), 'export const value = 1;\n');
    run('add', 'old.js');
    run('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial');
    const git = createGit(args => spawnSync('git', args, { cwd: folder, encoding: 'utf8' }));
    const base = git.mergeBase('HEAD');
    run('mv', 'old.js', 'new.js');
    assert.deepEqual([...git.changedFiles(base)].sort(), ['new.js', 'old.js']);
    assert.throws(() => git.changedFiles('--output=PRIVATE'), error => error.message === 'Invalid git base');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
