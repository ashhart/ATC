import { ensure } from '../core/failure.js';
import { trafficView } from '../core/traffic.js';
import { createPresence } from './localPresence.js';
import { readPullFiles } from './pullFileReads.js';
import { writeTrafficCache } from './trafficCache.js';

export function inspectTraffic(context, snapshot) {
  const limitations = [...snapshot.limitations];
  if (snapshot.pulls.length > 200) limitations.push('boardPullRequestsLimit');
  const presence = localSessions(context);
  const identities = contributorReferences(snapshot, snapshot.openIssues, presence.length ? context.me : null);
  const pullFiles = new Map();
  const listed = snapshot.pulls.slice(0, 200);
  const read = readPullFiles(context, listed, snapshot.pulls);
  if (read.timed) limitations.push('timeLimit');
  for (const [number, files] of read.files) {
    if (files.partial) limitations.push('pullFilesLimit');
    if (files.invalid) limitations.push('invalidFiles');
    pullFiles.set(number, new Set(files.files));
  }
  const scoped = { ...snapshot, limitations: [...new Set(limitations)].sort(), partial: limitations.length > 0 };
  const view = trafficView(scoped, { me: context.me, repository: context.repository, openIssues: snapshot.openIssues, identities, pullFiles, presence });
  if (presence.inClone) writeTrafficCache(context.git, snapshot.now, listed.filter(pull => pull.author !== context.me)
    .map(pull => ({ number: pull.number, files: pullFiles.get(pull.number) })));
  if (context.labels) labelBoard(context.labels, identities, view, pullFiles);
  return view;
}

function localSessions(context) {
  const sessions = [];
  try {
    if (!context.git.remoteFor(context.repository)) return sessions;
    sessions.inClone = true;
    sessions.push(...createPresence(context.git.commonDir(), context.now).list());
  } catch {}
  return sessions;
}

function labelBoard(labels, identities, view, pullFiles) {
  for (const [login, reference] of identities) labels.contributors.set(reference, login);
  for (const overlap of view.fileOverlaps) {
    const [first, second] = overlap.pullRequests.map(number => pullFiles.get(number) || new Set());
    labels.shared.set(overlap.pullRequests.join(':'), [...first].filter(file => second.has(file)).sort());
  }
}

function contributorReferences(snapshot, openIssues, me) {
  const names = [...new Set([...snapshot.state.claims.map(claim => claim.login), ...snapshot.pulls.map(pull => pull.author),
    ...openIssues.flatMap(issue => issue.assignees.map(user => user.login)), ...(me ? [me] : [])])].sort();
  ensure(names.length <= 20000, 'Too many contributors to inspect');
  return new Map(names.map((login, index) => [login, index + 1]));
}
