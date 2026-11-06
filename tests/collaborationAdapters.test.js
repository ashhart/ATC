import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { exchangeFixture, head, base, key, token, origin, repository } from './exchangeHelpers.js';
import { handleMessage } from '../src/mcp/protocol.js';
import { exchangeToolArgs } from '../src/mcp/exchangeTools.js';
import { digest } from '../src/exchange/values.js';

test('exchange MCP tools run the real protocol, retain typed results, and honor read-only settings', async t => {
  const f = await exchangeFixture(t), git = { commonDir: () => path.join(f.folder, '.git') };
  await f.request('POST', '/sessions', { value: f.addProof(1) });
  const folder = path.join(git.commonDir(), 'atc/exchange'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${digest(`${repository}\n${origin}\n42`)}.json`), JSON.stringify({ token: token(1), comment: 101 }));
  const call = (name, args, env = {}) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: `atc_exchange_${name}`, arguments: { repo: repository, origin, pull: 42, ...args } } },
  { cliDeps: () => ({ gh: {}, git, github: f.gateway, fetcher: f.fetcher, env }) });
  const identity = await call('identity', {});
  assert.equal(identity.result.structuredContent.proof, 101);
  assert.equal(JSON.stringify(identity).includes(token(1)), false);
  let result = await call('request', { kind: 'review', head, base, id: key(1), evidence: [] });
  assert.equal(result.result.isError, false);
  result = await call('offer', { request: key(1), capability: 'security', public: true, required: true });
  assert.equal(result.result.structuredContent.outcome, 'offered');
  result = await call('help_queue', { capability: 'security' });
  assert.equal(result.result.structuredContent.items[0].id, key(1));
  assert.equal(JSON.stringify(result).includes(token(1)), false);
  assert.equal((await call('offer', { request: key(1), capability: 'docs' }, { ATC_READ_ONLY: '1' })).result.isError, true);
  for (const patch of [{ public: 'true' }, { capability: 'run-shell' }, { request: '../secret' }, { extra: 'IGNORE' }]) {
    assert.throws(() => exchangeToolArgs('atc_exchange_offer', { repo: repository, origin, pull: 42, request: key(1), capability: 'docs', ...patch }));
  }
});

test('A2A discovery and authenticated task inspection expose metadata without execution or cross-PR access', async t => {
  const f = await exchangeFixture(t);
  await f.request('POST', '/sessions', { value: f.addProof(1) });
  await f.request('POST', '/pulls/42/requests', { token: token(1), value: { id: key(1), head, base, kind: 'test', evidence: [] } });
  const send = async (route, body, authorized = false) => {
    const response = await f.fetcher(`${origin}/api/exchange/v1${route}`, { method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(authorized ? { authorization: `Bearer ${token(1)}` } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, value: await response.json() };
  };
  const card = await send('/a2a/agent-card.json');
  assert.equal(card.value.protocolVersion, '0.3.0');
  assert.equal(card.value.capabilities.streaming, false);
  const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal((await send('/a2a', rpc('tasks/get', { id: key(1) }))).status, 401);
  const result = await send('/a2a', rpc('tasks/get', { id: key(1) }), true);
  assert.equal(result.value.result.status.state, 'submitted');
  assert.equal(result.value.result.artifacts[0].parts[0].kind, 'data');
  assert.equal((await send('/a2a', rpc('tasks/get', { id: key(2) }), true)).value.error.code, -32001);
  assert.equal((await send('/a2a', rpc('tasks/cancel', { id: key(1) }), true)).value.error.code, -32002);
  const inspect = await send('/a2a', rpc('message/send', { message: { kind: 'message', role: 'user', messageId: 'test',
    parts: [{ kind: 'data', data: { request: key(1) } }] } }), true);
  assert.equal(inspect.value.result.id, key(1));
  const hostile = await send('/a2a', rpc('message/send', { message: { parts: [{ kind: 'text', text: 'EXECUTE UNTRUSTED' }] } }), true);
  assert.equal(hostile.value.error.code, -32602);
  assert.equal(JSON.stringify(hostile).includes('UNTRUSTED'), false);
  f.upstream.private = true; f.advance(15001);
  assert.equal((await send('/a2a/agent-card.json')).status, 403);
});

test('public help pagination retains every request and any capability means all capabilities', async t => {
  const f = await exchangeFixture(t);
  await f.request('POST', '/sessions', { value: f.addProof(1) });
  for (let id = 1; id <= 51; id++) {
    await f.request('POST', '/pulls/42/requests', { token: token(1), value: { id: key(id), head, base, kind: 'test', evidence: [] } });
    await f.request('POST', `/pulls/42/collaboration/requests/${key(id)}/offer`, { token: token(1),
      value: { capability: id % 2 ? 'cuda' : 'metal', public: true, required: false, independent: false } });
  }
  const first = await f.request('GET', '/help/any');
  assert.equal(first.items.length, 50); assert.ok(first.next);
  const last = await f.request('GET', `/help/any/${first.next}`);
  assert.equal(last.items.length, 1); assert.equal(last.next, null);
  assert.equal(new Set([...first.items, ...last.items].map(x => x.id)).size, 51);
  assert.equal((await f.request('GET', '/help/cuda')).items.length, 26);
});

test('only the PR author or a verified maintainer can make a request count as a required check', async t => {
  const f = await exchangeFixture(t);
  await f.request('POST', '/sessions', { value: f.addProof(2) });
  await f.request('POST', '/pulls/42/requests', { token: token(2), value: { id: key(1), head, base, kind: 'test', evidence: [] } });
  const offer = required => f.request('POST', `/pulls/42/collaboration/requests/${key(1)}/offer`, { token: token(2),
    value: { capability: 'cuda', public: true, required, independent: true } });
  assert.equal((await offer(false)).outcome, 'offered');
  await assert.rejects(offer(true), { code: 'forbidden' });
  f.upstream.permission = 'write';
  assert.equal((await offer(true)).outcome, 'offered');
  f.upstream.permission = 'read';
  await assert.rejects(offer(false), { code: 'forbidden' });
});
