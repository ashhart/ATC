import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, days, setup } from './helpers.js';

test('a repository without .github/atc.json can be read but never receives ATC comments', async () => {
  const fake = setup(null);
  fake.addIssue();
  const check = await cli(fake, 'alice', ['check', '1']);
  assert.deepEqual([check.advice, check.coordinationEnabled], ['free', false]);
  for (const args of [['claim', '1'], ['claim', '1', '--dry-run'], ['renew', '1'], ['release', '1'], ['propose', '1', 'pair'], ['accept', '5'], ['withdraw', '5']]) {
    const result = await cli(fake, 'alice', args);
    assert.equal(result.outcome, 'notEnabled', args.join(' '));
    assert.equal(result.posted, false);
  }
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
  assert.equal((await cli(fake, 'alice', ['board'])).opportunities.every(row => row.actions.join() === 'check'), true);
});

test('an open pull request that links the issue counts as your claim without posting anything', async () => {
  const fake = setup();
  fake.addIssue();
  const draft = fake.addPull({ author: 'alice', body: 'Fixes #1', files: ['src/core/a.js'], draft: true });
  const mine = await cli(fake, 'alice', ['check', '1']);
  assert.deepEqual([mine.advice, mine.claimedByMe, mine.myPullRequests], ['yours', false, [draft.number]]);
  const theirs = await cli(fake, 'bob', ['check', '1']);
  assert.deepEqual([theirs.advice, theirs.otherPullRequests], ['takenOutside', [draft.number]]);
  assert.equal((await cli(fake, 'bob', ['claim', '1'])).outcome, 'takenOutside');
  assert.equal(fake.store.comments.length, 0);
});

test('an ATC claim held by someone else still outranks your linked pull request', async () => {
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'bob', '/atc claim');
  fake.addPull({ author: 'alice', body: 'Fixes #1' });
  assert.equal((await cli(fake, 'alice', ['check', '1'])).advice, 'proposeInstead');
});

test('the board names duplicate attempts by different people and claims going stale', async () => {
  const fake = setup();
  fake.addIssue();
  fake.addIssue();
  fake.addIssue();
  const first = fake.addPull({ author: 'bob', body: 'Fixes #1' });
  const second = fake.addPull({ author: 'carol', body: 'Closes #1' });
  fake.addPull({ author: 'bob', body: 'Fixes #2' });
  fake.addPull({ author: 'bob', body: 'Also #2' });
  fake.addComment(3, 'dave', '/atc claim');
  fake.clock.now += days(4);
  const board = await cli(fake, 'alice', ['board']);
  assert.deepEqual(board.duplicateAttempts, [{ issue: 1, pullRequests: [first.number, second.number] }]);
  assert.equal(board.staleClaims.length, 1);
  assert.equal(board.staleClaims[0].issue, 3);
  assert.equal(board.staleClaims[0].mine, false);
  assert.equal(board.summary.duplicateAttempts, 1);
  assert.equal(board.summary.staleClaims, 1);
  assert.equal(JSON.stringify(board).includes('dave'), false);
  fake.clock.now -= days(2);
  assert.deepEqual((await cli(fake, 'alice', ['board'])).staleClaims, []);
});
