import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { isNumber, isRecord, isRepository } from '../core/values.js';
import { isFilePath } from './reader.js';

const maximum = 16 * 1024 * 1024;
const headPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const isPullHead = value => typeof value === 'string' && !/[\r\n]/.test(value) && headPattern.test(value);
export const pullCacheKey = pull => `${pull.number}:${pull.head}:${pull.base}`;

export function createScopedPullCache(repository, env = process.env) {
  if (!isRepository(repository) || env.ATC_CACHE === '0') return null;
  const base = env.XDG_CACHE_HOME === undefined ? path.join(os.homedir(), '.cache') : env.XDG_CACHE_HOME;
  if (typeof base !== 'string' || !path.isAbsolute(base) || !safePath(base)) return null;
  const folder = path.join(base, 'atc-github');
  const scope = createHash('sha256').update(repository.toLowerCase()).digest('hex');
  const file = path.join(folder, `head-files-${scope}.json`);
  return {
    read() {
      try {
        if (!safeDirectories(folder)) return new Map();
        const value = JSON.parse(readBounded(file));
        if (!isRecord(value) || Object.keys(value).length !== 3 || value.version !== 1 || value.repositoryHash !== scope
          || !Array.isArray(value.pulls) || value.pulls.length > 1000) return new Map();
        const result = new Map();
        for (const item of value.pulls) {
          if (!validEntry(item) || result.has(pullCacheKey(item))) return new Map();
          result.set(pullCacheKey(item), { ...item, files: [...item.files] });
        }
        return result;
      } catch { return new Map(); }
    },
    write(entries) {
      const bytes = boundedDocument(entries, scope);
      if (!bytes) return;
      const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        if (!safeDirectories(folder)) return;
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        if (!safeDirectories(folder)) return;
        fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch {
        try { fs.unlinkSync(temporary); } catch {}
      }
    }
  };
}

function boundedDocument(entries, scope) {
  const pulls = [...entries.values()].slice(-1000);
  if (!pulls.every(validEntry) || new Set(pulls.map(pullCacheKey)).size !== pulls.length) return null;
  const prefix = `${JSON.stringify({ version: 1, repositoryHash: scope }).slice(0, -1)},"pulls":[`;
  const pieces = [];
  let size = Buffer.byteLength(prefix) + 2;
  for (let index = pulls.length - 1; index >= 0; index--) {
    const text = JSON.stringify(pulls[index]);
    const added = Buffer.byteLength(text) + (pieces.length ? 1 : 0);
    if (size + added > maximum) break;
    size += added;
    pieces.push(text);
  }
  return Buffer.from(`${prefix}${pieces.reverse().join(',')}]}`);
}

function validEntry(value) {
  return isRecord(value) && Object.keys(value).length === 5 && isNumber(value.number) && isPullHead(value.head)
    && isPullHead(value.base) && Number.isSafeInteger(value.changedFiles) && value.changedFiles >= 0 && value.changedFiles <= 300
    && Array.isArray(value.files) && value.files.length <= 600 && value.files.every(isFilePath)
    && new Set(value.files).size === value.files.length && value.files.length >= value.changedFiles
    && value.files.length <= value.changedFiles * 2;
}

function safePath(value) {
  return value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)
    && !value.split(path.sep).some(part => ['.', '..'].includes(part));
}

function safeDirectories(folder) {
  if (!safePath(folder)) return false;
  let current = path.parse(folder).root;
  for (const part of folder.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch (error) { if (error.code !== 'ENOENT') return false; }
  }
  return true;
}

function readBounded(file) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximum)) throw new Error();
  if (process.platform !== 'win32' && (before.mode & 0o077n) !== 0n) throw new Error();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const after = fs.fstatSync(fd, { bigint: true });
    const sameDevice = before.dev === after.dev || process.platform === 'win32' && before.dev === 0n;
    if (!after.isFile() || after.nlink !== 1n || after.ino !== before.ino || !sameDevice || after.size !== before.size) throw new Error();
    const bytes = Buffer.alloc(Number(after.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== Number(after.size)) throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { fs.closeSync(fd); }
}
