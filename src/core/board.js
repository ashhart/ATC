import { ensure } from './failure.js';
import { readState } from './state.js';
import { isNumber } from './values.js';

export const boardLabel = 'atc-board';
export const boardTitle = 'ATC coordination board';
const markerPattern = /<!-- atc-state:([A-Za-z0-9+/=]+) -->/g;
const intro = 'A bot keeps this issue up to date. Comment `/atc` commands on the issue you want to work on, not here. Agents read this board through the `atc-gh` CLI.';

export function renderBoard(state) {
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  let human = ['## ATC coordination board', '', intro, '', ...claimTable(state), ...proposalTable(state), ...overlapTable(state)].join('\n');
  if (human.length + encoded.length > 60000) human = `## ATC coordination board\n\n${intro}\n\nThe board is too large to show as tables.`;
  ensure(human.length + encoded.length <= 64000, 'ATC board state is too large');
  return `${human}\n\n<!-- atc-state:${encoded} -->\n`;
}

export function readBoard(body) {
  ensure(typeof body === 'string' && body.length <= 65536, 'Invalid ATC board');
  const matches = [...body.matchAll(markerPattern)];
  ensure(matches.length === 1, 'Invalid ATC board');
  let value;
  try {
    value = JSON.parse(Buffer.from(matches[0][1], 'base64').toString('utf8'));
  } catch {
    ensure(false, 'Invalid ATC board');
  }
  return readState(value);
}

export function pickBoard(issues, botLogin) {
  return issues.filter(issue => issue && issue.user?.login === botLogin && issue.user?.type === 'Bot'
    && !issue.pull_request && isNumber(issue.number) && typeof issue.body === 'string')
    .sort((first, second) => first.number - second.number)[0] || null;
}

function claimTable(state) {
  if (state.claims.length === 0) return ['No active claims.', ''];
  return ['### Claims', '', '| Issue | Who | Role | Areas | Pull requests | Last activity |', '| --- | --- | --- | --- | --- | --- |',
    ...state.claims.map(claim => `| #${claim.issue} | \`${claim.login}\` | ${claim.role} | ${claim.areas.join(', ') || 'whole issue'} | ${numbers(claim.prs)} | ${day(claim.active)} |`), ''];
}

function proposalTable(state) {
  if (state.proposals.length === 0) return [];
  return ['### Pending proposals', '', '| Proposal | Issue | From | Kind | Areas |', '| --- | --- | --- | --- | --- |',
    ...state.proposals.map(proposal => `| ${proposal.id} | #${proposal.issue} | \`${proposal.from}\` | ${proposal.kind} | ${proposal.areas.join(', ') || 'none'} |`), ''];
}

function overlapTable(state) {
  if (state.overlaps.length === 0) return [];
  return ['### Overlapping pull requests', '', '| Pull requests | Shared files | Areas |', '| --- | --- | --- |',
    ...state.overlaps.map(overlap => `| ${numbers(overlap.prs)} | ${overlap.files} | ${overlap.areas.join(', ') || 'none'} |`), ''];
}

function numbers(values) {
  return values.length ? values.map(value => `#${value}`).join(', ') : 'none';
}

function day(time) {
  return new Date(time).toISOString().slice(0, 10);
}
