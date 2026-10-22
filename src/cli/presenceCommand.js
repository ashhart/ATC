import { randomBytes } from 'node:crypto';
import { createPresence } from './localPresence.js';
import { sessionFiles } from './sessionFiles.js';

export function reportPresence(command, input, { git, now, dryRun, readOnly }) {
  const verb = command === 'land' ? 'land' : 'flight';
  const session = command === 'start' ? randomBytes(6).readUIntBE(0, 6) || 1 : input.session;
  const state = verb === 'flight' ? input.state || 'working' : null;
  const reply = { issue: input.issue, command: verb, posted: false, session, ...(state ? { state } : {}) };
  if (dryRun) return { ...reply, outcome: 'dryRun' };
  if (readOnly) return { ...reply, outcome: 'readOnly' };
  const presence = createPresence(git, now);
  const outcome = verb === 'land' ? presence.land(input.issue, session) : presence.checkIn(input.issue, session, state, sessionFiles(git));
  return { ...reply, outcome };
}
