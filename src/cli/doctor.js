import { spawnSync } from 'node:child_process';
import { readConfig } from '../core/config.js';
import { isLogin, isRepository } from '../core/values.js';
import { createGh } from './gh.js';
import { createGit, isRef } from './git.js';
import { createReader } from './reader.js';

const good = new Set(['ok', 'missing', 'notRequired']);

export function doctor({ gh, git, flags = {}, env = {}, cwd = process.cwd(), nodeVersion = process.versions.node, run = spawnSync } = {}) {
  const call = (binary, args) => {
    try {
      return run(binary, args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    } catch { return { status: 1 }; }
  };
  const checks = {
    node: supportsNode(nodeVersion) ? 'ok' : 'unsupported',
    git: available(call('git', ['--version'])) ? 'ok' : 'missing', clone: 'skipped',
    gh: available(call('gh', ['--version'])) ? 'ok' : 'missing', authentication: 'skipped',
    repository: 'skipped', remote: 'skipped', configuration: 'skipped'
  };
  if (checks.git === 'ok') {
    const clone = call('git', ['rev-parse', '--is-inside-work-tree']);
    checks.clone = available(clone) && /^true\r?\n?$/.test(clone.stdout) ? 'ok' : 'missing';
  }
  if (checks.gh === 'missing') return report(checks);
  const client = gh || createGh(args => call('gh', args));
  try {
    checks.authentication = isLogin(client.get('user')?.login) ? 'ok' : 'failed';
  } catch { checks.authentication = 'failed'; }
  if (checks.authentication !== 'ok') return report(checks);
  const repository = resolveRepository(client, flags, env);
  checks.repository = repository === null ? 'failed' : 'ok';
  if (repository === null) return report(checks);
  if (checks.clone === 'ok') {
    if (flags.base !== undefined) checks.remote = isRef(flags.base) ? 'notRequired' : 'failed';
    else {
      try {
        const remote = (git || createGit(args => call('git', args))).remoteFor(repository);
        checks.remote = remote === null ? 'missing' : isRef(remote) ? 'ok' : 'failed';
      } catch { checks.remote = 'failed'; }
    }
  }
  try {
    const config = createReader(client, repository).config();
    const checked = readConfig(config);
    checks.configuration = !checked.areasPinned ? 'unpinned' : config === null ? 'missing' : 'ok';
  } catch { checks.configuration = 'invalid'; }
  return report(checks);
}

function available(result) {
  return result?.status === 0;
}

function supportsNode(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(value) || /[\r\n]/.test(value)) return false;
  const [major, minor] = value.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

function resolveRepository(gh, flags, env) {
  const chosen = flags.repo === undefined ? env.ATC_REPO : flags.repo;
  if (chosen !== undefined) return isRepository(chosen) ? chosen : null;
  try {
    const view = gh.repoView();
    if (!view || typeof view.isFork !== 'boolean') return null;
    const repository = view.isFork && view.parent ? `${view.parent.owner?.login}/${view.parent.name}` : view.nameWithOwner;
    return isRepository(repository) ? repository : null;
  } catch { return null; }
}

function report(checks) {
  return { command: 'doctor', ready: checks.node === 'ok' && checks.git === 'ok' && checks.clone === 'ok'
    && checks.gh === 'ok' && checks.authentication === 'ok' && checks.repository === 'ok'
    && good.has(checks.remote) && good.has(checks.configuration), checks };
}
