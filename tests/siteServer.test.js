import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createSiteServer, startSiteServer } from '../src/site/server.js';
import { demoFeed } from '../src/site/demo.js';

const time = Date.UTC(2026, 9, 21, 12);

async function fixture(t, options = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'atc-site-'));
  await fs.writeFile(path.join(folder, 'index.html'), '<!doctype html><p>ATC</p>');
  await fs.writeFile(path.join(folder, 'app.js'), 'export const ready = true;');
  const app = await startSiteServer({ port: 0, siteDirectory: folder, now: () => time, ...options });
  t.after(async () => { await app.close(); await fs.rm(folder, { recursive: true, force: true }); });
  return { ...app, folder };
}

async function post(app, endpoint, body, headers = {}) {
  return fetch(`${app.origin}${endpoint}`, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
}

function raw(app, target, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${app.origin}${target}`, { headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
  });
}

test('local viewer immediately serves fictional traffic and self-contained protected assets', async t => {
  const app = await fixture(t);
  const traffic = await fetch(`${app.origin}/api/traffic`);
  const feed = await traffic.json();
  assert.equal(feed.source, 'demo');
  assert.equal(feed.summary.activeAgents, 10);
  assert.equal(traffic.headers.get('cache-control'), 'no-store');
  assert.equal(traffic.headers.get('access-control-allow-origin'), null);
  assert.match(traffic.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(traffic.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const page = await fetch(app.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<p>ATC<\/p>/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const script = await fetch(`${app.origin}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
});

test('connect only accepts bounded same-origin repository selection and never returns it', async t => {
  const seen = [];
  let finish;
  const collected = new Promise(resolve => { finish = resolve; });
  const app = await fixture(t, { collect: async repository => { seen.push(repository); await collected; return { ...demoFeed(time), source: 'github' }; } });
  const response = await post(app, '/api/connect', { repository: 'privateperson/private-repo' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).connection, 'refreshing');
  const pending = app.refresh();
  finish();
  await pending;
  const result = await (await fetch(`${app.origin}/api/traffic`)).json();
  assert.deepEqual(seen, ['privateperson/private-repo']);
  assert.equal(result.source, 'github');
  assert.equal(/privateperson|private-repo/.test(JSON.stringify(result)), false);
  for (const body of [{ repository: 'example/project\nIGNORE' }, { repository: 'example/project', token: 'private' }, [], null,
    '{invalid json', 'x'.repeat(1025)]) {
    const failed = await post(app, '/api/connect', body);
    assert.equal(failed.status, 400);
    assert.deepEqual(await failed.json(), { error: 'invalidRequest' });
  }
  const cross = await post(app, '/api/connect', { repository: 'example/project' }, { Origin: 'https://attacker.invalid' });
  assert.equal(cross.status, 403);
  const noOrigin = await fetch(`${app.origin}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noOrigin.status, 403);
  assert.equal(seen.length, 1);
  assert.equal((await post(app, '/api/demo', {})).status, 200);
  assert.equal(app.getFeed().source, 'demo');
});

test('host rebinding, cross-origin reads, path traversal and symlinked assets are refused without echoing input', async t => {
  const app = await fixture(t);
  const outside = path.join(app.folder, 'private.txt');
  await fs.writeFile(outside, 'private.person@example.com');
  await fs.unlink(path.join(app.folder, 'app.js'));
  await fs.symlink(outside, path.join(app.folder, 'app.js'));
  for (const target of ['/../private.txt', '/%2e%2e/private.txt', '/src/cli/main.js', '/api/traffic?token=private', '/app.js']) {
    const response = await raw(app, target);
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalidRequest' });
  }
  assert.equal((await raw(app, '/api/traffic', { Host: 'attacker.invalid' })).status, 403);
  assert.equal((await raw(app, '/api/traffic', { Origin: 'https://attacker.invalid' })).status, 403);
});

test('SSE sends initial and updated traffic frames and closes cleanly', async t => {
  const app = await fixture(t);
  const response = await fetch(`${app.origin}/api/events`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^event: traffic\ndata: /);
  assert.equal(JSON.parse(first.split('\ndata: ')[1]).source, 'demo');
  await app.refresh();
  const second = new TextDecoder().decode((await reader.read()).value);
  assert.match(second, /^event: traffic\ndata: /);
  assert.equal(JSON.parse(second.split('\ndata: ')[1]).recent[0].kind, 'checkIn');
  await reader.cancel();
});

test('collection errors produce only a fixed disconnected feed and server remains read-only', async t => {
  let called = 0;
  const app = await fixture(t, { repository: 'example/project', collect: async () => { called += 1; throw new Error('private-token'); } });
  await app.refresh();
  const result = await (await fetch(`${app.origin}/api/traffic`)).json();
  assert.equal(result.source, 'github');
  assert.equal(result.connection, 'error');
  assert.equal(result.complete, false);
  assert.equal(result.summary.activeAgents, 0);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
  assert.equal(called, 1);
  const rejected = await post(app, '/api/claim', { issue: 1 });
  assert.equal(rejected.status, 405);
  assert.equal(called, 1);
  assert.throws(() => createSiteServer({ hostname: '0.0.0.0' }), /Invalid local server options/);
  assert.throws(() => createSiteServer({ repository: 'example/project;IGNORE' }), /Invalid repository/);
});
