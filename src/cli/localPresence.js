import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Failure, ensure } from '../core/failure.js';
import { maxFlightsPerClaim, presenceTtlMs } from '../core/presence.js';

const failed = 'Could not update local agent presence.';
const states = ['working', 'reviewing', 'blocked'];
const pause = new Int32Array(new SharedArrayBuffer(4));

export function createPresence(commonDir, now) {
  ensure(typeof commonDir === 'string' && path.isAbsolute(commonDir), failed);
  const folder = path.join(commonDir, 'atc');
  const file = path.join(folder, 'presence.json');
  const lock = path.join(folder, 'presence.lock');

  function list() {
    const time = now();
    return readSessions(file).filter(entry => entry.active <= time && entry.active > time - presenceTtlMs)
      .sort((first, second) => first.session - second.session);
  }

  function update(change) {
    prepareFolder(folder);
    acquire(lock, now);
    try {
      const time = now();
      const sessions = readSessions(file).filter(entry => entry.active <= time && entry.active > time - presenceTtlMs);
      const outcome = change(sessions, time);
      writeSessions(file, sessions);
      return outcome;
    } finally {
      try { fs.unlinkSync(lock); } catch {}
    }
  }

  return {
    list,
    checkIn(issue, session, state) {
      ensure(states.includes(state), failed);
      return update((sessions, time) => {
        const existing = sessions.find(entry => entry.session === session);
        if (existing && existing.issue !== issue) return 'notAuthorized';
        if (!existing && sessions.filter(entry => entry.issue === issue).length >= maxFlightsPerClaim) return 'flightLimit';
        if (existing) Object.assign(existing, { state, active: time });
        else sessions.push({ session, issue, state, active: time });
        return 'checkedIn';
      });
    },
    land(issue, session) {
      return update(sessions => {
        const index = sessions.findIndex(entry => entry.session === session);
        if (index < 0) return 'nothingToLand';
        if (sessions[index].issue !== issue) return 'notAuthorized';
        sessions.splice(index, 1);
        return 'landed';
      });
    }
  };
}

function readSessions(file) {
  let text;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 65536) return [];
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let value;
  try { value = JSON.parse(text); } catch { return []; }
  if (value?.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > 200) return [];
  const seen = new Set();
  return value.sessions.filter(entry => {
    const valid = entry !== null && typeof entry === 'object' && Object.keys(entry).length === 4
      && Number.isSafeInteger(entry.session) && entry.session >= 1 && entry.session <= 999999999999999
      && Number.isSafeInteger(entry.issue) && entry.issue >= 1 && entry.issue <= 999999999
      && states.includes(entry.state) && Number.isSafeInteger(entry.active) && entry.active > 0 && !seen.has(entry.session);
    if (valid) seen.add(entry.session);
    return valid;
  }).map(({ session, issue, state, active }) => ({ session, issue, state, active }));
}

function writeSessions(file, sessions) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, sessions })}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
    throw new Failure(failed);
  }
}

function prepareFolder(folder) {
  try {
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(folder);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), failed);
  } catch (error) {
    throw error instanceof Failure ? error : new Failure(failed);
  }
}

function acquire(lock, now) {
  const started = now();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx', 0o600));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Failure(failed);
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock);
      } catch {}
      if (now() - started > 3000) break;
      Atomics.wait(pause, 0, 0, 20);
    }
  }
  throw new Failure(failed);
}
