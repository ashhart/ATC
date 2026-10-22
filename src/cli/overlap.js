import { ensure } from '../core/failure.js';
import { overlapView } from '../core/view.js';
import { checkConflicts } from './conflicts.js';
import { createTrees } from './gitTrees.js';
import { readPullFiles } from './pullFileReads.js';
import { isFilePath } from './reader.js';
import { writeTrafficCache } from './trafficCache.js';

export function inspectOverlap(context, snapshot, flags) {
  let workingTree = null;
  let base = null;
  const limitations = [...snapshot.limitations];
  try {
    base = flags.base || defaultBase(context);
    const files = context.git.changedFiles(context.git.mergeBase(base));
    workingTree = new Set([...files].filter(isFilePath));
    if (workingTree.size !== files.size) limitations.push('invalidFiles');
  } catch (error) {
    if (flags.base) throw error;
    limitations.push('workingTreeUnavailable');
  }
  const mine = snapshot.pulls.filter(pull => pull.author === context.me);
  const others = snapshot.pulls.filter(pull => pull.author !== context.me).sort((first, second) => second.updatedAt - first.updatedAt);
  if (mine.length > 10) limitations.push('myPullRequestsLimit');
  if (others.length > 200) limitations.push('otherPullRequestsLimit');
  const read = readPullFiles(context, [...mine.slice(0, 10), ...others.slice(0, 200)], snapshot.pulls);
  function withFiles(pulls) {
    return pulls.map(pull => {
      const result = read.get(pull.number);
      if (result.partial) limitations.push('pullFilesLimit');
      if (result.invalid) limitations.push('invalidFiles');
      return { number: pull.number, files: new Set(result.files) };
    });
  }
  const myPulls = withFiles(mine.slice(0, 10));
  const otherPulls = withFiles(others.slice(0, 200));
  const view = overlapView({ workingTree, myPulls, otherPulls, limitations }, snapshot.config);
  const remote = workingTree ? safeRemote(context) : null;
  const local = checkConflicts({ trees: workingTree ? createTrees(context.git) : null, remote, base: workingTree ? base : null,
    overlaps: view.overlaps, workingFiles: workingTree, sourceFiles: new Map(myPulls.map(pull => [pull.number, pull.files])),
    config: snapshot.config, labels: context.labels });
  if (context.labels) for (const overlap of view.overlaps) {
    const theirs = otherPulls.find(pull => pull.number === overlap.pullRequest)?.files || new Set();
    const source = overlap.source === 'workingTree' ? workingTree : myPulls.find(pull => pull.number === overlap.source)?.files;
    context.labels.shared.set(`${overlap.source}:${overlap.pullRequest}`, [...(source || [])].filter(file => theirs.has(file)).sort());
  }
  if (workingTree) writeTrafficCache(context.git, snapshot.now, otherPulls);
  return { ...view, ...local };
}

function safeRemote(context) {
  try { return context.git.remoteFor(context.repository); } catch { return null; }
}

function defaultBase(context) {
  const remote = context.git.remoteFor(context.repository);
  ensure(remote, 'No git remote points at the repository. Pass --base.');
  return `${remote}/${context.reader.defaultBranch()}`;
}
