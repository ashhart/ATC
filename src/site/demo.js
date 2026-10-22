import { heartbeatTtl, refreshFeed } from './schema.js';

export function demoFeed(now = Date.now(), tick = 0) {
  const rows = [[142, 'working', [1, 2]], [156, 'working', [3, 4]], [163, 'reviewing', [5, 6]],
    [171, 'blocked', [7]], [184, 'working', [8]], [192, 'reviewing', [9]], [203, 'idle', [10]], [218, 'working', [11, 12]]];
  const flights = rows.map(([issue, state, refs], index) => {
    const active = now - (state === 'idle' ? heartbeatTtl + 90000 : 5000 + index * 6000);
    return { issue, phase: state, agents: refs.map(ref => ({ ref, state,
      lastSeen: iso(active), expiresAt: iso(active + heartbeatTtl) })), areas: [index % 4 + 1],
      pullRequests: index < 6 ? [301 + index] : [], lastActivity: iso(active) };
  });
  const recent = [{ id: 9001 + tick * 10, time: iso(now - 5000), kind: tick % 2 ? 'checkIn' : 'started', issue: 142, agents: 2 },
    { id: 9002 + tick * 10, time: iso(now - 17000), kind: 'review', issue: 163, agents: 2 },
    { id: 9003 + tick * 10, time: iso(now - 43000), kind: 'offer', issue: 184, agents: 1 },
    { id: 9004 + tick * 10, time: iso(now - 75000), kind: 'landed', issue: 137, agents: 1 }];
  return refreshFeed({ schemaVersion: 1, source: 'demo', connection: 'live', observedAt: iso(now), complete: true, summary: {}, flights,
    offers: [{ id: 8001, issue: 184, kind: 'pair', areas: [] }, { id: 8002, issue: 163, kind: 'review', areas: [] }],
    overlaps: [{ issues: [142, 156], pullRequests: [301, 302], sharedFiles: 3, areas: [1, 2] }], recent }, now);
}

export function emptyFeed(now = Date.now(), connection = 'refreshing') {
  return refreshFeed({ schemaVersion: 1, source: 'github', connection, observedAt: iso(now), complete: false,
    summary: {}, flights: [], offers: [], overlaps: [], recent: [] }, now);
}

function iso(value) {
  return new Date(value).toISOString();
}
