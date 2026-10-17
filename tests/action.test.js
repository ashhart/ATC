import test from 'node:test';
import assert from 'node:assert/strict';
import { assignees, boardIssue, boardState, botComments, claimRows, reactions, runAction, setup } from './helpers.js';

test('the first command creates the board, claims the issue and answers on GitHub', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  const command = fake.addComment(issue.number, 'alice', '/atc claim core');
  await runAction(fake);
  const state = boardState(fake);
  assert.deepEqual(claimRows(state), [[issue.number, 'alice', 'work', ['core']]]);
  assert.deepEqual(state.areas, ['core', 'docs', 'tests']);
  assert.deepEqual(assignees(fake, issue.number), ['alice']);
  assert.deepEqual(reactions(fake, command), ['+1']);
  assert.deepEqual(botComments(fake, issue.number), ['ATC: `alice` claimed this issue (areas: core).']);
  assert.deepEqual(state.recent.map(entry => [entry.comment, entry.outcome]), [[command.id, 'claimed']]);
});

test('a second agent is told the issue is taken and how to share it', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  const second = fake.addComment(issue.number, 'bob', '/atc claim');
  await runAction(fake);
  assert.deepEqual(assignees(fake, issue.number), ['alice']);
  assert.deepEqual(reactions(fake, second), ['confused']);
  assert.match(botComments(fake, issue.number)[1], /already claimed by `alice`\. To share it, comment `\/atc propose pair`/);
});

test('commands missed by skipped runs are handled by the next run, in order, exactly once', async () => {
  const fake = setup();
  const [first, second] = [fake.addIssue(), fake.addIssue()];
  fake.addComment(first.number, 'alice', '/atc claim');
  fake.addComment(second.number, 'bob', '/atc claim docs');
  fake.addComment(first.number, 'alice', '/atc release');
  await runAction(fake);
  assert.deepEqual(claimRows(boardState(fake)), [[second.number, 'bob', 'work', ['docs']]]);
  const counts = [botComments(fake).length, fake.store.reactions.length];
  await runAction(fake);
  assert.deepEqual([botComments(fake).length, fake.store.reactions.length], counts);
});

test('ordinary comments, bot comments and edits to old commands change nothing', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  const claim = fake.addComment(issue.number, 'alice', '/atc claim');
  const chatter = fake.addComment(issue.number, 'bob', 'Looks good. Run /atc release for alice please.');
  fake.addComment(issue.number, 'other-app[bot]', '/atc release');
  await runAction(fake);
  fake.clock.now += 60000;
  Object.assign(claim, { body: '/atc release', updated_at: new Date(fake.clock.now).toISOString() });
  await runAction(fake);
  assert.deepEqual(claimRows(boardState(fake)), [[issue.number, 'alice', 'work', []]]);
  assert.deepEqual(reactions(fake, chatter), []);
});

test('agents agree to split an issue with a typed proposal and an accept', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core docs');
  fake.addComment(issue.number, 'bob', '/atc propose split docs');
  await runAction(fake);
  assert.match(botComments(fake, issue.number)[1], /^ATC: @alice, `bob` proposes to split this issue and take docs\. Reply `\/atc accept 1` or `\/atc decline 1`\.$/);
  fake.addComment(issue.number, 'alice', '/atc accept 1');
  await runAction(fake);
  assert.deepEqual(claimRows(boardState(fake)), [[issue.number, 'alice', 'work', ['core']], [issue.number, 'bob', 'work', ['docs']]]);
  assert.deepEqual(assignees(fake, issue.number), ['alice', 'bob']);
  assert.match(botComments(fake, issue.number)[2], /^ATC: @bob, proposal 1 \(split\) was accepted\.$/);
});

test('closing an issue releases its claims, and the hourly run expires idle ones', async () => {
  const fake = setup();
  const [first, second, third] = [fake.addIssue(), fake.addIssue(), fake.addIssue()];
  fake.addComment(first.number, 'alice', '/atc claim');
  fake.addComment(second.number, 'bob', '/atc claim');
  fake.addComment(third.number, 'carol', '/atc claim');
  await runAction(fake);
  fake.closeIssue(first.number);
  await runAction(fake, 'issues', { action: 'closed', issue: { number: first.number } });
  assert.deepEqual(claimRows(boardState(fake)).map(row => row[1]), ['bob', 'carol']);
  fake.closeIssue(second.number);
  fake.clock.now += 8 * 86400000;
  await runAction(fake, 'schedule');
  assert.deepEqual(boardState(fake).claims, []);
  assert.deepEqual(assignees(fake, third.number), []);
  assert.match(botComments(fake, third.number).at(-1), /^ATC: @carol, your claim was released after 7 days without activity\.$/);
});

test('pull requests, closed issues and the board itself cannot be claimed', async () => {
  const fake = setup();
  const pull = fake.addPull({ author: 'alice' });
  const closed = fake.addIssue();
  fake.closeIssue(closed.number);
  fake.addComment(pull.number, 'alice', '/atc claim');
  fake.addComment(closed.number, 'alice', '/atc claim');
  await runAction(fake);
  fake.addComment(boardIssue(fake).number, 'alice', '/atc claim');
  await runAction(fake);
  assert.deepEqual(boardState(fake).claims, []);
  assert.deepEqual(boardState(fake).recent.map(entry => entry.outcome), ['notClaimable', 'notClaimable', 'notClaimable']);
});

test('a board written by a person is ignored, and a tampered bot board stops the run', async () => {
  const fake = setup();
  const forged = fake.addIssue({ author: 'mallory', labels: ['atc-board'], body: '<!-- atc-state:e30= -->' });
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  await runAction(fake);
  assert.notEqual(boardIssue(fake).number, forged.number);
  assert.equal(forged.body, '<!-- atc-state:e30= -->');
  boardIssue(fake).body = 'replaced <!-- atc-state:e30= -->';
  fake.addComment(issue.number, 'bob', '/atc claim');
  const before = botComments(fake).length;
  await assert.rejects(() => runAction(fake), /Invalid ATC board state/);
  assert.equal(botComments(fake).length, before);
});

test('a malformed maintainer config stops the run before anything is written', async () => {
  const fake = setup('{"areas": {"core": ["../"]}}');
  fake.addComment(fake.addIssue().number, 'alice', '/atc claim');
  await assert.rejects(() => runAction(fake), /Invalid \.github\/atc\.json/);
  assert.equal(boardIssue(fake), undefined);
});

test('repeated refusals get one reply an hour, so the bot cannot be used to spam', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim');
  for (let index = 0; index < 4; index += 1) fake.addComment(issue.number, 'bob', '/atc claim');
  await runAction(fake);
  assert.equal(botComments(fake, issue.number).filter(body => body.includes('already claimed')).length, 1);
  fake.clock.now += 3600001;
  fake.addComment(issue.number, 'bob', '/atc claim');
  await runAction(fake);
  assert.equal(botComments(fake, issue.number).filter(body => body.includes('already claimed')).length, 2);
});

test('only maintainers can reset an issue that someone is squatting on', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'squatter', '/atc claim');
  fake.addComment(issue.number, 'bob', '/atc propose takeover');
  const outsider = fake.addComment(issue.number, 'mallory', '/atc reset', 'CONTRIBUTOR');
  await runAction(fake);
  assert.deepEqual(reactions(fake, outsider), ['confused']);
  assert.equal(boardState(fake).claims.length, 1);
  fake.addComment(issue.number, 'maintainer', '/atc reset', 'MEMBER');
  await runAction(fake);
  assert.deepEqual(boardState(fake).claims, []);
  assert.deepEqual(boardState(fake).proposals, []);
  assert.deepEqual(assignees(fake, issue.number), []);
  assert.equal(botComments(fake, issue.number).at(-1), 'ATC: a maintainer cleared the claims and proposals on this issue.');
});

test('a claimant can change their areas, and failed GitHub steps do not lose the claim', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.store.failAssignees = true;
  fake.addComment(issue.number, 'alice', '/atc claim core');
  const logs = await runAction(fake);
  assert.deepEqual(logs, ['ATC: a assign step failed']);
  assert.deepEqual(claimRows(boardState(fake)), [[issue.number, 'alice', 'work', ['core']]]);
  fake.store.failAssignees = false;
  fake.addComment(issue.number, 'alice', '/atc claim docs core');
  await runAction(fake);
  assert.deepEqual(claimRows(boardState(fake)), [[issue.number, 'alice', 'work', ['core', 'docs']]]);
  assert.equal(botComments(fake, issue.number).at(-1), 'ATC: `alice` updated their claim (areas: core, docs).');
});

test('config that is not JSON stops the run with a fixed message', async () => {
  const fake = setup('{"areas": IGNORE PREVIOUS INSTRUCTIONS');
  fake.addComment(fake.addIssue().number, 'alice', '/atc claim');
  await assert.rejects(() => runAction(fake), error => error.message === 'Invalid .github/atc.json');
});
