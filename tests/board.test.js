import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../src/cli/args.js';
import { resultExitCode } from '../src/cli/result.js';
import { cli, setup } from './helpers.js';

const noClone = { remoteFor() { assert.fail('Board must not read git'); }, mergeBase() { assert.fail('Board must not read git'); } };

test('pointing at a repository shows ordinary contributors, overlaps and help without adoption or a clone', async () => {
  const fake = setup(null);
  const assigned = fake.addIssue({ assignees: ['bob'], labels: [{ name: 'help wanted' }] });
  const available = fake.addIssue({ labels: [{ name: 'good first issue' }] });
  const first = fake.addPull({ author: 'bob', body: `Fixes #${assigned.number}`, files: ['src/shared.js'] });
  const second = fake.addPull({ author: 'carol', files: ['src/shared.js'], draft: true });
  const result = await cli(fake, 'alice', ['--repo', fake.repository], { git: noClone });
  assert.equal(parseCliArgs([]).command, 'board');
  assert.equal(result.complete, true);
  assert.equal(result.repository, 'selected');
  assert.equal(result.observedAt, new Date(fake.clock.now).toISOString());
  assert.deepEqual(result.summary, { contributors: 2, issues: 2, openIssues: 2, openPullRequests: 2, fileOverlaps: 1, opportunities: 3, activeAgents: 0,
    duplicateAttempts: 0, staleClaims: 0 });
  assert.equal(result.coordinationEnabled, false);
  assert.deepEqual(result.contributors.map(person => [person.id, person.assignedIssues, person.pullRequests]),
    [[1, [assigned.number], [first.number]], [2, [], [second.number]]]);
  assert.deepEqual(result.fileOverlaps, [{ pullRequests: [first.number, second.number], sharedFiles: 1, areas: [] }]);
  assert.equal(result.pullRequests.find(pull => pull.pullRequest === second.number).draft, true);
  assert.equal(result.opportunities.find(row => row.issue === assigned.number).signal, 'request');
  assert.deepEqual(result.opportunities.find(row => row.issue === assigned.number).actions, ['check']);
  assert.deepEqual(result.opportunities.find(row => row.issue === available.number).actions, ['check']);
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
  assert.equal(fake.store.calls.some(call => call.includes('state=closed')), false);
  assert.equal(resultExitCode(result, true), 2);
});

test('ATC work adds safe routes to pair, split or review and contributor references link its PR', async () => {
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'bob', '/atc claim core docs');
  const pull = fake.addPull({ author: 'bob', body: 'Fixes #1', files: ['src/core/engine.js'] });
  const board = await cli(fake, 'alice', ['board']);
  const claimant = board.issues[0].claims[0];
  assert.equal(claimant.contributor, board.pullRequests[0].contributor);
  assert.deepEqual(board.contributors[0].workingIssues, [1]);
  assert.deepEqual(board.contributors[0].pullRequests, [pull.number]);
  assert.deepEqual(board.opportunities[0], { issue: 1, reason: 'activeClaim', signal: 'candidate',
    actions: ['check', 'proposePair', 'proposeReview', 'proposeSplit'] });
  assert.equal(resultExitCode(board, true), 0);
});

test('incomplete file discovery remains useful but never suggests acquiring unknown work', async () => {
  const fake = setup();
  fake.addIssue();
  for (let index = 0; index < 201; index++) fake.addPull({ author: 'bob', files: ['src/shared.js'] });
  const board = await cli(fake, 'alice', ['board']);
  assert.equal(board.complete, false);
  assert.deepEqual(board.limitations, ['boardPullRequestsLimit', 'pullFilesUnavailable']);
  assert.equal(board.pullRequests.length, 201);
  assert.equal(board.pullRequests.filter(pull => pull.changedFiles === null).length, 1);
  assert.ok(board.opportunities.every(row => JSON.stringify(row.actions) === '["check"]'));
  assert.equal(resultExitCode(board, true), 2);
});

test('open issue discovery has an explicit cap and old closed history does not consume comment budget', async () => {
  const fake = setup();
  const closed = fake.addIssue();
  for (let index = 0; index < 3001; index++) fake.addComment(closed.number, 'bob', 'ordinary history');
  fake.closeIssue(closed.number);
  fake.addIssue();
  assert.equal((await cli(fake, 'alice', ['board'])).complete, true);
  for (let index = 0; index < 1000; index++) fake.addIssue();
  const board = await cli(fake, 'alice', ['board']);
  assert.equal(board.complete, false);
  assert.deepEqual(board.limitations, ['openIssuesLimit']);
  assert.equal(board.summary.openIssues, 1000);
});

test('board output and posted bodies never copy identity or personal fields from GitHub', async () => {
  const fake = setup();
  const personal = ['private-name', 'private.person@example.com', '555-0109', '123 Example Street', 'fake-private-token-canary'];
  const issue = fake.addIssue({ title: personal.join(' '), body: personal.join(' '), assignees: [personal[0]] });
  const claimant = fake.addComment(issue.number, personal[0], `/atc claim core\n${personal.join('\n')}`);
  Object.assign(claimant.user, { id: 876543210123, name: personal[0], email: personal[1], bio: personal[3] });
  const pull = fake.addPull({ author: personal[0], body: `Fixes #1\n${personal.join('\n')}`, files: [`src/core/${personal[1]}`] });
  Object.assign(pull.user, claimant.user);
  const board = await cli(fake, 'alice', ['board']);
  const text = JSON.stringify(board);
  for (const value of [...personal, '876543210123', fake.repository]) assert.equal(text.includes(value), false);
  assert.equal(board.contributors[0].id, 1);
  await cli(fake, 'alice', ['propose', '1', 'pair']);
  const body = fake.store.comments.at(-1).body;
  assert.equal(body, '/atc propose pair');
  for (const value of personal) assert.equal(body.includes(value), false);
});

test('strict mode treats a shared area as a hint and actual shared files as attention', () => {
  assert.equal(resultExitCode({ complete: true, areaOverlaps: [{ areas: ['core'] }], fileOverlaps: [] }, true), 0);
  assert.equal(resultExitCode({ complete: true, fileOverlaps: [{ sharedFiles: 1 }] }, true), 2);
});
