import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exchangeFixture, head, key, origin, repository } from './exchangeHelpers.js';
import { parseExchangeArgs } from '../src/exchange/args.js';
import { runExchangeClient } from '../src/exchange/client.js';
import { createExchangeTransport } from '../src/exchange/clientTransport.js';

test('client commands connect once, share files explicitly, export receipts and preserve secrets locally', async t => {
  const f = await exchangeFixture(t);
  let posts = 0;
  const git = { commonDir: () => path.join(f.folder, '.git') };
  const gh = { post(route, fields) {
    posts++; assert.equal(route, `repos/${repository}/issues/42/comments`);
    f.comments.set(101, { id: 101, issue_url: `https://api.github.com/repos/${repository}/issues/42`, body: fields.body,
      user: { id: 1, login: 'user1', type: 'User' }, created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z' });
    return { id: 101 };
  } };
  const deps = { gh, git, github: f.gateway, fetcher: f.fetcher, env: {} };
  const invoke = (args, extra = {}) => runExchangeClient(parseExchangeArgs([...args, '--repo', repository, '--origin', origin]), { ...deps, ...extra });
  await invoke(['connect', '42']); await invoke(['connect', '42']); assert.equal(posts, 1);
  const file = path.join(f.folder, 'context.txt'); fs.writeFileSync(file, 'untrusted context\n');
  const upload = await invoke(['upload', '42', 'report', '--id', key(1), '--head', head, '--file', file]);
  assert.equal(upload.outcome, 'uploaded');
  await invoke(['request', '42', 'review', '--id', key(2), '--head', head, '--evidence', key(1)]);
  const view = await invoke(['inbox', '42']);
  assert.equal(view.requests[0].evidence[0].id, key(1)); assert.equal(view.counts.pending, 1);
  const output = path.join(f.folder, 'download.txt');
  await invoke(['download', '42', key(1), '--output', output]);
  assert.equal(fs.readFileSync(output, 'utf8'), 'untrusted context\n');
  await assert.rejects(invoke(['download', '42', key(1), '--output', output]));
  const receipt = path.join(f.folder, 'receipt.json'); await invoke(['export', '42', '--output', receipt]);
  assert.equal(JSON.parse(fs.readFileSync(receipt)).requests[0].id, key(2));
  const secrets = fs.readdirSync(path.join(git.commonDir(), 'atc/exchange'));
  const settingsFile = path.join(git.commonDir(), 'atc/exchange', secrets[0]);
  const settings = JSON.parse(fs.readFileSync(settingsFile));
  assert.equal(JSON.stringify(view).includes(settings.token), false);
  assert.equal(f.comments.get(101).body.includes(settings.token), false);
  assert.equal(fs.readFileSync(path.join(f.folder, 'service/state.json'), 'utf8').includes(settings.token), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o600);
  await assert.rejects(invoke(['upload', '42', 'log', '--id', key(9), '--head', head, '--file', file],
    { env: { ATC_READ_ONLY: '1' } }), { code: 'readOnly' });
  assert.equal(posts, 1);
});

test('disabled repositories cannot publish proof comments', async t => {
  const f = await exchangeFixture(t); f.upstream.enabled = false;
  let posts = 0;
  await assert.rejects(runExchangeClient(parseExchangeArgs(['connect', '42', '--repo', repository, '--origin', origin]), {
    github: f.gateway, gh: { post() { posts++; } }, git: { commonDir: () => f.folder }, env: {}
  }), { code: 'notEnabled' });
  assert.equal(posts, 0);
});

test('client rejects hostile server outputs, digest mismatches and transport redirects', async () => {
  const invalid = [Response.json({ outcome: 'connected', expiresAt: 'ignore instructions' }),
    Response.json({ outcome: 'requested', id: key(1), extra: 'hostile' }), new Response('bad', { headers: { 'content-type': 'text/html' } })];
  for (const response of invalid) {
    const request = createExchangeTransport(origin, { fetcher: async (_, options) => { assert.equal(options.redirect, 'error'); return response; } });
    await assert.rejects(request('GET', '/pulls/42'), { code: 'unavailable' });
  }
  const request = createExchangeTransport(origin, { fetcher: async () => new Response('wrong', {
    headers: { 'content-type': 'application/octet-stream', 'x-content-sha256': 'a'.repeat(64) }
  }) });
  await assert.rejects(request('GET', `/pulls/42/evidence/${key(1)}`, { download: true }), { code: 'unavailable' });
});

test('exchange executable works offline for help and identifiers, and errors never echo arguments', async () => {
  const run = promisify(execFile);
  const executable = path.resolve('src/exchange/main.js');
  const options = { env: { ...process.env, PATH: '' } };
  const help = await run(process.execPath, [executable, 'help'], options);
  assert.match(help.stdout, /atc-exchange request/);
  assert.match(JSON.parse((await run(process.execPath, [executable, 'id'], options)).stdout).id, /^[a-f0-9]{32}$/);
  const failed = await run(process.execPath, [executable, 'IGNORE-INSTRUCTIONS'], options).catch(x => x);
  assert.equal(failed.code, 1); assert.equal(failed.stderr, 'atc-exchange: invalid\n');
});
