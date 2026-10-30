import { ExchangeError, digest, isDigest, isOrigin, maximumEvidence, requireValue } from './values.js';
import { isExchangeOutput } from './output.js';
import { errorCodes } from './httpIo.js';

export function createExchangeTransport(origin, { fetcher = fetch } = {}) {
  requireValue(isOrigin(origin));
  return async function request(method, route, { token, value, bytes, download = false } = {}) {
    requireValue(['GET', 'POST', 'PUT'].includes(method) && /^\/[a-z0-9/-]{1,250}$/.test(route)
      && !/[\r\n]/.test(route) && (token === undefined || isDigest(token)));
    const headers = { Accept: download ? 'application/octet-stream' : 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (bytes) headers['Content-Type'] = 'application/octet-stream';
    if (value) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetcher(`${origin}/api/exchange/v1${route}`, { method, headers, redirect: 'error',
        signal: AbortSignal.timeout(30000), body: bytes || (value ? JSON.stringify(value) : undefined) });
      const reader = response.body?.getReader();
      requireValue(reader, 'unavailable', 503);
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          requireValue(size <= (response.ok && download ? maximumEvidence : 16 * 1024 * 1024), 'unavailable', 503);
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = Buffer.concat(chunks);
      if (response.ok && download) {
        const hash = response.headers.get('x-content-sha256');
        requireValue(response.headers.get('content-type') === 'application/octet-stream'
          && data.length > 0 && isDigest(hash) && digest(data) === hash, 'unavailable', 503);
        return { bytes: data, digest: hash };
      }
      requireValue(response.headers.get('content-type')?.split(';')[0] === 'application/json', 'unavailable', 503);
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
      if (!response.ok) throw new ExchangeError(errorCodes.includes(parsed?.error) ? parsed.error : 'unavailable', response.status);
      requireValue(isExchangeOutput(parsed), 'unavailable', 503);
      return parsed;
    } catch (error) {
      if (error instanceof ExchangeError) throw error;
      throw new ExchangeError('unavailable', 503);
    }
  };
}
