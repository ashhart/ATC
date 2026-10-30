import { createExchangeSqlStore } from './sqlStore.js';
import { createExchangeGithub } from './github.js';
import { createGithubFetch } from './githubFetch.js';
import { createExchangeWebHandler } from './webHandler.js';
import { jsonResponse, errorResponse } from './webIo.js';
import { isOrigin, isRepository, requireValue } from './values.js';

export class ExchangeStore {
  constructor(ctx, env) {
    requireValue(isRepository(env.EXCHANGE_REPOSITORY) && isOrigin(env.EXCHANGE_ORIGIN));
    requireValue(env.ATC_READ_ONLY === undefined || ['0', '1'].includes(env.ATC_READ_ONLY));
    const repository = env.EXCHANGE_REPOSITORY.toLowerCase();
    const origin = env.EXCHANGE_ORIGIN;
    this.ctx = ctx;
    this.origin = origin;
    this.active = 0;
    this.store = createExchangeSqlStore({ storage: ctx.storage, repository, origin });
    const github = createExchangeGithub({ repository, origin,
      ghFactory: () => createGithubFetch({ repository, token: env.GITHUB_READ_TOKEN }) });
    this.handle = createExchangeWebHandler({ store: this.store, github, origin, readOnly: env.ATC_READ_ONLY === '1' });
  }

  async schedule() {
    const expiry = this.store.nextExpiry();
    if (expiry !== null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, expiry));
    else await this.ctx.storage.deleteAlarm();
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      requireValue(url.origin === this.origin && url.pathname.startsWith('/api/exchange/v1/') && !url.search, 'notFound', 404);
      requireValue(this.active < 8, 'capacity', 429);
      this.store.rateLimit();
      if (request.method === 'GET' && url.pathname === '/api/exchange/v1/health') {
        return jsonResponse({ version: 1, status: 'ready' });
      }
      this.active++;
      try {
        this.store.sweep();
        const response = await this.handle(request);
        await this.schedule();
        return response;
      } finally { this.active--; }
    } catch (error) { return errorResponse(error); }
  }

  async alarm() {
    this.store.sweep();
    await this.schedule();
  }
}

export default {
  async fetch(request, env) {
    try {
      requireValue(isRepository(env.EXCHANGE_REPOSITORY) && isOrigin(env.EXCHANGE_ORIGIN), 'unavailable', 503);
      const url = new URL(request.url);
      requireValue(url.origin === env.EXCHANGE_ORIGIN && url.pathname.startsWith('/api/exchange/v1/'), 'notFound', 404);
      const id = env.EXCHANGE_STORE.idFromName(`exchange-v1/${env.EXCHANGE_REPOSITORY.toLowerCase()}`);
      return await env.EXCHANGE_STORE.get(id).fetch(request);
    } catch (error) { return errorResponse(error); }
  }
};
