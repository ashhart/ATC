import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { cli, setup, stubGit } from './helpers.js';

test('overlap compares your changes and pull requests with everyone else\'s, by count and area only', async () => {
  const fake = setup();
  const theirs = fake.addPull({ author: 'bob', files: ['src/core/engine.js', 'docs/guide.md'] });
  fake.addPull({ author: 'carol', files: ['tests/other.test.js'] });
  const mine = fake.addPull({ author: 'alice', files: ['docs/guide.md'] });
  const git = stubGit(['src/core/engine.js', 'src/core/parser.js', 'README.md']);
  const report = await cli(fake, 'alice', ['overlap'], { git });
  assert.deepEqual(report, {
    changedFiles: 3,
    myPullRequests: [mine.number],
    overlaps: [{ source: 'workingTree', pullRequest: theirs.number, sharedFiles: 1, areas: ['core'] },
      { source: mine.number, pullRequest: theirs.number, sharedFiles: 1, areas: ['docs'] }]
  });
  assert.equal(JSON.stringify(report).includes('engine'), false);
  const noClone = { remoteFor: () => { throw new Error('not a repository'); } };
  assert.equal((await cli(fake, 'alice', ['overlap'], { git: noClone })).changedFiles, null);
});

test('the git helper finds the upstream remote, the branch point and changed files without a shell', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-git-'));
  const run = args => spawnSync('git', args, { cwd: temp, encoding: 'utf8' });
  const sh = (...args) => execFileSync('git', args, { cwd: temp, encoding: 'utf8' });
  try {
    sh('init', '-q', '-b', 'main');
    sh('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'start');
    sh('remote', 'add', 'upstream', 'https://github.com/Acme/Widgets.git');
    sh('remote', 'add', 'fork', 'git@github.com:alice/widgets.git');
    sh('update-ref', 'refs/remotes/upstream/main', 'HEAD');
    fs.writeFileSync(path.join(temp, 'changed.txt'), 'new file');
    const git = createGit(run);
    assert.equal(git.remoteFor('acme/widgets'), 'upstream');
    assert.equal(git.remoteFor('someone/else'), null);
    const base = git.mergeBase('upstream/main');
    assert.match(base, /^[0-9a-f]{40}$/);
    assert.deepEqual([...git.changedFiles(base)], ['changed.txt']);
    assert.throws(() => git.mergeBase('--output=/tmp/x'), /--base must be a branch or ref name/);
    assert.throws(() => git.mergeBase('no-such-ref'), /A git command failed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
