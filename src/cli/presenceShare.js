import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../core/config.js';
import { isRef } from './git.js';
import { createPresence } from './localPresence.js';
import { hashPath, readDocument, repositorySalt, writeDocument } from './presenceDocs.js';

export const originPattern = /^[0-9a-f]{16}$/;
const everyone = '*';
const peersRefspec = `+refs/atc/presence/${everyone}:refs/atc/peers/${everyone}`;

export function shareResult(result, { git, now, repository }) {
  if (!['checkedIn', 'landed'].includes(result.outcome) || !gitSharingEnabled(git)) return result;
  try {
    const presence = createPresence(git, now);
    return { ...result, sharing: sharePresence({ git, remote: git.remoteFor(repository()), list: () => presence.list() }) };
  } catch {
    return { ...result, sharing: 'unavailable' };
  }
}

export function sharePresence({ git, remote, list }) {
  const origin = presenceOrigin(git);
  const salt = repositorySalt(git);
  if (!origin || !salt || !isRef(remote)) return 'unavailable';
  const target = `refs/atc/presence/${origin}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!fetchPeers(git, remote)) return 'unavailable';
    const current = readDocument(git, `refs/atc/peers/${origin}`, { shared: true });
    const sessions = list().map(entry => ({ session: entry.session, issue: entry.issue, state: entry.state, active: entry.active,
      fileHashes: [...new Set(entry.files.map(file => hashPath(salt, file)))] }));
    if (!current && sessions.length === 0) return 'git';
    const next = sessions.length ? writeDocument(git, sessions, { shared: true }) : null;
    if (sessions.length && !next) return 'unavailable';
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
