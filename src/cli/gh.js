import { spawnSync } from 'node:child_process';
import { Failure } from '../core/failure.js';

const failed = 'The GitHub CLI request failed. Check `gh auth status` and the repository name.';

export function createGh(run = runGh) {
  function call(args) {
    const response = run(args);
    if (!response || response.status !== 0) throw new Failure(failed);
    return parse(response.stdout);
  }
  function getOptional(path) {
    const response = run(['api', '--include', '--method', 'GET', path]);
    const text = typeof response?.stdout === 'string' ? response.stdout : '';
    const status = Number(text.match(/^HTTP\/[0-9.]+ ([0-9]{3})/)?.[1]);
    if (status === 404) return null;
    if (response?.status !== 0 || !(status >= 200 && status < 300)) throw new Failure(failed);
    const start = text.search(/\r?\n\r?\n/);
    return parse(start >= 0 ? text.slice(start) : '');
  }
  return {
    get: path => call(['api', '--method', 'GET', path]),
    getOptional,
    post: (path, fields) => call(['api', '--method', 'POST', path, ...Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`])]),
    repoView: () => call(['repo', 'view', '--json', 'nameWithOwner,isFork,parent'])
  };
}

function parse(text) {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new Failure('The GitHub CLI returned unreadable output.');
  }
}

function runGh(args) {
  return spawnSync('gh', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
}
