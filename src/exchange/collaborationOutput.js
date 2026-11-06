import { exact, isKey, isHead, isDigest, isNumber, isId, isTime, digest, kinds, maximumEvidence } from './values.js';
import { isCapability } from './collaborationSchema.js';
import { helpStates } from './collaborationView.js';

const boolean = x => typeof x === 'boolean';
const nullable = check => value => value === null || check(value);
const list = (check, max) => value => Array.isArray(value) && value.length <= max && value.every(check);
const size = x => Number.isInteger(x) && x > 0 && x <= maximumEvidence;
const item = x => exact(x, { id: isKey, pull: isNumber, kind: y => kinds.includes(y), capability: isCapability,
  required: boolean, independent: boolean, public: boolean, head: isHead, base: nullable(isHead),
  state: y => helpStates.includes(y), expiresAt: nullable(isTime), createdAt: isTime });
const handoff = x => exact(x, { id: isKey, pull: isNumber, issue: isNumber, head: isHead, base: isHead,
  report: isKey, digest: isDigest, size, createdAt: isTime, decision: y => ['offered', 'accepted', 'cancelled'].includes(y),
  stale: boolean, mine: boolean, forMe: boolean });
const pickup = x => exact(x, { id: isKey, proof: isId, consumer: isKey, expiresAt: isTime, mine: boolean });
const part = x => exact(x, { kind: y => ['head', 'base', 'feedback', 'dependencies', 'request', 'help', 'handoff'].includes(y),
  id: nullable(isKey), revision: isDigest });
const change = x => exact(x, { kind: y => ['head', 'base', 'feedback', 'dependencies', 'request', 'help', 'handoff'].includes(y),
  id: nullable(isKey), change: y => ['added', 'changed', 'removed'].includes(y) });

export function isCollaborationOutput(value) {
  if (value?.type !== 'collaboration') return false;
  const prefix = { type: x => x === 'collaboration' };
  if (value.view) {
    const common = { ...prefix, version: x => x === 1, observedAt: isTime };
    if (value.view === 'queue') return exact(value, { ...common, view: x => x === 'queue', items: list(item, 50), next: nullable(isKey) });
    if (value.view === 'matrix') return exact(value, { ...common, view: x => x === 'matrix', pull: isNumber,
      head: isHead, base: isHead, qualified: boolean, items: list(item, 100), handoffs: list(handoff, 100), pickups: list(pickup, 100) })
      && value.items.every(x => x.pull === value.pull)
      && value.qualified === (value.items.some(x => x.required) && value.items.filter(x => x.required).every(x => x.state === 'passed'));
    if (value.view === 'snapshot') return exact(value, { ...common, view: x => x === 'snapshot', pull: isNumber,
      cursor: isDigest, parts: list(part, 304) }) && value.cursor === digest(JSON.stringify(value.parts))
      && new Set(value.parts.map(x => `${x.kind}/${x.id}`)).size === value.parts.length;
    if (value.view === 'catchup') return exact(value, { ...common, view: x => x === 'catchup', pull: isNumber,
      cursor: isDigest, changes: list(change, 608) });
    return false;
  }
  if (value.outcome === 'identity') return exact(value, { ...prefix, outcome: x => x === 'identity', pull: isNumber, proof: isId });
  if (value.outcome === 'acknowledged') return exact(value, { ...prefix, outcome: x => x === 'acknowledged', cursor: isDigest });
  const outcomes = ['offered', 'released', 'handoffOffered', 'handoffDecided'];
  if (outcomes.includes(value.outcome)) return exact(value, { ...prefix, outcome: x => outcomes.includes(x), id: isKey });
  return exact(value, { ...prefix, outcome: x => x === 'taken', id: isKey, expiresAt: isTime });
}
