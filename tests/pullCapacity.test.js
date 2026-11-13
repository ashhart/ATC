import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, setup } from './helpers.js';
import { createReader } from '../src/cli/reader.js';
import { publicationPulls } from '../src/cli/publicationRead.js';
import { collectBoardFeed } from '../src/site/feed.js';
import { displayResult } from '../src/cli/output.js';
import { readWhoResult, readOverlapResult } from '../src/hooks/cliResults.js';

function fixture(count, linked = false) {
  const fake = setup();
  fake.addIssue();
  for (let index = 0; index < count; index++) fake.addPull({ author: 'bob', body: linked ? 'Fixes #1' : '' });
  return fake;
}

test('301 unrelated open PRs allow a free issue to be claimed', async () => {
  const fake = fixture(301);
  const check = await cli(fake, 'alice', ['check', '1']);
  assert.equal(check.complete, true);
  assert.equal(check.advice, 'free');
  assert.equal((await cli(fake, 'alice', ['claim', '1'])).outcome, 'claimed');
});

test('a linked PR beyond the third page blocks a competing claim', async () => {
  const fake = setup();
  fake.addIssue();
  const linked = fake.addPull({ author: 'bob', body: 'Fixes #1' });
  for (let index = 0; index < 300; index++) fake.addPull({ author: 'bob' });
  const check = await cli(fake, 'alice', ['check', '1']);
  assert.equal(check.complete, true);
  assert.equal(check.advice, 'takenOutside');
  assert.deepEqual(check.otherPullRequests, [linked.number]);
  assert.equal((await cli(fake, 'alice', ['claim', '1'])).posted, false);
});

test('2500 PRs remain complete at the exact boundary for check and status', async () => {
  const fake = fixture(2500, true);
  const check = await cli(fake, 'alice', ['check', '1']);
  assert.equal(check.complete, true);
  assert.equal(check.otherPullRequests.length, 2500);
  assert.equal(check.advice, 'takenOutside');
  const mine = await cli(fake, 'bob', ['check', '1']);
  assert.equal(mine.myPullRequests.length, 2500);
  assert.equal(mine.advice, 'yours');
  fake.addComment(1, 'bob', '/atc claim');
  const status = await cli(fake, 'bob', ['status']);
  assert.equal(status.complete, true);
  assert.equal(status.claims[0].pullRequests.length, 2500);
});

test('board and viewer retain 2500 PRs while file comparisons stay bounded', async () => {
  const fake = fixture(2500, true);
  const board = await cli(fake, 'alice', ['board']);
  assert.equal(board.summary.openPullRequests, 2500);
  assert.equal(board.contributors[0].pullRequests.length, 2500);
  assert.equal(board.issues[0].pullRequests.length, 2500);
  assert.equal(board.complete, false);
  assert.ok(board.limitations.includes('boardPullRequestsLimit'));
  assert.equal(board.limitations.includes('pullRequestsLimit'), false);
  const feed = collectBoardFeed(board, fake.clock.now);
  assert.equal(feed.flights[0].pullRequests.length, 2500);
  assert.equal(feed.complete, false);
});

test('2501 PRs refuse claim coverage without posting', async () => {
  const fake = fixture(2501);
  const check = await cli(fake, 'alice', ['check', '1']);
  assert.equal(check.complete, false);
  assert.deepEqual(check.limitations, ['pullRequestsLimit']);
  assert.equal(check.advice, 'incomplete');
  assert.equal((await cli(fake, 'alice', ['claim', '1'])).outcome, 'incomplete');
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
});

test('a deadline after three PR pages refuses incomplete coverage', () => {
  let calls = 0;
  const reader = createReader({ timeLeft: () => calls < 3 ? 30000 : 0,
    get: () => { calls++; return Array.from({ length: 100 }, (_, index) => ({ number: (calls - 1) * 100 + index + 1 })); } }, 'acme/widgets');
  const result = reader.openPulls();
  assert.equal(result.items.length, 300);
  assert.equal(result.partial, true);
  assert.equal(result.timed, true);
  assert.equal(calls, 3);
});

test('publication revalidation accepts 2500 PR identities and rejects overflow', () => {
  const pulls = Array.from({ length: 2500 }, (_, index) => ({ number: index + 1, head: { sha: 'a'.repeat(40) },
    base: { sha: 'b'.repeat(40), repo: { full_name: 'acme/widgets' } } }));
  assert.equal(publicationPulls(pulls, 'acme/widgets')?.length, 2500);
  assert.equal(publicationPulls([...pulls, { ...pulls[0], number: 2501 }], 'acme/widgets'), null);
});

test('who and hook boundaries preserve 2500 PR identities and refuse overflow', () => {
  const numbers = Array.from({ length: 2500 }, (_, index) => index + 1);
  const who = { command: 'who', complete: true, limitations: [], observedAt: null, pullRequests: numbers, worktrees: 0, agents: 0 };
  assert.equal(readWhoResult(displayResult(who)).pullRequests.length, 2500);
  assert.equal(readWhoResult({ ...who, pullRequests: [...numbers, 2501] }), null);
  assert.throws(() => displayResult({ ...who, pullRequests: [...numbers, 2501] }));
  const overlaps = numbers.map(pullRequest => ({ source: 'workingTree', pullRequest, sharedFiles: 1, areas: [], conflict: 'clean', conflictFiles: 0 }));
  const result = { complete: true, limitations: [], changedFiles: 1, myPullRequests: [], overlaps, worktrees: 0, worktreeOverlaps: [] };
  assert.equal(readOverlapResult(displayResult(result)).pulls.length, 2500);
});
