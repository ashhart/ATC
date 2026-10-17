import { assign, comment, result, unassign } from './effects.js';
import { caps, claimsOn, pruneAfterRemoval } from './state.js';

export function claimIssue(state, { login, issue, areas, open }, config, now) {
  if (!open) return result('notClaimable', [comment(issue, 'notClaimable')]);
  if (!knownAreas(areas, config)) return result('unknownArea', [comment(issue, 'unknownArea', { areas: configuredAreas(config) })]);
  const own = state.claims.find(claim => claim.issue === issue && claim.login === login);
  if (own?.role === 'work') {
    own.areas = areas;
    own.active = now;
    return result('claimUpdated', [comment(issue, 'claimUpdated', { login, areas })]);
  }
  const work = claimsOn(state, issue, 'work');
  if (work.length > 0) return result('claimTaken', [comment(issue, 'claimTaken', { claimants: work.map(claim => claim.login) })]);
  const held = state.claims.filter(claim => claim.login === login && claim.role === 'work').length;
  if (held >= config.maxClaimsPerUser) return result('claimLimit', [comment(issue, 'claimLimit', { login, limit: config.maxClaimsPerUser })]);
  if (state.claims.length >= caps.claims) return result('boardFull');
  addClaim(state, { issue, login, role: 'work', areas }, now);
  const overlaps = areaOverlaps(state, issue, areas);
  return result('claimed', [assign(issue, [login]), comment(issue, 'claimed', { login, areas, overlaps })]);
}

export function releaseClaim(state, { login, issue }) {
  const mine = state.claims.filter(claim => claim.issue === issue && claim.login === login);
  if (mine.length === 0) return result('nothingToRelease');
  state.claims = state.claims.filter(claim => !(claim.issue === issue && claim.login === login));
  state.proposals = state.proposals.filter(proposal => !(proposal.issue === issue && proposal.from === login));
  pruneAfterRemoval(state, issue);
  const effects = mine.some(claim => claim.role === 'work') ? [unassign(issue, [login])] : [];
  return result('released', [...effects, comment(issue, 'released', { login })]);
}

export function resetIssue(state, issue) {
  const work = claimsOn(state, issue, 'work').map(claim => claim.login);
  closeIssue(state, issue);
  return result('reset', [...(work.length > 0 ? [unassign(issue, work)] : []), comment(issue, 'reset')]);
}

export function closeIssue(state, issue) {
  state.claims = state.claims.filter(claim => claim.issue !== issue);
  state.proposals = state.proposals.filter(proposal => proposal.issue !== issue);
  pruneAfterRemoval(state, issue);
}

export function expireClaims(state, config, now) {
  const cutoff = now - config.idleDays * 86400000;
  const expired = state.claims.filter(claim => claim.active < cutoff);
  state.claims = state.claims.filter(claim => claim.active >= cutoff);
  state.proposals = state.proposals.filter(proposal => proposal.at >= now - config.proposalDays * 86400000);
  for (const claim of expired) pruneAfterRemoval(state, claim.issue);
  return expired.flatMap(claim => [
    ...(claim.role === 'work' ? [unassign(claim.issue, [claim.login])] : []),
    comment(claim.issue, 'expired', { login: claim.login, days: config.idleDays })
  ]);
}

export function addClaim(state, { issue, login, role, areas }, now) {
  state.claims = state.claims.filter(claim => !(claim.issue === issue && claim.login === login));
  state.claims.push({ issue, login, role, areas: [...areas].sort(), since: now, active: now, prs: [] });
}

export function knownAreas(areas, config) {
  return areas.every(area => Object.hasOwn(config.areas, area));
}

export function configuredAreas(config) {
  return Object.keys(config.areas).sort();
}

function areaOverlaps(state, issue, areas) {
  return state.claims.filter(claim => claim.issue !== issue && claim.role === 'work')
    .map(claim => ({ issue: claim.issue, login: claim.login, areas: claim.areas.filter(area => areas.includes(area)) }))
    .filter(overlap => overlap.areas.length > 0)
    .slice(0, 5);
}
