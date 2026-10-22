const reasonRank = { helpWanted: 0, goodFirstIssue: 1, unassigned: 2 };

export function boardRows(result, labels) {
  const pulls = new Map(result.pullRequests.map(pull => [pull.pullRequest, pull]));
  const activity = issue => Math.max(0, ...issue.pullRequests.map(number => Date.parse(pulls.get(number)?.updatedAt || 0)),
    ...issue.claims.map(claim => Date.parse(claim.lastActivity)));
  const inProgress = result.issues.filter(issue => issue.claims.length || issue.pullRequests.length)
    .sort((first, second) => activity(second) - activity(first) || second.issue - first.issue);
  const files = new Map();
  for (const overlap of result.fileOverlaps) {
    for (const file of labels.shared.get(overlap.pullRequests.join(':')) || []) {
      if (!files.has(file)) files.set(file, new Set());
      overlap.pullRequests.forEach(number => files.get(file).add(number));
    }
  }
  const newest = (first, second) => Date.parse(pulls.get(second)?.updatedAt || 0) - Date.parse(pulls.get(first)?.updatedAt || 0) || second - first;
  const hotFiles = [...files].map(([file, numbers]) => ({ file, pullRequests: [...numbers].sort(newest) }))
    .sort((first, second) => second.pullRequests.length - first.pullRequests.length || (first.file < second.file ? -1 : 1));
  const ready = new Map();
  const free = new Set(result.issues.filter(issue => issue.state === 'open' && !issue.claims.length && !issue.pullRequests.length
    && !issue.assignees.length).map(issue => issue.issue));
  const candidates = result.opportunities.filter(entry => Object.hasOwn(reasonRank, entry.reason) && free.has(entry.issue))
    .sort((first, second) => reasonRank[first.reason] - reasonRank[second.reason] || second.issue - first.issue);
  for (const entry of candidates) if (!ready.has(entry.issue)) ready.set(entry.issue, entry);
  return { pulls, inProgress, hotFiles, ready: [...ready.values()] };
}

export function boardNumbers(result, labels) {
  const rows = boardRows(result, labels);
  const numbers = [...result.sessions.map(session => session.issue), ...rows.inProgress.slice(0, 10).map(issue => issue.issue),
    ...rows.hotFiles.slice(0, 5).flatMap(entry => entry.pullRequests.slice(0, 4)),
    ...(rows.hotFiles.length ? [] : result.fileOverlaps.slice(0, 8).flatMap(overlap => overlap.pullRequests)),
    ...result.duplicateAttempts.slice(0, 8).map(entry => entry.issue), ...result.staleClaims.slice(0, 8).map(entry => entry.issue),
    ...rows.ready.slice(0, 8).map(entry => entry.issue)];
  return [...new Set(numbers)];
}
