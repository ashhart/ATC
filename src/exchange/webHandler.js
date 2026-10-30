import { inboxView } from './inbox.js';
import { isExchangeOutput } from './output.js';
import { readWebBytes, readWebJson, jsonResponse, errorResponse } from './webIo.js';
import { isDigest, isHead, isNumber, isOrigin, isPolicy, isSessionInput, isRequestInput,
  isResultInput, isResolutionInput, maximumEvidence, requireValue } from './values.js';

export function createExchangeWebHandler({ store, github, origin, now = Date.now, readOnly = false }) {
  requireValue(isOrigin(origin) && typeof readOnly === 'boolean');
  function reply(value) { requireValue(isExchangeOutput(value), 'storage', 503); return jsonResponse(value); }
  async function route(request) {
    const url = new URL(request.url);
    requireValue(url.origin === origin && !url.search && !/[#%\s]/.test(url.pathname) && url.pathname.length <= 300);
    requireValue(!request.headers.has('origin') || request.headers.get('origin') === origin, 'forbidden', 403);
    requireValue(!request.headers.has('content-encoding'), 'invalid', 415);
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
    const bearer = request.headers.get('authorization');
    requireValue(bearer?.startsWith('Bearer ') && isDigest(bearer.slice(7)), 'unauthorized', 401);
    const token = bearer.slice(7);
    const session = store.session(token);
    const match = url.pathname.match(/^\/api\/exchange\/v1\/pulls\/([1-9][0-9]{0,8})(.*)$/);
    requireValue(match && isNumber(Number(match[1])), 'notFound', 404);
    const pull = Number(match[1]);
    requireValue(session.pull === pull, 'unauthorized', 401);
    const policy = await github.policy();
    requireValue(isPolicy(policy) && policy.origin === origin, 'notEnabled', 403);
    requireValue(await github.verify({ pull, comment: session.comment, token }) === session.author, 'unauthorized', 401);
    const current = await github.pull(pull);
    requireValue(isHead(current?.head) && ['open', 'closed'].includes(current.state), 'upstream', 502);
    const tail = match[2];
    if (request.method === 'GET' && tail === '') return reply(inboxView(store, session, pull, current, now()));
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
      return reply(store.request(session, pull, input));
    }
    const action = tail.match(/^\/requests\/([a-f0-9]{32})\/(results|resolve)$/);
    if (request.method === 'POST' && action) {
      const input = await readWebJson(request);
      requireValue(action[2] === 'results' ? isResultInput(input) : isResolutionInput(input));
      return reply(action[2] === 'results' ? store.respond(session, pull, action[1], input) : store.resolve(session, pull, action[1], input));
    }
    requireValue(false, 'notFound', 404);
  }
  return request => route(request).catch(errorResponse);
}
