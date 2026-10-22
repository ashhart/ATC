import { ensure } from '../core/failure.js';

export async function readPublicResource(url, { fetcher = fetch, maximum = 4 * 1024 * 1024, optional = false } = {}) {
  const response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ATC-public-viewer' },
    redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (optional && response.status === 404) { await response.body?.cancel(); return null; }
  ensure(response.ok && response.body, 'Public traffic unavailable.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      ensure(length <= maximum, 'Public traffic unavailable.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function readPublicPages(read, url, maximum) {
  const items = [];
  for (let page = 1; page <= maximum; page += 1) {
    const batch = JSON.parse(await read(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
    ensure(Array.isArray(batch) && batch.length <= 100, 'Public traffic unavailable.');
    items.push(...batch);
    if (batch.length < 100) return { items, partial: false };
  }
  return { items, partial: true };
}

export function readPublicDiff(text) {
  ensure(typeof text === 'string' && text.length <= 4 * 1024 * 1024, 'Public traffic unavailable.');
  const files = new Set();
  let headers = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    headers += 1;
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    ensure(match && match.slice(1).every(isPublicPath), 'Public traffic unavailable.');
    for (const name of match.slice(1)) files.add(name);
    ensure(files.size <= 600, 'Public traffic unavailable.');
  }
  ensure(headers > 0, 'Public traffic unavailable.');
  return files;
}

function isPublicPath(value) {
  return /^[A-Za-z0-9_. -][A-Za-z0-9_./ -]{0,4095}$/.test(value) && !value.startsWith('/')
    && !value.split('/').some(part => ['.', '..', ''].includes(part));
}
