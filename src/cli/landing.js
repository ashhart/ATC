import { ensure } from '../core/failure.js';
import { readConfig } from '../core/config.js';
import { isActorLogin, isId, isLogin, isNumber, isRecord, isRepository, readTimestamp } from '../core/values.js';
import { parseCommand } from '../core/commands.js';
import { dependencyGraph } from '../core/dependencyGraph.js';
import { createReader } from './reader.js';
import { hasTime } from './timeBudget.js';

const failure = 'Invalid pull request dependencies.';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && value.length === 40;
const list = (value, maximum = 64) => Array.isArray(value) && value.length <= maximum && value.every(isNumber) && new Set(value).size === value.length;
const exact = (value, fields) => isRecord(value) && Object.keys(value).length === Object.keys(fields).length
  && Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]));

export function runLanding(command, rest, context) {
  const { gh, repository, me, now = Date.now, readOnly = false, dryRun = false } = context;
  ensure(isRepository(repository) && isLogin(me) && ['depends', 'landing'].includes(command)
    && Array.isArray(rest) && rest.length >= 1 && rest.length <= (command === 'depends' ? 17 : 16), failure);
  const numbers = rest.map(number => {
    ensure(typeof number === 'string' && /^[1-9][0-9]{0,8}$/.test(number) && !/[\r\n]/.test(number) && isNumber(Number(number)), failure);
    return Number(number);
  });
  ensure(new Set(numbers).size === numbers.length, failure);
  const reader = context.reader || createReader(gh, repository);
  const config = readConfig(reader.config());
  if (command === 'depends') return updateDependencies(numbers, { ...context, now, reader, config, readOnly, dryRun });
  return inspectLanding(numbers, { gh, repository, reader, now });
}

function readPull(gh, repository, number) {
  const value = gh.getOptional(`repos/${repository}/pulls/${number}`);
  if (value === null) return null;
  ensure(value?.number === number && ['open', 'closed'].includes(value.state) && typeof value.merged === 'boolean'
    && (!value.merged || value.state === 'closed')
    && isActorLogin(value.user?.login) && sha(value.head?.sha) && sha(value.base?.sha)
    && isRepository(value.base?.repo?.full_name) && value.base.repo.full_name.toLowerCase() === repository.toLowerCase(), failure);
  return { pull: number, state: value.merged ? 'merged' : value.state, author: value.user.login.toLowerCase(),
    head: value.head.sha, base: value.base.sha };
}

function readDependencies(reader, repository, pull, now, gh) {
  const result = reader.issueComments(pull.pull);
  ensure(Array.isArray(result?.items) && typeof result.partial === 'boolean', failure);
  const comments = result.items;
  ensure(comments.length <= 3000, failure);
  const seen = new Set();
  ensure(comments.every(value => isId(value?.id) && !seen.has(value.id) && seen.add(value.id)), failure);
  let dependencies = [];
  for (const value of [...comments].sort((a, b) => a.id - b.id)) {
    if (value.user?.type !== 'User' || !isLogin(value.user.login) || readTimestamp(value.created_at) === null
      || value.created_at !== value.updated_at || readTimestamp(value.created_at) > now) continue;
    const expected = `https://api.github.com/repos/${repository}/issues/${pull.pull}`;
    if (typeof value.issue_url !== 'string' || value.issue_url.length > 256 || value.issue_url.toLowerCase() !== expected.toLowerCase()) continue;
    const owner = value.user.login.toLowerCase() === pull.author;
    if (!owner && !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(value.author_association)) continue;
    ensure(typeof value.body === 'string' && value.body.length <= 65536, failure);
    const command = parseCommand(value.body);
    if (command?.verb !== 'depends') continue;
    if (!owner) {
      const access = gh.getOptional(`repos/${repository}/collaborators/${value.user.login}/permission`);
      if (!['write', 'admin'].includes(access?.permission) || !isLogin(access.user?.login)
        || access.user.login.toLowerCase() !== value.user.login.toLowerCase()) continue;
    }
    dependencies = [...command.pulls];
  }
  return { dependencies, complete: !result.partial };
}

function inspectLanding(roots, { gh, repository, reader, now }) {
  const observed = now(), queue = [...roots].sort((a, b) => a - b), rows = [], missing = new Set(), limitations = new Set();
  const seen = new Set();
  while (queue.length > 0) {
    const number = queue.shift();
    if (seen.has(number)) continue;
    if (seen.size >= 64) { limitations.add('dependencyLimit'); break; }
    if (!hasTime(gh, 1000)) { limitations.add('timeLimit'); break; }
    seen.add(number);
    try {
      const pull = readPull(gh, repository, number);
      if (!pull) { missing.add(number); limitations.add('pullUnavailable'); continue; }
      const read = pull.state === 'merged' ? { dependencies: [], complete: true } : readDependencies(reader, repository, pull, observed, gh);
      if (!read.complete) limitations.add('commentsLimit');
      rows.push({ pull: pull.pull, state: pull.state, head: pull.head, base: pull.base, dependencies: read.dependencies });
      for (const dependency of read.dependencies) if (!seen.has(dependency)) queue.push(dependency);
    } catch { limitations.add('pullUnavailable'); missing.add(number); }
  }
  const graph = dependencyGraph(rows.map(({ pull, state, dependencies }) => ({ pull, state, dependencies })), roots);
  const complete = limitations.size === 0 && graph.missing.length === 0;
  const blocked = graph.blocked.length > 0 || graph.cycles.length > 0;
  const advice = !complete ? 'incomplete' : blocked ? 'blocked' : roots.every(id => rows.find(x => x.pull === id)?.state === 'merged')
    ? 'landed' : roots.every(id => graph.ready.includes(id) || rows.find(x => x.pull === id)?.state === 'merged') ? 'ready' : 'waiting';
  return displayLanding({ command: 'landing', repository: 'selected', observedAt: new Date(observed).toISOString(), complete,
    limitations: [...limitations].sort(), roots: [...roots].sort((a, b) => a - b), advice,
    pulls: rows.sort((a, b) => a.pull - b.pull), order: graph.order, ready: graph.ready, blocked: graph.blocked,
    cycles: graph.cycles, missing: [...new Set([...missing, ...graph.missing])].sort((a, b) => a - b) });
}

function updateDependencies([pull, ...dependencies], context) {
  const { gh, repository, me, reader, config, readOnly, dryRun, now } = context;
  const output = (outcome, posted = false, comment = null) => displayLanding({ command: 'depends', repository: 'selected', pull,
    dependencies: [...dependencies].sort((a, b) => a - b), outcome, posted, comment });
  if (!config.enabled) return output('notEnabled');
  if (!config.areasPinned) return output('incomplete');
  if (readOnly) return output('readOnly');
  const target = readPull(gh, repository, pull);
  if (!target || target.state !== 'open') return output('notOpen');
  if (target.author !== me.toLowerCase()) {
    let access;
    try { access = gh.getOptional(`repos/${repository}/collaborators/${me}/permission`); } catch {}
    if (!['write', 'admin'].includes(access?.permission) || !isLogin(access.user?.login)
      || access.user.login.toLowerCase() !== me.toLowerCase()) return output('notAuthorized');
  }
  const current = readDependencies(reader, repository, target, now(), gh);
  if (!current.complete) return output('incomplete');
  for (const number of dependencies) if (!readPull(gh, repository, number)) return output('dependencyUnavailable');
  if (dryRun) return output('dryRun');
  const posted = gh.post(`repos/${repository}/issues/${pull}/comments`, { body: ['/atc', 'depends', ...dependencies.sort((a, b) => a - b)].join(' ') });
  ensure(isId(posted?.id), failure);
  const confirmed = readDependencies(reader, repository, target, now(), gh);
  if (!confirmed.complete || JSON.stringify(confirmed.dependencies) !== JSON.stringify(dependencies)) return output('pending', true, posted.id);
  return output('dependenciesUpdated', true, posted.id);
}

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
