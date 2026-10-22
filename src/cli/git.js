import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Failure, ensure } from '../core/failure.js';
import { isRepository } from '../core/values.js';

const refPattern = /^(?!-)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

export function isRef(value) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && refPattern.test(value);
}

export function createGit(run = runGit) {
  function call(args, env) {
    const response = run(args, env);
    if (!response || response.status !== 0) throw new Failure('A git command failed. Run atc inside a clone of the repository, or pass --base.');
    ensure(typeof response.stdout === 'string', 'A git command returned unreadable output.');
    return response.stdout;
  }
  return {
    remoteFor(repository) {
      ensure(isRepository(repository), 'Invalid repository');
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
      ensure(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha), 'Could not find where your branch starts. Pass --base.');
      return sha;
    },
    changedFiles(base) {
      ensure(typeof base === 'string' && [40, 64].includes(base.length) && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(base), 'Invalid git base');
      const changed = call(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base]).split('\0');
      const added = call(['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
      return new Set([...changed, ...added].filter(Boolean));
    },
    commonDir() {
      const folder = call(['rev-parse', '--path-format=absolute', '--git-common-dir']).replace(/\r?\n$/, '');
      ensure(path.isAbsolute(folder) && /^[^\u0000-\u001f\u007f]{1,4096}$/.test(folder), 'Run atc inside a clone of the repository.');
      return folder;
    },
    run: call,
    exec: (args, env) => run(args, env)
  };
}

function runGit(args, env) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } });
}
