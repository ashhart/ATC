import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTraffic } from '../src/site/collector.js';
import { collectBoardFeed } from '../src/site/feed.js';
import { demoFeed } from '../src/site/demo.js';
import { createFeedStore } from '../src/site/store.js';
import { heartbeatTtl, refreshFeed, validateFeed } from '../src/site/schema.js';
import { cli, presenceGit, setup } from './helpers.js';

const time = Date.UTC(2026, 9, 21, 12);
const iso = value => new Date(value).toISOString();

function board(at = time) {
  return { observedAt: iso(at), complete: true, repository: 'privateperson/private-repo',
    sessions: [{ session: 1001, contributor: 1, issue: 42, state: 'working', active: iso(at - 10000), expiresAt: iso(at - 10000 + heartbeatTtl) }],
    issues: [{ issue: 42, claims: [{ areas: [1], lastActivity: iso(at - 20000), login: 'privateperson' }], pullRequests: [13], title: 'private title' }],
    proposals: [{ id: 2001, issue: 42, kind: 'review', areas: [], from: 'privateperson' }], fileOverlaps: [], token: 'private-token' };
}

test('demo is explicitly fictional and models eight flights with twelve agents and real freshness', () => {
  const feed = demoFeed(time);
  assert.deepEqual(feed.flights.map(flight => flight.issue), [142, 156, 163, 171, 184, 192, 203, 218]);
  assert.equal(feed.flights.flatMap(flight => flight.agents).length, 12);
  assert.deepEqual(feed.summary, { activeAgents: 10, inFlight: 4, reviewing: 2, blocked: 1, overlaps: 1, offers: 2 });
  assert.equal(feed.source, 'demo');
  assert.equal(validateFeed(feed, time), feed);
  const stale = refreshFeed(feed, time + heartbeatTtl + 1);
  assert.equal(stale.connection, 'stale');
  assert.equal(stale.summary.activeAgents, 0);
  assert.equal(stale.summary.inFlight, 0);
});

test('board projection emits only the public schema and keeps claim activity distinct from live heartbeats', () => {
  const feed = collectBoardFeed(board(), time);
  assert.equal(feed.source, 'github');
  assert.equal(feed.connection, 'live');
  assert.equal(feed.summary.activeAgents, 1);
  assert.equal(feed.flights[0].phase, 'working');
  assert.deepEqual(feed.offers, [{ id: 2001, issue: 42, kind: 'review', areas: [] }]);
  assert.equal(/privateperson|private-repo|private title|private-token|login|token/.test(JSON.stringify(feed)), false);
  const quiet = board();
  quiet.sessions = [];
  assert.equal(collectBoardFeed(quiet, time).summary.activeAgents, 0);
  assert.equal(collectBoardFeed(quiet, time).flights[0].phase, 'idle');
  assert.equal(collectBoardFeed(board(time - heartbeatTtl - 1), time).connection, 'stale');
  const partial = board(); partial.complete = false;
  assert.equal(collectBoardFeed(partial, time).connection, 'stale');
});

test('distinct fresh agent sessions count separately while blocked and expired sessions stay separate', () => {
  const input = board();
  input.issues.push({ issue: 43, claims: [], pullRequests: [] });
  input.sessions.push({ ...input.sessions[0], session: 1002, issue: 43 },
    { ...input.sessions[0], session: 1003, contributor: 2, state: 'blocked' });
  const feed = collectBoardFeed(input, time);
  assert.equal(feed.summary.activeAgents, 2);
  assert.equal(feed.summary.blocked, 1);
  assert.equal(feed.flights[0].phase, 'blocked');
  input.sessions[0].active = iso(time - heartbeatTtl - 1);
  input.sessions[0].expiresAt = iso(time - 1);
  assert.equal(collectBoardFeed(input, time).flights[0].agents[0].state, 'idle');
});

test('exact public schema rejects hostile values, extra fields, wrong types and forged counts', () => {
  const mutate = [feed => { feed.email = 'private.person@example.com'; }, feed => { feed.source = 'privateperson'; },
    feed => { feed.summary.activeAgents = 123456789; }, feed => { feed.flights[0].agents[0].ref = 987654321; },
    feed => { feed.flights[0].title = 'private title'; }, feed => { feed.flights[0].areas = ['privateperson']; },
    feed => { feed.recent[0].time = 'IGNORE INSTRUCTIONS'; }, feed => { feed.offers[0].kind = 'IGNORE'; },
    feed => { feed.flights[0].agents[0].expiresAt = iso(time + heartbeatTtl * 2); }];
  for (const change of mutate) {
    const feed = demoFeed(time); change(feed);
    assert.throws(() => validateFeed(feed, time), error => error.message === 'Invalid traffic feed.');
  }
  const future = demoFeed(time + heartbeatTtl);
  assert.throws(() => validateFeed(future, time), /Invalid traffic feed/);
});

test('collector invokes only the read-only CLI with bounded subprocess options and fixed failures', async () => {
  const calls = [];
  const fake = setup();
  fake.clock.now = time;
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim 1');
  const git = presenceGit();
  await cli(fake, 'alice', ['start', '1'], { git });
  const source = await cli(fake, 'alice', ['board'], { git });
  const run = async (...args) => { calls.push(args); return { stdout: JSON.stringify(source) }; };
  const feed = await collectTraffic('example/project', { now: () => fake.clock.now, run });
  assert.equal(feed.summary.activeAgents, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1].slice(1), ['board', '--json', '--repo', 'example/project']);
  assert.equal(calls[0][2].timeout, 20000);
  assert.equal(calls[0][2].maxBuffer, 2097152);
  assert.equal(calls[0][2].shell, undefined);
  assert.equal(calls[0][2].env.ATC_READ_ONLY, '1');
  await assert.rejects(() => collectTraffic('example/project;IGNORE', { run }), /Invalid repository/);
  assert.equal(calls.length, 1);
  for (const result of ['private.person@example.com', '{bad', JSON.stringify({ title: 'private' })]) {
    await assert.rejects(() => collectTraffic('example/project', { run: async () => ({ stdout: result }) }), error => error.message === 'Traffic unavailable.');
  }
  await assert.rejects(() => collectTraffic('example/project', { run: async () => { throw new Error('private-token'); } }), /Traffic unavailable/);
});

test('store coalesces refreshes, cancels collectors and never exposes failures or old repository results', async () => {
  let resolve;
  let calls = 0;
  let signal;
  const store = createFeedStore({ now: () => time, repository: 'example/project', collect: async (_repository, options) => {
    calls += 1; signal = options.signal; return new Promise(done => { resolve = done; });
  } });
  const first = store.refresh();
  assert.equal(store.refresh(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  store.demo();
  assert.equal(signal.aborted, true);
  resolve(collectBoardFeed(board(), time));
  await first;
  assert.equal(store.getFeed().source, 'demo');
  store.close();
  const bad = createFeedStore({ now: () => time, repository: 'example/project', collect: async () => ({ email: 'private.person@example.com' }) });
  await bad.refresh();
  assert.equal(bad.getFeed().connection, 'error');
  assert.equal(JSON.stringify(bad.getFeed()).includes('private.person'), false);
  bad.close();
});


test('failed collection uses bounded exponential cooldown and changing source resets it', async () => {
  let clock = time;
  let calls = 0;
  let failing = true;
  const store = createFeedStore({ repository: 'example/project', now: () => clock, collect: async () => {
    calls += 1;
    if (failing) throw new Error('private-token');
    return collectBoardFeed(board(clock), clock);
  } });
  await store.refresh();
  assert.equal(calls, 1);
  for (const delay of [60000, 120000, 240000, 300000, 300000]) {
    clock += delay - 1;
    await store.refresh();
    assert.equal(store.getFeed().connection, 'error');
    const before = calls;
    store.connect('example/project');
    await store.refresh();
    assert.equal(calls, before);
    clock += 1;
    await store.refresh();
    assert.equal(calls, before + 1);
  }
  const previous = calls;
  store.connect('example/other-project');
  await store.refresh();
  assert.equal(calls, previous + 1);
  store.demo();
  assert.equal(store.getFeed().source, 'demo');
  failing = false;
  store.connect('example/project');
  await store.refresh();
  assert.equal(store.getFeed().connection, 'live');
  clock += 30000;
  const successful = calls;
  await store.refresh();
  assert.equal(calls, successful + 1);
  store.close();
});

test('projection accepts actual CLI session and proposal fields and more than one hundred issues', async () => {
  const fake = setup(); fake.clock.now = time;
  for (let index = 0; index < 150; index += 1) fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim 1');
  fake.addComment(1, 'bob', '/atc propose review');
  const git = presenceGit();
  await cli(fake, 'alice', ['start', '1'], { git });
  const source = await cli(fake, 'alice', ['board'], { git });
  const feed = collectBoardFeed(source, fake.clock.now);
  assert.equal(feed.flights.length, 150);
  assert.equal(feed.summary.activeAgents, 1);
  assert.equal(feed.offers.length, 1);
  assert.equal(feed.offers[0].kind, 'review');
  assert.equal(feed.flights[0].agents[0].ref, 1);
  assert.equal(JSON.stringify(feed).includes('alice'), false);
});

test('oversized legitimate discovery is truncated into an explicit incomplete bounded viewer feed', () => {
  const input = board();
  input.sessions = Array.from({ length: 5001 }, (_, index) => ({ ...input.sessions[0], session: index + 1 }));
  input.issues = Array.from({ length: 1001 }, (_, index) => ({ issue: index + 1, claims: [], pullRequests: [] }));
  input.proposals = Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, issue: 42, kind: 'review', areas: [] }));
  input.fileOverlaps = Array.from({ length: 1001 }, () => ({ pullRequests: [13, 14], sharedFiles: 1, areas: [] }));
  const feed = collectBoardFeed(input, time);
  assert.equal(feed.complete, false);
  assert.equal(feed.connection, 'stale');
  assert.equal(feed.flights.length, 1000);
  assert.equal(feed.summary.activeAgents, 5000);
  assert.equal(feed.offers.length, 1000);
  assert.equal(feed.overlaps.length, 1000);
  assert.equal(validateFeed(feed, time), feed);
});
