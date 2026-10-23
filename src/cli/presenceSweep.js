import fs from 'node:fs';
import path from 'node:path';
import { presenceTtlMs } from '../core/presence.js';
import { createPresence } from './localPresence.js';
import { removeProof } from './presenceProof.js';
import { readSettings } from './publicSettings.js';

const filePattern = /^public-([1-9][0-9]{0,14})\.json$/;
const maxSweeps = 5;

export function sweepProofs({ gh, git, now, repository, keep }) {
  let folder, live, names;
  try {
    folder = path.join(git.commonDir(), 'atc');
    live = new Set(createPresence(git, now).list().map(entry => entry.session));
    names = fs.readdirSync(folder);
  } catch { return; }
  const stale = names.map(name => name.match(filePattern)).filter(Boolean).map(match => Number(match[1]))
    .filter(session => session !== keep && !live.has(session)).sort((first, second) => first - second).slice(0, maxSweeps);
  for (const session of stale) {
    const file = path.join(folder, `public-${session}.json`);
    try {
      if (fs.lstatSync(file).mtimeMs > now() - presenceTtlMs) continue;
      const settings = readSettings(file);
      if (!settings) continue;
      removeProof(gh, repository, settings);
      fs.unlinkSync(file);
    } catch {}
  }
}
