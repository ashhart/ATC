import { isFresh, readDocument } from './presenceDocs.js';
import { originPattern, presenceOrigin } from './presenceShare.js';

const prefix = 'refs/atc/peers/';

export function readPeers(git, now) {
  if (typeof git?.exec !== 'function') return [];
  const listing = git.exec(['for-each-ref', '--format=%(refname)', prefix]);
  if (listing?.status !== 0 || typeof listing.stdout !== 'string') return [];
  const origin = presenceOrigin(git);
  const time = now();
  const sessions = [];
  for (const ref of listing.stdout.split('\n').filter(Boolean).slice(0, 200)) {
    const name = ref.slice(prefix.length);
    if (!ref.startsWith(prefix) || !originPattern.test(name) || name === origin) continue;
    for (const entry of readDocument(git, ref, { shared: true })?.sessions || []) {
      if (!isFresh(entry, time)) continue;
      sessions.push({ session: entry.session, issue: entry.issue, state: entry.state, active: Math.min(entry.active, time), fileHashes: entry.fileHashes });
    }
  }
  return sessions;
}
