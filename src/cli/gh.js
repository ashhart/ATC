import { spawnSync } from 'node:child_process';
import { Failure } from '../core/failure.js';
import { commandText, isAreaReference, parseCommand } from '../core/commands.js';
import { isCursor, isNumber, isRecord, isRepository } from '../core/values.js';
import { createTransport, rateLimited, readHttpResponse, requestFailed, UncertainWrite } from './ghTransport.js';

export { UncertainWrite } from './ghTransport.js';

export function createGh(run = runGh, options = {}) {
  const transport = createTransport(run, options);
  const readOnly = options.readOnly === undefined ? process.env.ATC_READ_ONLY === '1' : options.readOnly;
  if (typeof readOnly !== 'boolean') throw new Failure('Invalid GitHub request limits.');
  function call(args, write = false) {
    const response = transport.request(args, write);
    if (!response || response.status !== 0) {
      transport.block();
      throw write ? new UncertainWrite() : new Failure(requestFailed);
    }
    try {
      if (write && typeof response.stdout === 'string' && !response.stdout.trim()) throw new UncertainWrite();
      const result = parse(response.stdout);
      transport.finish(write);
      return result;
    } catch (error) {
      transport.block();
      throw write ? new UncertainWrite() : error;
    }
  }
  function getOptional(path) {
    const response = transport.request(['api', '--include', '--method', 'GET', path]);
    let http;
    try { http = readHttpResponse(response?.stdout); }
    catch (error) { transport.block(); throw error; }
    if (http.limited) transport.block(rateLimited);
    if (http.status === 429 || http.status === 403 && http.limited) throw new Failure(rateLimited);
    if (http.status === 404) { transport.finish(); return null; }
    if (response?.status !== 0 || !(http.status >= 200 && http.status < 300)) {
      transport.block();
      throw new Failure(requestFailed);
    }
    const result = parse(http.body);
    transport.finish();
    return result;
  }
  return {
    get: path => call(['api', '--method', 'GET', path]),
    getOptional,
    graphql: (query, variables) => call(graphArgs(query, variables)),
    post(path, fields) {
      if (readOnly) throw new Failure('GitHub writes are disabled in read-only mode.');
      const body = validatePost(path, fields);
      return call(['api', '--method', 'POST', path, '-f', `body=${body}`], true);
    },
    repoView: () => call(['repo', 'view', '--json', 'nameWithOwner,isFork,parent'])
  };
}

function validatePost(path, fields) {
  const target = typeof path === 'string' ? path.match(/^repos\/([^/]+\/[^/]+)\/issues\/([1-9][0-9]{0,8})\/comments$/) : null;
  const keys = fields && typeof fields === 'object' && !Array.isArray(fields) ? Object.keys(fields) : [];
  const body = fields?.body;
  const command = parseCommand(body);
  if (!target || target[0] !== path || !isRepository(target[1]) || !isNumber(Number(target[2]))
    || keys.length !== 1 || keys[0] !== 'body' || !command || command.verb === 'invalid' || commandText(command) !== body
    || command.areas?.some(area => !isAreaReference(area))) {
    throw new Failure('Only typed ATC commands can be posted.');
  }
  return body;
}

function graphArgs(query, variables) {
  const keys = isRecord(variables) ? Object.keys(variables) : [];
  const checks = { owner: value => typeof value === 'string', name: value => typeof value === 'string', cursor: isCursor, number: isNumber };
  if (typeof query !== 'string' || query.length > 2000 || !query.startsWith('query(') || /mutation|subscription/i.test(query)
    || !keys.includes('owner') || !keys.includes('name') || !isRepository(`${variables.owner}/${variables.name}`)
    || keys.some(key => !Object.hasOwn(checks, key) || !checks[key](variables[key]))) {
    throw new Failure('Only typed ATC queries can be read.');
  }
  return ['api', 'graphql', '-f', `query=${query}`, ...keys.flatMap(key => [key === 'number' ? '-F' : '-f', `${key}=${variables[key]}`])];
}

function parse(text) {
  try {
    if (typeof text !== 'string') throw new Error();
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new Failure('The GitHub CLI returned unreadable output.');
  }
}

function runGh(args, { timeout }) {
  return spawnSync('gh', args, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' } });
}
