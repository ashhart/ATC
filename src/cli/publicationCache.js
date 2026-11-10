import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { isCommit } from '../core/plans.js';
import { isNumber, isRepository } from '../core/values.js';
import { ticketLocation } from './workTicket.js';
import { inspectDirectory, readFile, createDirectory, createFile } from './safeFiles.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/[\r\n]/.test(value);
const policyVersion = 3;

export function publicationKey(repository, base, local, pull) {
  if (!isRepository(repository) || !isCommit(base) || !isCommit(local?.head) || !isCommit(local?.tree)
    || !isNumber(pull?.number) || !isCommit(pull.head) || !isCommit(pull.base)) return null;
  return hash(JSON.stringify([policyVersion, repository.toLowerCase(), base, local.head, local.tree, pull.number, pull.head, pull.base]));
}

export function createPublicationCache(git, repository, env = {}) {
  if (!isRepository(repository) || env.ATC_CACHE === '0') return null;
  let location;
  try { location = ticketLocation(git); } catch { return null; }
  const { folder } = location;
  const file = path.join(folder, path.basename(location.file).replace(/^work-/, 'publication-'));
  const repositoryHash = hash(repository.toLowerCase());
  return {
    read() {
      try {
        if (!inspectDirectory(folder)) return new Set();
        if (process.platform !== 'win32' && (fs.lstatSync(file).mode & 0o077) !== 0) return new Set();
        const value = JSON.parse(readFile(file, 24000));
        if (!value || Object.keys(value).length !== 3 || value.version !== policyVersion || value.repositoryHash !== repositoryHash
          || !Array.isArray(value.clean) || value.clean.length > 300 || !value.clean.every(isHash)
          || new Set(value.clean).size !== value.clean.length) return new Set();
        return new Set(value.clean);
      } catch { return new Set(); }
    },
    write(entries) {
      if (!(entries instanceof Set)) return;
      const clean = [...entries].slice(-300);
      if (!clean.every(isHash)) return;
      const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        createDirectory(folder, []);
        createFile(temporary, JSON.stringify({ version: policyVersion, repositoryHash, clean }), []);
        if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
        fs.renameSync(temporary, file);
      } catch {} finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
    }
  };
}
