import { createHash } from 'node:crypto';
import { ensure } from '../core/failure.js';
import { isCommit } from '../core/plans.js';
import { isRef } from './git.js';

export function workBase(context, ref = null, { fetchMissing = false } = {}) {
  if (ref !== null) {
    ensure(isRef(ref), 'Invalid work comparison base.');
    const shown = context.git.exec(['rev-parse', '--verify', `${ref}^{commit}`]);
    const sha = shown?.status === 0 && typeof shown.stdout === 'string' ? shown.stdout.trim() : null;
    ensure(isCommit(sha), 'Could not inspect the work comparison base.');
    return sha;
  }
  const branch = context.reader.defaultBranch();
  ensure(isRef(branch), 'Could not inspect the repository base.');
  const value = context.gh.get(`repos/${context.repository}/commits/${encodeURIComponent(branch)}`);
  ensure(isCommit(value?.sha), 'Could not inspect the repository base.');
  if (fetchMissing && context.git.exec(['cat-file', '-e', `${value.sha}^{commit}`])?.status !== 0) {
    const remote = context.git.remoteFor(context.repository);
    ensure(isRef(remote), 'No repository remote is available for the work base.');
    const key = createHash('sha256').update(context.repository.toLowerCase()).digest('hex').slice(0, 16);
    const target = `refs/atc/base/${key}`;
    ensure(context.git.exec(['fetch', '--no-tags', '--no-write-fetch-head', remote, `${branch}:${target}`])?.status === 0,
      'Could not fetch the repository base.');
    ensure(context.git.exec(['cat-file', '-e', `${value.sha}^{commit}`])?.status === 0, 'The repository base changed during inspection.');
  }
  return value.sha;
}
