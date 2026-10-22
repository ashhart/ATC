import { ago, fileList, plural, safeText } from '../terminalText.js';
import { boardRows } from './boardRows.js';
import { issueName, person, pullName } from './names.js';

export function renderBoard(result, labels, style, now) {
  const lines = [];
  const rows = boardRows(result, labels);
  const name = safeText(labels.repository, 60) || 'repository';
  lines.push(`${style.bold(`ATC · ${name}`)}  ${style.dim(`observed ${result.observedAt.slice(11, 16)} UTC`)}`);
  const { summary } = result;
  lines.push(style.dim([plural(summary.contributors, 'contributor'), plural(summary.openIssues, 'open issue'), plural(summary.openPullRequests, 'open PR'),
    ...(summary.activeAgents ? [`${plural(summary.activeAgents, 'agent')} active here`] : []),
    ...(summary.duplicateAttempts ? [plural(summary.duplicateAttempts, 'duplicate attempt')] : [])].join(' · ')));
  if (result.limitations.includes('timeLimit')) {
    lines.push(style.yellow('Partial view: GitHub reads stopped at the 30-second limit. Run it again; changed-file lists are cached, so the next run is faster.'));
  }
  const others = result.limitations.filter(limit => limit !== 'timeLimit');
  if (others.length) lines.push(style.yellow(`Partial view: ${others.join(', ')}. Treat empty sections as unknown.`));
  if (!result.coordinationEnabled) lines.push(style.dim('Claims are off: this repository has no .github/atc.json, so ATC only reads here.'));
  const elsewhere = result.sessions.some(session => !session.local);
  section(lines, style, elsewhere ? 'Agents in flight' : 'Agents in flight on this machine', result.sessions.map(session =>
    `${issueName(session.issue, labels)}  ${stateWord(session.state, style)}  ${style.dim(`${ago(session.active, now)}${elsewhere
      ? `, ${session.local ? 'this machine' : 'another machine'}` : ''}`)}`));
  section(lines, style, 'In flight: who is working on what', rows.inProgress.slice(0, 10).map(issue => {
    const holders = issue.claims.map(claim => `${person(claim, labels)}${claim.role === 'review' ? ' reviewing' : ' claimed'}`);
    const linked = issue.pullRequests.map(number => rows.pulls.get(number)).filter(Boolean)
      .map(pull => `PR #${pull.pullRequest} ${person(pull, labels)}${pull.draft ? ' draft' : ''}`);
    return `${issueName(issue.issue, labels)}  ${style.dim([...holders, ...linked].join(', '))}`;
  }), rows.inProgress.length - 10);
  const hot = rows.hotFiles.slice(0, 5).map(entry => {
    const shown = entry.pullRequests.slice(0, 4).map(number => `#${number} ${person(rows.pulls.get(number), labels)}`).join(', ');
    const more = entry.pullRequests.length > 4 ? ` and ${entry.pullRequests.length - 4} more` : '';
    return `${style.yellow(fileList([entry.file]))}  ${style.dim(`${plural(entry.pullRequests.length, 'open PR')}: ${shown}${more}`)}`;
  });
  const pairs = rows.hotFiles.length ? [] : result.fileOverlaps.slice(0, 8).map(overlap =>
    `${pullName(overlap.pullRequests[0], labels)} and ${pullName(overlap.pullRequests[1], labels)} share ${plural(overlap.sharedFiles, 'file')}`);
  section(lines, style, 'Contested files: more than one open PR changes them', [...hot, ...pairs], rows.hotFiles.length - 5);
  section(lines, style, 'Duplicate attempts', result.duplicateAttempts.slice(0, 8).map(entry =>
    `${issueName(entry.issue, labels)}  ${style.dim(`${entry.pullRequests.length} PRs by different people: `
      + entry.pullRequests.map(number => `#${number} ${person(rows.pulls.get(number) || { contributor: null }, labels)}`).join(', '))}`),
  result.duplicateAttempts.length - 8);
  section(lines, style, 'Stale claims', result.staleClaims.slice(0, 8).map(claim =>
    `${issueName(claim.issue, labels)}  ${style.dim(`${person(claim, labels)}, last active ${ago(claim.lastActivity, now)}, expires ${claim.expiresAt.slice(0, 10)}`)}`),
  result.staleClaims.length - 8);
  section(lines, style, 'Ready to pick up', rows.ready.slice(0, 8).map(entry =>
    `${issueName(entry.issue, labels)}  ${style.dim(reasonWord(entry.reason))}  ${style.cyan(`atc check ${entry.issue}`)}`), rows.ready.length - 8);
  lines.push('', style.dim('Agents and scripts: add --json for the full structured board.'));
  return lines.join('\n');
}

function section(lines, style, title, rows, hidden = 0) {
  if (rows.length === 0) return;
  lines.push('', style.bold(title), ...rows.map(row => `  ${row}`));
  if (hidden > 0) lines.push(style.dim(`  and ${hidden} more`));
}

function stateWord(state, style) {
  return state === 'blocked' ? style.yellow('blocked') : state === 'reviewing' ? style.cyan('reviewing') : style.green('working');
}

function reasonWord(reason) {
  return { helpWanted: 'help wanted', goodFirstIssue: 'good first issue', unassigned: 'unassigned' }[reason];
}
