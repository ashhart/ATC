import { randomBytes } from 'node:crypto';
import { createPresence } from './localPresence.js';
import { clearLocalOnly, markLocalOnly } from './localPresenceOnly.js';
import { sessionFiles } from './sessionFiles.js';

export function reportPresence(command, input, { git, now, dryRun, readOnly, localOnly }) {
  const verb = command === 'land' ? 'land' : 'flight';
  const session = command === 'start' ? randomBytes(6).readUIntBE(0, 6) || 1 : input.session;
  const state = verb === 'flight' ? input.state || 'working' : null;
  const reply = { issue: input.issue, command: verb, posted: false, session, ...(state ? { state } : {}) };
  if (dryRun) return { ...reply, outcome: 'dryRun' };
  if (readOnly) return { ...reply, outcome: 'readOnly' };
  if (command === 'start' && localOnly) markLocalOnly(git, session);
  const presence = createPresence(git, now);
  const outcome = verb === 'land' ? presence.land(input.issue, session) : presence.checkIn(input.issue, session, state, sessionFiles(git));
  if (command === 'start' && localOnly && outcome !== 'checkedIn') clearLocalOnly(git, session);
  return { ...reply, outcome };
}
