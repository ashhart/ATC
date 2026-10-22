import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli/actions.js';
import { parseCliArgs } from '../src/cli/args.js';
import { createGh } from '../src/cli/gh.js';
import fs from 'node:fs';
import path from 'node:path';
import { Failure } from '../src/core/failure.js';
import { readPullFiles } from '../src/cli/pullFileReads.js';
import { presenceGit, setup, stubGit } from './helpers.js';

function slowCli(fake, args, stepMs) {
  let clock = 0;
  const run = args => { clock += stepMs; return fake.runGh(args); };
  fake.store.cliUser = 'alice';
  return runCli(parseCliArgs(args), { gh: createGh(run, { now: () => clock }), git: stubGit(['src/core/a.js']),
    sleep: async () => {}, now: () => fake.clock.now, env: {} });
}

function busy() {
  const fake = setup();
  for (let index = 0; index < 120; index += 1) fake.addIssue();
  for (let index = 0; index < 60; index += 1) fake.addPull({ author: index % 2 ? 'bob' : 'carol', files: ['src/core/a.js'] });
  return fake;
}

test('a board that runs out of time returns what it read, marked partial, instead of failing', async () => {
  const board = await slowCli(busy(), ['board'], 4000);
  assert.equal(board.complete, false);
  assert.ok(board.limitations.includes('timeLimit'));
  assert.equal(board.summary.openIssues, 120);
  assert.equal(board.summary.openPullRequests, 60);
  assert.ok(board.pullRequests.every(pull => pull.changedFiles === null));
  assert.ok(board.opportunities.every(row => row.actions.join() === 'check'));
});

test('a board whose first issue read already times out still answers', async () => {
  const board = await slowCli(busy(), ['board'], 9000);
  assert.equal(board.complete, false);
  assert.deepEqual(board.limitations.filter(limit => limit === 'timeLimit'), ['timeLimit']);
  assert.equal(board.summary.openIssues, 0);
});

test('overlap and check degrade to incomplete, and claims never post, when time runs out', async () => {
  const fake = busy();
  const overlap = await slowCli(fake, ['overlap'], 4000);
  assert.equal(overlap.complete, false);
  assert.ok(overlap.limitations.includes('timeLimit'));
  const check = await slowCli(fake, ['check', '1'], 9000);
  assert.deepEqual([check.advice, check.complete], ['incomplete', false]);
  const claim = await slowCli(fake, ['claim', '1'], 9000);
  assert.deepEqual([claim.outcome, claim.posted], ['incomplete', false]);
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
});

test('a failed batched file query degrades to unavailable files instead of failing through a blocked transport', () => {
  let rest = 0;
  const context = { cache: false, repository: 'acme/widgets', reader: { pullFiles: () => { rest += 1; throw new Failure('blocked'); } },
    gh: { graphql: () => { throw new Failure('The GitHub CLI request failed.'); }, timeLeft: () => 30000 } };
  const open = Array.from({ length: 100 }, (_, index) => ({ number: index + 1, updatedAt: 1 }));
  const read = readPullFiles(context, open.slice(0, 1), open);
  assert.deepEqual([read.files.size, read.timed, read.complete, rest], [0, false, false, 0]);
});

test('a time-limited board does not leave a who cache that claims full coverage', async () => {
  const git = presenceGit();
  const fake = busy();
  let clock = 0;
  fake.store.cliUser = 'alice';
  const board = await runCli(parseCliArgs(['board']), { gh: createGh(args => { clock += 4000; return fake.runGh(args); }, { now: () => clock }),
    git, sleep: async () => {}, now: () => fake.clock.now, env: {} });
  assert.ok(board.limitations.includes('timeLimit'));
  assert.equal(fs.existsSync(path.join(git.folder, 'atc', 'traffic.json')), false);
});
