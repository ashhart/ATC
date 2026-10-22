import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGh } from '../src/cli/gh.js';
import { version } from '../src/cli/version.js';
import { createFraming } from '../src/mcp/framing.js';
import { handleMessage } from '../src/mcp/protocol.js';
import { toolArgv, toolList } from '../src/mcp/tools.js';
import { posted, setup, stubGit } from './helpers.js';

const server = fileURLToPath(new URL('../src/mcp/server.js', import.meta.url));

function depsFor(fake, user = 'alice') {
  fake.store.cliUser = user;
  return { cliDeps: () => ({ gh: createGh(fake.runGh), git: stubGit(), sleep: async () => { fake.clock.now += 1000; },
    now: () => fake.clock.now, env: {}, cwd: process.cwd() }) };
}

function call(name, args, deps, id = 7) {
  return handleMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, deps);
}

test('initialize negotiates a supported protocol version and names the server', async () => {
  const known = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(known.id, 1);
  assert.equal(known.result.protocolVersion, '2025-03-26');
  assert.deepEqual(known.result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(known.result.serverInfo, { name: 'atc', title: 'Agent Traffic Control', version });
  const unknown = await handleMessage({ jsonrpc: '2.0', id: 'start', method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(unknown.result.protocolVersion, '2025-06-18');
  assert.deepEqual(await handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' }), { jsonrpc: '2.0', id: 2, result: {} });
});

test('notifications and client responses produce no reply', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/unknown', params: { anything: true } }), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', id: 9, result: {} }), null);
});

test('tools/list describes every tool with a closed input schema and honest hints', async () => {
  const { result } = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const names = result.tools.map(tool => tool.name);
  assert.deepEqual(names, ['atc_board', 'atc_status', 'atc_check', 'atc_overlap', 'atc_claim', 'atc_renew', 'atc_release', 'atc_propose',
    'atc_accept', 'atc_decline', 'atc_withdraw', 'atc_start', 'atc_pulse', 'atc_land', 'atc_who']);
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.inputSchema.required.every(key => Object.hasOwn(tool.inputSchema.properties, key)));
    assert.equal(tool.annotations.destructiveHint, false);
  }
  const hints = Object.fromEntries(result.tools.map(tool => [tool.name, [tool.annotations.readOnlyHint, tool.annotations.openWorldHint]]));
  assert.deepEqual([hints.atc_board, hints.atc_overlap, hints.atc_who, hints.atc_claim, hints.atc_start], [[true, true], [true, true], [true, false], [false, true], [false, false]]);
  assert.match(result.tools.find(tool => tool.name === 'atc_claim').description, /unless dryRun is true/);
  assert.match(result.tools.find(tool => tool.name === 'atc_pulse').description, /posts nothing to GitHub/);
  toolList()[0].inputSchema.properties.repo.maxLength = 1;
  assert.equal(toolList()[0].inputSchema.properties.repo.maxLength, 140);
});

test('board and check run the real CLI against GitHub and return structured results', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  const deps = depsFor(fake);
  const board = await call('atc_board', { repo: 'acme/widgets' }, deps);
  assert.equal(board.result.isError, false);
  assert.equal(board.result.structuredContent.repository, 'selected');
  assert.deepEqual(JSON.parse(board.result.content[0].text), board.result.structuredContent);
  const check = await call('atc_check', { issue: issue.number, areas: [1] }, deps);
  assert.equal(check.result.structuredContent.advice, 'free');
  assert.equal(check.result.structuredContent.issue, issue.number);
});

test('a dry-run claim previews without posting and a real claim posts only the typed command', async () => {
  const fake = setup();
  const issue = fake.addIssue();
  const deps = depsFor(fake);
  const preview = await call('atc_claim', { issue: issue.number, areas: [1], dryRun: true }, deps);
  assert.deepEqual(preview.result.structuredContent, { issue: issue.number, command: 'claim', posted: false, outcome: 'dryRun', areas: [1] });
  assert.deepEqual(posted(fake), []);
  const claim = await call('atc_claim', { issue: issue.number }, deps);
  assert.equal(claim.result.structuredContent.outcome, 'claimed');
  assert.deepEqual(posted(fake), [['alice', '/atc claim']]);
});

test('hostile tool arguments fail with fixed messages that never echo input', async () => {
  const fake = setup();
  const deps = depsFor(fake);
  const hostile = '<img src=x onerror=alert(1)>';
  const cases = [
    ['atc_check', { issue: 1.5 }], ['atc_check', { issue: '1' }], ['atc_check', { issue: -1 }], ['atc_check', { issue: 1, areas: [25] }],
    ['atc_check', { issue: 1, areas: [1, 1] }], ['atc_check', { issue: 1, extra: hostile }], ['atc_board', { repo: hostile }],
    ['atc_overlap', { base: `--${hostile}` }], ['atc_who', { path: '--repo' }], ['atc_who', { path: `a\n${hostile}` }],
    ['atc_propose', { issue: 1, kind: 'split' }], ['atc_propose', { issue: 1, kind: hostile }], ['atc_pulse', { issue: 1, session: 1, state: hostile }],
    ['atc_accept', { proposal: 2 ** 60 }], ['atc_claim', { issue: 1, dryRun: 'yes' }], ['atc_check', {}]
  ];
  for (const [name, args] of cases) {
    const response = await call(name, args, deps);
    assert.equal(response.result.isError, true, name);
    assert.ok(!response.result.content[0].text.includes(hostile));
    assert.ok(!response.result.content[0].text.includes('\n'));
  }
  assert.deepEqual(posted(fake), []);
  const unknownTool = await call(hostile, {}, deps);
  assert.deepEqual(unknownTool.error, { code: -32602, message: 'Unknown tool.' });
  const arrayArguments = await call('atc_board', [hostile], deps);
  assert.deepEqual(arrayArguments.error, { code: -32602, message: 'Tool arguments must be an object.' });
});

test('malformed requests and unknown methods get fixed JSON-RPC errors', async () => {
  assert.deepEqual(await handleMessage('hello'), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } });
  assert.deepEqual(await handleMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } });
  assert.deepEqual(await handleMessage({ jsonrpc: '1.0', id: 1, method: 'ping' }), { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid request.' } });
  assert.deepEqual(await handleMessage({ jsonrpc: '2.0', id: { nested: true }, method: 'ping' }), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } });
  assert.deepEqual(await handleMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }), { jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not found.' } });
  assert.deepEqual(await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: [1] }), { jsonrpc: '2.0', id: 5, error: { code: -32602, message: 'Invalid params.' } });
});

test('unexpected failures inside a tool are reported with a fixed message', async () => {
  const deps = { cliDeps: () => { throw new Error('secret token ghp_abc in a stack trace'); } };
  const response = await call('atc_status', {}, deps);
  assert.deepEqual(response.result, { content: [{ type: 'text', text: 'ATC could not complete the request.' }], isError: true });
});

test('presence and file tools map to local CLI commands', () => {
  assert.deepEqual(toolArgv('atc_start', { issue: 4, dryRun: true }), ['start', '4', '--dry-run']);
  assert.deepEqual(toolArgv('atc_pulse', { issue: 4, session: 99, state: 'blocked' }), ['pulse', '4', '99', 'blocked']);
  assert.deepEqual(toolArgv('atc_land', { issue: 4, session: 99 }), ['land', '4', '99']);
  assert.deepEqual(toolArgv('atc_who', { path: 'src/core/rules.js' }), ['who', 'src/core/rules.js']);
  assert.deepEqual(toolArgv('atc_propose', { issue: 3, kind: 'split', areas: [2, 1], repo: 'acme/widgets' }), ['propose', '3', 'split', '2', '1', '--repo', 'acme/widgets']);
  assert.deepEqual(toolArgv('atc_overlap', { base: 'origin/main' }), ['overlap', '--base', 'origin/main']);
});

test('framing splits lines, ignores blanks and drops oversized messages until the next newline', () => {
  const lines = [];
  let oversize = 0;
  const framing = createFraming({ limit: 10, onLine: line => lines.push(line), onOversize: () => { oversize += 1; } });
  framing.push('{"a":1}\r\n\n{"b"');
  framing.push(':2}\n0123456789ABC');
  framing.push('DEF\n{"c":3}\n01234567890123\n');
  framing.push('{"d":4}');
  framing.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}', '{"d":4}']);
  assert.equal(oversize, 2);
});

test('the stdio server answers newline-delimited JSON-RPC and survives garbage', async () => {
  const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ATC_READ_ONLY: '1' } });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write('not json at all\n');
  child.stdin.write(`${'x'.repeat(1048577)}\n`);
  child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
  await new Promise(resolve => child.on('close', resolve));
  const responses = output.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(responses.map(response => [response.id, response.error?.code ?? 'ok']), [[1, 'ok'], [null, -32700], [null, -32700], [2, 'ok']]);
  assert.equal(responses[0].result.serverInfo.name, 'atc');
});
