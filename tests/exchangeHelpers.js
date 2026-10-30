import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { createExchangeServer } from '../src/exchange/server.js';
import { createExchangeGithub } from '../src/exchange/github.js';
import { createExchangeTransport } from '../src/exchange/clientTransport.js';
import { proofFor } from '../src/exchange/values.js';

export const head = 'a'.repeat(40);
export const key = number => number.toString(16).padStart(32, '0');
export const token = number => number.toString(16).padStart(64, '0');
export const origin = 'https://exchange.example.org';
export const repository = 'example/project';
export const encodeFile = value => { const bytes = Buffer.from(JSON.stringify(value)); return { type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') }; };

export async function exchangeFixture(t, { readOnly = false } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-exchange-'));
  const comments = new Map();
  const calls = [];
  const upstream = { head, state: 'open', private: false, permission: 'read', enabled: true, failure: false,
    policy: { version: 1, origin, retentionHours: 1 } };
  let clock = Date.parse('2026-10-30T12:00:00.000Z');
  function addProof(author, pull = 42, secret = token(author)) {
    const id = 100 + author;
    comments.set(id, { id, issue_url: `https://api.github.com/repos/${repository}/issues/${pull}`,
      body: `/atc exchange ${proofFor(secret, origin, repository, pull)}`, user: { id: author, login: `user${author}`, type: 'User' },
      created_at: '2026-10-30T11:59:00Z', updated_at: '2026-10-30T11:59:00Z' });
    return { pull, comment: id, token: secret };
  }
  const mock = http.createServer((request, response) => {
    calls.push(request.url);
    const base = `/repos/${repository}`;
    let data;
    if (request.url === base) data = { private: upstream.private };
    if (request.url === `${base}/contents/.github/atc.json`) data = upstream.enabled ? encodeFile({}) : null;
    if (request.url === `${base}/contents/.github/atc-exchange.json`) data = encodeFile(upstream.policy);
    if (/\/pulls\/[0-9]+$/.test(request.url)) data = { number: Number(request.url.split('/').at(-1)), state: upstream.state,
      head: { sha: upstream.head }, base: { repo: { full_name: repository } } };
    if (/\/issues\/comments\/[0-9]+$/.test(request.url)) data = comments.get(Number(request.url.split('/').at(-1))) || null;
    const permission = request.url.match(/\/collaborators\/user([0-9]+)\/permission$/);
    if (permission) data = { permission: upstream.permission, user: { id: Number(permission[1]) } };
    response.writeHead(upstream.failure ? 503 : data === undefined ? 501 : data === null ? 404 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(upstream.failure ? { message: 'UNTRUSTED UPSTREAM ERROR' } : data ?? { message: 'Not found' }));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  async function get(route, optional = false) {
    const response = await fetch(`http://127.0.0.1:${mock.address().port}/${route}`);
    if (response.status === 404 && optional) return null;
    if (!response.ok) throw new Error('UNTRUSTED UPSTREAM ERROR');
    return response.json();
  }
  const gateway = createExchangeGithub({ repository, origin, ghFactory: () => ({ get, getOptional: route => get(route, true) }) });
  let server;
  async function start() {
    server = createExchangeServer({ folder: path.join(folder, 'service'), repository, origin, now: () => clock, github: gateway, readOnly });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  await start();
  const fetcher = (url, options) => fetch(url.replace(origin, `http://127.0.0.1:${server.address().port}`), options);
  const request = createExchangeTransport(origin, { fetcher });
  async function stop() { const done = once(server, 'close'); server.close(); server.closeAllConnections(); await done; }
  t.after(async () => { await stop(); const done = once(mock, 'close'); mock.close(); mock.closeAllConnections(); await done; fs.rmSync(folder, { recursive: true, force: true }); });
  return { folder, comments, calls, upstream, addProof, request, fetcher, gateway, now: () => clock,
    advance: ms => { clock += ms; }, restart: async () => { await stop(); await start(); } };
}
