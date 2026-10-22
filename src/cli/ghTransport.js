import { performance } from 'node:perf_hooks';
import { Failure, ensure } from '../core/failure.js';

export const requestFailed = 'The GitHub CLI request failed. Check `gh auth status` and the repository name.';
export const rateLimited = 'GitHub rate limit reached. Run the command again later.';
const deadlineExceeded = 'GitHub request deadline exceeded.';
const timedOut = 'GitHub did not answer in time. Run the command again.';

export class UncertainWrite extends Failure {
  constructor() {
    super('GitHub comment delivery could not be confirmed.');
  }
}

export class TimeLimit extends Failure {}

export function createTransport(run, options = {}) {
  ensure(options && typeof options === 'object' && !Array.isArray(options), 'Invalid GitHub request limits.');
  const now = options.now === undefined ? () => performance.now() : options.now;
  const maxRequests = options.maxRequests === undefined ? 500 : options.maxRequests;
  const deadlineMs = options.deadlineMs === undefined ? 30000 : options.deadlineMs;
  ensure(typeof run === 'function' && typeof now === 'function' && Number.isSafeInteger(maxRequests)
    && maxRequests >= 1 && maxRequests <= 500 && Number.isSafeInteger(deadlineMs)
    && deadlineMs >= 1 && deadlineMs <= 30000, 'Invalid GitHub request limits.');
  let last = now();
  ensure(Number.isFinite(last), 'Invalid GitHub request clock.');
  const deadline = last + deadlineMs;
  let requests = 0;
  let blocked = null;
  let blockedByTime = false;
  function remaining() {
    const current = now();
    ensure(Number.isFinite(current), 'Invalid GitHub request clock.');
    last = Math.max(last, current);
    return Math.floor(deadline - last);
  }
  function outOfTime(message = deadlineExceeded) {
    blocked = message;
    blockedByTime = true;
    return new TimeLimit(message);
  }
  function finish(write = false) {
    if (remaining() > 0) return;
    const error = outOfTime();
    throw write ? new UncertainWrite() : error;
  }
  return {
    request(args, write = false) {
      if (blocked) throw blockedByTime ? new TimeLimit(blocked) : new Failure(blocked);
      ensure(requests < maxRequests, 'GitHub request budget exceeded.');
      const budget = remaining();
      if (budget <= 0) throw new TimeLimit(deadlineExceeded);
      requests += 1;
      let response;
      try {
        response = run(args, { timeout: Math.min(10000, budget) });
      } catch {
        blocked = requestFailed;
        throw write ? new UncertainWrite() : new Failure(requestFailed);
      }
      if (response?.signal) {
        const error = outOfTime(remaining() <= 0 ? deadlineExceeded : timedOut);
        throw write ? new UncertainWrite() : error;
      }
      if (response?.error) {
        blocked = requestFailed;
        throw write ? new UncertainWrite() : new Failure(requestFailed);
      }
      finish(write);
      return response;
    },
    finish,
    timeLeft: () => Math.max(0, remaining()),
    block(message = requestFailed) { if (!blockedByTime) blocked = message; }
  };
}

export function readHttpResponse(text) {
  const message = 'The GitHub CLI returned invalid HTTP headers.';
  ensure(typeof text === 'string', message);
  const boundary = text.search(/\r?\n\r?\n/);
  ensure(boundary >= 0 && boundary <= 16384, message);
  const lines = text.slice(0, boundary).split(/\r?\n/);
  ensure(lines.length <= 128, message);
  const status = lines.shift().match(/^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5][0-9]{2})(?: [^\r\n]*)?$/);
  ensure(status !== null, message);
  const limits = { 'retry-after': 86400, 'x-ratelimit-remaining': 1000000, 'x-ratelimit-reset': 9999999999 };
  const values = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).toLowerCase();
    if (!Object.hasOwn(limits, key)) continue;
    const raw = line.slice(separator + 1).trim();
    ensure(/^[0-9]{1,12}$/.test(raw) && Number(raw) <= limits[key], message);
    const value = Number(raw);
    ensure(!Object.hasOwn(values, key) || values[key] === value, message);
    values[key] = value;
  }
  const code = Number(status[1]);
  return { status: code, body: text.slice(boundary).replace(/^\r?\n\r?\n/, ''),
    limited: code === 429 || values['x-ratelimit-remaining'] === 0
      || code === 403 && Object.hasOwn(values, 'retry-after') };
}
