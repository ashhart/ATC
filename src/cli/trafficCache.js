import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isNumber } from '../core/values.js';
import { isFilePath } from './reader.js';

const maxAgeMs = 1800000;
const maxBytes = 8 * 1024 * 1024;

export function writeTrafficCache(git, now, pulls) {
  const folder = cacheFolder(git);
  if (!folder || !Number.isSafeInteger(now)) return;
  const rows = pulls.slice(0, 300).filter(pull => isNumber(pull.number) && pull.files instanceof Set && pull.files.size <= 600)
    .map(pull => ({ number: pull.number, files: [...pull.files].filter(isFilePath).sort() }));
  const text = `${JSON.stringify({ version: 1, observedAt: now, pulls: rows })}\n`;
  if (Buffer.byteLength(text) > maxBytes) return;
  const file = path.join(folder, 'traffic.json');
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

export function readTrafficCache(git, now) {
  const folder = cacheFolder(git);
  if (!folder) return null;
  let value;
  try {
    const file = path.join(folder, 'traffic.json');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (value?.version !== 1 || !Number.isSafeInteger(value.observedAt) || value.observedAt > now || value.observedAt <= now - maxAgeMs) return null;
  if (!Array.isArray(value.pulls) || value.pulls.length > 300) return null;
  const pulls = new Map();
  for (const pull of value.pulls) {
    if (!isNumber(pull?.number) || pulls.has(pull.number) || !Array.isArray(pull.files) || pull.files.length > 600) return null;
    if (!pull.files.every(isFilePath)) return null;
    pulls.set(pull.number, new Set(pull.files));
  }
  return { observedAt: value.observedAt, pulls };
}

function cacheFolder(git) {
  if (typeof git?.commonDir !== 'function') return null;
  try { return path.join(git.commonDir(), 'atc'); } catch { return null; }
}
