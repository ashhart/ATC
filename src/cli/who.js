import fs from 'node:fs';
import path from 'node:path';
import { ensure } from '../core/failure.js';
import { createTrees } from './gitTrees.js';
import { isFilePath } from './reader.js';
import { readTrafficCache } from './trafficCache.js';

const rawPattern = /^[^\u0000-\u001f\u007f]{1,4096}$/;
const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function inspectWho({ git, now, cwd, labels }, rawPath) {
  ensure(typeof rawPath === 'string' && rawPattern.test(rawPath), 'Give a file path inside this clone.');
  const top = git.run(['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '');
  ensure(path.isAbsolute(top) && rawPattern.test(top), 'Run atc inside a clone of the repository.');
  const relative = path.relative(realFolder(top), realPath(path.resolve(cwd, rawPath))).split(path.sep).join('/');
  ensure(isFilePath(relative) && !relative.startsWith('../'), 'Give a file path inside this clone.');
  const time = now();
  const cache = readTrafficCache(git, time);
  const pullRequests = cache ? [...cache.pulls].filter(([, files]) => files.has(relative)).map(([number]) => number).sort((a, b) => a - b) : [];
  let worktrees = 0;
  for (const worktree of createTrees(git)?.worktrees() || []) {
    if (!worktreeChanges(git, worktree.path).has(relative)) continue;
    worktrees += 1;
    labels?.worktrees.set(worktrees, worktree.branch);
  }
  const limitations = cache ? [] : ['pullFilesUnavailable'];
  return { command: 'who', complete: limitations.length === 0, limitations, observedAt: cache ? new Date(cache.observedAt).toISOString() : null,
    pullRequests, worktrees };
}

function realFolder(folder) {
  try { return fs.realpathSync(folder); } catch { return folder; }
}

function realPath(file) {
  return path.join(realFolder(path.dirname(file)), path.basename(file));
}

function worktreeChanges(git, folder) {
  const files = new Set();
  try {
    const start = git.run(['-C', folder, 'merge-base', 'HEAD', git.run(['rev-parse', 'HEAD']).trim()]).trim();
    if (!shaPattern.test(start)) return files;
    const changed = git.run(['-C', folder, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', start]);
    const added = git.run(['-C', folder, 'ls-files', '--others', '--exclude-standard', '-z']);
    for (const file of [...changed.split('\0'), ...added.split('\0')]) if (isFilePath(file)) files.add(file);
  } catch {}
  return files;
}
