import { areasForPath } from './config.js';
import { isActorLogin, isLogin, isNumber, readTimestamp } from './values.js';

const referencePattern = /(?:^|[^A-Za-z0-9_&/#-])#([1-9][0-9]{0,8})(?![0-9A-Za-z_])/g;

export function referencedIssues(body) {
  if (typeof body !== 'string') return [];
  if (body.length > 65536) return null;
  const found = new Set();
  for (const match of body.matchAll(referencePattern)) {
    found.add(Number(match[1]));
    if (found.size > 20) return null;
  }
  return [...found];
}

export function readPulls(items) {
  return items.filter(pull => isNumber(pull?.number) && typeof pull.draft === 'boolean' && (pull.body === null || typeof pull.body === 'string')
    && (pull.user?.type === 'User' && isLogin(pull.user.login)
    || pull.user?.type === 'Bot' && isActorLogin(pull.user.login)))
    .map(pull => ({ number: pull.number, author: pull.user.login.toLowerCase(), draft: pull.draft, createdAt: readTimestamp(pull.created_at),
      updatedAt: readTimestamp(pull.updated_at), issues: referencedIssues(pull.body) }))
    .filter(pull => pull.createdAt !== null && pull.updatedAt !== null && pull.updatedAt >= pull.createdAt && pull.issues !== null);
}

export function linkedPulls(state, pulls, claim) {
  if (claim.role !== 'work') return [];
  const named = pulls.filter(pull => pull.author === claim.login && pull.issues.includes(claim.issue));
  if (named.length > 0) return named.map(pull => pull.number);
  const held = state.claims.filter(entry => entry.login === claim.login && entry.role === 'work');
  return held.length === 1 ? pulls.filter(pull => pull.author === claim.login && pull.issues.length === 0).map(pull => pull.number) : [];
}

export function sharedFiles(files, otherFiles, config) {
  const shared = [...files].filter(file => otherFiles.has(file));
  return { sharedFiles: shared.length, areas: [...new Set(shared.flatMap(file => areasForPath(config, file)))].sort() };
}
