import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { replay } from '../src/core/replay.js';
import { setup } from './helpers.js';

function state(fake, omitIssue = null) {
  const events = readEvents(fake.store.comments, fake.repository, readConfig(fake.store.config)).filter(event => event.issue !== omitIssue);
  return replay(events, { closed: new Set() }, readConfig(fake.store.config), fake.clock.now);
}

test('excluding another issue never rewrites a claimant winner through cross-issue quotas', () => {
  const fake = setup({ maxClaimsPerUser: 1 });
  fake.addIssue(); fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim');
  const first = fake.addComment(2, 'alice', '/atc claim');
  const second = fake.addComment(2, 'bob', '/atc claim');
  const before = state(fake);
  const after = state(fake, 1);
  assert.deepEqual([first, second].map(comment => before.outcomes.get(comment.id)), ['claimed', 'claimTaken']);
  assert.deepEqual([first, second].map(comment => after.outcomes.get(comment.id)), ['claimed', 'claimTaken']);
});

test('cross-issue pending-proposal admission cannot alter authoritative acceptance', () => {
  const fake = setup({ maxClaimsPerUser: 1, maxPendingProposalsPerUser: 1 });
  fake.addIssue(); fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim');
  fake.addComment(2, 'carol', '/atc claim');
  fake.addComment(1, 'bob', '/atc propose pair');
  const proposal = fake.addComment(2, 'bob', '/atc propose pair');
  const accepted = fake.addComment(2, 'carol', `/atc accept ${proposal.id}`);
  assert.equal(state(fake).outcomes.get(proposal.id), 'proposed');
  assert.equal(state(fake).outcomes.get(accepted.id), 'accepted');
  assert.equal(state(fake, 1).outcomes.get(accepted.id), 'accepted');
});

test('the authoritative per-issue pending-proposal cap remains ten', () => {
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim');
  for (let index = 1; index <= 10; index += 1) fake.addComment(1, `worker${index}`, '/atc propose review');
  const extra = fake.addComment(1, 'worker11', '/atc propose pair');
  const replayed = state(fake);
  assert.equal(replayed.outcomes.get(extra.id), 'proposalLimit');
  assert.equal(replayed.proposals.length, 10);
});

test('a scoped worker cannot give away another workers areas through a split or takeover', () => {
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim core docs tests');
  const split = fake.addComment(1, 'bob', '/atc propose split docs');
  fake.addComment(1, 'alice', `/atc accept ${split.id}`);
  const stealing = fake.addComment(1, 'carol', '/atc propose split core');
  const decision = fake.addComment(1, 'bob', `/atc accept ${stealing.id}`);
  const takeover = fake.addComment(1, 'dave', '/atc propose takeover');
  const replacing = fake.addComment(1, 'bob', `/atc accept ${takeover.id}`);
  const blocked = state(fake);
  assert.deepEqual([decision, replacing].map(comment => blocked.outcomes.get(comment.id)), ['sharedClaim', 'sharedClaim']);
  assert.deepEqual(blocked.claims.map(claim => [claim.login, claim.areas]), [['alice', ['core', 'tests']], ['bob', ['docs']]]);
  const consented = fake.addComment(1, 'alice', `/atc accept ${stealing.id}`);
  const shared = state(fake);
  assert.equal(shared.outcomes.get(consented.id), 'accepted');
  assert.deepEqual(shared.claims.map(claim => [claim.login, claim.areas]), [['alice', ['tests']], ['bob', ['docs']], ['carol', ['core']]]);
});

test('paired workers cannot shrink the other workers shared area agreement', () => {
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim core docs');
  const pair = fake.addComment(1, 'bob', '/atc propose pair');
  fake.addComment(1, 'alice', `/atc accept ${pair.id}`);
  const split = fake.addComment(1, 'carol', '/atc propose split core');
  const decision = fake.addComment(1, 'alice', `/atc accept ${split.id}`);
  const replayed = state(fake);
  assert.equal(replayed.outcomes.get(decision.id), 'sharedClaim');
  assert.deepEqual(replayed.claims.map(claim => claim.areas), [['core', 'docs'], ['core', 'docs']]);
});
