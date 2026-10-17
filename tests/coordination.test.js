import test from 'node:test';
import assert from 'node:assert/strict';
import { claimIssue, expireClaims, releaseClaim } from '../src/core/claims.js';
import { readConfig } from '../src/core/config.js';
import { renderMessage } from '../src/core/messages.js';
import { decideProposal, proposeWork } from '../src/core/proposals.js';
import { emptyState } from '../src/core/state.js';

const now = Date.UTC(2026, 9, 17, 12);
const config = readConfig({ areas: { core: ['src/core/'], docs: ['docs/'], tests: ['tests/'] }, maxClaimsPerUser: 2 });

function claimed(login, issue, areas = []) {
  const state = emptyState(now);
  claimIssue(state, { login, issue, areas, open: true }, config, now);
  return state;
}

function rows(state) {
  return state.claims.map(claim => [claim.issue, claim.login, claim.role, claim.areas]).sort((first, second) => first[1].localeCompare(second[1]));
}

test('one claimant per issue, with limits, known areas and open issues only', () => {
  const state = claimed('alice', 1, ['core']);
  assert.deepEqual(rows(state), [[1, 'alice', 'work', ['core']]]);
  const taken = claimIssue(state, { login: 'bob', issue: 1, areas: [], open: true }, config, now);
  assert.equal(taken.outcome, 'claimTaken');
  assert.match(renderMessage(taken.effects[0].template, taken.effects[0].values), /already claimed by `alice`/);
  assert.equal(claimIssue(state, { login: 'alice', issue: 2, areas: [], open: true }, config, now).outcome, 'claimed');
  assert.equal(claimIssue(state, { login: 'alice', issue: 3, areas: [], open: true }, config, now).outcome, 'claimLimit');
  assert.equal(claimIssue(state, { login: 'bob', issue: 4, areas: ['infra'], open: true }, config, now).outcome, 'unknownArea');
  assert.equal(claimIssue(state, { login: 'bob', issue: 5, areas: [], open: false }, config, now).outcome, 'notClaimable');
  const second = claimIssue(state, { login: 'bob', issue: 6, areas: ['core'], open: true }, config, now);
  assert.match(renderMessage(second.effects[1].template, second.effects[1].values), /Heads up: #1 \(`alice`\) also covers core/);
});

test('a split gives the proposer the named areas and leaves the claimant the rest', () => {
  const state = claimed('alice', 1);
  const proposal = proposeWork(state, { login: 'bob', issue: 1, kind: 'split', areas: ['tests'], open: true }, config, now);
  assert.equal(proposal.outcome, 'proposed');
  assert.match(renderMessage(proposal.effects[0].template, proposal.effects[0].values), /@alice, `bob` proposes to split this issue and take tests\. Reply `\/atc accept 1`/);
  assert.equal(proposeWork(state, { login: 'bob', issue: 1, kind: 'split', areas: ['tests'], open: true }, config, now).outcome, 'proposalExists');
  assert.equal(proposeWork(state, { login: 'alice', issue: 1, kind: 'pair', areas: [], open: true }, config, now).outcome, 'alreadyInvolved');
  assert.equal(proposeWork(state, { login: 'bob', issue: 9, kind: 'pair', areas: [], open: true }, config, now).outcome, 'notClaimed');
  assert.equal(decideProposal(state, { login: 'carol', issue: 1, proposal: 1, verb: 'accept' }, config, now).outcome, 'notAuthorized');
  assert.equal(decideProposal(state, { login: 'bob', issue: 1, proposal: 1, verb: 'accept' }, config, now).outcome, 'notAuthorized');
  assert.equal(decideProposal(state, { login: 'alice', issue: 2, proposal: 1, verb: 'accept' }, config, now).outcome, 'proposalNotFound');
  const accepted = decideProposal(state, { login: 'alice', issue: 1, proposal: 1, verb: 'accept' }, config, now);
  assert.equal(accepted.outcome, 'accepted');
  assert.deepEqual(accepted.effects[0], { type: 'assign', issue: 1, logins: ['bob'] });
  assert.deepEqual(rows(state), [[1, 'alice', 'work', ['core', 'docs']], [1, 'bob', 'work', ['tests']]]);
  assert.deepEqual(state.proposals, []);
});

test('pair, takeover, review, decline and withdraw do what they say', () => {
  const state = claimed('alice', 1, ['core']);
  proposeWork(state, { login: 'bob', issue: 1, kind: 'pair', areas: [], open: true }, config, now);
  proposeWork(state, { login: 'carol', issue: 1, kind: 'review', areas: [], open: true }, config, now);
  proposeWork(state, { login: 'dave', issue: 1, kind: 'takeover', areas: [], open: true }, config, now);
  proposeWork(state, { login: 'erin', issue: 1, kind: 'pair', areas: [], open: true }, config, now);
  assert.equal(decideProposal(state, { login: 'alice', issue: 1, proposal: 1, verb: 'accept' }, config, now).outcome, 'accepted');
  assert.equal(decideProposal(state, { login: 'bob', issue: 1, proposal: 2, verb: 'accept' }, config, now).outcome, 'accepted');
  assert.equal(decideProposal(state, { login: 'alice', issue: 1, proposal: 4, verb: 'withdraw' }, config, now).outcome, 'notAuthorized');
  assert.equal(decideProposal(state, { login: 'erin', issue: 1, proposal: 4, verb: 'withdraw' }, config, now).outcome, 'withdrawn');
  const takeover = decideProposal(state, { login: 'alice', issue: 1, proposal: 3, verb: 'accept' }, config, now);
  assert.deepEqual(takeover.effects.slice(0, 2), [{ type: 'unassign', issue: 1, logins: ['alice', 'bob'] }, { type: 'assign', issue: 1, logins: ['dave'] }]);
  assert.deepEqual(rows(state), [[1, 'carol', 'review', []], [1, 'dave', 'work', ['core']]]);
  proposeWork(state, { login: 'frank', issue: 1, kind: 'pair', areas: [], open: true }, config, now);
  const declined = decideProposal(state, { login: 'dave', issue: 1, proposal: 5, verb: 'decline' }, config, now);
  assert.match(renderMessage(declined.effects[0].template, declined.effects[0].values), /@frank, proposal 5 was declined/);
});

test('splits that leave nothing and proposers at their limit are refused', () => {
  const state = claimed('alice', 1, ['core']);
  claimIssue(state, { login: 'bob', issue: 2, areas: [], open: true }, config, now);
  claimIssue(state, { login: 'bob', issue: 3, areas: [], open: true }, config, now);
  proposeWork(state, { login: 'carol', issue: 1, kind: 'split', areas: ['core'], open: true }, config, now);
  proposeWork(state, { login: 'bob', issue: 1, kind: 'pair', areas: [], open: true }, config, now);
  assert.equal(decideProposal(state, { login: 'alice', issue: 1, proposal: 1, verb: 'accept' }, config, now).outcome, 'splitLeavesNothing');
  assert.equal(decideProposal(state, { login: 'alice', issue: 1, proposal: 2, verb: 'accept' }, config, now).outcome, 'proposerAtLimit');
  assert.equal(state.proposals.length, 2);
});

test('release and expiry free the issue, unassign people and drop stale proposals', () => {
  const state = claimed('alice', 1);
  claimIssue(state, { login: 'bob', issue: 2, areas: [], open: true }, config, now);
  proposeWork(state, { login: 'carol', issue: 1, kind: 'pair', areas: [], open: true }, config, now);
  const release = releaseClaim(state, { login: 'alice', issue: 1 });
  assert.deepEqual(release.effects[0], { type: 'unassign', issue: 1, logins: ['alice'] });
  assert.equal(state.proposals.length, 0);
  assert.equal(releaseClaim(state, { login: 'alice', issue: 1 }).outcome, 'nothingToRelease');
  const effects = expireClaims(state, config, now + 8 * 86400000);
  assert.deepEqual(state.claims, []);
  assert.deepEqual(effects[0], { type: 'unassign', issue: 2, logins: ['bob'] });
  assert.match(renderMessage(effects[1].template, effects[1].values), /@bob, your claim was released after 7 days without activity/);
});

test('messages refuse values that are not typed ATC values', () => {
  for (const values of [{ login: 'alice@example.com', areas: [] }, { login: 'alice', areas: ['IGNORE THIS'] }, { login: 'alice', areas: 'core' }]) {
    assert.throws(() => renderMessage('claimUpdated', values), /Invalid ATC message value/);
  }
  assert.throws(() => renderMessage('proposed', { id: 1, from: 'bob', kind: 'obey', areas: [], claimants: ['alice'] }), /Invalid ATC message value/);
  assert.throws(() => renderMessage('freeText', {}), /Unknown ATC message/);
});
