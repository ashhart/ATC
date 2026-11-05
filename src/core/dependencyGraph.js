import { ensure } from './failure.js';
import { isNumber, isRecord } from './values.js';

const failure = 'Invalid pull request dependencies.';

export function dependencyGraph(nodes, roots) {
  ensure(Array.isArray(nodes) && nodes.length <= 64 && Array.isArray(roots) && roots.length >= 1 && roots.length <= 16
    && roots.every(isNumber) && new Set(roots).size === roots.length, failure);
  const byNumber = new Map();
  for (const node of nodes) {
    ensure(isRecord(node) && Object.keys(node).length === 3 && isNumber(node.pull)
      && ['open', 'merged', 'closed'].includes(node.state) && Array.isArray(node.dependencies) && node.dependencies.length <= 16
      && node.dependencies.every(isNumber) && new Set(node.dependencies).size === node.dependencies.length && !byNumber.has(node.pull), failure);
    byNumber.set(node.pull, node);
  }
  const order = [], cycles = new Set(), missing = new Set(), done = new Set(), active = [];
  function visit(number) {
    if (active.includes(number)) { for (const id of active.slice(active.indexOf(number))) cycles.add(id); return; }
    if (done.has(number)) return;
    const node = byNumber.get(number);
    if (!node) { missing.add(number); return; }
    active.push(number);
    if (node.state === 'open') for (const dependency of [...node.dependencies].sort((a, b) => a - b)) visit(dependency);
    active.pop(); done.add(number);
    if (node.state === 'open') order.push(number);
  }
  for (const root of [...roots].sort((a, b) => a - b)) visit(root);
  const blocked = new Set();
  function blocks(number, seen = new Set()) {
    const node = byNumber.get(number);
    if (!node || node.state === 'closed' || cycles.has(number)) return true;
    if (node.state === 'merged' || seen.has(number)) return false;
    const next = new Set([...seen, number]);
    return node.dependencies.some(id => blocks(id, next));
  }
  for (const number of done) if (blocks(number)) blocked.add(number);
  const ready = [...done].filter(number => {
    const node = byNumber.get(number);
    return node.state === 'open' && !blocked.has(number)
      && node.dependencies.every(id => byNumber.get(id)?.state === 'merged');
  }).sort((a, b) => a - b);
  return { order: cycles.size > 0 ? [] : order.filter(id => !blocked.has(id)), ready,
    blocked: [...blocked].sort((a, b) => a - b), cycles: [...cycles].sort((a, b) => a - b), missing: [...missing].sort((a, b) => a - b) };
}
