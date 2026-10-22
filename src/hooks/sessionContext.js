import { summaryPath } from './boardSummary.js';
import { contextOutput } from './hookIo.js';
import { isAbsolutePath, isRecord, plural } from './hookValues.js';

const summaryMaxAgeMs = 7 * 86400000;

export function sessionStartOutput(input, deps) {
  if (!isRecord(input) || input.hook_event_name !== 'SessionStart' || !isAbsolutePath(input.cwd)) return null;
  const git = deps.gitContext(input.cwd);
  if (!git || !git.github) return null;
  const file = summaryPath(deps.dataDir, git.root);
  const summary = file ? deps.readSummary(file) : null;
  if (file && deps.refreshDue(file, deps.now())) deps.startRefresh(git.root, file);
  const lines = git.configured
    ? ['This repository coordinates issue work with Agent Traffic Control (ATC).',
      '`atc check <issue>` reports whether someone already claimed, was assigned or opened a pull request for an issue, and `atc claim <issue>` claims it.']
    : ['Agent Traffic Control (ATC) can show who is working on this GitHub repository\'s issues and pull requests.',
      '`atc check <issue>` reports whether an issue already has an assignee or a linked pull request.'];
  lines.push('`atc overlap` compares local changes with other open pull requests and local worktrees, and reports merge conflicts.',
    '`atc board` lists current work, pull requests that share files, and open issues that need help.');
  if (isAbsolutePath(deps.cliPath)) lines.push(`When \`atc\` is not on PATH, the same CLI runs as \`node "${deps.cliPath}"\`.`);
  const line = summaryLine(summary, deps.now());
  if (line) lines.push(line);
  return contextOutput('SessionStart', lines.join('\n'));
}

function summaryLine(summary, now) {
  if (!summary || !(now - Date.parse(summary.observedAt) <= summaryMaxAgeMs)) return null;
  const counts = [
    `${summary.openIssues} open ${plural(summary.openIssues, 'issue', 'issues')}`,
    `${summary.openPullRequests} open pull ${plural(summary.openPullRequests, 'request', 'requests')}`,
    `${summary.fileOverlaps} pull request ${plural(summary.fileOverlaps, 'pair', 'pairs')} sharing files`,
    `${summary.opportunities} ${plural(summary.opportunities, 'issue that needs', 'issues that need')} help`,
    `${summary.activeAgents} active agent ${plural(summary.activeAgents, 'session', 'sessions')}`
  ];
  const coverage = summary.complete ? '' : ' Its coverage was incomplete.';
  return `The last ATC board snapshot, observed ${summary.observedAt}, showed ${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}.${coverage}`;
}
