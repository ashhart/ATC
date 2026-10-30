import { readWebBytes } from './webIo.js';
import { isRepository, requireValue, ExchangeError } from './values.js';

export function createGithubFetch({ repository, fetcher = fetch, token } = {}) {
  requireValue(isRepository(repository));
  requireValue(token === undefined || typeof token === 'string' && /^[A-Za-z0-9_]{20,255}$/.test(token));
  const base = `repos/${repository.toLowerCase()}`;
  async function read(route, optional = false) {
    requireValue(typeof route === 'string' && route.length <= 300 && !/[\r\n]/.test(route)
      && (route === base || route.startsWith(`${base}/`))
      && /^(?:repos\/[^/]+\/[^/]+)(?:|\/contents\/\.github\/atc(?:-exchange)?\.json|\/pulls\/[1-9][0-9]{0,8}|\/issues\/comments\/[1-9][0-9]{0,15}|\/collaborators\/[A-Za-z0-9-]{1,39}\/permission)$/.test(route));
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ATC-review-exchange' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetcher(`https://api.github.com/${route}`, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (optional && response.status === 404) { await response.body?.cancel(); return null; }
      requireValue(response.status === 200, 'upstream', 502);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readWebBytes(response.body, 2 * 1024 * 1024)));
    } catch { throw new ExchangeError('upstream', 502); }
  }
  return { get: route => read(route), getOptional: route => read(route, true) };
}
