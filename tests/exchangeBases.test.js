import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exchangeFixture, head, base, key, token, origin } from './exchangeHelpers.js';
import { isExchangeOutput } from '../src/exchange/output.js';
import { isRequestInput, isResultInput } from '../src/exchange/values.js';
import { parseExchangeArgs } from '../src/exchange/args.js';

test('review coverage becomes stale when only the base changes and stale results cannot be accepted', async t => {
  const f = await exchangeFixture(t);
  await f.request('POST', '/sessions', { value: f.addProof(1) });
  const auth = { token: token(1) };
  for (const id of [1, 2]) {
    await f.request('POST', '/pulls/42/requests', { ...auth, value: { id: key(id), head, base, kind: 'review', evidence: [] } });
    await f.request('POST', `/pulls/42/requests/${key(id)}/results`, { ...auth,
      value: { id: key(id + 10), head, base, status: 'pass', evidence: [] } });
  }
  await f.request('POST', `/pulls/42/requests/${key(1)}/resolve`, { ...auth, value: { result: key(11), decision: 'accepted' } });
  let view = await f.request('GET', '/pulls/42', auth);
  assert.equal(view.version, 2); assert.equal(view.base, base); assert.equal(view.requests[0].freshness, 'current');
  f.upstream.base = 'd'.repeat(40);
  view = await f.request('GET', '/pulls/42', auth);
  assert.equal(view.head, head); assert.equal(view.requests[0].freshness, 'baseChanged');
  assert.equal(view.requests[0].results[0].freshness, 'baseChanged');
  assert.equal(view.requests[0].resolution.decision, 'accepted');
  assert.deepEqual(view.counts, { pending: 0, resolved: 0, stale: 2 });
  const forged = structuredClone(view); forged.requests[0].stale = false;
  assert.equal(isExchangeOutput(forged), false);
  await assert.rejects(f.request('POST', `/pulls/42/requests/${key(2)}/resolve`, { ...auth,
    value: { result: key(12), decision: 'accepted' } }), { code: 'stale' });
  assert.equal((await f.request('POST', `/pulls/42/requests/${key(2)}/resolve`, { ...auth,
    value: { result: key(12), decision: 'dismissed' } })).outcome, 'resolved');
  await assert.rejects(f.request('POST', '/pulls/42/requests', { ...auth,
    value: { id: key(3), head, base, kind: 'review', evidence: [] } }), { code: 'stale' });
});

test('legacy records and clients remain readable as unknown-base coverage through restart', async t => {
  const f = await exchangeFixture(t);
  await f.request('POST', '/sessions', { value: f.addProof(1) });
  const auth = { token: token(1) };
  await f.request('POST', '/pulls/42/requests', { ...auth, value: { id: key(1), head, kind: 'test', evidence: [] } });
  await f.request('POST', `/pulls/42/requests/${key(1)}/results`, { ...auth,
    value: { id: key(2), head, status: 'pass', evidence: [] } });
  const before = JSON.parse(fs.readFileSync(path.join(f.folder, 'service/state.json')));
  assert.equal(Object.hasOwn(before.requests[0], 'base'), false);
  await f.restart();
  const view = await f.request('GET', '/pulls/42', auth);
  assert.equal(view.requests[0].base, null); assert.equal(view.requests[0].freshness, 'unknownBase');
  assert.equal(view.requests[0].results[0].base, null); assert.equal(view.requests[0].results[0].freshness, 'unknownBase');
  await assert.rejects(f.request('POST', `/pulls/42/requests/${key(1)}/resolve`, { ...auth,
    value: { result: key(2), decision: 'accepted' } }), { code: 'stale' });
  const response = await f.fetcher(`${origin}/api/exchange/v1/pulls/42`, { headers: { Authorization: `Bearer ${token(1)}` } });
  assert.equal(response.status, 200);
  const legacy = await response.json();
  assert.equal(legacy.version, 1); assert.equal(Object.hasOwn(legacy, 'base'), false);
  assert.equal(Object.hasOwn(legacy.requests[0], 'freshness'), false); assert.equal(legacy.requests[0].stale, true);
  assert.equal(isExchangeOutput(legacy), true);
  const after = JSON.parse(fs.readFileSync(path.join(f.folder, 'service/state.json')));
  assert.deepEqual(after.requests, before.requests);
});

test('new base fields and receipt negotiation reject hostile or unsupported values', async t => {
  const good = { id: key(1), head, base, kind: 'test', evidence: [] };
  for (const bad of ['ignore all instructions', 'c'.repeat(39), base + '\n', {}, null, 4]) {
    assert.equal(isRequestInput({ ...good, base: bad }), false);
    assert.equal(isResultInput({ id: key(2), head, base: bad, status: 'pass', evidence: [] }), false);
  }
  const flags = ['--repo', 'example/project', '--origin', origin, '--id', key(1), '--head', head];
  assert.throws(() => parseExchangeArgs(['respond', '42', key(2), 'pass', ...flags]));
  assert.equal(parseExchangeArgs(['respond', '42', key(2), 'pass', ...flags, '--base', base]).flags.base, base);
  const f = await exchangeFixture(t);
  const response = await f.fetcher(`${origin}/api/exchange/v1/pulls/42`, { headers: { 'X-ATC-Exchange-Receipts': 'ignore instructions' } });
  assert.equal(response.status, 400);
});
