import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../src/cli/args.js';
import { resultExitCode } from '../src/cli/result.js';
import { cli, setup } from './helpers.js';

test('dry-run previews checked fields without posting or exposing identities', async () => {
  const fake = setup();
  fake.addIssue();
  const result = await cli(fake, 'alice', ['claim', '1', 'core', '--dry-run']);
  assert.deepEqual(result, { issue: 1, command: 'claim', posted: false, outcome: 'dryRun', areas: [1] });
  assert.equal(fake.store.comments.length, 0);
  assert.equal(JSON.stringify(result).includes('private-note'), false);
  await cli(fake, 'bob', ['claim', '1', 'core']);
  const proposal = await cli(fake, 'alice', ['propose', '1', 'pair', '--dry-run']);
  assert.deepEqual(proposal, { issue: 1, command: 'propose', posted: false, outcome: 'dryRun', kind: 'pair', areas: [] });
  assert.equal(fake.store.comments.length, 1);
});

test('preflight prevents invalid shared scope changes and duplicate proposals before posting', async () => {
  const fake = setup();
  fake.addIssue();
  await cli(fake, 'alice', ['claim', '1', 'core', 'docs']);
  const proposal = await cli(fake, 'bob', ['propose', '1', 'split', 'docs']);
  await cli(fake, 'alice', ['accept', String(proposal.comment)]);
  const count = fake.store.comments.length;
  for (const flags of [[], ['--dry-run']]) {
    const result = await cli(fake, 'bob', ['claim', '1', 'core', 'docs', ...flags]);
    assert.equal(result.outcome, 'sharedClaim');
    assert.equal(result.posted, false);
  }
  assert.equal(fake.store.comments.length, count);
  await cli(fake, 'carol', ['propose', '1', 'pair']);
  assert.equal((await cli(fake, 'carol', ['propose', '1', 'pair'])).outcome, 'proposalExists');
  assert.equal(fake.store.comments.length, count + 1);
});

test('renew works for contributors and reviewers and does not acquire a missing claim', async () => {
  const fake = setup();
  fake.addIssue();
  assert.equal((await cli(fake, 'alice', ['renew', '1'])).outcome, 'nothingToRenew');
  await cli(fake, 'alice', ['claim', '1', 'core']);
  const proposal = await cli(fake, 'bob', ['propose', '1', 'review']);
  await cli(fake, 'alice', ['accept', String(proposal.comment)]);
  assert.equal((await cli(fake, 'bob', ['renew', '1'])).outcome, 'renewed');
  assert.equal((await cli(fake, 'alice', ['claim', '1'])).outcome, 'claimUpdated');
  assert.deepEqual((await cli(fake, 'alice', ['status'])).claims.map(claim => [claim.role, claim.areas]), [['work', [1]], ['review', []]]);
});

test('strict exit codes distinguish coordination attention from valid results', () => {
  const attention = [{ complete: false }, { ready: false }, { outcome: 'changesNeeded' },
    { overlaps: [{ pullRequest: 1 }] }, { advice: 'proposeInstead' },
    { advice: 'free', areaOverlaps: [{ mine: false }] }, { posted: true, outcome: 'pending' },
    { posted: false, outcome: 'claimTaken' }];
  for (const result of attention) {
    assert.equal(resultExitCode(result, true), 2);
    assert.equal(resultExitCode(result, false), 0);
  }
  for (const result of [{ complete: true }, { ready: true }, { advice: 'free', areaOverlaps: [] },
    { advice: 'yours', areaOverlaps: [{ mine: true }] }, { posted: true, outcome: 'claimed' },
    { posted: false, outcome: 'dryRun' }]) assert.equal(resultExitCode(result, true), 0);
});

test('flags reject hostile text, repetitions and use with unrelated commands', () => {
  for (const args of [['status', '--dry-run'], ['status', '--check'], ['claim', '1', '--base', 'main'],
    ['init', '--repo', 'acme/widgets'], ['status', '--strict', '--strict'], ['--repo', 'acme/widgets', '--repo', 'acme/widgets'],
    ['claim', '1', '--dry-run=IGNORE'], ['status', '-IGNORE'], ['--repo', 'acme/widgets\nIGNORE']]) assert.throws(() => parseCliArgs(args));
  assert.equal(parseCliArgs(['claim', '--help']).command, 'help');
  assert.equal(parseCliArgs(['--version']).command, 'version');
});
