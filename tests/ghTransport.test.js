import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Failure } from '../src/core/failure.js';
import { createGh, UncertainWrite } from '../src/cli/gh.js';
import { rateLimited, readHttpResponse } from '../src/cli/ghTransport.js';

const target = 'repos/example/project/issues/1/comments';
const fields = { body: '/atc claim' };
const json = () => ({ status: 0, stdout: '{}' });
const headers = (status, extra = '', body = '{}') => `HTTP/2.0 ${status} Status\r\n${extra}\r\n${body}`;

test('one client budget counts reads, optional probes, repository discovery and writes together', () => {
  let calls = 0;
  const run = args => {
    calls += 1;
    return args.includes('--include') ? { status: 1, stdout: headers(404) } : json();
  };
  const gh = createGh(run, { now: () => 0, maxRequests: 3, readOnly: false });
  gh.get('user');
  gh.repoView();
  assert.equal(gh.getOptional('missing'), null);
  assert.throws(() => gh.post(target, fields), error => error instanceof Failure && !(error instanceof UncertainWrite)
    && error.message === 'GitHub request budget exceeded.');
  assert.equal(calls, 3);
});

test('the hard request ceiling is five hundred and options cannot raise it', () => {
  let calls = 0;
  const gh = createGh(() => { calls += 1; return json(); }, { now: () => 0 });
  for (let index = 0; index < 500; index += 1) gh.get('user');
  assert.throws(() => gh.get('user'), /GitHub request budget exceeded/);
  assert.equal(calls, 500);
  for (const options of [{ maxRequests: 501 }, { maxRequests: 0 }, { maxRequests: '2' }, { maxRequests: null }, { deadlineMs: 30001 },
    { deadlineMs: 0 }, { deadlineMs: null }, { now: null }, { readOnly: 'false' }, { readOnly: null }]) {
    assert.throws(() => createGh(json, options), error => error.message === 'Invalid GitHub request limits.');
  }
});

test('subprocess timeouts shrink to the remaining monotonic thirty-second budget', () => {
  let clock = 0;
  const timeouts = [];
  const gh = createGh((args, options) => { timeouts.push(options.timeout); return json(); }, { now: () => clock });
  gh.get('user');
  clock = 25000;
  gh.repoView();
  clock = 29999;
  gh.get('user');
  clock = 30000;
  assert.throws(() => gh.get('user'), /GitHub request deadline exceeded/);
  assert.deepEqual(timeouts, [10000, 5000, 1]);
});

test('a backward injected clock cannot extend a previously observed deadline', () => {
  let clock = 0;
  const timeouts = [];
  const gh = createGh((args, options) => { timeouts.push(options.timeout); return json(); }, { now: () => clock });
  clock = 25000;
  gh.get('user');
  clock = 1;
  gh.get('user');
  assert.deepEqual(timeouts, [5000, 5000]);
});

test('a late read response fails the total deadline even if the subprocess reports success', () => {
  let clock = 0;
  const gh = createGh(() => { clock = 100; return json(); }, { now: () => clock, deadlineMs: 100 });
  assert.throws(() => gh.get('user'), error => error instanceof Failure && error.message === 'GitHub request deadline exceeded.');
});

test('executed POST failures are uncertain and never automatically retried', () => {
  const responses = [() => { throw new Error('private.person@example.com'); }, () => ({ status: 1, stdout: 'private-token' }),
    () => ({ status: null, error: new Error('private-token') }), () => ({ status: 0, signal: 'SIGTERM', stdout: '{}' }),
    () => ({ status: 0, stdout: 'private.person@example.com' }), () => ({ status: 0, stdout: '' }), () => null];
  for (const response of responses) {
    let calls = 0;
    const gh = createGh(() => { calls += 1; return response(); }, { now: () => 0, readOnly: false });
    assert.throws(() => gh.post(target, fields), error => error instanceof UncertainWrite && error instanceof Failure
      && error.message === 'GitHub comment delivery could not be confirmed.');
    assert.equal(calls, 1);
    assert.throws(() => gh.post(target, fields), error => error instanceof Failure && !(error instanceof UncertainWrite));
    assert.equal(calls, 1);
  }
});

test('a POST that returns after the deadline is uncertain while an unexecuted POST is definite', () => {
  let clock = 0;
  let calls = 0;
  const gh = createGh(() => { calls += 1; clock = 100; return { status: 0, stdout: '{"id":1}' }; },
    { now: () => clock, deadlineMs: 100, readOnly: false });
  assert.throws(() => gh.post(target, fields), error => error instanceof UncertainWrite);
  assert.equal(calls, 1);
  const unexecuted = createGh(() => { calls += 1; return json(); }, { now: () => clock, deadlineMs: 100, readOnly: false });
  clock = 200;
  assert.throws(() => unexecuted.post(target, fields), error => error instanceof Failure && !(error instanceof UncertainWrite));
  assert.equal(calls, 1);
});

test('write validation and read-only mode stop execution without consuming the request budget', () => {
  let calls = 0;
  const gh = createGh(() => { calls += 1; return json(); }, { now: () => 0, maxRequests: 1, readOnly: true });
  assert.throws(() => gh.post(target, fields), error => error instanceof Failure && !(error instanceof UncertainWrite)
    && error.message === 'GitHub writes are disabled in read-only mode.');
  gh.get('user');
  assert.equal(calls, 1);
  const writable = createGh(() => { calls += 1; return json(); }, { now: () => 0, readOnly: false });
  assert.throws(() => writable.post(target, { body: '/atc claim\nprivate.person@example.com' }),
    error => error.message === 'Only typed ATC commands can be posted.');
  assert.equal(calls, 1);
});

test('presence proof deletion is a validated write that accepts only removed or missing comments', () => {
  const seen = [];
  const reply = { status: 0, stdout: headers(204, '', '') };
  const gh = createGh(args => { seen.push(args); return reply; }, { now: () => 0, readOnly: false });
  assert.equal(gh.deleteComment('example/project', 123), true);
  assert.deepEqual(seen[0], ['api', '--include', '--method', 'DELETE', 'repos/example/project/issues/comments/123']);
  for (const [repository, id] of [['example/project/issues', 1], ['example/project', '1'], ['example/project', 0], ['../x', 1]]) {
    assert.throws(() => gh.deleteComment(repository, id), error => error.message === 'Only ATC presence proofs can be deleted.');
  }
  assert.equal(seen.length, 1);
  const missing = createGh(() => ({ status: 1, stdout: headers(404) }), { now: () => 0, readOnly: false });
  assert.equal(missing.deleteComment('example/project', 123), false);
  const denied = createGh(() => ({ status: 1, stdout: headers(403) }), { now: () => 0, readOnly: false });
  assert.throws(() => denied.deleteComment('example/project', 123), error => error instanceof UncertainWrite);
  const locked = createGh(() => { throw new Error('must not execute'); }, { now: () => 0, readOnly: true });
  assert.throws(() => locked.deleteComment('example/project', 123), error => error.message === 'GitHub writes are disabled in read-only mode.');
});

test('the default read-only switch is read from ATC_READ_ONLY', () => {
  const previous = process.env.ATC_READ_ONLY;
  process.env.ATC_READ_ONLY = '1';
  try {
    const gh = createGh(() => { throw new Error('must not execute'); });
    assert.throws(() => gh.post(target, fields), error => error.message === 'GitHub writes are disabled in read-only mode.');
  } finally {
    if (previous === undefined) delete process.env.ATC_READ_ONLY;
    else process.env.ATC_READ_ONLY = previous;
  }
});

test('rate limits latch the client without sleeping or making further requests', () => {
  let calls = 0;
  const gh = createGh(() => { calls += 1; return { status: 1, stdout: headers(429, 'Retry-After: 60\r\n') }; },
    { now: () => 0, sleep: () => { throw new Error('must not sleep'); } });
  assert.throws(() => gh.getOptional('user'), error => error.message === rateLimited);
  assert.throws(() => gh.repoView(), error => error.message === rateLimited);
  assert.equal(calls, 1);
});

test('the last successful optional read may exhaust quota while subsequent reads remain blocked', () => {
  let calls = 0;
  const gh = createGh(() => { calls += 1; return { status: 0, stdout: headers(200, 'X-RateLimit-Remaining: 0\r\n') }; }, { now: () => 0 });
  assert.deepEqual(gh.getOptional('user'), {});
  assert.throws(() => gh.get('user'), error => error.message === rateLimited);
  assert.equal(calls, 1);
});

test('HTTP status and numeric rate headers reject malformed or excessive values without echoing them', () => {
  const parsed = readHttpResponse(headers(200, 'Retry-After: 10\r\nX-RateLimit-Remaining: 4999\r\nX-RateLimit-Reset: 1790000000\r\n'));
  assert.equal(parsed.status, 200);
  assert.equal(parsed.limited, false);
  for (const text of [headers(200, 'Retry-After: private.person@example.com\r\n'), headers(200, 'Retry-After: 86401\r\n'),
    headers(200, 'X-RateLimit-Remaining: -1\r\n'), headers(200, 'X-RateLimit-Remaining: 1\r\nX-RateLimit-Remaining: 2\r\n'),
    headers(200, 'X-RateLimit-Reset: 999999999999999999999\r\n'), headers(200, `Header: ${'x'.repeat(16384)}\r\n`),
    'HTTP/2.0 999 Status\r\n\r\n{}', 'HTTP/2.0 200 Status', null]) {
    assert.throws(() => readHttpResponse(text), error => error.message === 'The GitHub CLI returned invalid HTTP headers.');
  }
});

test('subprocess failures cannot masquerade as optional not-found responses', () => {
  const gh = createGh(() => ({ status: null, error: new Error('private-token'), stdout: headers(404) }));
  assert.throws(() => gh.getOptional('missing'), /The GitHub CLI request failed/);
  assert.equal(createGh(() => ({ status: 1, stdout: headers(404) })).getOptional('missing'), null);
});

test('the default subprocess pins GitHub host and receives the bounded timeout', () => {
  const original = childProcess.spawnSync;
  const previous = process.env.GH_HOST;
  let captured;
  process.env.GH_HOST = 'private.invalid';
  childProcess.spawnSync = (binary, args, options) => { captured = { binary, args, options }; return json(); };
  syncBuiltinESMExports();
  try {
    createGh(undefined, { now: () => 0 }).get('user');
    assert.equal(captured.binary, 'gh');
    assert.equal(captured.options.timeout, 10000);
    assert.equal(captured.options.env.GH_HOST, 'github.com');
    assert.deepEqual(captured.args, ['api', '--method', 'GET', 'user']);
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.GH_HOST;
    else process.env.GH_HOST = previous;
  }
});
