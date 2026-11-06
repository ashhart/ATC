import { isCollaborationOutput } from './collaborationOutput.js';
import { isCapability, isOfferInput, isLeaseInput, isConsumerInput, isHandoffInput, isDecisionInput, isQueueInput } from './collaborationSchema.js';
import { collaborationView, helpView, catchupSnapshot } from './collaborationView.js';
import { iso, isKey, requireValue } from './values.js';
import { readWebJson, jsonResponse } from './webIo.js';

export function createCollaborationRoutes({ store, github, now, readOnly }) {
  function reply(value) { requireValue(isCollaborationOutput(value), 'storage', 503); return jsonResponse(value); }
  const cache = new Map();
  async function queue(input, session) {
    const snapshot = store.collaborationData(), data = snapshot.collaboration;
    const selected = snapshot.requests.filter(x => data.offers.some(o => o.id === x.id && (o.public || x.pull === session?.pull)
      && (input.capability === null || input.capability === 'any' || o.capability === 'any' || o.capability === input.capability)))
      .filter(x => input.after === null || x.id > input.after).sort((a, b) => a.id.localeCompare(b.id));
    const current = new Map(), page = selected.slice(0, 50);
    const pulls = [...new Set(page.map(x => x.pull))];
    for (let offset = 0; offset < pulls.length; offset += 5) await Promise.all(pulls.slice(offset, offset + 5).map(async pull => {
      current.set(pull, await github.pull(pull));
    }));
    const items = page.map(request => helpView(store, request, current.get(request.pull), now(), snapshot));
    return reply({ type: 'collaboration', view: 'queue', version: 1, observedAt: iso(now()), items,
      next: selected.length > 50 ? items.at(-1).id : null });
  }
  async function route(request, session) {
    const path = new URL(request.url).pathname.replace('/api/exchange/v1', '');
    const publicPage = path.match(/^\/help(?:\/([a-z0-9]+))?(?:\/([a-f0-9]{32}))?$/);
    if (request.method === 'GET' && publicPage) {
      const legacyAfter = isKey(publicPage[1]) ? publicPage[1] : null;
      requireValue(!publicPage[1] || legacyAfter && !publicPage[2] || isCapability(publicPage[1]));
      const old = cache.get(path);
      if (old && now() - old.at < 15000) return (await old.response).clone();
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      const response = (async () => {
        requireValue(await github.publicRepository(), 'forbidden', 403);
        await github.policy();
        return queue({ after: publicPage[2] || legacyAfter || null, capability: legacyAfter ? null : publicPage[1] || null });
      })();
      cache.set(path, { at: now(), response });
      return (await response).clone();
    }
    if (!session) return null;
    if (request.method === 'POST' && path === '/queue') {
      const input = await readWebJson(request); requireValue(isQueueInput(input));
      return queue(input, session);
    }
    const match = path.match(/^\/pulls\/([1-9][0-9]{0,8})\/collaboration(?:\/(.*))?$/);
    if (!match) return null;
    requireValue(Number(match[1]) === session.pull, 'unauthorized', 401);
    const current = await github.pull(session.pull), tail = match[2] || '';
    if (request.method === 'GET' && tail === '') return reply(collaborationView(store, session, current, now()));
    if (request.method === 'GET' && tail === 'snapshot') {
      return reply(catchupSnapshot(store, session, current, await github.observation(session.pull), now()));
    }
    const packet = tail.match(/^handoffs\/([a-f0-9]{32})\/packet$/);
    if (request.method === 'GET' && packet) {
      const found = store.packet(session, packet[1]);
      return new Response(found.bytes, { headers: { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="handoff.bin"', 'X-Content-SHA256': found.digest,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }
    requireValue(!readOnly, 'readOnly', 403);
    requireValue(current.state === 'open', 'closed', 409);
    const action = tail.match(/^requests\/([a-f0-9]{32})\/(offer|take|release)$/);
    if (request.method === 'POST' && action) {
      const input = await readWebJson(request), id = action[1];
      if (action[2] === 'offer') {
        requireValue(isOfferInput(input));
        const wasRequired = store.collaboration().offers.find(x => x.id === id)?.required;
        requireValue(!input.required && !wasRequired || await github.mayRequire(session), 'forbidden', 403);
        requireValue(!input.public || await github.publicRepository(), 'forbidden', 403);
        return reply(store.offer(session, id, input));
      }
      if (action[2] === 'take') { requireValue(isLeaseInput(input)); return reply(store.take(session, id, input, current)); }
      requireValue(isConsumerInput(input)); return reply(store.releaseHelp(session, id, input.consumer));
    }
    if (request.method === 'POST' && tail === 'handoffs') {
      const input = await readWebJson(request); requireValue(isHandoffInput(input));
      requireValue(input.head === current.head && input.base === current.base, 'stale', 409);
      await github.participant(session.pull, input.recipient);
      return reply(store.handoff(session, input));
    }
    const decision = tail.match(/^handoffs\/([a-f0-9]{32})\/decision$/);
    if (request.method === 'POST' && decision) {
      const input = await readWebJson(request); requireValue(isDecisionInput(input));
      return reply(store.decideHandoff(session, decision[1], input, current));
    }
    requireValue(false, 'notFound', 404);
  }
  return Object.assign(route, { invalidate() { cache.clear(); } });
}
