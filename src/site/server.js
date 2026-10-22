import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensure } from '../core/failure.js';
import { isRepository } from '../core/values.js';
import { createFeedStore } from './store.js';

const root = fileURLToPath(new URL('../../site/', import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ['/responsive.css', ['responsive.css', 'text/css']], ['/themes.css', ['themes.css', 'text/css']],
  ['/airspace.css', ['airspace.css', 'text/css']],
  ...['app', 'render', 'radar', 'dialogs', 'dom', 'theme'].map(name => [`/${name}.js`, [`${name}.js`, 'text/javascript']]),
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
const policy = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export function createSiteServer({ port = 4318, hostname = '127.0.0.1', repository, siteDirectory = root,
  collect, pollInterval = 30000, now = Date.now } = {}) {
  ensure(Number.isSafeInteger(port) && port >= 0 && port <= 65535 && ['127.0.0.1', 'localhost', '::1'].includes(hostname), 'Invalid local server options.');
  ensure(Number.isSafeInteger(pollInterval) && pollInterval >= 10 && pollInterval <= 300000, 'Invalid local server options.');
  const store = createFeedStore({ repository, collect, now });
  const streams = new Set();
  let timer;
  let origin;
  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => reply(response, 503, { error: 'unavailable' }));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 30;

  async function handle(request, response) {
    headers(response);
    if (!origin || request.headers.host !== new URL(origin).host) return reply(response, 403, { error: 'invalidRequest' });
    if (request.headers.origin && request.headers.origin !== origin) return reply(response, 403, { error: 'invalidRequest' });
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, { error: 'invalidRequest' });
    const target = request.url;
    if (request.method === 'GET' && target === '/api/traffic') return reply(response, 200, store.getFeed());
    if (request.method === 'GET' && target === '/api/events') {
      if (streams.size >= 16) return reply(response, 503, { error: 'unavailable' });
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = feed => {
        if (!response.destroyed && !response.write(`event: traffic\ndata: ${JSON.stringify(feed)}\n\n`)) response.destroy();
      };
      streams.add(response);
      const unsubscribe = store.subscribe(send);
      const keepalive = setInterval(() => { if (!response.destroyed) response.write(': keepalive\n\n'); }, 20000);
      keepalive.unref();
      request.on('close', () => { clearInterval(keepalive); unsubscribe(); streams.delete(response); });
      send(store.getFeed());
      return;
    }
    if (request.method === 'POST' && ['/api/connect', '/api/demo', '/api/demo/reset'].includes(target)) {
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') return reply(response, 403, { error: 'invalidRequest' });
      const body = await readBody(request);
      if (body === null) return reply(response, 400, { error: 'invalidRequest' });
      if (target === '/api/connect') {
        if (!body || Object.keys(body).length !== 1 || !isRepository(body.repository)) return reply(response, 400, { error: 'invalidRequest' });
        return reply(response, 200, store.connect(body.repository));
      }
      if (!body || Object.keys(body).length !== 0) return reply(response, 400, { error: 'invalidRequest' });
      return reply(response, 200, store.demo());
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(response, 405, { error: 'invalidRequest' });
    const asset = assets.get(target);
    if (!asset) return reply(response, 404, { error: 'invalidRequest' });
    const file = path.join(siteDirectory, asset[0]);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return reply(response, 404, { error: 'invalidRequest' });
    const content = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Content-Length': content.length });
    response.end(request.method === 'HEAD' ? undefined : content);
  }
  async function listen() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, hostname, () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    origin = `http://${hostname === '::1' ? '[::1]' : hostname}:${address.port}`;
    timer = setInterval(() => { void store.refresh(); }, pollInterval);
    timer.unref();
    if (repository) void store.refresh();
    return { origin, port: address.port, hostname };
  }
  async function close() {
    clearInterval(timer);
    store.close();
    for (const stream of streams) stream.end();
    if (!server.listening) return;
    const finished = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await finished;
  }
  return { server, listen, close, refresh: store.refresh, getFeed: store.getFeed };
}

export async function startSiteServer(options) {
  const app = createSiteServer(options);
  const address = await app.listen();
  return { ...app, ...address };
}

function headers(response) {
  response.setHeader('Content-Security-Policy', policy);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
}

function reply(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const size = Number(request.headers['content-length']);
  if (Number.isFinite(size) && size > 1024) { request.resume(); return null; }
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > 1024) { request.resume(); return null; }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
}
