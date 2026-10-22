import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Failure, ensure } from '../core/failure.js';
import { isRepository } from '../core/values.js';
import { collectBoardFeed } from './feed.js';
import { validatePublicResult } from '../cli/output.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../cli/main.js', import.meta.url));

export async function collectTraffic(repository, { signal, now = Date.now, run = execute } = {}) {
  ensure(isRepository(repository), 'Invalid repository.');
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', ATC_SIGNATURE: '', ATC_READ_ONLY: '1' };
  try {
    const response = await run(process.execPath, [cli, 'board', '--json', '--repo', repository], {
      encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env, signal
    });
    ensure(typeof response.stdout === 'string' && Buffer.byteLength(response.stdout) <= 2 * 1024 * 1024, 'Traffic unavailable.');
    return collectBoardFeed(validatePublicResult(JSON.parse(response.stdout)), now());
  } catch { throw new Failure('Traffic unavailable.'); }
}
