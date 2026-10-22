import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isAbsolutePath } from './hookValues.js';

const githubRemote = /(?:^|\s)(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/m;

export function readGitContext(cwd, runGit = runGitCommand) {
  if (!isAbsolutePath(cwd)) return null;
  const top = runGit(['-C', cwd, 'rev-parse', '--show-toplevel']);
  if (typeof top !== 'string') return null;
  const root = top.replace(/\r?\n$/, '');
  if (!isAbsolutePath(root)) return null;
  const remotes = runGit(['-C', root, 'remote', '-v']);
  return { root, github: typeof remotes === 'string' && githubRemote.test(remotes), configured: isRegularFile(path.join(root, '.github', 'atc.json')) };
}

function runGitCommand(args) {
  try {
    const result = spawnSync('git', args, { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    return result.status === 0 && typeof result.stdout === 'string' ? result.stdout : null;
  } catch {
    return null;
  }
}

function isRegularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
