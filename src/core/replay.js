import { claimIssue, decideProposal, dropIssue, proposeWork, releaseClaim, renewClaim, resetIssue, tidy } from './rules.js';

const activityOutcomes = ['claimed', 'claimUpdated', 'renewed', 'released', 'reset', 'proposed', 'withdrawn', 'declined', 'accepted'];

export function replay(events, { closed }, config, now) {
  const state = { claims: [], proposals: [], outcomes: new Map() };
  for (const event of events) {
    if (event.at > now) continue;
    expire(state, event.at, config);
    const outcome = apply(state, event, closed, config);
    state.outcomes.set(event.id, outcome);
    const own = state.claims.find(claim => claim.issue === event.issue && claim.login === event.login);
    if (own && activityOutcomes.includes(outcome)) own.active = Math.max(own.active, event.at);
  }
  expire(state, now, config);
  for (const issue of closed) dropIssue(state, issue);
  return state;
}

function apply(state, event, closed, config) {
  const { command, login, issue, at } = event;
  const open = !event.onPull && !closed.has(issue);
  if (command.verb === 'invalid') return 'invalid';
  if (command.verb === 'presence') return 'presenceProof';
  if (command.verb === 'claim') return claimIssue(state, { login, issue, areas: command.areas, open }, config, at);
  if (command.verb === 'renew') return renewClaim(state, { login, issue, open }, at);
  if (command.verb === 'release') return releaseClaim(state, { login, issue });
  if (command.verb === 'reset') return event.maintainer ? resetIssue(state, issue) : 'notAuthorized';
  if (command.verb === 'propose') return proposeWork(state, { id: event.id, login, issue, kind: command.kind, areas: command.areas, open }, config, at);
  return decideProposal(state, { login, issue, proposal: command.proposal, verb: command.verb }, config, at);
}

function expire(state, time, config) {
  const idle = config.idleDays * 86400000;
  const before = new Set(state.claims.map(claim => claim.issue));
  state.claims = state.claims.filter(claim => claim.active >= time - idle);
  state.proposals = state.proposals.filter(proposal => proposal.at >= time - config.proposalDays * 86400000);
  for (const issue of before) tidy(state, issue);
}
