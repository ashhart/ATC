import { createHash } from 'node:crypto';
import { presenceTtlMs } from '../core/presence.js';
import { isFilePath } from './reader.js';

export const maxSessions = 50;
export const maxFiles = 300;
const maxBytes = 262144;
const clockSkewMs = 60000;
const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const hashPattern = /^[0-9a-f]{32}$/;
const states = ['working', 'reviewing', 'blocked'];
const identity = { GIT_AUTHOR_NAME: 'atc', GIT_AUTHOR_EMAIL: 'atc@localhost', GIT_COMMITTER_NAME: 'atc', GIT_COMMITTER_EMAIL: 'atc@localhost',
  GIT_AUTHOR_DATE: '1970-01-01T00:00:00Z', GIT_COMMITTER_DATE: '1970-01-01T00:00:00Z' };

export function isFresh(entry, time) {
  return entry.active <= time + clockSkewMs && entry.active > time - presenceTtlMs;
}

export function repositorySalt(git) {
  const roots = git.exec(['rev-list', '--max-parents=0', 'HEAD']);
  const first = roots?.status === 0 ? roots.stdout.split('\n').filter(line => shaPattern.test(line)).sort()[0] : null;
  return first || null;
}

export function hashPath(salt, file) {
  return createHash('sha256').update(`atc-presence\0${salt}\0${file}`).digest('hex').slice(0, 32);
}

export function readDocument(git, ref, { shared = false } = {}) {
  const sha = output(git, ['rev-parse', '-q', '--verify', `${ref}^{commit}`])?.trim();
  if (!sha || !shaPattern.test(sha)) return null;
  const size = output(git, ['cat-file', '-s', `${sha}:presence.json`])?.trim();
  if (!/^[0-9]{1,7}$/.test(size || '') || Number(size) > maxBytes) return { sha, sessions: [] };
  return { sha, sessions: parseSessions(output(git, ['cat-file', 'blob', `${sha}:presence.json`]), shared) };
}

export function writeDocument(git, sessions, { shared = false } = {}) {
  const text = `${JSON.stringify({ version: shared ? 3 : 2, sessions: sessions.slice(0, maxSessions) })}\n`;
  const blob = hash(git, ['hash-object', '-w', '--stdin'], text);
  const tree = blob && hash(git, ['mktree'], `100644 blob ${blob}\tpresence.json\n`);
  return tree ? hash(git, ['commit-tree', tree, '-m', 'atc presence'], undefined, identity) : null;
}

export function updateRef(git, ref, next, expected) {
  const args = next ? ['update-ref', ref, next, expected || '0'.repeat(next.length)] : ['update-ref', '-d', ref, expected];
  return git.exec(args)?.status === 0;
}

function parseSessions(text, shared) {
  let value;
  try { value = JSON.parse(text); } catch { return []; }
  if (value?.version !== (shared ? 3 : 2) || !Array.isArray(value.sessions) || value.sessions.length > maxSessions) return [];
  const list = shared ? 'fileHashes' : 'files';
  const seen = new Set();
  return value.sessions.filter(entry => valid(entry, list) && !seen.has(entry.session) && seen.add(entry.session))
    .map(entry => ({ session: entry.session, issue: entry.issue, state: entry.state, active: entry.active, [list]: [...entry[list]] }));
}

function valid(entry, list) {
  const check = list === 'files' ? isFilePath : value => typeof value === 'string' && hashPattern.test(value);
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length === 5
    && Number.isSafeInteger(entry.session) && entry.session >= 1 && entry.session <= 999999999999999
    && Number.isSafeInteger(entry.issue) && entry.issue >= 1 && entry.issue <= 999999999
    && states.includes(entry.state) && Number.isSafeInteger(entry.active) && entry.active > 0
    && Array.isArray(entry[list]) && entry[list].length <= maxFiles && entry[list].every(check) && new Set(entry[list]).size === entry[list].length;
}

function output(git, args, input, env) {
  const result = git.exec(args, env, input);
  return result?.status === 0 && typeof result.stdout === 'string' ? result.stdout : null;
}

function hash(git, args, input, env) {
  const value = output(git, args, input, env)?.trim();
  return value && shaPattern.test(value) ? value : null;
}
