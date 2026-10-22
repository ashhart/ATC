import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { readPulls } from '../src/core/pulls.js';
import { replay } from '../src/core/replay.js';
import { areasConfig, days, setup } from './helpers.js';

function replayFake(fake, config = readConfig(areasConfig), comments = fake.store.comments) {
  const issues = [...fake.store.issues.values()];
  const closed = new Set(issues.filter(issue => issue.state === 'closed').map(issue => issue.number));
  const pulls = readPulls(issues.filter(issue => issue.pull_request && issue.state === 'open')
    .map(issue => ({ number: issue.number, user: issue.user, body: issue.body, draft: issue.draft, created_at: issue.created_at, updated_at: issue.updated_at })));
  return replay(readEvents(comments, fake.repository), { closed, pulls }, config, fake.clock.now);
}

function rows(state) {
  return state.claims.map(claim => [claim.issue, claim.login, claim.role, claim.areas]).sort((first, second) => first[1].localeCompare(second[1]));
}

test('the earliest claim wins, whatever order the comments arrive in', () => {
  const fake = setup();
  const issue = fake.addIssue();
  const first = fake.addComment(issue.number, 'alice', '/atc claim core');
  const second = fake.addComment(issue.number, 'bob', '/atc claim');
  const forward = replayFake(fake);
  const backward = replayFake(fake, undefined, [...fake.store.comments].reverse());
  assert.deepEqual(rows(forward), [[issue.number, 'alice', 'work', ['core']]]);
  assert.deepEqual(rows(backward), rows(forward));
  assert.deepEqual([forward.outcomes.get(first.id), forward.outcomes.get(second.id)], ['claimed', 'claimTaken']);
});

test('edited, bot, foreign and malformed comments never count', () => {
  const fake = setup();
  const issue = fake.addIssue();
  const edited = fake.addComment(issue.number, 'mallory', '/atc claim');
  fake.edit(edited, '/atc claim core');
  fake.addComment(issue.number, 'helper[bot]', '/atc claim');
  const foreign = fake.addComment(issue.number, 'carol', '/atc claim');
  foreign.html_url = foreign.html_url.replace('acme/widgets', 'acme/other');
  const shifted = fake.addComment(issue.number, 'dave', '/atc claim');
  shifted.html_url = shifted.html_url.replace(String(shifted.id), String(shifted.id + 1));
  fake.addComment(issue.number, 'erin', 'I will take this one');
  assert.deepEqual(readEvents(fake.store.comments, fake.repository), []);
  const valid = fake.addComment(issue.number, 'frank', '/atc claim');
  assert.deepEqual(readEvents(fake.store.comments, 'ACME/Widgets').map(event => event.id), [valid.id]);
});

test('proposals let a second agent pair, split, take over or review, with the claimant deciding', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  const split = fake.addComment(issue.number, 'bob', '/atc propose split tests');
  fake.addComment(issue.number, 'carol', `/atc accept ${split.id}`);
  fake.addComment(issue.number, 'bob', `/atc accept ${split.id}`);
  fake.addComment(issue.number, 'alice', `/atc accept ${split.id}`);
  const review = fake.addComment(issue.number, 'carol', '/atc propose review');
  const takeover = fake.addComment(issue.number, 'dave', '/atc propose takeover');
  const pair = fake.addComment(issue.number, 'erin', '/atc propose pair');
  fake.addComment(issue.number, 'bob', `/atc accept ${review.id}`);
  fake.addComment(issue.number, 'alice', `/atc withdraw ${pair.id}`);
  fake.addComment(issue.number, 'erin', `/atc withdraw ${pair.id}`);
  fake.addComment(issue.number, 'bob', '/atc release');
  fake.addComment(issue.number, 'alice', `/atc accept ${takeover.id}`);
  const state = replayFake(fake);
  assert.deepEqual(rows(state), [[issue.number, 'carol', 'review', []], [issue.number, 'dave', 'work', ['core', 'docs']]]);
  assert.deepEqual(state.proposals, []);
  const outcomes = fake.store.comments.map(comment => state.outcomes.get(comment.id));
  assert.deepEqual(outcomes, ['claimed', 'proposed', 'notAuthorized', 'notAuthorized', 'accepted', 'proposed', 'proposed', 'proposed',
    'accepted', 'notAuthorized', 'withdrawn', 'released', 'accepted']);
});

test('claims expire without successful ATC activity even when a linked pull request is moving', () => {
  const fake = setup();
  const [quiet, busy] = [fake.addIssue(), fake.addIssue()];
  fake.addComment(quiet.number, 'alice', '/atc claim');
  fake.addComment(busy.number, 'bob', '/atc claim');
  const pull = fake.addPull({ author: 'bob', body: `Fixes #${busy.number}` });
  fake.clock.now += days(8);
  pull.updated_at = new Date(fake.clock.now - days(1)).toISOString();
  const late = fake.addComment(quiet.number, 'carol', '/atc claim');
  const reclaimed = fake.addComment(busy.number, 'carol', '/atc claim');
  const state = replayFake(fake);
  assert.deepEqual([state.outcomes.get(late.id), state.outcomes.get(reclaimed.id)], ['claimed', 'claimed']);
  assert.deepEqual(rows(state), [[quiet.number, 'carol', 'work', []], [busy.number, 'carol', 'work', []]]);
});

test('pull requests and closed issues cannot be held, and only maintainers reset', () => {
  const fake = setup();
  const pull = fake.addPull({ author: 'alice' });
  const [closing, contested] = [fake.addIssue(), fake.addIssue()];
  const onPull = fake.addComment(pull.number, 'alice', '/atc claim');
  fake.addComment(closing.number, 'alice', '/atc claim');
  fake.addComment(contested.number, 'squatter', '/atc claim');
  const outsider = fake.addComment(contested.number, 'mallory', '/atc reset');
  fake.store.roles.maintainer = 'MEMBER';
  const maintainer = fake.addComment(contested.number, 'maintainer', '/atc reset');
  fake.closeIssue(closing.number);
  const state = replayFake(fake);
  assert.deepEqual(state.claims, []);
  assert.deepEqual([onPull, outsider, maintainer].map(comment => state.outcomes.get(comment.id)), ['notClaimable', 'notAuthorized', 'reset']);
});

test('replay keeps issue constraints independent of cross-issue admission limits', () => {
  const fake = setup({ ...areasConfig, maxClaimsPerUser: 1, maxPendingProposalsPerUser: 1 });
  const [first, second, third] = [fake.addIssue(), fake.addIssue(), fake.addIssue()];
  fake.addComment(first.number, 'alice', '/atc claim core');
  const over = fake.addComment(second.number, 'alice', '/atc claim');
  fake.addComment(third.number, 'bob', '/atc claim');
  const ok = fake.addComment(first.number, 'carol', '/atc propose pair');
  const extra = fake.addComment(third.number, 'carol', '/atc propose pair');
  const greedy = fake.addComment(first.number, 'dave', '/atc propose split core');
  const atLimit = fake.addComment(first.number, 'bob', '/atc propose pair');
  fake.addComment(first.number, 'alice', `/atc accept ${greedy.id}`);
  fake.addComment(first.number, 'alice', `/atc accept ${atLimit.id}`);
  const state = replayFake(fake, readConfig(fake.store.config));
  const outcomes = [over, ok, extra, greedy, atLimit].map(comment => state.outcomes.get(comment.id));
  assert.deepEqual(outcomes, ['claimed', 'proposed', 'proposed', 'proposed', 'proposed']);
  assert.deepEqual(fake.store.comments.slice(-2).map(comment => state.outcomes.get(comment.id)), ['splitLeavesNothing', 'accepted']);
});

test('a claimant can change their areas, and a decline leaves the claim as it was', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core');
  const update = fake.addComment(issue.number, 'alice', '/atc claim core docs');
  const offer = fake.addComment(issue.number, 'bob', '/atc propose pair');
  const decline = fake.addComment(issue.number, 'alice', `/atc decline ${offer.id}`);
  const state = replayFake(fake);
  assert.deepEqual([update, offer, decline].map(comment => state.outcomes.get(comment.id)), ['claimUpdated', 'proposed', 'declined']);
  assert.deepEqual(rows(state), [[issue.number, 'alice', 'work', ['core', 'docs']]]);
  assert.deepEqual(state.proposals, []);
});
