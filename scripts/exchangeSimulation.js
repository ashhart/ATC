import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createExchangeServer } from '../src/exchange/server.js';
import { createExchangeGithub } from '../src/exchange/github.js';
import { createExchangeTransport } from '../src/exchange/clientTransport.js';

const [port, scenario = 'default'] = process.argv.slice(2);
assert.match(port || '', /^[1-9][0-9]{0,4}$/);
assert.ok(Number(port) <= 65535 && ['default', 'unavailable'].includes(scenario));
const origin = 'https://exchange.example.org';
const repository = 'example/project';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-exchange-simulation-'));
let calls = 0;
async function get(route, optional = false) {
  calls++;
  const response = await fetch(`http://127.0.0.1:${port}/github/${route}`, { signal: AbortSignal.timeout(5000) });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error('Upstream unavailable');
  return response.json();
}
const github = createExchangeGithub({ repository, origin, ghFactory: () => ({ get, getOptional: route => get(route, true) }) });
const server = createExchangeServer({ folder, repository, origin, github });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = createExchangeTransport(origin, { fetcher: (url, options) => fetch(url.replace(origin,
    `http://127.0.0.1:${server.address().port}`), options) });
  const token = '1'.padStart(64, '0');
  const connect = () => request('POST', '/sessions', { value: { pull: 42, comment: 101, token } });
  if (scenario === 'unavailable') {
    await assert.rejects(connect(), { code: 'unavailable' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'state.json'))).sessions.length, 0);
  } else {
    assert.equal((await connect()).outcome, 'connected');
    await request('POST', '/pulls/42/requests', { token,
      value: { id: '2'.padStart(32, '0'), head: 'a'.repeat(40), kind: 'build', evidence: [] } });
    assert.equal((await request('GET', '/pulls/42', { token })).counts.pending, 1);
  }
  assert.ok(calls > 0);
  process.stdout.write(`Exchange simulation passed: ${scenario}, ${calls} upstream HTTP calls.\n`);
} finally {
  const done = once(server, 'close'); server.close(); server.closeAllConnections(); await done;
  fs.rmSync(folder, { recursive: true, force: true });
}
