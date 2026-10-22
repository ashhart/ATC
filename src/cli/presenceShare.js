import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../core/config.js';
import { isLogin } from '../core/values.js';
import { isRef } from './git.js';
import { createPresence } from './localPresence.js';
import { isFresh, maxSessions, readDocument, writeDocument } from './presenceDocs.js';

const originPattern = /^[0-9a-f]{16}$/;
const everyone = '*';
const peersRefspec = `+refs/atc/presence/${everyone}:refs/atc/peers/${everyone}`;

export function shareResult(result, { gh, git, now, repository }) {
  if (!['checkedIn', 'landed'].includes(result.outcome) || !gitSharingEnabled(git)) return result;
  try {
    const remote = git.remoteFor(repository());
    const login = gh.get('user')?.login;
    const sessions = createPresence(git, now).list();
    return { ...result, sharing: sharePresence({ git, login: typeof login === 'string' ? login.toLowerCase() : null, remote, now, sessions }) };
  } catch {
    return { ...result, sharing: 'unavailable' };
  }
}

export function sharePresence({ git, login, remote, now, sessions }) {
  if (!isLogin(login) || !isRef(remote)) return 'unavailable';
  const origin = presenceOrigin(git);
  const target = `refs/atc/presence/${login}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!fetchPeers(git, remote)) return 'unavailable';
    const current = readDocument(git, `refs/atc/peers/${login}`, { shared: true });
    const time = now();
    const others = (current?.sessions || []).filter(entry => entry.origin !== origin && isFresh(entry, time));
    const merged = [...others, ...sessions.map(entry => ({ ...entry, origin }))].slice(0, maxSessions);
    if (!current && merged.length === 0) return 'git';
    const next = merged.length ? writeDocument(git, merged) : null;
    if (merged.length && !next) return 'unavailable';
    const pushed = git.exec(['push', '--porcelain', '--no-verify', `--force-with-lease=${target}:${current?.sha || ''}`, remote,
      next ? `${next}:${target}` : `:${target}`]);
    if (pushed?.status === 0) return 'git';
    if (!/\[rejected\]/.test(pushed?.stdout || '')) return 'unavailable';
  }
  return 'unavailable';
}

export function fetchPeers(git, remote) {
  if (!isRef(remote)) return false;
  return git.exec(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--prune', remote, peersRefspec])?.status === 0;
}

export function presenceOrigin(git) {
  const folder = path.join(git.commonDir(), 'atc');
  const file = path.join(folder, 'origin');
  const read = () => {
    try { const value = fs.readFileSync(file, 'utf8').trim(); return originPattern.test(value) ? value : null; } catch { return null; }
  };
  const existing = read();
  if (existing) return existing;
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(file, `${randomBytes(8).toString('hex')}\n`, { flag: 'wx', mode: 0o600 }); } catch {}
  return read();
}

function gitSharingEnabled(git) {
  if (typeof git?.exec !== 'function') return false;
  const shown = git.exec(['cat-file', '-p', 'HEAD:.github/atc.json']);
  if (shown?.status !== 0 || typeof shown.stdout !== 'string' || shown.stdout.length > 65536) return false;
  try { return readConfig(JSON.parse(shown.stdout)).presence === 'git'; } catch { return false; }
}
