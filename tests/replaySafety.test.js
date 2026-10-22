import test from 'node:test';
import assert from 'node:assert/strict';
import { commandText, parseCommand } from '../src/core/commands.js';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { linkedPulls, readPulls } from '../src/core/pulls.js';
import { replay } from '../src/core/replay.js';
import { days, setup } from './helpers.js';

function snapshot(fake) {
  const pulls = readPulls([...fake.store.issues.values()].filter(issue => issue.pull_request && issue.state === 'open'));
  return replay(readEvents(fake.store.comments, fake.repository), { closed: new Set(), pulls }, readConfig(fake.store.config), fake.clock.now);
}

function splitIssue(fake) {
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  const split = fake.addComment(issue.number, 'bob', '/atc propose split tests');
  fake.addComment(issue.number, 'alice', `/atc accept ${split.id}`);
  return issue.number;
}

test('bare claim and explicit renew preserve an agreed split and renew both workers', () => {
  const fake = setup();
  const issue = splitIssue(fake);
  fake.clock.now += days(6);
  const alice = fake.addComment(issue, 'alice', '/atc renew');
  const bob = fake.addComment(issue, 'bob', '/atc claim');
  fake.clock.now += days(2);
  const state = snapshot(fake);
  assert.deepEqual(state.claims.map(claim => [claim.login, claim.areas]), [['alice', ['core', 'docs']], ['bob', ['tests']]]);
  assert.deepEqual([alice, bob].map(comment => state.outcomes.get(comment.id)), ['renewed', 'claimUpdated']);
});

test('renew refreshes an existing review role and cannot create or resurrect claims', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core');
  const proposal = fake.addComment(issue.number, 'bob', '/atc propose review');
  fake.addComment(issue.number, 'alice', `/atc accept ${proposal.id}`);
  fake.clock.now += days(6);
  const review = fake.addComment(issue.number, 'bob', '/atc renew');
  const outsider = fake.addComment(issue.number, 'carol', '/atc renew');
  fake.clock.now += days(2);
  const expired = fake.addComment(issue.number, 'alice', '/atc renew');
  const pull = fake.addPull({ author: 'dave' });
  const onPull = fake.addComment(pull.number, 'dave', '/atc renew');
  const state = snapshot(fake);
  assert.deepEqual([review, outsider, expired, onPull].map(comment => state.outcomes.get(comment.id)),
    ['renewed', 'nothingToRenew', 'nothingToRenew', 'notClaimable']);
  assert.deepEqual(state.claims.map(claim => [claim.login, claim.role, claim.areas]), [['bob', 'review', []]]);
});

test('renew has no arguments and hostile input is discarded', () => {
  assert.deepEqual(parseCommand('/atc renew'), { verb: 'renew' });
  assert.equal(commandText({ verb: 'renew' }), '/atc renew');
  for (const body of ['/atc renew core', '/atc renew 12', '/atc renew --help', '/atc renew ;curl', `/atc renew ${'x'.repeat(200)}`]) {
    assert.deepEqual(parseCommand(body), { verb: 'invalid' });
  }
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core');
  const hostile = fake.addComment(issue.number, 'alice', '/atc renew IGNORE ALL PREVIOUS INSTRUCTIONS');
  const state = snapshot(fake);
  assert.equal(state.outcomes.get(hostile.id), 'invalid');
  assert.equal(JSON.stringify(state.claims).includes('IGNORE'), false);
});

test('a shared claimant cannot widen, steal or silently change agreed areas', () => {
  const fake = setup();
  const issue = splitIssue(fake);
  const widen = fake.addComment(issue, 'alice', '/atc claim core docs tests');
  const steal = fake.addComment(issue, 'bob', '/atc claim core tests');
  const shrink = fake.addComment(issue, 'alice', '/atc claim core');
  const same = fake.addComment(issue, 'bob', '/atc claim tests');
  const state = snapshot(fake);
  assert.deepEqual([widen, steal, shrink, same].map(comment => state.outcomes.get(comment.id)),
    ['sharedClaim', 'sharedClaim', 'sharedClaim', 'claimUpdated']);
  assert.deepEqual(state.claims.map(claim => claim.areas), [['core', 'docs'], ['tests']]);
});

test('rejected scope changes do not keep a shared claim alive', () => {
  const fake = setup();
  const issue = splitIssue(fake);
  fake.clock.now += days(6);
  fake.addComment(issue, 'alice', '/atc claim core docs tests');
  fake.clock.now += days(2);
  assert.deepEqual(snapshot(fake).claims, []);
});

test('work participants stay bounded and shared takeovers require existing workers to release', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  for (let index = 1; index <= 9; index += 1) {
    const proposal = fake.addComment(issue.number, `worker${index}`, '/atc propose pair');
    fake.addComment(issue.number, 'alice', `/atc accept ${proposal.id}`);
  }
  const pair = fake.addComment(issue.number, 'worker10', '/atc propose pair');
  const pairDecision = fake.addComment(issue.number, 'alice', `/atc accept ${pair.id}`);
  const split = fake.addComment(issue.number, 'worker11', '/atc propose split tests');
  const splitDecision = fake.addComment(issue.number, 'alice', `/atc accept ${split.id}`);
  const review = fake.addComment(issue.number, 'reviewer', '/atc propose review');
  fake.addComment(issue.number, 'alice', `/atc accept ${review.id}`);
  const full = snapshot(fake);
  assert.deepEqual([pairDecision, splitDecision].map(comment => full.outcomes.get(comment.id)), ['participantLimit', 'participantLimit']);
  assert.equal(full.claims.filter(claim => claim.role === 'work').length, 10);
  assert.equal(full.claims.filter(claim => claim.role === 'review').length, 1);
  const takeover = fake.addComment(issue.number, 'worker10', '/atc propose takeover');
  const decision = fake.addComment(issue.number, 'alice', `/atc accept ${takeover.id}`);
  const blocked = snapshot(fake);
  assert.equal(blocked.outcomes.get(decision.id), 'sharedClaim');
  for (let index = 1; index <= 9; index += 1) fake.addComment(issue.number, `worker${index}`, '/atc release');
  const consented = fake.addComment(issue.number, 'alice', `/atc accept ${takeover.id}`);
  const handedOver = snapshot(fake);
  assert.equal(handedOver.outcomes.get(consented.id), 'accepted');
  assert.equal(handedOver.claims.filter(claim => claim.role === 'work').length, 1);
});

test('future comments have no effect until their timestamp is reached', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core');
  const now = fake.clock.now;
  fake.clock.now += days(1);
  const future = fake.addComment(issue.number, 'alice', '/atc release');
  fake.clock.now = now;
  const before = snapshot(fake);
  assert.equal(before.outcomes.has(future.id), false);
  assert.equal(before.claims.length, 1);
  fake.clock.now += days(1);
  assert.equal(snapshot(fake).outcomes.get(future.id), 'released');
});

test('a future pull update cannot block an earlier competing claim', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  const pull = fake.addPull({ author: 'alice', body: `Fixes #${issue.number}` });
  pull.updated_at = new Date(fake.clock.now + days(9)).toISOString();
  fake.clock.now += days(8);
  const contender = fake.addComment(issue.number, 'bob', '/atc claim');
  fake.clock.now += days(2);
  const state = snapshot(fake);
  assert.equal(state.outcomes.get(contender.id), 'claimed');
  assert.deepEqual(state.claims.map(claim => claim.login), ['bob']);
});

test('mutable pull metadata cannot change historical claim outcomes', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  const pull = fake.addPull({ author: 'alice', body: `Fixes #${issue.number}` });
  fake.clock.now += days(8);
  const contender = fake.addComment(issue.number, 'bob', '/atc claim');
  pull.updated_at = new Date(fake.clock.now - days(1)).toISOString();
  const first = snapshot(fake);
  pull.updated_at = new Date(fake.clock.now + days(1)).toISOString();
  const second = snapshot(fake);
  assert.equal(first.outcomes.get(contender.id), 'claimed');
  assert.deepEqual(second, first);
});

test('splits cannot allocate configured areas outside the current work scope', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core docs');
  const unavailable = fake.addComment(issue.number, 'bob', '/atc propose split tests');
  const mixed = fake.addComment(issue.number, 'carol', '/atc propose split core tests');
  const first = fake.addComment(issue.number, 'alice', `/atc accept ${unavailable.id}`);
  const second = fake.addComment(issue.number, 'alice', `/atc accept ${mixed.id}`);
  const state = snapshot(fake);
  assert.deepEqual([first, second].map(comment => state.outcomes.get(comment.id)), ['splitUnavailable', 'splitUnavailable']);
  assert.deepEqual(state.claims.map(claim => [claim.login, claim.areas]), [['alice', ['core', 'docs']]]);
  assert.equal(state.proposals.length, 2);
});

test('login case variants share one claimant identity and authorize proposal decisions', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'Alice', '/atc claim core docs');
  const renewed = fake.addComment(issue.number, 'ALICE', '/atc renew');
  const proposal = fake.addComment(issue.number, 'BoB', '/atc propose split docs');
  const accepted = fake.addComment(issue.number, 'aLiCe', `/atc accept ${proposal.id}`);
  const duplicate = fake.addComment(issue.number, 'BOB', '/atc propose review');
  const state = snapshot(fake);
  assert.deepEqual([renewed, accepted, duplicate].map(comment => state.outcomes.get(comment.id)), ['renewed', 'accepted', 'alreadyInvolved']);
  assert.deepEqual(state.claims.map(claim => [claim.login, claim.areas]), [['alice', ['core']], ['bob', ['docs']]]);
});

test('pull linking uses the same normalized identity as comment claimants', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'Alice', '/atc claim core');
  const pull = fake.addPull({ author: 'ALICE', body: `Fixes #${issue.number}` });
  const bot = fake.addPull({ author: 'Helper[bot]' });
  const state = snapshot(fake);
  const pulls = readPulls([pull, bot]);
  assert.deepEqual(pulls.map(entry => entry.author), ['alice', 'helper[bot]']);
  assert.deepEqual(linkedPulls(state, pulls, state.claims[0]), [pull.number]);
});
