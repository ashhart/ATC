import { ExchangeError, requireValue } from './values.js';

export const errorCodes = ['invalid', 'notEnabled', 'upstream', 'unauthorized', 'forbidden', 'notFound', 'conflict',
  'evidenceUnavailable', 'capacity', 'storage', 'closed', 'stale', 'unavailable', 'readOnly', 'rateLimited'];

export async function readBody(request, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    requireValue(size <= maximum, 'invalid', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request) {
  requireValue(request.headers['content-type'] === 'application/json', 'invalid', 415);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4096))); }
  catch (error) { if (error instanceof ExchangeError) throw error; throw new ExchangeError('invalid'); }
}

export function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  response.end(JSON.stringify(value));
}

export function sendError(response, error) {
  const safe = error instanceof ExchangeError && errorCodes.includes(error.code);
  if (!response.headersSent) sendJson(response, safe ? error.status : 503, { error: safe ? error.code : 'unavailable' });
  else response.destroy();
}
