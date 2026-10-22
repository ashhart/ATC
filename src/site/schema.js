import { ensure } from '../core/failure.js';
import { isId, isNumber, readTimestamp } from '../core/values.js';

export const heartbeatTtl = 300000;
const message = 'Invalid traffic feed.';
const phases = ['working', 'reviewing', 'blocked', 'idle'];

export function validateFeed(feed, now = Date.now()) {
  exact(feed, ['schemaVersion', 'source', 'connection', 'observedAt', 'complete', 'summary', 'flights', 'offers', 'overlaps', 'recent']);
  check(feed.schemaVersion === 1 && ['demo', 'github'].includes(feed.source));
  check(['live', 'refreshing', 'stale', 'error'].includes(feed.connection));
  check(typeof feed.complete === 'boolean');
  timestamp(feed.observedAt);
  if (feed.connection === 'live') check(feed.complete && freshObservation(feed.observedAt, now));
  list(feed.flights, 1000).forEach(flight => {
    exact(flight, ['issue', 'phase', 'agents', 'areas', 'pullRequests', 'lastActivity']);
    check(isNumber(flight.issue) && phases.includes(flight.phase));
    areas(flight.areas); numbers(flight.pullRequests, 300);
    if (flight.lastActivity !== null) timestamp(flight.lastActivity);
    list(flight.agents, 5000).forEach(agent => {
      exact(agent, ['ref', 'state', 'lastSeen', 'expiresAt']);
      check(ordinal(agent.ref) && phases.includes(agent.state));
      const active = timestamp(agent.lastSeen);
      const expiry = timestamp(agent.expiresAt);
      check(expiry - active === heartbeatTtl);
    });
    check(new Set(flight.agents.map(agent => agent.ref)).size === flight.agents.length);
    check(flight.phase === flightPhase(flight.agents, now));
  });
  check(new Set(feed.flights.map(flight => flight.issue)).size === feed.flights.length);
  check(feed.flights.reduce((total, flight) => total + flight.agents.length, 0) <= 5000);
  list(feed.offers, 1000).forEach(offer => {
    exact(offer, ['id', 'issue', 'kind', 'areas']);
    check(isId(offer.id) && isNumber(offer.issue) && ['pair', 'split', 'takeover', 'review'].includes(offer.kind));
    areas(offer.areas);
  });
  list(feed.overlaps, 1000).forEach(overlap => {
    exact(overlap, ['pullRequests', 'sharedFiles', 'areas'], ['issues']);
    numbers(overlap.pullRequests, 100);
    if (overlap.issues !== undefined) numbers(overlap.issues, 1000);
    check(Number.isSafeInteger(overlap.sharedFiles) && overlap.sharedFiles >= 1 && overlap.sharedFiles <= 600);
    areas(overlap.areas);
  });
  list(feed.recent, 40).forEach(event => {
    exact(event, ['id', 'time', 'kind', 'issue', 'agents']);
    check(isId(event.id) && isNumber(event.issue) && ['started', 'checkIn', 'review', 'offer', 'landed'].includes(event.kind));
    timestamp(event.time);
    check(Number.isSafeInteger(event.agents) && event.agents >= 0 && event.agents <= 20000);
  });
  exact(feed.summary, ['activeAgents', 'inFlight', 'reviewing', 'blocked', 'overlaps', 'offers']);
  const summary = summarize(feed, now);
  for (const key of Object.keys(summary)) check(feed.summary[key] === summary[key]);
  return feed;
}

export function refreshFeed(feed, now = Date.now()) {
  const result = structuredClone(feed);
  if (result.connection === 'live' && (!result.complete || !freshObservation(result.observedAt, now))) result.connection = 'stale';
  for (const flight of result.flights) {
    for (const agent of flight.agents) if (!isFreshAgent(agent, now)) agent.state = 'idle';
    flight.phase = flightPhase(flight.agents, now);
  }
  result.summary = summarize(result, now);
  return validateFeed(result, now);
}

export function summarize(feed, now) {
  const active = new Set();
  for (const flight of feed.flights) {
    for (const agent of flight.agents) {
      if (isFreshAgent(agent, now) && ['working', 'reviewing'].includes(agent.state)) active.add(agent.ref);
    }
  }
  return { activeAgents: active.size, inFlight: feed.flights.filter(flight => flight.phase === 'working').length,
    reviewing: feed.flights.filter(flight => flight.phase === 'reviewing').length,
    blocked: feed.flights.filter(flight => flight.phase === 'blocked').length, overlaps: feed.overlaps.length, offers: feed.offers.length };
}

export function flightPhase(agents, now) {
  const states = agents.filter(agent => isFreshAgent(agent, now)).map(agent => agent.state);
  return ['blocked', 'working', 'reviewing'].find(state => states.includes(state)) || 'idle';
}

export function isFreshAgent(agent, now) {
  return Date.parse(agent.lastSeen) <= now && Date.parse(agent.expiresAt) > now;
}

export function exact(value, required, optional = []) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  const keys = Object.keys(value);
  check(required.every(key => Object.hasOwn(value, key)) && keys.every(key => required.includes(key) || optional.includes(key)));
}

export function list(value, limit) {
  check(Array.isArray(value) && value.length <= limit);
  return value;
}

export function numbers(value, limit = 100) {
  check(list(value, limit).every(isNumber) && new Set(value).size === value.length);
}

export function areas(value) {
  check(list(value, 24).every(area => Number.isSafeInteger(area) && area >= 1 && area <= 24) && new Set(value).size === value.length);
}

export function ordinal(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 5000;
}

export function timestamp(value) {
  const at = readTimestamp(value);
  check(at !== null);
  return at;
}

export function check(value) {
  ensure(Boolean(value), message);
}

function freshObservation(value, now) {
  const at = Date.parse(value);
  return at <= now + 5000 && at >= now - heartbeatTtl;
}
