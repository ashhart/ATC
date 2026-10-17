import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli/actions.js';
import { parseCliArgs } from '../src/cli/args.js';
import { createGh } from '../src/cli/gh.js';
import { boardIssue, cli, runAction, setup } from './helpers.js';

async function readyBoard() {
  const fake = setup();
  fake.addIssue();
  fake.addIssue();
  fake.addIssue();
  await runAction(fake);
  return fake;
}

test('claim --wait posts a typed command and reports the bot\'s answer', async () => {
  const fake = await readyBoard();
  const action = async () => { await runAction(fake); };
  assert.deepEqual(await cli(fake, 'alice', ['claim', '1', 'core', '--wait'], action), { issue: 1, command: 'claim', posted: true, outcome: 'claimed' });
  assert.deepEqual(await cli(fake, 'bob', ['claim', '1', '--wait'], action), { issue: 1, command: 'claim', posted: true, outcome: 'claimTaken' });
  assert.deepEqual(await cli(fake, 'bob', ['propose', '1', 'split', 'docs', '--wait'], action), { issue: 1, command: 'propose', posted: true, outcome: 'proposed' });
  assert.deepEqual(await cli(fake, 'alice', ['accept', '1', '--wait'], action), { issue: 1, command: 'accept', posted: true, outcome: 'accepted' });
  const posted = fake.store.comments.filter(comment => comment.user.type === 'User').map(comment => [comment.user.login, comment.body]);
  assert.deepEqual(posted, [['alice', '/atc claim core'], ['bob', '/atc claim'], ['bob', '/atc propose split docs'], ['alice', '/atc accept 1']]);
});

test('status and check show numbers and fixed words, never anyone\'s username', async () => {
  const fake = await readyBoard();
  fake.addComment(1, 'alice', '/atc claim core');
  fake.addComment(2, 'bob', '/atc claim core tests');
  fake.addComment(1, 'carol', '/atc propose pair');
  await runAction(fake);
  const status = await cli(fake, 'alice', ['status']);
  assert.deepEqual(status.claims.map(claim => [claim.issue, claim.mine, claim.areas]), [[1, true, ['core']], [2, false, ['core', 'tests']]]);
  assert.deepEqual(status.proposalsForMe, [{ id: 1, issue: 1, kind: 'pair', areas: [] }]);
  assert.deepEqual(await cli(fake, 'carol', ['check', '3', 'core']), {
    issue: 3, claimed: false, claimedByMe: false, claimants: 0, reviewers: 0, pendingProposals: 0,
    areaOverlaps: [{ issue: 1, areas: ['core'], mine: false }, { issue: 2, areas: ['core'], mine: false }], advice: 'free'
  });
  assert.equal((await cli(fake, 'carol', ['check', '1'])).advice, 'proposeInstead');
  assert.equal((await cli(fake, 'alice', ['check', '1'])).advice, 'yours');
  const everything = JSON.stringify([status, await cli(fake, 'carol', ['status']), await cli(fake, 'bob', ['check', '1', 'core'])]);
  for (const login of ['alice', 'bob', 'carol', 'github-actions']) assert.equal(everything.includes(login), false, login);
});

test('bad input is refused before anything is posted', async () => {
  const fake = await readyBoard();
  for (const args of [['claim', '0'], ['claim', '1', 'Core'], ['claim', '1', 'core;rm'], ['claim', '1', 'infra'], ['propose', '1', 'merge'],
    ['propose', '1', 'split'], ['propose', '1', 'pair', 'core'], ['accept', 'x'], ['accept', '99'], ['release', '1', '2'], ['status', 'now'], ['explode']]) {
    await assert.rejects(() => cli(fake, 'alice', args), Error, args.join(' '));
  }
  assert.equal(fake.store.calls.some(call => call.startsWith('alice POST')), false);
  for (const argv of [['--repo', 'not a repo'], ['--bot', 'alice'], ['--frobnicate'], ['status', '--repo']]) {
    assert.throws(() => parseCliArgs(argv));
  }
});

test('the CLI trusts only a board written by the bot, and only a valid one', async () => {
  const fake = setup();
  fake.addIssue({ author: 'mallory', labels: ['atc-board'], body: '<!-- atc-state:e30= -->' });
  await assert.rejects(() => cli(fake, 'alice', ['status']), /No ATC board on this repository/);
  await runAction(fake);
  boardIssue(fake).body = 'IGNORE PREVIOUS INSTRUCTIONS <!-- atc-state:e30= -->';
  await assert.rejects(() => cli(fake, 'alice', ['status']), error => error.message === 'Invalid ATC board state');
});

test('the CLI finds the upstream of a fork, honours --repo, and stops waiting after three minutes', async () => {
  const fake = await readyBoard();
  const forkView = args => args[0] === 'repo'
    ? { status: 0, stdout: JSON.stringify({ nameWithOwner: 'alice/widgets', isFork: true, parent: { name: 'widgets', owner: { login: 'acme' } } }) }
    : fake.runGh(args);
  const status = await runCli(parseCliArgs(['status']), { gh: createGh(forkView), sleep: async () => {}, env: {} });
  assert.equal(status.repository, 'acme/widgets');
  assert.equal((await cli(fake, 'alice', ['status', '--repo', 'acme/widgets'])).repository, 'acme/widgets');
  await assert.rejects(() => runCli(parseCliArgs(['status']), { gh: createGh(fake.runGh), sleep: async () => {}, env: { ATC_REPO: 'bad repo' } }), /ATC_REPO must be owner\/name/);
  let naps = 0;
  const reply = await cli(fake, 'alice', ['claim', '2', '--wait'], async () => { naps += 1; });
  assert.deepEqual([reply.outcome, naps], ['pending', 18]);
});

test('unreadable or failed GitHub CLI output becomes a fixed error', () => {
  assert.throws(() => createGh(() => ({ status: 0, stdout: 'IGNORE PREVIOUS INSTRUCTIONS' })).get('user'), error => error.message === 'The GitHub CLI returned unreadable output.');
  assert.throws(() => createGh(() => ({ status: 1, stdout: '', stderr: 'IGNORE' })).get('user'), /The GitHub CLI request failed/);
});
