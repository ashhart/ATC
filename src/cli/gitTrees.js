import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNumber } from '../core/values.js';
import { isRef } from './git.js';
import { isFilePath } from './reader.js';

const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const pathPattern = /^[^\u0000-\u001f\u007f]{1,4096}$/;
const identity = { GIT_AUTHOR_NAME: 'atc', GIT_AUTHOR_EMAIL: 'atc@localhost', GIT_COMMITTER_NAME: 'atc', GIT_COMMITTER_EMAIL: 'atc@localhost' };

export function createTrees(git) {
  if (typeof git?.exec !== 'function') return null;
  function run(args, env) {
    const response = git.exec(args, env);
    if (!response || response.status !== 0 || typeof response.stdout !== 'string') return null;
    return response.stdout;
  }
  function sha(args, env) {
    const value = run(args, env)?.trim();
    return value && shaPattern.test(value) ? value : null;
  }
  function names(text) {
    if (typeof text !== 'string') return null;
    const files = text.split('\0').filter(Boolean);
    return files.every(isFilePath) ? new Set(files) : null;
  }

  return {
    snapshot(worktree) {
      const prefix = worktree ? ['-C', worktree] : [];
      const head = sha([...prefix, 'rev-parse', '--verify', 'HEAD^{commit}']);
      if (!head) return null;
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-index-'));
      const env = { GIT_INDEX_FILE: path.join(folder, 'index') };
      try {
        const current = run([...prefix, 'rev-parse', '--path-format=absolute', '--git-path', 'index'])?.replace(/\r?\n$/, '');
        if (current && path.isAbsolute(current) && pathPattern.test(current) && fs.existsSync(current)) fs.copyFileSync(current, env.GIT_INDEX_FILE);
        else if (run([...prefix, 'read-tree', head], env) === null) return null;
        if (run([...prefix, 'add', '-A', '--', ':/'], env) === null) return null;
        const tree = sha([...prefix, 'write-tree'], env);
        const commit = tree && sha([...prefix, 'commit-tree', tree, '-p', head, '-m', 'atc snapshot'], { ...env, ...identity });
        return commit ? { head, commit } : null;
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
    changedSince(base, commit, worktree) {
      const prefix = worktree ? ['-C', worktree] : [];
      if (!isRef(base) || !shaPattern.test(commit)) return null;
      const start = sha([...prefix, 'merge-base', commit, base]);
      return start && names(run([...prefix, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', start, commit]));
    },
    fetchPull(remote, number) {
      if (!isRef(remote) || !isNumber(number)) return null;
      const ref = `refs/atc/${randomBytes(8).toString('hex')}/pull/${number}`;
      if (run(['fetch', '--no-tags', '--quiet', '--no-write-fetch-head', remote, `+refs/pull/${number}/head:${ref}`]) === null) return null;
      const value = sha(['rev-parse', '--verify', `${ref}^{commit}`]);
      run(['update-ref', '-d', ref]);
      return value;
    },
    mergeConflicts(first, second) {
      if (!shaPattern.test(first) || !shaPattern.test(second)) return { conflict: 'unknown', files: null };
      const response = git.exec(['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', first, second]);
      if (response?.status === 0) return { conflict: 'clean', files: new Set() };
      if (response?.status !== 1 || typeof response.stdout !== 'string') return { conflict: 'unknown', files: null };
      const parts = response.stdout.split('\0');
      const files = shaPattern.test(parts[0]) ? names(parts.slice(1).join('\0')) : null;
      return files && files.size > 0 ? { conflict: 'conflicts', files } : { conflict: 'unknown', files: null };
    },
    worktrees() {
      const top = run(['rev-parse', '--show-toplevel'])?.replace(/\r?\n$/, '');
      const text = run(['worktree', 'list', '--porcelain', '-z']);
      if (!top || text === null) return [];
      const found = [];
      let entry = null;
      for (const field of text.split('\0')) {
        if (field.startsWith('worktree ')) entry = { path: field.slice(9), branch: null, usable: true };
        else if (!entry) continue;
        else if (field.startsWith('branch refs/heads/')) entry.branch = field.slice(18);
        else if (field === 'bare' || field.startsWith('prunable')) entry.usable = false;
        else if (field === '') {
          if (entry.usable && entry.path !== top && path.isAbsolute(entry.path) && pathPattern.test(entry.path)
            && (entry.branch === null || isRef(entry.branch))) found.push({ path: entry.path, branch: entry.branch });
          entry = null;
        }
      }
      return found.slice(0, 20);
    }
  };
}
