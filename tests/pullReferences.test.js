import test from 'node:test';
import assert from 'node:assert/strict';
import { readPulls, referencedIssues } from '../src/core/pulls.js';
import { cli, setup } from './helpers.js';
import { outputBoard } from './outputFixtures.js';
import { displayResult } from '../src/cli/output.js';

const references = (count, start = 1) => Array.from({ length: count }, (_, index) => `#${start + index}`).join(' ');
const rawPull = (number, body) => ({ number, body, draft: false, user: { login: 'contributor', type: 'User' },
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' });

test('a 21-reference PR retains its final issue and does not block unrelated check or claim previews', async () => {
  const fake = setup();
  fake.store.nextNumber = 2270;
  fake.addIssue();
  fake.store.nextNumber = 2211;
  fake.addPull({ author: 'bob', body: references(21) });
  const check = await cli(fake, 'alice', ['check', '2270']);
  assert.equal(check.complete, true);
  assert.equal(check.advice, 'free');
  const preview = await cli(fake, 'alice', ['claim', '2270', '--dry-run']);
  assert.equal(preview.outcome, 'dryRun');
  assert.equal(preview.posted, false);
  const board = await cli(fake, 'alice', ['board']);
  assert.equal(board.complete, true);
  assert.deepEqual(board.pullRequests[0].issues, Array.from({ length: 21 }, (_, index) => index + 1));
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
});

test('an issue at the end of a long description still reports its existing pull request', async () => {
  const fake = setup();
  fake.store.nextNumber = 21;
  fake.addIssue();
  fake.store.nextNumber = 2211;
  fake.addPull({ author: 'bob', body: references(21) });
  const check = await cli(fake, 'alice', ['check', '21']);
  assert.equal(check.complete, true);
  assert.equal(check.advice, 'takenOutside');
  assert.deepEqual(check.otherPullRequests, [2211]);
});

test('reference distribution can change without increasing the existing 6000-edge snapshot budget', () => {
  const full = references(6000);
  assert.equal(referencedIssues(full).length, 6000);
  assert.equal(referencedIssues(`${full} #1 #6000`).length, 6000);
  assert.equal(referencedIssues(`${full} #6001`), null);
  const first = rawPull(1, references(3000));
  const second = rawPull(2, references(3000, 3001));
  const overflow = rawPull(3, '#6001');
  assert.deepEqual(readPulls([second, first]).map(pull => pull.issues.length), [3000, 3000]);
  const retained = readPulls([overflow, second, first]);
  assert.deepEqual(retained.map(pull => pull.number), [1, 2]);
  assert.equal(retained.reduce((count, pull) => count + pull.issues.length, 0), 6000);
});

test('the outbound board accepts a long numeric list and rejects aggregate overflow', () => {
  const board = outputBoard();
  board.pullRequests[0].issues = Array.from({ length: 6000 }, (_, index) => index + 1);
  assert.equal(displayResult(board, ['first', 'second']).pullRequests[0].issues.length, 6000);
  board.pullRequests.push({ ...board.pullRequests[0], pullRequest: 3, issues: [6001] });
  board.summary.openPullRequests = 2;
  assert.throws(() => displayResult(board, ['first', 'second']), /ATC output failed validation/);
});

test('several individually valid descriptions cannot exceed the snapshot budget or permit a claim', async () => {
  const fake = setup();
  fake.store.nextNumber = 9000;
  fake.addIssue();
  fake.addPull({ author: 'bob', body: references(3000) });
  fake.addPull({ author: 'carol', body: references(3001, 3001) });
  const check = await cli(fake, 'alice', ['check', '9000']);
  assert.equal(check.complete, false);
  assert.equal(check.advice, 'incomplete');
  assert.deepEqual(check.limitations, ['invalidPulls']);
  const preview = await cli(fake, 'alice', ['claim', '9000', '--dry-run']);
  assert.equal(preview.outcome, 'incomplete');
  assert.equal(preview.posted, false);
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
});
