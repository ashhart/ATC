import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensure } from '../core/failure.js';
import { isNumber, isId, isRepository, readTimestamp } from '../core/values.js';
import { isCommit, isPlanHash, isPlanSession, planTtlMs } from '../core/plans.js';
import { readFile, createDirectory, createFile, inspectDirectory } from './safeFiles.js';
import { canonicalFolder } from './localPaths.js';
import { isRef } from './git.js';

const failure = 'Invalid ATC work ticket.';
const cleanPath = value => typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);

export function ticketLocation(git) {
  const shown = git.exec(['rev-parse', '--path-format=absolute', '--show-toplevel']);
  ensure(shown?.status === 0 && typeof shown.stdout === 'string', failure);
  const root = shown.stdout.replace(/\r?\n$/, '');
  const common = git.commonDir();
  ensure(cleanPath(root) && cleanPath(common), failure);
  const key = createHash('sha256').update(canonicalFolder(root)).digest('hex');
  return { root: canonicalFolder(root), folder: path.join(common, 'atc'), file: path.join(common, 'atc', `work-${key}.json`) };
}

export function readWorkTicket(git) {
  const { file, folder } = ticketLocation(git);
  if (!inspectDirectory(folder)) return null;
  const text = readFile(file, 8192);
  if (text === null) return null;
  let value;
  try { value = JSON.parse(text); } catch { ensure(false, failure); }
  ensure(validTicket(value), failure);
  return value;
}

export function writeWorkTicket(git, value) {
  ensure(validTicket(value), failure);
  const { file, folder } = ticketLocation(git);
  createDirectory(folder, []);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    createFile(temporary, `${JSON.stringify(value)}\n`, []);
    if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
    if (fs.existsSync(file)) readWorkTicket(git);
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function workTicketStatus(cwd) {
  try {
    if (!cleanPath(cwd)) return 'unknown';
    const run = args => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
    const git = { exec: run, commonDir() {
      const out = run(['rev-parse', '--path-format=absolute', '--git-common-dir']);
      ensure(out.status === 0 && typeof out.stdout === 'string', failure);
      return out.stdout.replace(/\r?\n$/, '');
    } };
    return readWorkTicket(git) === null ? 'absent' : 'present';
  } catch { return 'unknown'; }
}

function validTicket(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 10
    && value.version === 1 && isRepository(value.repository) && isNumber(value.issue) && isPlanSession(value.session)
    && isId(value.plan) && isCommit(value.base) && Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 32
    && value.files.every(isPlanHash) && new Set(value.files).size === value.files.length
    && (value.ref === null || isRef(value.ref)) && readTimestamp(value.observedAt) !== null && readTimestamp(value.expiresAt) !== null
    && readTimestamp(value.expiresAt) > readTimestamp(value.observedAt)
    && readTimestamp(value.expiresAt) - readTimestamp(value.observedAt) <= planTtlMs;
}
