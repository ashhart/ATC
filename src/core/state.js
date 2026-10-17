import { ensure } from './failure.js';
import { proposalKinds } from './commands.js';
import { hasExactKeys, isArea, isId, isLogin, isNumber, isTime } from './values.js';

export const outcomes = ['claimed', 'claimUpdated', 'claimTaken', 'claimLimit', 'unknownArea', 'notClaimable',
  'released', 'nothingToRelease', 'proposed', 'proposalExists', 'proposalLimit', 'notClaimed', 'alreadyInvolved',
  'accepted', 'declined', 'withdrawn', 'notAuthorized', 'proposalNotFound', 'proposerAtLimit', 'splitLeavesNothing',
  'boardFull', 'reset', 'invalid'];
export const caps = { claims: 200, proposals: 100, overlaps: 100, recent: 50, prsPerClaim: 10, areas: 24, bytes: 40000 };
const stateKeys = ['version', 'cursor', 'nextProposal', 'areas', 'claims', 'proposals', 'overlaps', 'recent', 'updatedAt'];

export function emptyState(now) {
  return { version: 1, cursor: { commentId: 0, time: Math.max(0, now - 600000) }, nextProposal: 1, areas: [],
    claims: [], proposals: [], overlaps: [], recent: [], updatedAt: now };
}

export function readState(value) {
  check(hasExactKeys(value, stateKeys) && value.version === 1);
  check(hasExactKeys(value.cursor, ['commentId', 'time']) && (value.cursor.commentId === 0 || isId(value.cursor.commentId)));
  check(isTime(value.cursor.time) && isNumber(value.nextProposal) && isTime(value.updatedAt));
  const state = {
    version: 1,
    cursor: { commentId: value.cursor.commentId, time: value.cursor.time },
    nextProposal: value.nextProposal,
    areas: areaList(value.areas, caps.areas),
    claims: items(value.claims, caps.claims).map(readClaim),
    proposals: items(value.proposals, caps.proposals).map(readProposal),
    overlaps: items(value.overlaps, caps.overlaps).map(readOverlap),
    recent: items(value.recent, caps.recent).map(readRecent),
    updatedAt: value.updatedAt
  };
  check(unique(state.claims.map(claim => `${claim.issue}:${claim.login}`)));
  check(unique(state.proposals.map(proposal => proposal.id)) && state.proposals.every(proposal => proposal.id < state.nextProposal));
  return state;
}

export function claimsOn(state, issue, role) {
  return state.claims.filter(claim => claim.issue === issue && (!role || claim.role === role));
}

export function recordOutcome(state, entry) {
  state.recent.push(entry);
  if (state.recent.length > caps.recent) state.recent.splice(0, state.recent.length - caps.recent);
}

export function pruneAfterRemoval(state, issue) {
  if (claimsOn(state, issue, 'work').length === 0) state.proposals = state.proposals.filter(proposal => proposal.issue !== issue);
  const linked = new Set(state.claims.filter(claim => claim.role === 'work').flatMap(claim => claim.prs));
  state.overlaps = state.overlaps.filter(overlap => overlap.prs.every(number => linked.has(number)));
}

export function fitsOnBoard(state) {
  return JSON.stringify(state).length <= caps.bytes;
}

function readClaim(value) {
  check(hasExactKeys(value, ['issue', 'login', 'role', 'areas', 'since', 'active', 'prs']));
  check(isNumber(value.issue) && isLogin(value.login) && ['work', 'review'].includes(value.role));
  check(isTime(value.since) && isTime(value.active));
  return { issue: value.issue, login: value.login, role: value.role, areas: areaList(value.areas, 8),
    since: value.since, active: value.active, prs: numberList(value.prs, caps.prsPerClaim) };
}

function readProposal(value) {
  check(hasExactKeys(value, ['id', 'issue', 'from', 'kind', 'areas', 'at']));
  check(isNumber(value.id) && isNumber(value.issue) && isLogin(value.from) && proposalKinds.includes(value.kind) && isTime(value.at));
  return { id: value.id, issue: value.issue, from: value.from, kind: value.kind, areas: areaList(value.areas, 8), at: value.at };
}

function readOverlap(value) {
  check(hasExactKeys(value, ['prs', 'files', 'areas', 'at']));
  const prs = numberList(value.prs, 2);
  check(prs.length === 2 && prs[0] < prs[1] && isNumber(value.files) && isTime(value.at));
  return { prs, files: value.files, areas: areaList(value.areas, caps.areas), at: value.at };
}

function readRecent(value) {
  check(hasExactKeys(value, ['comment', 'issue', 'login', 'outcome', 'at']));
  check(isId(value.comment) && isNumber(value.issue) && isLogin(value.login) && outcomes.includes(value.outcome) && isTime(value.at));
  return { comment: value.comment, issue: value.issue, login: value.login, outcome: value.outcome, at: value.at };
}

function areaList(value, max) {
  check(Array.isArray(value) && value.length <= max && value.every(isArea) && unique(value));
  return [...value];
}

function numberList(value, max) {
  check(Array.isArray(value) && value.length <= max && value.every(isNumber) && unique(value));
  return [...value];
}

function items(value, max) {
  check(Array.isArray(value) && value.length <= max);
  return value;
}

function unique(values) {
  return new Set(values).size === values.length;
}

function check(condition) {
  ensure(condition, 'Invalid ATC board state');
}
