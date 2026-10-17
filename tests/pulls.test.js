import test from 'node:test';
import assert from 'node:assert/strict';
import { referencedIssues } from '../src/core/pulls.js';
import { boardIssue, boardState, botComments, runAction, setup } from './helpers.js';

test('overlapping pull requests get one notice each, with counts and areas but never file names', async () => {
  const fake = setup();
  const [first, second] = [fake.addIssue(), fake.addIssue()];
  fake.addComment(first.number, 'alice', '/atc claim core');
  fake.addComment(second.number, 'bob', '/atc claim tests');
  await runAction(fake);
  const alicePull = fake.addPull({ author: 'alice', body: `Fixes #${first.number}`, files: ['src/core/engine.js', 'docs/guide.md'] });
  const bobPull = fake.addPull({ author: 'bob', body: `Closes #${second.number}`, files: ['src/core/engine.js', 'tests/engine.test.js'] });
  await runAction(fake, 'pull_request_target', { action: 'opened' });
  const state = boardState(fake);
  assert.deepEqual(state.overlaps.map(overlap => [overlap.prs, overlap.files, overlap.areas]), [[[alicePull.number, bobPull.number], 1, ['core']]]);
  assert.deepEqual(state.claims.map(claim => claim.prs), [[alicePull.number], [bobPull.number]]);
  const notice = `ATC: @alice, @bob, pull requests #${alicePull.number} and #${bobPull.number} change 1 of the same files (areas: core). Agree how to share the work on the linked issues with \`/atc propose pair\` or \`/atc propose split <areas>\`.`;
  assert.deepEqual(botComments(fake, alicePull.number), [notice]);
  assert.deepEqual(botComments(fake, bobPull.number), [notice]);
  for (const text of [...botComments(fake), boardIssue(fake).body, JSON.stringify(state)]) assert.equal(text.includes('engine'), false);
  await runAction(fake, 'pull_request_target', { action: 'synchronize' });
  assert.equal(botComments(fake, alicePull.number).length, 1);
  fake.closeIssue(bobPull.number);
  await runAction(fake, 'pull_request_target', { action: 'closed' });
  assert.deepEqual(boardState(fake).overlaps, []);
  assert.deepEqual(boardState(fake).claims.map(claim => claim.prs), [[alicePull.number], []]);
});

test('a pull request links to the claim it names, or to its author\'s only claim', async () => {
  const fake = setup();
  const [first, second, third] = [fake.addIssue(), fake.addIssue(), fake.addIssue()];
  fake.addComment(first.number, 'alice', '/atc claim');
  fake.addComment(second.number, 'alice', '/atc claim');
  fake.addComment(third.number, 'bob', '/atc claim');
  await runAction(fake);
  const named = fake.addPull({ author: 'alice', body: `Work for #${second.number}` });
  const vague = fake.addPull({ author: 'alice', body: 'No reference' });
  const only = fake.addPull({ author: 'bob', body: 'No reference either' });
  const stranger = fake.addPull({ author: 'carol', body: `Fixes #${third.number}` });
  await runAction(fake, 'schedule');
  const links = Object.fromEntries(boardState(fake).claims.map(claim => [claim.issue, claim.prs]));
  assert.deepEqual(links, { [first.number]: [], [second.number]: [named.number], [third.number]: [only.number] });
  assert.equal([vague.number, stranger.number].some(number => JSON.stringify(links).includes(String(number))), false);
});

test('issue references are read as numbers only', () => {
  assert.deepEqual(referencedIssues('Fixes #12, see #3 and #12 again'), [12, 3]);
  assert.deepEqual(referencedIssues('&#39; url/#7 a#8 #0 #9x'), []);
  assert.deepEqual(referencedIssues(null), []);
});
