import { pickBoard, readBoard, renderBoard } from '../core/board.js';
import { claimIssue, closeIssue, expireClaims, releaseClaim, resetIssue } from '../core/claims.js';
import { parseCommand } from '../core/commands.js';
import { readConfig } from '../core/config.js';
import { ensure } from '../core/failure.js';
import { decideProposal, proposeWork } from '../core/proposals.js';
import { linkPullRequests, linkedPullAuthors, recordOverlaps, referencedIssues } from '../core/pulls.js';
import { emptyState, fitsOnBoard, recordOutcome } from '../core/state.js';
import { isLogin, isNumber } from '../core/values.js';
import { applyEffects } from './effects.js';

const successes = ['claimed', 'claimUpdated', 'released', 'proposed', 'accepted', 'declined', 'withdrawn', 'reset'];
const maintainerRoles = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const issueUrlPattern = /\/issues\/([1-9][0-9]{0,8})$/;

export async function runCoordinator({ github, eventName, payload, botLogin, now = Date.now, log = () => {} }) {
  const config = readConfig(await github.readConfig());
  const board = await findOrCreateBoard(github, botLogin, now);
  const state = readBoard(board.body);
  const context = { github, config, now, log, board, state, saved: shape(state) };
  state.areas = Object.keys(config.areas).sort();
  await processComments(context);
  if (eventName === 'issues' && payload?.action === 'closed' && isNumber(payload.issue?.number)) closeIssue(state, payload.issue.number);
  const periodic = eventName === 'schedule' || eventName === 'workflow_dispatch';
  if (periodic) {
    await closeFinishedIssues(context);
    const effects = expireClaims(state, config, now());
    await save(context);
    await applyEffects(github, effects, log);
  }
  if (periodic || eventName === 'pull_request_target') await scanPulls(context);
  await save(context);
}

async function findOrCreateBoard(github, botLogin, now) {
  const candidates = await github.listBoards();
  const board = pickBoard(candidates, botLogin);
  if (board) return board;
  ensure(!candidates.some(issue => issue?.user?.type === 'Bot'), 'An ATC board from another bot account exists. Check the bot-login input.');
  const created = await github.createBoard(renderBoard(emptyState(now())));
  ensure(pickBoard([created], botLogin), 'The new ATC board was not created by bot-login. Check the bot-login input.');
  return created;
}

async function processComments(context) {
  const { state } = context;
  const since = new Date(Math.max(0, state.cursor.time - 300000)).toISOString();
  const comments = (await context.github.listComments(since))
    .filter(comment => Number.isSafeInteger(comment?.id))
    .sort((first, second) => first.id - second.id);
  let handled = 0;
  for (const comment of comments) {
    if (comment.id <= state.cursor.commentId) continue;
    const command = isPerson(comment) ? parseCommand(comment.body) : null;
    const issue = issueNumber(comment.issue_url);
    if (command && issue && handled >= 50) break;
    state.cursor = { commentId: comment.id, time: Math.max(state.cursor.time, Date.parse(comment.created_at) || 0) };
    if (!command || !issue) continue;
    handled += 1;
    const maintainer = maintainerRoles.includes(comment.author_association);
    await handleCommand(context, { comment: comment.id, login: comment.user.login, maintainer, issue, command });
  }
}

async function handleCommand(context, { comment, login, maintainer, issue, command }) {
  const { state } = context;
  const at = context.now();
  const before = structuredClone(state);
  let { outcome, effects } = await dispatch(context, { login, maintainer, issue, command, at });
  if (!fitsOnBoard(state)) {
    Object.assign(state, before);
    outcome = 'boardFull';
    effects = [];
  }
  const own = state.claims.find(claim => claim.issue === issue && claim.login === login);
  if (own && outcome !== 'invalid') own.active = at;
  const repeated = state.recent.some(entry => entry.login === login && entry.issue === issue && entry.outcome === outcome && entry.at > at - 3600000);
  if (repeated) effects = effects.filter(effect => effect.type !== 'comment');
  recordOutcome(state, { comment, issue, login, outcome, at });
  await save(context);
  const reaction = { type: 'react', comment, content: successes.includes(outcome) ? '+1' : 'confused' };
  await applyEffects(context.github, [...effects, reaction], context.log);
}

async function dispatch(context, { login, maintainer, issue, command, at }) {
  const { state, config, github, board } = context;
  if (command.verb === 'invalid') return { outcome: 'invalid', effects: [] };
  if (command.verb === 'release') return releaseClaim(state, { login, issue });
  if (command.verb === 'reset') return maintainer ? resetIssue(state, issue) : { outcome: 'notAuthorized', effects: [] };
  if (command.verb !== 'claim' && command.verb !== 'propose') {
    return decideProposal(state, { login, issue, proposal: command.proposal, verb: command.verb }, config, at);
  }
  const details = await github.getIssue(issue);
  const open = Boolean(details && details.state === 'open' && !details.pull_request && !details.locked && issue !== board.number);
  if (command.verb === 'claim') return claimIssue(state, { login, issue, areas: command.areas, open }, config, at);
  return proposeWork(state, { login, issue, kind: command.kind, areas: command.areas, open }, config, at);
}

async function closeFinishedIssues(context) {
  const since = new Date(context.now() - 2 * 86400000).toISOString();
  const closed = new Set((await context.github.listClosedIssues(since))
    .filter(issue => issue?.state === 'closed' && isNumber(issue.number))
    .map(issue => issue.number));
  for (const issue of new Set(context.state.claims.map(claim => claim.issue))) {
    if (closed.has(issue)) closeIssue(context.state, issue);
  }
}

async function scanPulls(context) {
  const { state, github, config, now } = context;
  const pulls = (await github.listOpenPulls())
    .filter(pull => isNumber(pull?.number) && pull.user?.type === 'User' && isLogin(pull.user.login))
    .map(pull => ({ number: pull.number, author: pull.user.login, updatedAt: Date.parse(pull.updated_at) || 0, issues: referencedIssues(pull.body) }));
  linkPullRequests(state, pulls, now());
  const files = new Map();
  for (const number of [...linkedPullAuthors(state).keys()].slice(0, 30)) files.set(number, new Set(await github.listPullFiles(number)));
  const effects = recordOverlaps(state, files, config, now());
  while (!fitsOnBoard(state) && state.overlaps.length > 0) state.overlaps.pop();
  await save(context);
  await applyEffects(github, effects, context.log);
}

async function save(context) {
  const current = shape(context.state);
  if (current === context.saved) return;
  context.state.updatedAt = context.now();
  await context.github.updateBoard(context.board.number, renderBoard(context.state));
  context.saved = current;
}

function shape(state) {
  return renderBoard({ ...state, updatedAt: 0 });
}

function isPerson(comment) {
  return comment?.user?.type === 'User' && isLogin(comment.user.login);
}

function issueNumber(url) {
  const match = typeof url === 'string' ? url.match(issueUrlPattern) : null;
  return match ? Number(match[1]) : null;
}
