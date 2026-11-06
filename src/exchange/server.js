import http from 'node:http';
import { createExchangeStore } from './store.js';
import { createExchangeGithub } from './github.js';
import { createGithubRead } from './githubRead.js';
import { createExchangeWebHandler } from './webHandler.js';
import { readBody, sendJson, sendError } from './httpIo.js';
import { isOrigin, isRepository, maximumEvidence, requireValue } from './values.js';

export function createExchangeServer({ folder, repository, origin, now = Date.now, github, store, readOnly = false }) {
  requireValue(isRepository(repository) && isOrigin(origin) && typeof readOnly === 'boolean');
  repository = repository.toLowerCase();
  github ||= createExchangeGithub({ repository, origin, ghFactory: createGithubRead });
  store ||= createExchangeStore({ folder, repository, origin, now });
  const handle = createExchangeWebHandler({ store, github, origin, now, readOnly });
  let active = 0, storageFailed = false, minute = -1, count = 0, publicCount = 0;
  async function route(request, response) {
    requireValue(!storageFailed, 'storage', 503);
    const current = Math.floor(now() / 60000);
    if (current !== minute) { minute = current; count = 0; publicCount = 0; }
    const publicRead = request.url?.startsWith('/api/exchange/v1/help') || request.url === '/api/exchange/v1/a2a/agent-card.json';
    requireValue(publicRead ? ++publicCount <= 600 : ++count <= 120, 'capacity', 429);
    requireValue(typeof request.url === 'string' && request.url.length <= 300 && !/[?%#\s]/.test(request.url)
      && request.url.startsWith('/api/exchange/v1/'));
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request, maximumEvidence);
    const result = await handle(new Request(`${origin}${request.url}`, { method: request.method, headers: request.headers, body }));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  }
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, (request, response) => {
    if (active >= 8) { request.resume(); return sendJson(response, 429, { error: 'capacity' }); }
    active++;
    request.setTimeout(15000, () => request.destroy());
    route(request, response).catch(error => sendError(response, error)).finally(() => { active--; request.resume(); });
  });
  server.maxConnections = 64;
  const timer = setInterval(() => { try { store.sweep(); } catch { storageFailed = true; } }, 60000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); store.close(); });
  server.on('clientError', (_, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}
