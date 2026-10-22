import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, presenceGit, setup, areasConfig } from './helpers.js';
import { collectBoardFeed } from '../src/site/feed.js';
import { createSiteServer } from '../src/site/server.js';
import { createGh } from '../src/cli/gh.js';
import { runCli } from '../src/cli/actions.js';
import { parseCliArgs } from '../src/cli/args.js';

test('local start, pulse and land drive the public feed with expiring anonymous agent counts and no comments', async () => {
  const fake = setup();
  fake.addIssue();
  const git = presenceGit();
  await cli(fake, 'alice', ['claim', '1', '1'], { git });
  const comments = fake.store.comments.length;
  const started = await cli(fake, 'alice', ['start', '1'], { git });
  assert.equal(started.outcome, 'checkedIn');
  assert.ok(Number.isSafeInteger(started.session));
  let board = await cli(fake, 'alice', ['board'], { git });
  let feed = collectBoardFeed(board, fake.clock.now);
  assert.equal(feed.summary.activeAgents, 1);
  assert.equal(feed.flights[0].phase, 'working');
  assert.equal(JSON.stringify(feed).includes('alice'), false);
  await cli(fake, 'alice', ['pulse', '1', String(started.session), 'reviewing'], { git });
  feed = collectBoardFeed(await cli(fake, 'alice', ['board'], { git }), fake.clock.now);
  assert.equal(feed.summary.reviewing, 1);
  await cli(fake, 'alice', ['pulse', '1', String(started.session), 'blocked'], { git });
  feed = collectBoardFeed(await cli(fake, 'alice', ['board'], { git }), fake.clock.now);
  assert.equal(feed.summary.activeAgents, 0);
  assert.equal(feed.summary.blocked, 1);
  await cli(fake, 'alice', ['pulse', '1', String(started.session), 'working'], { git });
  board = await cli(fake, 'alice', ['board'], { git });
  fake.clock.now = Date.parse(board.sessions[0].expiresAt);
  feed = collectBoardFeed(board, fake.clock.now);
  assert.equal(feed.summary.activeAgents, 0);
  assert.equal(feed.flights[0].phase, 'idle');
  const next = await cli(fake, 'alice', ['start', '1'], { git });
  assert.equal((await cli(fake, 'alice', ['land', '1', String(next.session)], { git })).outcome, 'landed');
  assert.equal((await cli(fake, 'alice', ['board'], { git })).sessions.length, 0);
  assert.equal((await cli(fake, 'bob', ['board'])).sessions.length, 0);
  assert.equal(fake.store.comments.length, comments);
});

test('accepted collaboration supports separate live agents while each keeps their agreed scope', async () => {
  const fake = setup();fake.addIssue();
  await cli(fake, 'alice', ['claim', '1', '1', '2', '3']);
  const proposal = await cli(fake, 'bob', ['propose', '1', 'split', '2']);
  assert.equal((await cli(fake, 'alice', ['board'])).proposals[0].id, proposal.comment);
  await cli(fake, 'alice', ['accept', String(proposal.comment)]);
  const git = presenceGit();
  await cli(fake, 'alice', ['start', '1'], { git });await cli(fake, 'alice', ['start', '1'], { git });
  const board = await cli(fake, 'alice', ['board'], { git });
  const feed = collectBoardFeed(board, fake.clock.now);
  assert.equal(feed.summary.activeAgents, 2);
  assert.equal(feed.flights[0].agents.length, 2);
  const theft = await cli(fake, 'carol', ['propose', '1', 'split', '1']);
  assert.equal((await cli(fake, 'bob', ['accept', String(theft.comment)])).outcome, 'sharedClaim');
  assert.deepEqual((await cli(fake, 'alice', ['status'])).claims.find(claim => claim.mine).areas, [1, 3]);
});

test('stale counts and delayed comments cannot produce a second successful claim', async () => {
  const fake = setup();const issue = fake.addIssue();
  fake.addComment(1, 'bob', '/atc claim core');issue.comments = 0;
  assert.equal((await cli(fake, 'alice', ['check', '1'])).advice, 'incomplete');
  assert.equal((await cli(fake, 'alice', ['claim', '1'])).outcome, 'incomplete');
  issue.comments = 1;fake.store.comments[0].hidden = true;
  assert.equal((await cli(fake, 'alice', ['claim', '1'])).outcome, 'incomplete');
  assert.equal(fake.store.comments.length, 1);
});

test('closing unrelated work cannot activate a refused claim or take work from an accepted holder', async () => {
  const fake = setup({ ...areasConfig, maxClaimsPerUser: 1 });fake.addIssue();fake.addIssue();
  await cli(fake, 'alice', ['claim', '1']);
  assert.equal((await cli(fake, 'alice', ['claim', '2'])).outcome, 'claimLimit');
  assert.equal((await cli(fake, 'bob', ['claim', '2'])).outcome, 'claimed');
  fake.closeIssue(1);
  assert.equal((await cli(fake, 'bob', ['check', '2'])).advice, 'yours');
});

test('read-only collectors cannot start sessions and an ambiguous write is never retried', async () => {
  const fake = setup();fake.addIssue();await cli(fake, 'alice', ['claim', '1']);
  const before = fake.store.comments.length;
  assert.equal((await cli(fake, 'alice', ['start', '1'], { env: { ATC_READ_ONLY: '1' } })).outcome, 'readOnly');
  assert.equal((await cli(fake, 'alice', ['release', '1'], { env: { ATC_READ_ONLY: '1' } })).outcome, 'readOnly');
  assert.equal(fake.store.comments.length, before);
  let writes = 0;const run = fake.runGh;
  fake.runGh = args => {
    if (args.includes('POST')) { writes++;run(args);return { status: 1, stdout: '' }; }
    return run(args);
  };
  const result = await cli(fake, 'alice', ['release', '1']);
  assert.equal(result.outcome, 'uncertain');assert.equal(result.posted, null);assert.equal(writes, 1);
});

test('a real CLI board flows through the local read-only HTTP feed', async () => {
  const fake = setup();fake.addIssue();const git = presenceGit();
  await cli(fake, 'alice', ['claim', '1'], { git });await cli(fake, 'alice', ['start', '1'], { git });
  const app = createSiteServer({ port: 0, repository: fake.repository, now: () => fake.clock.now,
    collect: async () => collectBoardFeed(await cli(fake, 'alice', ['board'], { git }), fake.clock.now) });
  const { origin } = await app.listen();
  try {
    await app.refresh();
    const result = await (await fetch(`${origin}/api/traffic`)).json();
    assert.equal(result.source, 'github');assert.equal(result.connection, 'live');assert.equal(result.summary.activeAgents, 1);
    assert.equal(JSON.stringify(result).includes(fake.repository), false);
    assert.equal(JSON.stringify(result).includes('alice'), false);
  } finally { await app.close(); }
});

test('local presence neither requires nor creates a claim', async () => {
  const fake = setup();fake.addIssue();const git = presenceGit();
  const session = await cli(fake, 'bob', ['start', '1'], { git });
  assert.equal(session.outcome, 'checkedIn');assert.equal(session.state, 'working');
  assert.equal((await cli(fake, 'bob', ['pulse', '1', String(session.session), 'reviewing'], { git })).outcome, 'checkedIn');
  assert.deepEqual((await cli(fake, 'bob', ['status'])).claims, []);
  assert.equal((await cli(fake, 'alice', ['check', '1'])).advice, 'free');
});

test('an exhausted request budget before POST is a definite failure without an uncertain write', async () => {
  const fake = setup();fake.addIssue();
  const gh = createGh(fake.runGh, { maxRequests: 6 });
  await assert.rejects(() => runCli(parseCliArgs(['claim', '1']), { gh, now: () => fake.clock.now,
    sleep: async () => {}, env: {} }), /request budget/);
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
});

test('paired shared scope does not advertise a split that no individual owner can authorize', async () => {
  const fake = setup();fake.addIssue();await cli(fake, 'alice', ['claim', '1', '1', '2']);
  const offer = await cli(fake, 'bob', ['propose', '1', 'pair']);await cli(fake, 'alice', ['accept', String(offer.comment)]);
  const board = await cli(fake, 'carol', ['board']);
  assert.ok(board.opportunities.every(item => !item.actions.includes('proposeSplit')));
});
