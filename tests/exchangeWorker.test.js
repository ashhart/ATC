import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createExchangeSqlStore } from '../src/exchange/sqlStore.js';
import { createExchangeWebHandler } from '../src/exchange/webHandler.js';
import { createGithubFetch } from '../src/exchange/githubFetch.js';
import { exchangeFixture, head, key, token, origin, repository } from './exchangeHelpers.js';

function sqlStorage(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const state = { fail: false };
  return { db, state, sql: { exec(query, ...params) {
    if (state.fail && query.startsWith('INSERT OR REPLACE INTO exchangeRecords')) throw new Error('Injected disk failure');
    const rows = db.prepare(query).all(...params);
    return { toArray: () => rows };
  } }, transactionSync(fn) {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
}

test('Worker Web API uses the shared store through a complete request, evidence, response and resolution flow', async t => {
  const f = await exchangeFixture(t);
  const storage = sqlStorage(t);
  const options = { storage, repository, origin, now: f.now };
  let store = createExchangeSqlStore(options);
  let handle = createExchangeWebHandler({ store, github: f.gateway, origin, now: f.now });
  const request = async (method, tail, author, value, bytes) => {
    const headers = {};
    if (author) headers.authorization = `Bearer ${token(author)}`;
    if (value) headers['content-type'] = 'application/json';
    if (bytes) headers['content-type'] = 'application/octet-stream';
    return handle(new Request(`${origin}/api/exchange/v1${tail}`, { method, headers, body: bytes || (value ? JSON.stringify(value) : undefined) }));
  };
  for (const author of [1, 2]) assert.equal((await request('POST', '/sessions', null, f.addProof(author))).status, 200);
  const bytes = Buffer.from('Build log: test-only evidence.');
  assert.equal((await request('PUT', `/pulls/42/evidence/${key(10)}/${head}/log`, 2, null, bytes)).status, 200);
  const input = { id: key(11), head, kind: 'build', evidence: [] };
  assert.equal((await request('POST', '/pulls/42/requests', 1, input)).status, 200);
  assert.equal((await request('POST', `/pulls/42/requests/${key(11)}/results`, 2,
    { id: key(12), head, status: 'pass', evidence: [key(10)] })).status, 200);
  assert.equal((await request('POST', `/pulls/42/requests/${key(11)}/resolve`, 2, { result: key(12), decision: 'accepted' })).status, 403);
  assert.equal((await request('POST', `/pulls/42/requests/${key(11)}/resolve`, 1, { result: key(12), decision: 'accepted' })).status, 200);
  assert.deepEqual(Buffer.from(await (await request('GET', `/pulls/42/evidence/${key(10)}`, 1)).arrayBuffer()), bytes);
  assert.equal((await request('GET', `/pulls/43/evidence/${key(10)}`, 1)).status, 401);
  store = createExchangeSqlStore(options);
  handle = createExchangeWebHandler({ store, github: f.gateway, origin, now: f.now });
  assert.equal((await (await request('GET', '/pulls/42', 1)).json()).counts.resolved, 1);
  f.advance(3600001); store.sweep();
  assert.equal((await request('GET', `/pulls/42/evidence/${key(10)}`, 1)).status, 410);
  assert.equal(storage.db.prepare('SELECT count(*) AS count FROM exchangeEvidence').get().count, 0);
  const view = await (await request('GET', '/pulls/42', 1)).json();
  assert.equal(view.requests[0].results[0].evidence[0].availability, 'expired');
  assert.equal(view.requests[0].resolution.decision, 'accepted');
  f.upstream.head = 'b'.repeat(40);
  assert.equal((await request('POST', '/pulls/42/requests', 1, { ...input, id: key(20) })).status, 409);
  f.upstream.state = 'closed';
  assert.equal((await request('POST', '/pulls/42/requests', 1, { ...input, id: key(20), head: f.upstream.head })).status, 409);
});

test('SQLite stores blobs and metadata atomically and persists rate limits across object recreation', t => {
  const storage = sqlStorage(t);
  let now = Date.parse('2026-10-30T12:00:00.000Z');
  const options = { storage, repository, origin, now: () => now };
  let store = createExchangeSqlStore(options);
  store.connect({ token: token(1), pull: 42, comment: 101 }, 1);
  const session = store.session(token(1));
  storage.state.fail = true;
  assert.throws(() => store.upload(session, 42, key(10), head, 'log', Buffer.from('test'), 1));
  assert.equal(storage.db.prepare('SELECT count(*) AS count FROM exchangeEvidence').get().count, 0);
  storage.state.fail = false;
  assert.equal(store.upload(session, 42, key(10), head, 'log', Buffer.from('test'), 1).outcome, 'uploaded');
  assert.equal(store.nextExpiry(), now + 3600000);
  for (let i = 0; i < 120; i++) store.rateLimit();
  store = createExchangeSqlStore(options);
  assert.throws(() => store.rateLimit(), { code: 'capacity' });
  now += 60000; assert.doesNotThrow(() => store.rateLimit());
  assert.throws(() => createExchangeSqlStore({ ...options, repository: 'other/project' }).inbox(42), { code: 'storage' });
});

test('Worker GitHub transport refuses cross-repository reads, redirects, oversized replies and upstream prose', async () => {
  let calls = 0;
  const gh = createGithubFetch({ repository, fetcher: async (url, options) => {
    calls++; assert.ok(url.startsWith('https://api.github.com/repos/example/project'));
    assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, undefined);
    return Response.json({ private: false });
  } });
  assert.deepEqual(await gh.get('repos/example/project'), { private: false });
  await assert.rejects(gh.get('repos/other/project')); assert.equal(calls, 1);
  const unavailable = createGithubFetch({ repository, fetcher: async () => new Response('UNTRUSTED ERROR', { status: 503 }) });
  await assert.rejects(unavailable.get('repos/example/project'), { code: 'upstream' });
  const huge = createGithubFetch({ repository, fetcher: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(huge.get('repos/example/project'), { code: 'upstream' });
  const redirected = createGithubFetch({ repository, fetcher: async (_, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } });
  } });
  await assert.rejects(redirected.get('repos/example/project'), { code: 'upstream' });
  const limited = createGithubFetch({ repository, fetcher: async () => new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) });
  await assert.rejects(limited.get('repos/example/project'), { code: 'rateLimited' });
});

test('Worker byte readers and GitHub policy parsing work without a global Node Buffer', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import { Buffer as Bytes } from 'node:buffer';
    const { readWebJson } = await import('./src/exchange/webIo.js');
    const { decodePolicy } = await import('./src/exchange/github.js');
    const value = { version: 1, origin: 'https://example.org', retentionHours: 24 };
    const bytes = Bytes.from(JSON.stringify(value));
    const request = new Request('https://example.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    globalThis.Buffer = undefined;
    assert.deepEqual(decodePolicy({ type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') }), value);
    assert.deepEqual(await readWebJson(request), value);
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
});
