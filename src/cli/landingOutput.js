import { ensure } from '../core/failure.js';
import { isId, isNumber, isRecord, readTimestamp } from '../core/values.js';
import { dependencyGraph } from '../core/dependencyGraph.js';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && value.length === 40;
const list = (value, maximum = 64) => Array.isArray(value) && value.length <= maximum && value.every(isNumber) && new Set(value).size === value.length;
const exact = (value, fields) => isRecord(value) && Object.keys(value).length === Object.keys(fields).length
  && Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]));

export function displayLanding(value) {
  const check = condition => ensure(condition, 'ATC output failed validation.');
  if (value?.command === 'depends') {
    check(exact(value, { command: x => x === 'depends', repository: x => x === 'selected', pull: isNumber, dependencies: x => list(x, 16),
      outcome: x => ['notEnabled', 'readOnly', 'notOpen', 'notAuthorized', 'incomplete', 'dependencyUnavailable', 'dryRun', 'pending', 'dependenciesUpdated'].includes(x),
      posted: x => typeof x === 'boolean', comment: x => x === null || isId(x) }));
  } else {
    check(exact(value, { command: x => x === 'landing', repository: x => x === 'selected', observedAt: x => readTimestamp(x) !== null && x.length === 24,
      complete: x => typeof x === 'boolean', limitations: x => Array.isArray(x) && x.length <= 4
        && x.every(y => ['dependencyLimit', 'timeLimit', 'pullUnavailable', 'commentsLimit'].includes(y)), roots: x => list(x, 16) && x.length > 0,
      advice: x => ['incomplete', 'blocked', 'landed', 'ready', 'waiting'].includes(x), order: x => list(x), ready: x => list(x), blocked: x => list(x), cycles: x => list(x), missing: x => list(x, 1024),
      pulls: x => Array.isArray(x) && x.length <= 64 && x.every(y => exact(y, { pull: isNumber, state: z => ['open', 'closed', 'merged'].includes(z),
        head: sha, base: sha, dependencies: z => list(z, 16) })) }));
    check(new Set(value.limitations).size === value.limitations.length
      && value.complete === (value.limitations.length === 0 && value.missing.length === 0)
      && (value.advice === 'incomplete') === !value.complete);
    const graph = dependencyGraph(value.pulls.map(({ pull, state, dependencies }) => ({ pull, state, dependencies })), value.roots);
    for (const key of ['order', 'ready', 'blocked', 'cycles']) check(JSON.stringify(value[key]) === JSON.stringify(graph[key]));
    check(graph.missing.every(id => value.missing.includes(id)));
  }
  return value;
}
