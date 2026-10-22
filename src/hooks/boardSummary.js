import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBoardSummary } from './cliResults.js';
import { isAbsolutePath, isRecord } from './hookValues.js';

const refreshEveryMs = 10 * 60 * 1000;
const refreshRunningMs = 3 * 60 * 1000;
const fileLimit = 65536;

export function summaryPath(dataDir, root) {
  if (!isAbsolutePath(dataDir) || !isAbsolutePath(root)) return null;
  const key = createHash('sha256').update(root).digest('hex').slice(0, 32);
  return path.join(dataDir, 'board', `${key}.json`);
}

export function readSummary(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > fileLimit) return null;
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(stored) && stored.version === 1 ? readBoardSummary(stored.board) : null;
  } catch {
    return null;
  }
}

export function writeSummary(file, summary) {
  if (!isAbsolutePath(file) || !summary) return false;
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { observedAt, complete, ...counts } = summary;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, board: { observedAt, complete, summary: counts } })}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    return true;
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
    return false;
  }
}

export function refreshDue(file, now) {
  if (ageOf(`${file}.refreshing`, now) < refreshRunningMs) return false;
  return ageOf(file, now) >= refreshEveryMs;
}

export function markRefreshing(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.refreshing`, '', { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function refreshBoard([root, file], run) {
  if (!isAbsolutePath(root) || !isAbsolutePath(file)) return false;
  try {
    const summary = readBoardSummary(run(['board', '--json'], { cwd: root, timeout: 120000 }));
    return summary ? writeSummary(file, summary) : false;
  } finally {
    try { fs.unlinkSync(`${file}.refreshing`); } catch {}
  }
}

function ageOf(file, now) {
  try {
    return now - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
}
