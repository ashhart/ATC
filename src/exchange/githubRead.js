import { execFile } from 'node:child_process';
import { readHttpResponse } from '../cli/ghTransport.js';
import { ExchangeError, isRepository, requireValue } from './values.js';

export function createGithubRead() {
  async function read(route, optional = false) {
    const match = typeof route === 'string' && route.match(/^repos\/([^/]+\/[^/]+)(.*)$/);
    requireValue(match && isRepository(match[1]) && /^(?:|\/contents\/\.github\/atc(?:-exchange)?\.json|\/pulls\/[1-9][0-9]{0,8}|\/issues\/comments\/[1-9][0-9]{0,15}|\/collaborators\/[A-Za-z0-9-]{1,39}\/permission)$/.test(match[2])
      && !/[\r\n]/.test(route));
    const response = await new Promise(resolve => execFile('gh', ['api', '--include', '--method', 'GET', route],
      { timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' } },
      (error, stdout) => resolve({ error, stdout })));
    try {
      const parsed = readHttpResponse(response.stdout);
      if (optional && parsed.status === 404) return null;
      requireValue(!response.error && parsed.status === 200, 'upstream', 502);
      return JSON.parse(parsed.body);
    } catch { throw new ExchangeError('upstream', 502); }
  }
  return { get: route => read(route), getOptional: route => read(route, true) };
}
