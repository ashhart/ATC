import { agentCard, a2aTask } from './a2a.js';
import { createCollaborationRoutes } from './collaborationRoutes.js';
import { inboxView, legacyInboxView } from './inbox.js';
import { isExchangeOutput } from './output.js';
import { readWebBytes, readWebJson, jsonResponse, errorResponse } from './webIo.js';
import { isDigest, isHead, isNumber, isOrigin, isPolicy, isSessionInput, isRequestInput,
  isResultInput, isResolutionInput, maximumEvidence, requireValue } from './values.js';

export function createExchangeWebHandler({ store, github, origin, now = Date.now, readOnly = false }) {
  requireValue(isOrigin(origin) && typeof readOnly === 'boolean');
  let cardCache;
  const collaboration = createCollaborationRoutes({ store, github, now, readOnly });
  function reply(value) { requireValue(isExchangeOutput(value), 'storage', 503); return jsonResponse(value); }
  async function route(request) {
    const url = new URL(request.url);
    requireValue(url.origin === origin && !url.search && !/[#%\s]/.test(url.pathname) && url.pathname.length <= 300);
    requireValue(!request.headers.has('origin') || request.headers.get('origin') === origin, 'forbidden', 403);
    requireValue(!request.headers.has('content-encoding'), 'invalid', 415);
    requireValue(!request.headers.has('x-atc-exchange-receipts') || request.headers.get('x-atc-exchange-receipts') === '2');
    if (request.method === 'POST' && url.pathname === '/api/exchange/v1/sessions') {
      requireValue(!readOnly, 'readOnly', 403);
      const input = await readWebJson(request);
      requireValue(isSessionInput(input));
      const policy = await github.policy();
      requireValue(isPolicy(policy) && policy.origin === origin, 'notEnabled', 403);
      const author = await github.verify(input);
      await github.pull(input.pull);
      return reply(store.connect(input, author));
    }
    if (request.method === 'GET' && url.pathname === '/api/exchange/v1/a2a/agent-card.json') {
      if (!cardCache || now() - cardCache.at >= 15000) {
        const response = (async () => {
          await github.policy();
          requireValue(await github.publicRepository(), 'forbidden', 403);
          return jsonResponse(agentCard(origin));
        })();
        cardCache = { at: now(), response };
      }
      return (await cardCache.response).clone();
    }
    const publicResult = await collaboration(request);
    if (publicResult) return publicResult;
    const bearer = request.headers.get('authorization');
    requireValue(bearer?.startsWith('Bearer ') && isDigest(bearer.slice(7)), 'unauthorized', 401);
    const token = bearer.slice(7);
    const session = store.session(token);
    const enabled = await github.policy();
    requireValue(isPolicy(enabled) && enabled.origin === origin, 'notEnabled', 403);
    requireValue(await github.verify({ pull: session.pull, comment: session.comment, token }) === session.author, 'unauthorized', 401);
    if (request.method === 'POST' && url.pathname === '/api/exchange/v1/a2a') return a2aTask(request, { session, store, github, now });
    if (request.method !== 'GET' && url.pathname !== '/api/exchange/v1/queue') collaboration.invalidate();
    const collaborationResult = await collaboration(request, session);
    if (collaborationResult) return collaborationResult;
    const match = url.pathname.match(/^\/api\/exchange\/v1\/pulls\/([1-9][0-9]{0,8})(.*)$/);
    requireValue(match && isNumber(Number(match[1])), 'notFound', 404);
    const pull = Number(match[1]);
    requireValue(session.pull === pull, 'unauthorized', 401);
    const policy = enabled;
    const current = await github.pull(pull);
    requireValue(isHead(current?.head) && isHead(current?.base) && ['open', 'closed'].includes(current.state), 'upstream', 502);
    const tail = match[2];
    if (request.method === 'GET' && tail === '') {
      const view = inboxView(store, session, pull, current, now());
      return reply(request.headers.get('x-atc-exchange-receipts') === '2' ? view : legacyInboxView(view));
    }
    const evidence = tail.match(/^\/evidence\/([a-f0-9]{32})(?:\/([a-f0-9]{40})\/(log|trace|report))?$/);
    if (request.method === 'GET' && evidence && !evidence[2]) {
      const found = store.download(session, pull, evidence[1]);
      return new Response(found.bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="evidence.bin"',
        'Content-Length': String(found.bytes.length), 'X-Content-SHA256': found.digest, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }
    requireValue(!readOnly, 'readOnly', 403);
    requireValue(current.state === 'open', 'closed', 409);
    if (request.method === 'PUT' && evidence?.[2]) {
      requireValue(request.headers.get('content-type') === 'application/octet-stream', 'invalid', 415);
      requireValue(evidence[2] === current.head || store.inbox(pull).some(x => x.head === evidence[2]), 'stale', 409);
      const bytes = await readWebBytes(request.body, maximumEvidence);
      return reply(store.upload(session, pull, evidence[1], evidence[2], evidence[3], bytes, policy.retentionHours));
    }
    if (request.method === 'POST' && tail === '/requests') {
      const input = await readWebJson(request);
      requireValue(isRequestInput(input)); requireValue(input.head === current.head, 'stale', 409);
      requireValue(input.base === undefined || input.base === current.base, 'stale', 409);
      return reply(store.request(session, pull, input));
    }
    const action = tail.match(/^\/requests\/([a-f0-9]{32})\/(results|resolve)$/);
    if (request.method === 'POST' && action) {
      const input = await readWebJson(request);
      requireValue(action[2] === 'results' ? isResultInput(input) : isResolutionInput(input));
      return reply(action[2] === 'results' ? store.respond(session, pull, action[1], input) : store.resolve(session, pull, action[1], input, current));
    }
    requireValue(false, 'notFound', 404);
  }
  return request => route(request).catch(errorResponse);
}
