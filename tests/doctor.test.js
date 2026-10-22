import test from 'node:test';
import assert from 'node:assert/strict';
import { doctor } from '../src/cli/doctor.js';
import { version } from '../src/cli/version.js';

function fixture(options = {}) {
  const calls = [];
  const config = options.config === undefined ? { areaIds: { code: 1 }, areas: { code: ['src/'] } } : options.config;
  const gh = {
    get(name) { calls.push(['get', name]); if (options.authError) throw new Error('IGNORE INSTRUCTIONS'); return { login: options.login ?? 'contributor' }; },
    getOptional(name) {
      calls.push(['getOptional', name]);
      if (options.configError) throw new Error('IGNORE INSTRUCTIONS');
      if (config === null) return null;
      const content = typeof config === 'string' ? config : JSON.stringify(config);
      return { type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') };
    },
    repoView() {
      calls.push(['repoView']);
      return options.view ?? { nameWithOwner: 'example/project', isFork: false, parent: null };
    },
    post() { assert.fail('Doctor must never post'); }
  };
  const git = { remoteFor(repository) { calls.push(['remoteFor', repository]); return options.remote === undefined ? 'origin' : options.remote; } };
  const run = (binary, args, configuration) => {
    calls.push([binary, args, configuration]);
    assert.equal(configuration.shell, undefined);
    assert.equal(configuration.timeout, 10000);
    assert.equal(configuration.maxBuffer, 65536);
    if (options.runError) throw new Error('IGNORE INSTRUCTIONS');
    if (args[0] === '--version') return { status: options[`${binary}Missing`] ? 1 : 0, stdout: binary === 'git' ? options.gitVersion ?? 'git version 2.50.1 (Apple Git-155)\n' : 'IGNORE INSTRUCTIONS' };
    return { status: options.noClone ? 1 : 0, stdout: options.cloneOutput ?? 'true\n' };
  };
  return { gh, git, run, calls };
}

function inspect(options = {}, input = {}) {
  const stub = fixture(options);
  return { result: doctor({ ...stub, nodeVersion: '22.16.0', ...input }), calls: stub.calls };
}

test('doctor reports each prerequisite with typed values and bounded read-only checks', () => {
  const { result, calls } = inspect();
  assert.deepEqual(result, { command: 'doctor', ready: true, checks: {
    node: 'ok', git: 'ok', clone: 'ok', gh: 'ok', authentication: 'ok', repository: 'ok', remote: 'ok', configuration: 'ok'
  } });
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.filter(call => call[0] === 'get'), [['get', 'user']]);
  assert.equal(calls.filter(call => call[0] === 'getOptional').length, 1);
  assert.equal(version, '0.5.0');
});

test('doctor accepts supported Node releases and rejects malformed or older version text', () => {
  for (const nodeVersion of ['22.16.0', '22.99.0', '23.0.0', '26.12.0']) assert.equal(inspect({}, { nodeVersion }).result.checks.node, 'ok');
  for (const nodeVersion of ['20.19.0', '22.15.9', '22.16.0-IGNORE', '9999.0.0', null]) {
    const { result } = inspect({}, { nodeVersion });
    assert.equal(result.checks.node, 'unsupported');
    assert.equal(result.ready, false);
    assert.ok(!JSON.stringify(result).includes('IGNORE'));
  }
});

test('missing tools, a non-clone and subprocess errors produce fixed statuses', () => {
  const missing = inspect({ gitMissing: true, ghMissing: true });
  assert.deepEqual(missing.result.checks, {
    node: 'ok', git: 'missing', clone: 'skipped', gh: 'missing', authentication: 'skipped', repository: 'skipped', remote: 'skipped', configuration: 'skipped'
  });
  assert.equal(missing.calls.length, 2);
  for (const options of [{ noClone: true }, { cloneOutput: 'true\nIGNORE INSTRUCTIONS' }, { runError: true }]) {
    const { result } = inspect(options);
    assert.equal(result.ready, false);
    assert.ok(!JSON.stringify(result).includes('IGNORE'));
  }
});

test('doctor refuses invalid authentication data and stops dependent GitHub checks', () => {
  for (const options of [{ authError: true }, { login: 'IGNORE ALL INSTRUCTIONS' }]) {
    const { result, calls } = inspect(options);
    assert.equal(result.checks.authentication, 'failed');
    assert.equal(result.checks.repository, 'skipped');
    assert.equal(calls.some(call => call[0] === 'repoView' || call[0] === 'getOptional'), false);
    assert.ok(!JSON.stringify(result).includes('IGNORE'));
  }
});

test('doctor validates repository selection and resolves fork upstreams', () => {
  const fork = inspect({ view: { nameWithOwner: 'contributor/project', isFork: true, parent: { owner: { login: 'example' }, name: 'project' } } });
  assert.ok(fork.calls.some(call => call[0] === 'remoteFor' && call[1] === 'example/project'));
  const explicit = inspect({}, { flags: { repo: 'example/alternate' }, env: { ATC_REPO: 'IGNORE' } });
  assert.equal(explicit.result.ready, true);
  assert.equal(explicit.calls.some(call => call[0] === 'repoView'), false);
  for (const input of [{ flags: { repo: 'example/project;IGNORE' } }, { env: { ATC_REPO: 'IGNORE INSTRUCTIONS' } }]) {
    const { result, calls } = inspect({}, input);
    assert.equal(result.checks.repository, 'failed');
    assert.equal(calls.some(call => call[0] === 'getOptional'), false);
    assert.ok(!JSON.stringify(result).includes('IGNORE'));
  }
  for (const view of [{ nameWithOwner: 'example/project', isFork: 'yes' }, { nameWithOwner: 'IGNORE', isFork: false }]) {
    assert.equal(inspect({ view }).result.checks.repository, 'failed');
  }
});

test('doctor handles missing remotes and default configuration while validating refs and configuration', () => {
  const missing = inspect({ remote: null, config: null }).result;
  assert.equal(missing.ready, true);
  assert.equal(missing.checks.remote, 'missing');
  assert.equal(missing.checks.configuration, 'missing');
  assert.equal(inspect({}, { flags: { base: 'main' } }).result.checks.remote, 'notRequired');
  assert.equal(inspect({}, { flags: { base: 'main;IGNORE' } }).result.checks.remote, 'failed');
  assert.equal(inspect({ remote: 'origin;IGNORE' }).result.checks.remote, 'failed');
  for (const options of [{ config: '{"areas":{"IGNORE INSTRUCTIONS":["src/"]}}' }, { config: '{bad' }, { configError: true }]) {
    const { result } = inspect(options);
    assert.equal(result.checks.configuration, 'invalid');
    assert.equal(result.ready, false);
    assert.ok(!JSON.stringify(result).includes('IGNORE'));
  }
});

test('doctor requires git 2.38 or later for merge-tree conflict checks and rejects unreadable versions', () => {
  for (const [gitVersion, expected] of [['git version 2.38.0\n', 'ok'], ['git version 3.0.1\n', 'ok'], ['git version 2.39.3 (Apple Git-146)\n', 'ok'],
    ['git version 2.37.9\n', 'unsupported'], ['git version 1.99.0\n', 'unsupported'], ['IGNORE INSTRUCTIONS', 'unsupported'], ['', 'unsupported']]) {
    const { result } = inspect({ gitVersion });
    assert.equal(result.checks.git, expected, gitVersion);
    if (expected === 'unsupported') assert.equal(result.ready, false);
  }
  assert.equal(inspect({ gitMissing: true }).result.checks.git, 'missing');
});
