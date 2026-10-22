import { maxFiles } from './presenceDocs.js';
import { isFilePath } from './reader.js';

const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function sessionFiles(git) {
  if (typeof git?.exec !== 'function') return [];
  const base = ['@{upstream}', 'refs/remotes/origin/HEAD'].map(ref => mergeBase(git, ref)).find(Boolean) || 'HEAD';
  const changed = git.exec(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base]);
  const added = git.exec(['ls-files', '--others', '--exclude-standard', '-z']);
  if (changed?.status !== 0 || added?.status !== 0) return [];
  const files = new Set([...changed.stdout.split('\0'), ...added.stdout.split('\0')].filter(isFilePath));
  return [...files].sort().slice(0, maxFiles);
}

function mergeBase(git, ref) {
  const result = git.exec(['merge-base', 'HEAD', ref]);
  const sha = result?.status === 0 ? result.stdout.trim() : '';
  return shaPattern.test(sha) ? sha : null;
}
