import fs from 'node:fs';
import path from 'node:path';
import { privateDirectory, readPrivate, atomicWrite, requireOutsideCheckout } from './disk.js';
import { validateState } from './stateSchema.js';
import { createExchangeOperations } from './operations.js';
import { isKey, maximumEvidence, iso, requireValue } from './values.js';

export function createExchangeStore({ folder, repository, origin, now = Date.now }) {
  requireOutsideCheckout(folder);
  privateDirectory(folder);
  const blobs = path.join(folder, 'evidence');
  privateDirectory(blobs);
  const lock = path.join(folder, 'lock');
  const handle = fs.openSync(lock, 'wx', 0o600);
  const file = path.join(folder, 'state.json');
  let closed = false;
  function read() {
    requireValue(!closed, 'storage', 503);
    privateDirectory(folder); privateDirectory(blobs);
    const state = validateState(JSON.parse(readPrivate(file, 16 * 1024 * 1024)));
    requireValue(state.repository === repository && state.origin === origin, 'storage', 503);
    return state;
  }
  function save(state) { atomicWrite(file, JSON.stringify(validateState(state))); }
  function sweep() {
    const state = read();
    const time = iso(now());
    const live = new Set(state.evidence.filter(x => x.expiresAt > time).map(x => x.id));
    for (const name of fs.readdirSync(blobs)) {
      requireValue(isKey(name) || /^[a-f0-9]{32}\.[a-f0-9]{16}\.tmp$/.test(name), 'storage', 503);
      if (!live.has(name)) fs.unlinkSync(path.join(blobs, name));
    }
    const sessions = state.sessions.filter(x => x.expiresAt > time);
    if (sessions.length !== state.sessions.length) { state.sessions = sessions; save(state); }
  }
  try {
    if (!fs.existsSync(file)) save({ version: 1, repository, origin, sessions: [], requests: [], evidence: [] });
    sweep();
  } catch (error) { fs.closeSync(handle); fs.unlinkSync(lock); throw error; }
  return {
    ...createExchangeOperations({ read, save, now,
      putBytes: (id, bytes) => atomicWrite(path.join(blobs, id), bytes),
      readBytes: id => readPrivate(path.join(blobs, id), maximumEvidence) }),
    close() { if (!closed) { closed = true; fs.closeSync(handle); fs.unlinkSync(lock); } },
    sweep
  };
}
