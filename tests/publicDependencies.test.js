import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the public board module graph stays usable without Node built-ins or installed dependencies', async () => {
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), `Public board dependency must be relative: ${match[1]}`);
      await visit(new URL(match[1], url));
    }
  }
  await visit(new URL('../src/public/board.js', import.meta.url));
});
