import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createExchangeSqlStore } from '../src/exchange/sqlStore.js';
import { createExchangeWebHandler } from '../src/exchange/webHandler.js';
import { collaborationView } from '../src/exchange/collaborationView.js';
import { head, base, key, token, repository, origin } from './exchangeHelpers.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let fail = false, clock = Date.parse('2026-11-06T09:00:00.000Z');
  const storage = { sql: { exec(query, ...args) {
    if (fail && query.startsWith('INSERT OR REPLACE INTO exchangeRecords')) throw Error('storage failure');
    const rows = db.prepare(query).all(...args);
    return { toArray: () => rows };
  } }, transactionSync(fn) {
    db.exec('BEGIN');
    try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  const options = { storage, repository, origin, now: () => clock };
  let store = createExchangeSqlStore(options);
  for (const author of [1, 2]) store.connect({ token: token(author), pull: 42, comment: 100 + author }, author);
  const session = author => store.session(token(author));
  store.request(session(1), 42, { id: key(1), head, base, kind: 'test', evidence: [] });
  return { db, options, session, get store() { return store; }, restart() { store = createExchangeSqlStore(options); },
    fail(value) { fail = value; }, advance(ms) { clock += ms; }, now: () => clock };
}

test('SQLite collaboration records and durable packet bytes persist, roll back atomically and reject corrupt state', t => {
  const f = fixture(t), bytes = Buffer.from('explicit handoff report');
  f.store.offer(f.session(1), key(1), { capability: 'cuda', public: true, required: true, independent: true });
  f.store.take(f.session(2), key(1), { consumer: key(2), seconds: 60 }, { head, base });
  f.store.upload(f.session(1), 42, key(5), head, 'report', bytes, 1);
  const input = { id: key(6), issue: 40, head, base, recipient: 102, report: key(5) };
  f.fail(true);
  assert.throws(() => f.store.handoff(f.session(1), input));
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM exchangePackets').get().count, 0);
  f.fail(false); f.store.handoff(f.session(1), input); f.restart();
  assert.equal(f.store.collaboration().offers.length, 1);
  assert.equal(f.store.collaboration().leases.length, 1);
  f.advance(3600001); f.store.sweep();
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM exchangeEvidence').get().count, 0);
  assert.deepEqual(f.store.packet(f.session(2), key(6)).bytes, bytes);
  assert.equal(collaborationView(f.store, f.session(1), { head, base, state: 'open' }, f.now()).items[0].state, 'available');
  f.db.prepare('UPDATE exchangeRecords SET payload = ? WHERE kind = ?').run('{"arbitrary":"instructions"}', 'offers');
  assert.throws(() => f.store.collaboration(), { code: 'storage' });
});

test('Worker collaboration routes enforce read-only, strict bodies and current authorization before every write', async t => {
  const f = fixture(t), gateway = { policy: async () => ({ version: 1, origin, retentionHours: 1 }),
    verify: async () => 1, mayRequire: async () => true, pull: async () => ({ head, base, state: 'open' }), publicRepository: async () => true };
  const make = readOnly => createExchangeWebHandler({ store: f.store, github: gateway, origin, readOnly, now: f.now });
  const call = (handle, tail, body) => handle(new Request(`${origin}/api/exchange/v1/pulls/42/collaboration${tail}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token(1)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined }));
  const offer = { capability: 'linux', public: true, required: true, independent: false };
  assert.equal((await call(make(true), `/requests/${key(1)}/offer`, offer)).status, 403);
  assert.equal(f.store.collaboration().offers.length, 0);
  assert.equal((await call(make(false), `/requests/${key(1)}/offer`, { ...offer, notes: 'untrusted' })).status, 400);
  assert.equal((await call(make(false), `/requests/${key(1)}/offer`, offer)).status, 200);
  assert.equal((await call(make(true), '')).status, 200);
  gateway.verify = async () => 2;
  assert.equal((await call(make(false), `/requests/${key(1)}/offer`, offer)).status, 401);
  assert.equal(f.store.collaboration().offers.length, 1);
});

test('public viewer traffic cannot consume or reset the authenticated agent budget', t => {
  const f = fixture(t);
  for (let count = 0; count < 119; count++) f.store.rateLimit();
  for (let count = 0; count < 600; count++) f.store.rateLimit(true);
  assert.throws(() => f.store.rateLimit(true), { code: 'capacity' });
  assert.doesNotThrow(() => f.store.rateLimit());
  assert.throws(() => f.store.rateLimit(), { code: 'capacity' });
  f.advance(60000);
  assert.doesNotThrow(() => f.store.rateLimit());
  assert.doesNotThrow(() => f.store.rateLimit(true));
});
