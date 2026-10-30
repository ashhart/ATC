import http from 'node:http';
import { createExchangeStore } from './store.js';
import { createExchangeGithub } from './github.js';
import { inboxView } from './inbox.js';
import { readBody, readJson, sendJson, sendError } from './httpIo.js';
import { digest, isDigest, isHead, isNumber, isOrigin, isPolicy, isRepository, isSessionInput,
  isRequestInput, isResultInput, isResolutionInput, maximumEvidence, requireValue } from './values.js';

export function createExchangeServer({ folder, repository, origin, now = Date.now, github, store, readOnly = false }) {
  requireValue(isRepository(repository) && isOrigin(origin) && typeof readOnly === 'boolean');
  repository = repository.toLowerCase();
  github ||= createExchangeGithub({ repository, origin });
  store ||= createExchangeStore({ folder, repository, origin, now });
  const attempts = new Map();
  let active = 0;
  let storageFailed = false;
  function rateLimit(key) {
    const minute = Math.floor(now() / 60000);
    for (const [old, value] of attempts) if (value.minute !== minute) attempts.delete(old);
    const value = attempts.get(key) || { minute, count: 0 };
    requireValue(attempts.size < 512 || attempts.has(key), 'capacity', 429);
    requireValue(++value.count <= 120, 'capacity', 429);
    attempts.set(key, value);
  }
  async function route(request, response) {
    requireValue(!storageFailed, 'storage', 503);
    requireValue(!request.headers.origin || request.headers.origin === origin, 'forbidden', 403);
    requireValue(!request.headers['content-encoding'], 'invalid', 415);
    rateLimit('all');
    const url = request.url;
    requireValue(typeof url === 'string' && url.length <= 300 && !/[?%#\s]/.test(url));
    const prefix = '/api/exchange/v1';
    if (request.method === 'POST' && url === `${prefix}/sessions`) {
      requireValue(!readOnly, 'readOnly', 403);
      const input = await readJson(request);
      requireValue(isSessionInput(input));
      const policy = await github.policy();
      requireValue(isPolicy(policy) && policy.origin === origin, 'notEnabled', 403);
      const author = await github.verify(input);
      await github.pull(input.pull);
      return sendJson(response, 200, store.connect(input, author));
    }
    const bearer = request.headers.authorization;
    requireValue(typeof bearer === 'string' && bearer.startsWith('Bearer ') && isDigest(bearer.slice(7)), 'unauthorized', 401);
    const token = bearer.slice(7);
    rateLimit(digest(token));
    const session = store.session(token);
    const match = url.match(/^\/api\/exchange\/v1\/pulls\/([1-9][0-9]{0,8})(.*)$/);
    requireValue(match && isNumber(Number(match[1])), 'notFound', 404);
    const pull = Number(match[1]);
    requireValue(session.pull === pull, 'unauthorized', 401);
    const policy = await github.policy();
    requireValue(isPolicy(policy) && policy.origin === origin, 'notEnabled', 403);
    const author = await github.verify({ pull, comment: session.comment, token });
    requireValue(author === session.author, 'unauthorized', 401);
    const current = await github.pull(pull);
    requireValue(isHead(current?.head) && ['open', 'closed'].includes(current.state), 'upstream', 502);
    const tail = match[2];
    if (request.method === 'GET' && tail === '') return sendJson(response, 200, inboxView(store, session, pull, current, now()));
    const evidence = tail.match(/^\/evidence\/([a-f0-9]{32})(?:\/([a-f0-9]{40})\/(log|trace|report))?$/);
    if (request.method === 'GET' && evidence && !evidence[2]) {
      const found = store.download(session, pull, evidence[1]);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="evidence.bin"',
        'Content-Length': found.bytes.length, 'X-Content-SHA256': found.digest, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      return response.end(found.bytes);
    }
    requireValue(!readOnly, 'readOnly', 403);
    requireValue(current.state === 'open', 'closed', 409);
    if (request.method === 'PUT' && evidence?.[2]) {
      requireValue(request.headers['content-type'] === 'application/octet-stream', 'invalid', 415);
      requireValue(evidence[2] === current.head || store.inbox(pull).some(x => x.head === evidence[2]), 'stale', 409);
      const bytes = await readBody(request, maximumEvidence);
      return sendJson(response, 200, store.upload(session, pull, evidence[1], evidence[2], evidence[3], bytes, policy.retentionHours));
    }
    if (request.method === 'POST' && tail === '/requests') {
      const input = await readJson(request);
      requireValue(isRequestInput(input));
      requireValue(input.head === current.head, 'stale', 409);
      return sendJson(response, 200, store.request(session, pull, input));
    }
    const action = tail.match(/^\/requests\/([a-f0-9]{32})\/(results|resolve)$/);
    if (request.method === 'POST' && action) {
      const input = await readJson(request);
      requireValue(action[2] === 'results' ? isResultInput(input) : isResolutionInput(input));
      const result = action[2] === 'results' ? store.respond(session, pull, action[1], input) : store.resolve(session, pull, action[1], input);
      return sendJson(response, 200, result);
    }
    requireValue(false, 'notFound', 404);
  }
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, (request, response) => {
    if (active >= 8) { request.resume(); return sendJson(response, 429, { error: 'capacity' }); }
    active += 1;
    request.setTimeout(15000, () => request.destroy());
    route(request, response).catch(error => sendError(response, error)).finally(() => { active -= 1; request.resume(); });
  });
  server.maxConnections = 64;
  const timer = setInterval(() => { try { store.sweep(); } catch { storageFailed = true; } }, 60000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); store.close(); });
  server.on('clientError', (_, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}
