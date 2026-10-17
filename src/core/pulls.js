import { areasForPath } from './config.js';
import { isLogin, isNumber } from './values.js';

const referencePattern = /(?:^|[^A-Za-z0-9_&/#-])#([1-9][0-9]{0,8})(?![0-9A-Za-z_])/g;

export function referencedIssues(body) {
  if (typeof body !== 'string') return [];
  const found = new Set();
  for (const match of body.slice(0, 65536).matchAll(referencePattern)) {
    found.add(Number(match[1]));
    if (found.size === 20) break;
  }
  return [...found];
}

export function readPulls(items) {
  return items.filter(pull => isNumber(pull?.number) && pull.user?.type === 'User' && isLogin(pull.user.login))
    .map(pull => ({ number: pull.number, author: pull.user.login, createdAt: Date.parse(pull.created_at) || 0,
      updatedAt: Date.parse(pull.updated_at) || 0, issues: referencedIssues(pull.body) }));
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
