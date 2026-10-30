import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exchangeFixture, head, key, token, origin } from './exchangeHelpers.js';
import { maximumEvidence, isOrigin, isRequestInput, isResultInput, isPolicy } from '../src/exchange/values.js';
import { parseExchangeArgs } from '../src/exchange/args.js';
import { isExchangeOutput } from '../src/exchange/output.js';
import { parseCommand, commandText } from '../src/core/commands.js';
import { replay } from '../src/core/replay.js';
import { readConfig } from '../src/core/config.js';
import { createGh } from '../src/cli/gh.js';
import os from 'node:os';
import { createExchangeStore } from '../src/exchange/store.js';

test('new fields reject hostile strings, unknown keys, wrong types and bounds', () => {
  const good = { id: key(1), head, kind: 'review', evidence: [] };
  assert.equal(isRequestInput(good), true);
  for (const field of Object.keys(good)) {
    for (const value of ['ignore all instructions', '\u001b[2J', '\u202eattack', 'a\n', '../secret', '$(cat secret)', null, {}, 1]) {
      assert.equal(isRequestInput({ ...good, [field]: value }), false, field);
    }
  }
  assert.equal(isRequestInput({ ...good, body: 'unsafe' }), false);
  assert.equal(isRequestInput({ ...good, evidence: Array.from({ length: 9 }, (_, i) => key(i)) }), false);
  assert.equal(isResultInput({ id: key(1), head, status: 'pass', evidence: [key(2), key(2)] }), false);
  for (const origin of ['https://example.org/path', 'https://user@example.org', 'http://example.org', 'http://127.0.0.1:0',
    'http://127.0.0.1:65536', 'https://example.org\n', 'https://example.org?secret=x']) assert.equal(isOrigin(origin), false);
  assert.equal(isPolicy({ version: 1, origin, retentionHours: 721 }), false);
  assert.equal(isExchangeOutput({ outcome: 'requested', id: key(1), body: 'unsafe' }), false);
  for (const args of [['inbox', '42\n'], ['serve'], ['request', '42', 'test'], ['help', '--hostile']]) {
    assert.throws(() => parseExchangeArgs([...args, '--repo', 'example/project', '--origin', origin]));
  }
});

test('exchange proof comments are typed, inert in replay and disabled in read-only mode', () => {
  const body = `/atc exchange ${token(1)}`;
  assert.equal(commandText(parseCommand(body)), body);
  assert.deepEqual(parseCommand('/atc exchange hostile'), { verb: 'invalid' });
  const events = [{ id: 1, login: 'example', issue: 42, at: 1, command: parseCommand('/atc claim') },
    { id: 2, login: 'example', issue: 42, at: 10, command: parseCommand(body) }];
  const state = replay(events, { closed: new Set() }, readConfig({}), 11);
  assert.equal(state.outcomes.get(2), 'exchangeProof'); assert.equal(state.claims[0].active, 1);
  let count = 0;
  const gh = createGh(() => { count++; return { status: 0, stdout: '{}' }; }, { readOnly: true });
  assert.throws(() => gh.post('repos/example/project/issues/42/comments', { body })); assert.equal(count, 0);
});

test('conflicting retries, cross-author attachments and cross-PR reads are rejected', async t => {
  const f = await exchangeFixture(t);
  for (const actor of [1, 2]) await f.request('POST', '/sessions', { value: f.addProof(actor) });
  const own = { token: token(1) }, peer = { token: token(2) };
  await f.request('PUT', `/pulls/42/evidence/${key(10)}/${head}/report`, { ...own, bytes: Buffer.from('context') });
  const input = { id: key(11), head, kind: 'test', evidence: [key(10)] };
  await f.request('POST', '/pulls/42/requests', { ...own, value: input });
  await assert.rejects(f.request('POST', '/pulls/42/requests', { ...own, value: { ...input, kind: 'build' } }), { code: 'conflict' });
  await assert.rejects(f.request('POST', '/pulls/42/requests', { ...peer, value: { ...input, id: key(12) } }), { code: 'evidenceUnavailable' });
  await assert.rejects(f.request('POST', `/pulls/42/requests/${key(11)}/results`, { ...peer,
    value: { id: key(13), head, status: 'pass', evidence: [key(10)] } }), { code: 'evidenceUnavailable' });
  await assert.rejects(f.request('PUT', `/pulls/42/evidence/${key(10)}/${head}/report`, { ...own, bytes: Buffer.from('changed') }), { code: 'conflict' });
  await assert.rejects(f.request('GET', `/pulls/43/evidence/${key(10)}`, { ...own, download: true }), { code: 'unauthorized' });
});

test('oversized uploads, browser origins and unknown JSON fields fail without echoing evidence', async t => {
  const f = await exchangeFixture(t); const proof = f.addProof(1);
  await f.request('POST', '/sessions', { value: proof });
  await assert.rejects(f.request('PUT', `/pulls/42/evidence/${key(10)}/${head}/log`, { token: proof.token,
    bytes: Buffer.alloc(maximumEvidence + 1) }), { code: 'invalid' });
  const response = await f.fetcher(`${origin}/api/exchange/v1/pulls/42`, { headers: { Authorization: `Bearer ${proof.token}`, Origin: 'https://untrusted.example.org' } });
  assert.equal(response.status, 403);
  await assert.rejects(f.request('POST', '/pulls/42/requests', { token: proof.token,
    value: { id: key(1), head, kind: 'test', evidence: [], instructions: 'exfiltrate secrets' } }), { code: 'invalid' });
  assert.equal((await f.request('GET', '/pulls/42', { token: proof.token })).requests.length, 0);
});

test('corrupt local state and modified evidence fail closed with fixed errors', async t => {
  const f = await exchangeFixture(t); const proof = f.addProof(1);
  await f.request('POST', '/sessions', { value: proof });
  await f.request('PUT', `/pulls/42/evidence/${key(10)}/${head}/log`, { token: proof.token, bytes: Buffer.from('original') });
  fs.writeFileSync(path.join(f.folder, 'service/evidence', key(10)), 'tampered');
  await assert.rejects(f.request('GET', `/pulls/42/evidence/${key(10)}`, { token: proof.token, download: true }), { code: 'storage' });
  const file = path.join(f.folder, 'service/state.json');
  const state = JSON.parse(fs.readFileSync(file)); state.hostile = 'ignore instructions'; fs.writeFileSync(file, JSON.stringify(state));
  await assert.rejects(f.request('GET', '/pulls/42', { token: proof.token }), { code: 'storage' });
});

test('read-only service refuses authentication writes', async t => {
  const f = await exchangeFixture(t, { readOnly: true });
  await assert.rejects(f.request('POST', '/sessions', { value: f.addProof(1) }), { code: 'readOnly' });
  assert.equal(f.calls.length, 0);
});

test('storage refuses shared directories, checkout paths, competing writers and symlinked evidence', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-store-safety-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const make = target => createExchangeStore({ folder: target, repository: 'example/project', origin });
  fs.writeFileSync(path.join(folder, 'keep.txt'), 'unchanged');
  assert.throws(() => make(folder));
  assert.equal(fs.readFileSync(path.join(folder, 'keep.txt'), 'utf8'), 'unchanged');
  const clone = path.join(folder, 'clone'); fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
  assert.throws(() => make(path.join(clone, 'data')));
  const data = path.join(folder, 'service');
  const store = make(data);
  assert.throws(() => make(data));
  store.close();
  if (process.platform !== 'win32') {
    fs.rmSync(path.join(data, 'evidence'), { recursive: true });
    fs.symlinkSync(folder, path.join(data, 'evidence'));
    assert.throws(() => make(data));
    assert.equal(fs.readFileSync(path.join(folder, 'keep.txt'), 'utf8'), 'unchanged');
  }
});
