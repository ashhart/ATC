import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isRecord } from './hookValues.js';

export const cliPath = fileURLToPath(new URL('../cli/main.js', import.meta.url));
const outputLimit = 8 * 1024 * 1024;

export function createCliRunner({ spawn = spawnSync, node = process.execPath, main = cliPath, env = process.env } = {}) {
  return (args, { cwd, timeout }) => {
    let response;
    try {
      response = spawn(node, [main, ...args], { cwd, encoding: 'utf8', timeout, maxBuffer: outputLimit,
        stdio: ['ignore', 'pipe', 'ignore'], env: { ...env, ATC_READ_ONLY: '1', NO_COLOR: '1' } });
    } catch {
      return null;
    }
    if (!response || response.error || response.signal || response.status !== 0) return null;
    if (typeof response.stdout !== 'string' || response.stdout.length > outputLimit) return null;
    try {
      const parsed = JSON.parse(response.stdout);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
}
