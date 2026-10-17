import { spawnSync } from 'node:child_process';
import { Failure, ensure } from '../core/failure.js';

const refPattern = /^(?!-)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

export function isRef(value) {
  return typeof value === 'string' && refPattern.test(value);
}

export function createGit(run = runGit) {
  function call(args) {
    const response = run(args);
    if (!response || response.status !== 0) throw new Failure('A git command failed. Run atc inside a clone of the repository, or pass --base.');
    return response.stdout;
  }
  return {
    remoteFor(repository) {
      const wanted = repository.toLowerCase();
      for (const line of call(['remote', '-v']).split('\n')) {
        const [name, url] = line.split(/\s+/);
        const match = (url || '').toLowerCase().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?\/?$/);
        if (match && match[1] === wanted && isRef(name)) return name;
      }
      return null;
    },
    mergeBase(ref) {
      ensure(isRef(ref), '--base must be a branch or ref name');
      const sha = call(['merge-base', 'HEAD', ref]).trim();
      ensure(/^[0-9a-f]{40,64}$/.test(sha), 'Could not find where your branch starts. Pass --base.');
      return sha;
    },
    changedFiles(base) {
      const changed = call(['diff', '--name-only', '-z', base]).split('\0');
      const added = call(['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
      return new Set([...changed, ...added].filter(Boolean));
    }
  };
}

function runGit(args) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
}
