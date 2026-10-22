import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSummary, refreshBoard, refreshDue, summaryPath, writeSummary } from '../src/hooks/boardSummary.js';
import { readOverlapResult, readWhoResult } from '../src/hooks/cliResults.js';
import { createCliRunner } from '../src/hooks/cliRunner.js';
import { postEditOutput } from '../src/hooks/editWarning.js';
import { readGitContext } from '../src/hooks/gitContext.js';
import { isPullRequestCreate, preBashOutput } from '../src/hooks/pullRequestGate.js';
import { sessionStartOutput } from '../src/hooks/sessionContext.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cwd = '/work/repo';
const git = { root: cwd, github: true, configured: true };
const board = { repository: 'selected', observedAt: '2026-10-22T07:00:00.000Z', complete: true,
  summary: { contributors: 9, issues: 120, openIssues: 112, openPullRequests: 132, fileOverlaps: 4, opportunities: 37, activeAgents: 2 } };

function deps(result, extra = {}) {
  const calls = [];
  return { calls, gitContext: () => git, now: () => Date.parse('2026-10-22T08:00:00Z'), cliPath: '/opt/atc/src/cli/main.js',
    run: (args, options) => { calls.push({ args, options }); return typeof result === 'function' ? result(args) : result; }, ...extra };
}

function edit(filePath, overrides = {}) {
  return { hook_event_name: 'PostToolUse', cwd, tool_name: 'Edit', tool_input: { file_path: filePath }, ...overrides };
}

function bash(command) {
  return { hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } };
}

function overlapRow(pullRequest, conflict, conflictFiles) {
  return { source: 'workingTree', pullRequest, sharedFiles: 2, areas: [1], conflict, conflictFiles };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atc-hooks-'));
}

test('edit hook names pull requests and worktrees from a validated who result', () => {
  const context = deps({ complete: true, limitations: [], observedAt: null, pullRequests: [6013, 6012, 6012], worktrees: 1 });
  const output = postEditOutput(edit('lib/router.js'), context);
  assert.deepEqual(context.calls[0].args, ['who', '/work/repo/lib/router.js', '--json']);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /open pull requests #6013 and #6012 and 1 other local worktree\./);
});

test('edit hook stays silent outside a clone, without overlap, and for hostile or missing paths', () => {
  const quiet = { complete: true, limitations: [], observedAt: null, pullRequests: [], worktrees: 0 };
  assert.equal(postEditOutput(edit('/work/repo/a.js'), deps(quiet)), null);
  assert.equal(postEditOutput(edit('/work/repo/a.js'), deps(quiet, { gitContext: () => null })), null);
  for (const hostile of ['', 'a\u0000b', 'a\nb', 'a\u001b[31mb', 'a‮b', 'x'.repeat(5000), 42, null, ['a']]) {
    const context = deps(quiet);
    assert.equal(postEditOutput(edit(hostile), context), null);
    assert.equal(context.calls.length, 0);
  }
  assert.equal(postEditOutput(edit('a.js', { cwd: 'relative/dir' }), deps(quiet)), null);
  assert.equal(postEditOutput({ hook_event_name: 'PreToolUse', cwd, tool_input: { file_path: 'a.js' } }, deps(quiet)), null);
});

test('edit hook ignores failed, invalid and hostile CLI results', () => {
  const hostile = [null, { complete: 'yes', pullRequests: [1], worktrees: 0 }, { complete: true, pullRequests: ['#1; rm -rf /'], worktrees: 0 },
    { complete: true, pullRequests: [-4], worktrees: 0 }, { complete: true, pullRequests: [1.5], worktrees: 0 },
    { complete: true, pullRequests: [1], worktrees: '1' }, { complete: true, pullRequests: new Array(301).fill(1), worktrees: 0 }];
  for (const result of hostile) assert.equal(postEditOutput(edit('a.js'), deps(result)), null);
  assert.equal(readWhoResult({ complete: true, pullRequests: [7], worktrees: 0 }).pullRequests[0], 7);
});

test('pull request gate only runs for gh pr create commands', () => {
  for (const command of ['gh pr create --draft --title x', 'cd sub && gh pr create', 'gh -R acme/widgets pr create', 'gh pr new', 'git push; gh pr create']) {
    assert.equal(isPullRequestCreate(command), true, command);
  }
  for (const command of ['npm test', 'gh pr view 12', 'gh pr list', 'git commit -m "gh prcreate"', 'mygh pr create', 42, 'gh pr create'.padEnd(100001, ' ')]) {
    const context = deps(null);
    assert.equal(isPullRequestCreate(command), false, String(command).slice(0, 30));
    assert.equal(preBashOutput(bash(command), context), null);
    assert.equal(context.calls.length, 0);
  }
});

test('pull request gate denies when ATC finds merge conflicts', () => {
  const context = deps({ complete: true, limitations: [], changedFiles: 3, myPullRequests: [], overlaps: [overlapRow(6012, 'conflicts', 2), overlapRow(6020, 'clean', 0)],
    worktreeOverlaps: [{ worktree: 1, sharedFiles: 1, areas: [], conflict: 'conflicts', conflictFiles: 1 }] });
  const output = preBashOutput(bash('gh pr create --fill'), context).hookSpecificOutput;
  assert.deepEqual(context.calls[0].args, ['overlap', '--json']);
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, /open pull request #6012 \(2 conflicting files\) and 1 other local worktree \(1 conflicting file\)/);
  assert.doesNotMatch(output.permissionDecisionReason, /6020/);
});

test('pull request gate adds context without a permission decision for clean overlaps', () => {
  const output = preBashOutput(bash('gh pr create'), deps({ complete: true, limitations: [], overlaps: [overlapRow(6012, 'clean', 0), overlapRow(6013, 'unknown', null)] }));
  assert.equal(Object.hasOwn(output.hookSpecificOutput, 'permissionDecision'), false);
  assert.match(output.hookSpecificOutput.additionalContext, /share files with open pull requests #6012 and #6013\. ATC could not test 1 of them/);
  assert.equal(preBashOutput(bash('gh pr create'), deps({ complete: true, limitations: [], overlaps: [] })), null);
  const partial = preBashOutput(bash('gh pr create'), deps({ complete: false, limitations: ['pullFilesLimit'], overlaps: [] }));
  assert.match(partial.hookSpecificOutput.additionalContext, /coverage was incomplete/);
});

test('pull request gate allows and says so when the CLI fails or returns invalid data', () => {
  const invalid = [null, { complete: true, overlaps: [overlapRow('6012', 'conflicts', 2)] }, { complete: true, overlaps: [overlapRow(6012, 'maybe', 2)] },
    { complete: true, overlaps: [overlapRow(6012, 'conflicts', -1)] }, { complete: true, overlaps: 'none' },
    { complete: true, overlaps: [], worktreeOverlaps: [{ worktree: 0, sharedFiles: 1, conflict: 'clean' }] }];
  for (const result of invalid) {
    const output = preBashOutput(bash('gh pr create'), deps(result)).hookSpecificOutput;
    assert.equal(Object.hasOwn(output, 'permissionDecision'), false);
    assert.equal(output.additionalContext, 'ATC could not check this pull request for overlapping work.');
  }
  assert.equal(preBashOutput(bash('gh pr create'), deps(null, { gitContext: () => null })), null);
  assert.equal(readOverlapResult({ complete: true, overlaps: [overlapRow(5, 'clean', 0)] }).pulls[0].id, 5);
});

test('session start describes ATC, summarizes the last board and refreshes it in the background', () => {
  const refreshed = [];
  const data = tempDir();
  const file = summaryPath(data, cwd);
  assert.equal(writeSummary(file, readSummaryFrom(board)), true);
  const context = deps(null, { dataDir: data, readSummary, refreshDue: () => true, startRefresh: (...args) => refreshed.push(args) });
  const text = sessionStartOutput({ hook_event_name: 'SessionStart', cwd, source: 'startup' }, context).hookSpecificOutput.additionalContext;
  assert.match(text, /coordinates issue work with Agent Traffic Control/);
  assert.match(text, /`atc check <issue>`/);
  assert.match(text, /node "\/opt\/atc\/src\/cli\/main\.js"/);
  assert.match(text, /112 open issues, 132 open pull requests, 4 pull request pairs sharing files, 37 issues that need help and 2 active agent sessions\./);
  assert.deepEqual(refreshed, [[cwd, file]]);
  assert.equal(context.calls.length, 0);
});

test('session start is silent outside GitHub clones and skips stale summaries', () => {
  const input = { hook_event_name: 'SessionStart', cwd, source: 'resume' };
  const base = { readSummary: () => null, refreshDue: () => false, startRefresh: () => assert.fail('no refresh') };
  assert.equal(sessionStartOutput(input, deps(null, { ...base, gitContext: () => null })), null);
  assert.equal(sessionStartOutput(input, deps(null, { ...base, gitContext: () => ({ ...git, github: false }) })), null);
  const old = { ...readSummaryFrom(board), observedAt: '2026-01-01T00:00:00.000Z' };
  const text = sessionStartOutput(input, deps(null, { ...base, gitContext: () => ({ ...git, configured: false }), dataDir: tempDir(), readSummary: () => old }))
    .hookSpecificOutput.additionalContext;
  assert.match(text, /can show who is working/);
  assert.doesNotMatch(text, /board snapshot/);
});

test('board summaries round-trip, reject hostile files and refresh through the CLI', () => {
  const data = tempDir();
  const file = summaryPath(data, '/work/repo');
  assert.equal(summaryPath('relative', '/work/repo'), null);
  assert.equal(refreshDue(file, Date.now()), true);
  assert.equal(refreshBoard(['/work/repo', file], () => board), true);
  assert.equal(readSummary(file).openPullRequests, 132);
  assert.equal(refreshDue(file, Date.now()), false);
  fs.writeFileSync(file, JSON.stringify({ version: 1, board: { ...board, summary: { ...board.summary, openIssues: 'many' } } }));
  assert.equal(readSummary(file), null);
  fs.writeFileSync(file, '{"version":1');
  assert.equal(readSummary(file), null);
  assert.equal(refreshBoard(['/work/repo', file], () => null), false);
  assert.equal(refreshBoard(['relative', file], () => board), false);
});

test('the CLI runner spawns node without a shell, forces read-only mode and parses only JSON objects', () => {
  const seen = [];
  const spawn = (command, args, options) => { seen.push({ command, args, options }); return outputs.shift(); };
  const outputs = [{ status: 0, stdout: '{"complete":true}' }, { status: 1, stdout: '{}' }, { status: 0, stdout: 'not json' },
    { status: 0, stdout: '[1]' }, { status: null, signal: 'SIGTERM', stdout: '' }];
  const run = createCliRunner({ spawn, node: '/usr/bin/node', main: '/opt/atc/main.js', env: { PATH: '/bin' } });
  assert.deepEqual(run(['who', '/a', '--json'], { cwd, timeout: 5 }), { complete: true });
  for (let index = 0; index < 4; index += 1) assert.equal(run(['overlap', '--json'], { cwd, timeout: 5 }), null);
  assert.equal(seen[0].command, '/usr/bin/node');
  assert.deepEqual(seen[0].args, ['/opt/atc/main.js', 'who', '/a', '--json']);
  assert.equal(seen[0].options.env.ATC_READ_ONLY, '1');
  assert.equal(seen[0].options.shell, undefined);
  assert.equal(createCliRunner({ spawn: () => { throw new Error('spawn failed'); } })(['board'], { cwd, timeout: 5 }), null);
});

test('git context reads the clone root and GitHub remote from a real repository', () => {
  const folder = fs.realpathSync(tempDir());
  assert.equal(readGitContext(folder), null);
  execFileSync('git', ['init', '-q', folder]);
  assert.deepEqual(readGitContext(folder), { root: folder, github: false, configured: false });
  execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
  fs.mkdirSync(path.join(folder, '.github'));
  fs.writeFileSync(path.join(folder, '.github', 'atc.json'), '{}');
  fs.mkdirSync(path.join(folder, 'src'));
  assert.deepEqual(readGitContext(path.join(folder, 'src')), { root: folder, github: true, configured: true });
  assert.equal(readGitContext('relative'), null);
});

test('hook entry scripts exit cleanly and print nothing for bad input or a folder outside git', () => {
  const folder = tempDir();
  for (const script of ['sessionStart.js', 'postEdit.js', 'preBash.js']) {
    for (const input of ['not json', JSON.stringify(edit('a.js', { cwd: folder })), JSON.stringify({ ...bash('gh pr create'), cwd: folder })]) {
      const result = spawnSync(process.execPath, [path.join(root, 'src/hooks', script)], { input, cwd: folder, encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 0, script);
      assert.equal(result.stdout, '', script);
      assert.equal(result.stderr, '', script);
    }
  }
});

test('plugin manifests point at files that exist and match the package version', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const plugin = read('.claude-plugin/plugin.json');
  const marketplace = read('.claude-plugin/marketplace.json');
  assert.equal(plugin.name, 'atc');
  assert.equal(plugin.version, read('package.json').version);
  assert.deepEqual(marketplace.plugins.map(entry => [entry.name, entry.source]), [['atc', './']]);
  const hooks = read('hooks/hooks.json').hooks;
  const scripts = Object.values(hooks).flat().flatMap(group => group.hooks).map(hook => hook.args[0]);
  assert.equal(scripts.length, 3);
  for (const script of scripts) assert.ok(fs.existsSync(script.replace('${CLAUDE_PLUGIN_ROOT}', root)), script);
  assert.ok(fs.existsSync(path.join(root, 'skills/atc/SKILL.md')));
});

function readSummaryFrom(value) {
  return { observedAt: value.observedAt, complete: value.complete, ...Object.fromEntries(['openIssues', 'openPullRequests', 'fileOverlaps', 'opportunities', 'activeAgents']
    .map(key => [key, value.summary[key]])) };
}
