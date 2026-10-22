import { fileList, plural } from '../terminalText.js';
import { branchName, issueName, pullName } from './names.js';

export function renderCheck(result, labels, style) {
  const lines = [style.bold(issueName(result.issue, labels))];
  const others = result.otherPullRequests.map(number => `#${number}`).join(', ');
  const advice = {
    free: `${style.green('Free.')} No claim, no other assignee and no linked open PR. ${style.cyan(`atc claim ${result.issue}`)}`,
    yours: `${style.green('Yours.')} ${result.myPullRequests.length ? `Your PR ${result.myPullRequests.map(n => `#${n}`).join(', ')} links it.` : 'You hold the claim.'}`,
    proposeInstead: `${style.yellow('Claimed by someone else.')} Offer help: ${style.cyan(`atc propose ${result.issue} pair`)}, review, split or takeover.`,
    takenOutside: `${style.yellow('Taken outside ATC.')} ${result.assignedToOthers ? `${plural(result.assignedToOthers, 'other assignee')}. ` : ''}`
      + `${others ? `Linked PRs: ${others}. ` : ''}Talk to them before starting.`,
    notOpen: `${style.red('Not an open issue.')} Pick another one.`,
    incomplete: `${style.yellow('Not sure.')} Coverage was incomplete (${result.limitations.join(', ')}). Don't start yet.`
  }[result.advice];
  lines.push(`  ${advice}`);
  for (const overlap of result.areaOverlaps.filter(entry => !entry.mine)) {
    const areas = [...overlap.areas].sort((first, second) => first - second);
    lines.push(`  ${style.dim(`${areas.length === 1 ? 'Area' : 'Areas'} ${areas.join(', ')} ${areas.length === 1 ? 'is' : 'are'} also claimed on ${issueName(overlap.issue, labels)}.`)}`);
  }
  if (result.pendingProposals) lines.push(`  ${style.dim(`${plural(result.pendingProposals, 'pending proposal')} on this issue.`)}`);
  if (!result.coordinationEnabled) lines.push(`  ${style.dim('Claims are off here: the repository has no .github/atc.json.')}`);
  return lines.join('\n');
}

export function renderOverlap(result, labels, style) {
  const lines = [style.bold('Overlap check')];
  if (result.changedFiles === null) lines.push(style.yellow('  Could not read your working tree. Run inside the clone or pass --base.'));
  else lines.push(style.dim(`  ${plural(result.changedFiles, 'changed file')} on your side`));
  const rank = { conflicts: 0, clean: 1, unknown: 2 };
  const rows = [...result.worktreeOverlaps.map(overlap => ({ overlap, key: `worktree:${overlap.worktree}`, subject: `Your changes and ${branchName(overlap.worktree, labels)}` })),
    ...result.overlaps.map(overlap => ({ overlap, key: `${overlap.source}:${overlap.pullRequest}`,
      subject: `${overlap.source === 'workingTree' ? 'Your changes' : `Your PR #${overlap.source}`} and ${pullName(overlap.pullRequest, labels)}` }))]
    .map((entry, index) => ({ ...entry, index })).sort((first, second) => rank[first.overlap.conflict] - rank[second.overlap.conflict] || first.index - second.index);
  const shown = rows.filter((entry, index) => entry.overlap.conflict === 'conflicts' || index < 6);
  for (const entry of shown) lines.push(`  ${row(entry.overlap, entry.subject, labels.conflicts.get(entry.key), labels.shared.get(entry.key), style)}`);
  const rest = rows.slice(shown.length).filter(entry => entry.overlap.pullRequest);
  const clean = rest.filter(entry => entry.overlap.conflict === 'clean').length;
  if (rest.length) lines.push(style.dim(`  and ${plural(rest.length, 'more open PR')} sharing files (${clean} merge cleanly, ${rest.length - clean} not test-merged): `
    + `${rest.slice(0, 12).map(entry => `#${entry.overlap.pullRequest}`).join(', ')}${rest.length > 12 ? ', …' : ''}`));
  if (result.overlaps.length === 0 && result.worktreeOverlaps.length === 0) {
    lines.push(`  ${style.green('Clear.')} No shared files with other people's open PRs${result.worktrees ? ` or ${plural(result.worktrees, 'other local worktree')}` : ''}.`);
  }
  if (!result.complete) lines.push(style.yellow(`  Partial check: ${result.limitations.join(', ')}.`));
  return lines.join('\n');
}

function row(overlap, subject, conflicts, shared, style) {
  if (overlap.conflict === 'conflicts') {
    const files = fileList(conflicts);
    return `${style.red('conflict')}  ${subject} will conflict in ${files || plural(overlap.conflictFiles, 'file')}`;
  }
  const files = fileList(shared);
  const tail = overlap.conflict === 'clean' ? 'merges cleanly' : "couldn't test-merge";
  return `${style.yellow('shared')}    ${subject} share ${plural(overlap.sharedFiles, 'file')}${files ? ` (${files})` : ''}, ${tail}`;
}

export function renderWho(result, labels, style) {
  const newest = [...result.pullRequests].sort((first, second) => second - first);
  const pulls = newest.length > 8 ? `${plural(newest.length, 'open PR')} (newest ${newest.slice(0, 8).map(n => `#${n}`).join(', ')})`
    : newest.map(number => pullName(number, labels)).join(', ');
  const agents = labels.agents.slice(0, 5).map(agent => `an agent on #${agent.issue} elsewhere`);
  const places = [...(pulls ? [pulls] : []), ...Array.from({ length: result.worktrees }, (_, index) => branchName(index + 1, labels)),
    ...(agents.length ? agents : result.agents ? [`${plural(result.agents, 'agent')} elsewhere`] : [])];
  const lines = [places.length ? `${style.yellow('Also changed in')} ${places.join(', ')}` : style.green('No one else is changing this file.')];
  if (!result.complete) lines.push(style.dim('  Open PR files unknown: run atc board or atc overlap to refresh.'));
  return lines.join('\n');
}

export function renderStatus(result, labels, style) {
  const lines = [style.bold('Your coordination')];
  const mine = result.claims.filter(claim => claim.mine);
  if (mine.length === 0) lines.push(style.dim('  No claims.'));
  for (const claim of mine) {
    const due = result.refreshDue.includes(claim.issue) ? style.yellow(`  renew: atc renew ${claim.issue}`) : '';
    lines.push(`  ${issueName(claim.issue, labels)}  ${style.dim(claim.role === 'review' ? 'reviewing' : 'working')}${due}`);
  }
  for (const proposal of result.proposalsForMe) {
    lines.push(`  ${style.cyan('offer')} ${proposal.kind} on ${issueName(proposal.issue, labels)}: atc accept ${proposal.id} or atc decline ${proposal.id}`);
  }
  for (const proposal of result.myProposals) lines.push(`  ${style.dim(`you offered ${proposal.kind} on #${proposal.issue} (withdraw: atc withdraw ${proposal.id})`)}`);
  return lines.join('\n');
}
