import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishPresence, isPublicOrigin } from '../src/cli/publicPresence.js';
import { reportPresence } from '../src/cli/presenceCommand.js';
import { presenceGit } from './helpers.js';
import { parseCliArgs } from '../src/cli/args.js';
import { parseCommand, commandText } from '../src/core/commands.js';
import { replay } from '../src/core/replay.js';
import { readConfig } from '../src/core/config.js';
import { displayResult } from '../src/cli/output.js';
import { resultExitCode } from '../src/cli/result.js';

function fixture() {
  const git = presenceGit();
  const calls = [];
  const posts = [];
  const gh = { getOptional: target => target.endsWith('atc.json') ? { type: 'file', encoding: 'base64', size: 2, content: 'e30=' }
    : { number: 42, state: 'open', assignees: [] },
    get: target => target === 'repos/example/project' ? { private: false } : { number: 42, state: 'open', assignees: [] }, post: (target, fields) => { posts.push({ target, ...fields }); return { id: 123 }; } };
  const fetcher = async (url, options) => { calls.push({ url, ...options }); return Response.json({ outcome: 'published' }); };
  const options = { command: 'start', flags: { public: 'https://example.org' }, gh, git, fetcher, repository: () => 'example/project' };
  const start = reportPresence('start', { issue: 42 }, { git, now: Date.now });
  return { git, calls, posts, options, start };
}

test('public sessions are anonymous by default, keep the secret local, and publish subsequent pulses and landing', async () => {
  const f = fixture();
  const result = displayResult(await publishPresence(f.start, f.options));
  assert.equal(result.publication, 'public');
  const input = JSON.parse(f.calls[0].body);
  assert.equal(input.display, 'anonymous');
  assert.equal(f.posts[0].body, `/atc presence ${createHash('sha256').update(input.token).digest('hex')}`);
  assert.equal(JSON.stringify(result).includes(input.token), false);
  assert.equal(JSON.stringify(f.posts).includes(input.token), false);
  const file = path.join(f.git.commonDir(), 'atc', `public-${result.session}.json`);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const pulse = { ...f.start, state: 'reviewing' };
  assert.equal((await publishPresence(pulse, { ...f.options, command: 'pulse', flags: {} })).publication, 'public');
  assert.equal(JSON.parse(f.calls[1].body).state, 'reviewing');
  const landed = { ...f.start, command: 'land', outcome: 'landed' }; delete landed.state;
  assert.equal((await publishPresence(landed, { ...f.options, command: 'land', flags: {} })).publication, 'public');
  assert.equal(JSON.parse(f.calls[2].body).state, 'landed');
  assert.equal(fs.existsSync(file), false);
  assert.equal(f.posts.length, 1);
});

test('GitHub identity is shared only with explicit opt-in', async () => {
  const f = fixture(); f.options.flags.githubName = true;
  await publishPresence(f.start, f.options);
  assert.equal(JSON.parse(f.calls[0].body).display, 'github');
  assert.equal(parseCliArgs(['start', '42', '--github-name']).flags.githubName, true);
  assert.throws(() => parseCliArgs(['start', '42', '--local', '--github-name']));
});

test('private mode, dry runs and read-only mode never post or publish', async () => {
  const f = fixture();
  for (const outcome of ['dryRun', 'readOnly']) {
    assert.equal((await publishPresence({ ...f.start, outcome }, f.options)).publication, undefined);
  }
  assert.equal((await publishPresence(f.start, { ...f.options, flags: {} })).publication, undefined);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.posts, []);
});

test('invalid origins, hostile local state, missing opt-in and unavailable services cannot report success', async () => {
  for (const origin of ['http://example.org', 'https://example.org/path', 'https://user@example.org', 'https://example.org\n', 'https://example.org?token=x']) assert.equal(isPublicOrigin(origin), false);
  const f = fixture();
  f.options.fetcher = async () => new Response('', { status: 503 });
  const result = await publishPresence(f.start, f.options);
  assert.equal(result.publication, 'unavailable'); assert.equal(resultExitCode(result, true), 2);
  const file = path.join(f.git.commonDir(), 'atc', `public-${result.session}.json`);
  const settings = JSON.parse(fs.readFileSync(file)); settings.origin += '/hostile'; fs.writeFileSync(file, JSON.stringify(settings));
  assert.equal((await publishPresence(f.start, { ...f.options, command: 'pulse', flags: {} })).publication, undefined);
  const disabled = fixture(); disabled.options.gh.getOptional = () => null;
  assert.equal((await publishPresence(disabled.start, disabled.options)).publication, 'unavailable'); assert.equal(disabled.posts.length, 0);
});

test('presence proof comments cannot create or renew claims', () => {
  const proof = 'a'.repeat(64);
  assert.equal(commandText(parseCommand(`/atc presence ${proof}`)), `/atc presence ${proof}`);
  for (const body of ['/atc presence nope', `/atc presence ${proof} extra`, `/atc presence ${'a'.repeat(65)}`]) assert.deepEqual(parseCommand(body), { verb: 'invalid' });
  const state = replay([{ id: 1, issue: 42, login: 'example', at: 1, command: parseCommand(`/atc presence ${proof}`) }], { closed: new Set() }, readConfig({}), 2);
  assert.equal(state.outcomes.get(1), 'presenceProof'); assert.deepEqual(state.claims, []);
});
