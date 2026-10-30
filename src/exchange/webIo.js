import { ExchangeError, requireValue } from './values.js';

export const webErrors = ['invalid', 'notEnabled', 'upstream', 'unauthorized', 'forbidden', 'notFound', 'conflict',
  'evidenceUnavailable', 'capacity', 'storage', 'closed', 'stale', 'unavailable', 'readOnly'];

export async function readWebBytes(body, maximum) {
  requireValue(body);
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      requireValue(size <= maximum, 'invalid', 413);
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

export async function readWebJson(request) {
  requireValue(request.headers.get('content-type') === 'application/json', 'invalid', 415);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readWebBytes(request.body, 4096))); }
  catch (error) { if (error instanceof ExchangeError) throw error; throw new ExchangeError('invalid'); }
}

export function jsonResponse(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
}

export function errorResponse(error) {
  const known = error instanceof ExchangeError && webErrors.includes(error.code);
  return jsonResponse({ error: known ? error.code : 'unavailable' }, known ? error.status : 503);
}
