import { Failure, ensure } from '../core/failure.js';
import { maxFlightsPerClaim, presenceTtlMs } from '../core/presence.js';
import { maxFiles, readDocument, updateRef, writeDocument } from './presenceDocs.js';

export const localRef = 'refs/atc/presence/local';
const failed = 'Could not update local agent presence.';
const states = ['working', 'reviewing', 'blocked'];
const pause = new Int32Array(new SharedArrayBuffer(4));

export function createPresence(git, now) {
  ensure(typeof git?.exec === 'function', failed);
  const fresh = time => entry => entry.active <= time && entry.active > time - presenceTtlMs;

  function list() {
    const time = now();
    return (readDocument(git, localRef)?.sessions || []).filter(fresh(time)).sort((first, second) => first.session - second.session);
  }

  function update(change) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const current = readDocument(git, localRef);
      const time = now();
      const sessions = (current?.sessions || []).filter(fresh(time));
      const outcome = change(sessions, time);
      if (!['checkedIn', 'landed'].includes(outcome)) return outcome;
      const next = sessions.length ? writeDocument(git, sessions) : null;
      ensure(sessions.length === 0 || next, failed);
      if (!current && !next) return outcome;
      if (updateRef(git, localRef, next, current?.sha)) return outcome;
      Atomics.wait(pause, 0, 0, 5 + attempt * 5);
    }
    throw new Failure(failed);
  }

  return {
    list,
    checkIn(issue, session, state, files = []) {
      ensure(states.includes(state) && Array.isArray(files), failed);
      return update((sessions, time) => {
        const existing = sessions.find(entry => entry.session === session);
        if (existing && existing.issue !== issue) return 'notAuthorized';
        if (!existing && sessions.filter(entry => entry.issue === issue).length >= maxFlightsPerClaim) return 'flightLimit';
        const changed = [...new Set(files)].sort().slice(0, maxFiles);
        if (existing) Object.assign(existing, { state, active: time, files: changed });
        else sessions.push({ session, issue, state, active: time, files: changed });
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
