import { spawnSync } from 'node:child_process';
import { Failure } from '../core/failure.js';

export function createGh(run = runGh) {
  function call(args) {
    const response = run(args);
    if (!response || response.status !== 0) throw new Failure('The GitHub CLI request failed. Check `gh auth status` and the repository name.');
    try {
      return response.stdout.trim() ? JSON.parse(response.stdout) : null;
    } catch {
      throw new Failure('The GitHub CLI returned unreadable output.');
    }
  }
  return {
    get: path => call(['api', '--method', 'GET', path]),
    post: (path, fields) => call(['api', '--method', 'POST', path, ...Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`])]),
    repoView: () => call(['repo', 'view', '--json', 'nameWithOwner,isFork,parent'])
  };
}

function runGh(args) {
  return spawnSync('gh', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
}
