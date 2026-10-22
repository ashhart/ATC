import { isLogin } from '../core/values.js';
import { isFresh, readDocument } from './presenceDocs.js';
import { presenceOrigin } from './presenceShare.js';

const prefix = 'refs/atc/peers/';

export function readPeers(git, now) {
  if (typeof git?.exec !== 'function') return [];
  const listing = git.exec(['for-each-ref', '--format=%(refname)', prefix]);
  if (listing?.status !== 0 || typeof listing.stdout !== 'string') return [];
  const origin = presenceOrigin(git);
  const time = now();
  const sessions = [];
  for (const ref of listing.stdout.split('\n').filter(Boolean).slice(0, 200)) {
    const login = ref.slice(prefix.length);
    if (!ref.startsWith(prefix) || !isLogin(login) || login !== login.toLowerCase()) continue;
    for (const entry of readDocument(git, ref, { shared: true })?.sessions || []) {
      if (entry.origin === origin || !isFresh(entry, time)) continue;
      sessions.push({ login, session: entry.session, issue: entry.issue, state: entry.state, active: Math.min(entry.active, time), files: entry.files });
    }
  }
  return sessions;
}
