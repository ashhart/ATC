import { areas, check, flightPhase, heartbeatTtl, isFreshAgent, list, numbers, refreshFeed, timestamp } from './schema.js';
import { isId, isNumber } from '../core/values.js';

export function collectBoardFeed(board, now = Date.now()) {
  check(board && typeof board === 'object' && typeof board.complete === 'boolean');
  timestamp(board.observedAt);
  const allSessions = list(board.sessions || [], 60000).map(session => readSession(session, now));
  const recorded = allSessions.sort((first, second) => Date.parse(second.lastSeen) - Date.parse(first.lastSeen) || first.session - second.session).slice(0, 5000);
  const references = new Map([...new Set(recorded.map(session => session.session))].sort((first, second) => first - second)
    .map((session, index) => [session, index + 1]));
  const sessions = recorded.map(session => ({ ...session, ref: references.get(session.session) }));
  const sourceIssues = list(board.issues, 7000);
  const activeIssues = new Set(sessions.map(session => session.issue));
  const issues = [...sourceIssues].sort((first, second) => Number(activeIssues.has(second.issue)) - Number(activeIssues.has(first.issue))
    || first.issue - second.issue).slice(0, 1000);
  const flights = issues.map(issue => readFlight(issue, sessions, now));
  const sourceOffers = list(board.proposals || [], 10000);
  const offers = sourceOffers.slice(0, 1000).map(proposal => {
    check(isId(proposal.id) && isNumber(proposal.issue) && ['pair', 'split', 'takeover', 'review'].includes(proposal.kind));
    areas(proposal.areas);
    return { id: proposal.id, issue: proposal.issue, kind: proposal.kind, areas: [...proposal.areas] };
  });
  const sourceOverlaps = list(board.fileOverlaps, 19900);
  const overlaps = sourceOverlaps.slice(0, 1000).map(overlap => {
    numbers(overlap.pullRequests, 2); areas(overlap.areas);
    check(overlap.pullRequests.length === 2 && Number.isSafeInteger(overlap.sharedFiles) && overlap.sharedFiles >= 1 && overlap.sharedFiles <= 600);
    const matched = flights.filter(flight => flight.pullRequests.some(number => overlap.pullRequests.includes(number))).map(flight => flight.issue);
    return { issues: matched, pullRequests: [...overlap.pullRequests], sharedFiles: overlap.sharedFiles, areas: [...overlap.areas] };
  });
  const recent = sessions.filter(session => Date.parse(session.lastSeen) <= now).sort((first, second) => Date.parse(second.lastSeen) - Date.parse(first.lastSeen))
    .slice(0, 40).map(session => ({ id: session.ref, time: session.lastSeen,
      kind: session.state === 'reviewing' ? 'review' : 'checkIn', issue: session.issue, agents: 1 }));
  const complete = board.complete && allSessions.length <= 5000 && sourceIssues.length <= 1000 && sourceOffers.length <= 1000 && sourceOverlaps.length <= 1000;
  const feed = { schemaVersion: 1, source: 'github', connection: complete ? 'live' : 'stale', observedAt: board.observedAt,
    complete, summary: {}, flights, offers, overlaps, recent };
  return refreshFeed(feed, now);
}

function readSession(session, now) {
  check(session && isId(session.session) && isNumber(session.issue));
  check(session.contributor === null || Number.isSafeInteger(session.contributor) && session.contributor >= 1 && session.contributor <= 20000);
  check(['working', 'reviewing', 'blocked', 'idle'].includes(session.state));
  const active = timestamp(session.active);
  const expiry = timestamp(session.expiresAt);
  check(expiry - active === heartbeatTtl && active <= now + 5000);
  return { session: session.session, issue: session.issue, state: session.state,
    lastSeen: session.active, expiresAt: session.expiresAt };
}

function readFlight(issue, sessions, now) {
  check(issue && isNumber(issue.issue));
  numbers(issue.pullRequests, 300);
  const claims = list(issue.claims, 3000);
  const scope = new Set();
  let lastActivity = null;
  for (const claim of claims) {
    areas(claim.areas);
    const at = timestamp(claim.lastActivity);
    if (lastActivity === null || at > Date.parse(lastActivity)) lastActivity = claim.lastActivity;
    for (const area of claim.areas) scope.add(area);
  }
  const known = new Map();
  for (const session of sessions.filter(value => value.issue === issue.issue)) {
    const prior = known.get(session.ref);
    if (!prior || Date.parse(session.lastSeen) > Date.parse(prior.lastSeen)) known.set(session.ref, session);
  }
  const agents = [...known.values()].sort((first, second) => first.ref - second.ref)
    .map(({ ref, state, lastSeen, expiresAt }) => ({ ref, state: isFreshAgent({ lastSeen, expiresAt }, now) ? state : 'idle', lastSeen, expiresAt }));
  for (const agent of agents) {
    if (lastActivity === null || Date.parse(agent.lastSeen) > Date.parse(lastActivity)) lastActivity = agent.lastSeen;
  }
  return { issue: issue.issue, phase: flightPhase(agents, now), agents, areas: [...scope].sort((first, second) => first - second),
    pullRequests: [...issue.pullRequests], lastActivity };
}
