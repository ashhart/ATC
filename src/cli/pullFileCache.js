import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isNumber, isRepository } from '../core/values.js';
import { isFilePath } from './reader.js';

const maxBytes = 16 * 1024 * 1024;

export function createPullFileCache(repository, env = process.env) {
  if (!isRepository(repository) || env.ATC_CACHE === '0') return null;
  const base = typeof env.XDG_CACHE_HOME === 'string' && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
  const folder = path.join(base, 'atc-github');
  const file = path.join(folder, `${repository.toLowerCase().replace('/', '__')}.json`);
  return {
    read() {
      const entries = new Map();
      let value;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > maxBytes) return entries;
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return entries;
      }
      if (value?.version !== 1 || !Array.isArray(value.pulls) || value.pulls.length > 300) return entries;
      for (const pull of value.pulls) {
        if (!isNumber(pull?.number) || !Number.isSafeInteger(pull.updatedAt) || !Array.isArray(pull.files) || pull.files.length > 600
          || !pull.files.every(isFilePath) || entries.has(pull.number)) return new Map();
        entries.set(pull.number, { updatedAt: pull.updatedAt, files: pull.files });
      }
      return entries;
    },
    write(entries) {
      const pulls = [...entries].slice(0, 300).map(([number, entry]) => ({ number, updatedAt: entry.updatedAt, files: entry.files }));
      const text = `${JSON.stringify({ version: 1, pulls })}\n`;
      if (Buffer.byteLength(text) > maxBytes) return;
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        if (!fs.lstatSync(folder).isDirectory()) return;
        fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch {
        try { fs.unlinkSync(temporary); } catch {}
      }
    }
  };
}
