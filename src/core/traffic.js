import { trafficOpportunities } from './trafficOpportunities.js';
import { pullTraffic } from './trafficPulls.js';
import { presenceTtlMs } from './presence.js';

export function trafficView({ state, pulls, config, partial, limitations = [], now },
  { me, openIssues, identities, pullFiles, presence = [] }) {
  const limits = new Set(limitations);
  const actor = login => {
    const reference = identities.get(login);
    const valid = Number.isSafeInteger(reference) && reference > 0 && reference <= identities.size;
    if (!valid) limits.add('contributorReferencesUnavailable');
    return { contributor: valid ? reference : null, mine: login === me };
  };
  const traffic = pullTraffic(pulls, config, pullFiles, actor, limits);
  const seen = new Set();
  const fresh = presence.filter(flight => flight.active <= now && flight.active + presenceTtlMs > now && !seen.has(flight.session) && seen.add(flight.session));
  const contributors = contributorRows(state.claims, pulls, openIssues, actor, fresh.some(flight => flight.local !== false) ? [me] : []);
  const issues = issueRows(state.claims, traffic.pullRequests, openIssues, actor);
  const sessions = fresh
    .map(flight => ({ session: flight.session, contributor: flight.local === false ? null : actor(me).contributor, issue: flight.issue, state: flight.state,
      active: new Date(flight.active).toISOString(), expiresAt: new Date(flight.active + presenceTtlMs).toISOString(), local: flight.local !== false }))
    .sort((first, second) => first.session - second.session);
  const proposals = state.proposals.map(proposal => ({ id: proposal.id, issue: proposal.issue, kind: proposal.kind, areas: proposal.areas }));
  const duplicateAttempts = duplicates(issues, pulls);
  const staleClaims = stale(state.claims, pulls, config, now, actor);
  const complete = !partial && limits.size === 0;
  const opportunities = trafficOpportunities(issues, state.claims, config, me, complete);
  return {
    repository: 'selected', observedAt: new Date(now).toISOString(), complete, limitations: [...limits].sort(), coordinationEnabled: config.enabled !== false,
    summary: { contributors: contributors.length, issues: issues.length, openIssues: openIssues.length,
      openPullRequests: traffic.pullRequests.length, fileOverlaps: traffic.fileOverlaps.length, opportunities: opportunities.length,
      activeAgents: sessions.filter(session => session.state !== 'blocked').length, duplicateAttempts: duplicateAttempts.length, staleClaims: staleClaims.length },
    contributors, issues, ...traffic, opportunities, sessions, proposals, duplicateAttempts, staleClaims
  };
}

function duplicates(issues, pulls) {
  return issues.filter(issue => issue.state === 'open').map(issue => {
    const linked = pulls.filter(pull => pull.issues.includes(issue.issue));
    return { issue: issue.issue, authors: new Set(linked.map(pull => pull.author)).size, pullRequests: numbers(linked.map(pull => pull.number)) };
  }).filter(entry => entry.authors > 1).map(({ issue, pullRequests }) => ({ issue, pullRequests }));
}

function stale(claims, pulls, config, now, actor) {
  const threshold = now - config.idleDays * 43200000;
  return claims.filter(claim => claim.role === 'work' && claim.active < threshold
    && !pulls.some(pull => pull.author === claim.login && pull.issues.includes(claim.issue)))
    .map(claim => ({ issue: claim.issue, ...actor(claim.login), lastActivity: new Date(claim.active).toISOString(),
      expiresAt: new Date(claim.active + config.idleDays * 86400000).toISOString() }))
    .sort((first, second) => first.issue - second.issue || (first.contributor ?? Infinity) - (second.contributor ?? Infinity));
}

function contributorRows(claims, pulls, openIssues, actor, present) {
  const contributors = new Map();
  function add(login, field, number) {
    const { contributor, mine } = actor(login);
    const key = contributor === null ? login : contributor;
    if (!contributors.has(key)) contributors.set(key, { id: contributor, mine,
      workingIssues: [], reviewingIssues: [], assignedIssues: [], pullRequests: [] });
    const row = contributors.get(key);
    row.mine ||= mine;
    if (field) row[field].push(number);
  }
  for (const login of present) add(login);
  for (const claim of claims) add(claim.login, claim.role === 'work' ? 'workingIssues' : 'reviewingIssues', claim.issue);
  for (const issue of openIssues) {
    for (const assignee of issue.assignees) add(assignee.login, 'assignedIssues', issue.number);
  }
  for (const pull of pulls) add(pull.author, 'pullRequests', pull.number);
  return [...contributors.entries()].sort(compareContributors).map(([, row]) => ({ ...row, workingIssues: numbers(row.workingIssues),
    reviewingIssues: numbers(row.reviewingIssues), assignedIssues: numbers(row.assignedIssues), pullRequests: numbers(row.pullRequests) }));
}

function issueRows(claims, pulls, openIssues, actor) {
  const open = new Map(openIssues.map(issue => [issue.number, issue]));
  const known = numbers([...open.keys(), ...claims.map(claim => claim.issue), ...pulls.flatMap(pull => pull.issues)]);
  return known.map(issue => {
    const details = open.get(issue);
    const assignments = (details?.assignees || []).map(assignee => actor(assignee.login))
      .sort((first, second) => (first.contributor ?? Infinity) - (second.contributor ?? Infinity) || Number(second.mine) - Number(first.mine));
    const held = claims.filter(claim => claim.issue === issue).sort((first, second) => first.login < second.login ? -1 : first.login > second.login ? 1 : 0)
      .map(claim => ({ ...actor(claim.login), role: claim.role,
      areas: [...claim.areas].sort(), since: new Date(claim.since).toISOString(), lastActivity: new Date(claim.active).toISOString() }))
      .sort((first, second) => (first.contributor ?? Infinity) - (second.contributor ?? Infinity) || first.role.localeCompare(second.role));
    return { issue, state: details ? 'open' : 'unknown', helpWanted: Boolean(details?.helpWanted), goodFirstIssue: Boolean(details?.goodFirstIssue),
      assignees: assignments, claims: held, pullRequests: pulls.filter(pull => pull.issues.includes(issue)).map(pull => pull.pullRequest) };
  });
}

function numbers(values) {
  return [...new Set(values)].sort((first, second) => first - second);
}

function compareContributors([firstKey, first], [secondKey, second]) {
  const referenceOrder = (first.id ?? Infinity) - (second.id ?? Infinity);
  return referenceOrder || (firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0);
}
