import { safeText } from '../terminalText.js';

export function issueName(number, labels) {
  const title = safeText(labels.titles.get(number), 60);
  return title ? `#${number} ${title}` : `#${number}`;
}

export function pullName(number, labels) {
  const title = safeText(labels.titles.get(number), 40);
  return title ? `PR #${number} "${title}"` : `PR #${number}`;
}

export function person(row, labels) {
  if (row.mine) return 'you';
  const login = safeText(labels.contributors.get(row.contributor), 39);
  return login ? `@${login}` : row.contributor === null ? 'someone' : `contributor ${row.contributor}`;
}

export function branchName(index, labels) {
  const branch = safeText(labels.worktrees.get(index), 60);
  return branch ? `worktree ${branch}` : `local worktree ${index}`;
}
