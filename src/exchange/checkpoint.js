import path from 'node:path';
import { digest, exact, requireValue } from './values.js';
import { isCollaborationOutput } from './collaborationOutput.js';
import { readPrivate, atomicWrite, privateDirectory } from './disk.js';

export function checkpoint({ git, repository, origin, pull, consumer }) {
  const folder = path.join(git.commonDir(), 'atc', 'exchange');
  privateDirectory(folder);
  const file = path.join(folder, `catchup-${digest(`${repository}\n${origin}\n${pull}\n${consumer}`)}.json`);
  const snapshot = value => value === null || isCollaborationOutput(value) && value.view === 'snapshot' && value.pull === pull;
  function read() {
    try {
      const value = JSON.parse(readPrivate(file, 512 * 1024));
      requireValue(exact(value, { acknowledged: snapshot, pending: snapshot }), 'storage', 503);
      return value;
    } catch (error) { if (error.code === 'ENOENT') return { acknowledged: null, pending: null }; throw error; }
  }
  return {
    changes(value) {
      requireValue(snapshot(value) && value !== null, 'unavailable', 503);
      const state = read(), old = state.acknowledged?.parts || [], changes = [];
      const key = x => `${x.kind}/${x.id}`;
      for (const part of value.parts) {
        const before = old.find(x => key(x) === key(part));
        if (before?.revision !== part.revision) changes.push({ kind: part.kind, id: part.id, change: before ? 'changed' : 'added' });
      }
      for (const part of old) if (!value.parts.some(x => key(x) === key(part))) changes.push({ kind: part.kind, id: part.id, change: 'removed' });
      state.pending = value;
      atomicWrite(file, JSON.stringify(state));
      return { type: 'collaboration', view: 'catchup', version: 1, pull, observedAt: value.observedAt, cursor: value.cursor, changes };
    },
    acknowledge(cursor) {
      const state = read();
      requireValue(state.pending?.cursor === cursor, 'conflict', 409);
      state.acknowledged = state.pending;
      atomicWrite(file, JSON.stringify(state));
      return { type: 'collaboration', outcome: 'acknowledged', cursor };
    }
  };
}
