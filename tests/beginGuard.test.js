import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { setup } from './helpers.js';
import { createGh } from '../src/cli/gh.js';
import { createGit } from '../src/cli/git.js';
import { parseCliArgs } from '../src/cli/args.js';
import { runCli } from '../src/cli/actions.js';
import { readWorkTicket, ticketLocation } from '../src/cli/workTicket.js';
import { planTtlMs } from '../src/core/plans.js';
import { preEditOutput } from '../src/hooks/workGate.js';

function fixture(t) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-begin-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const command = args => execFileSync('git', args, { cwd: folder, encoding: 'utf8' }).trim();
  command(['init', '-q', '-b', 'main']);
  command(['config', 'user.name', 'Fixture']); command(['config', 'user.email', 'fixture@example.invalid']);
  fs.mkdirSync(path.join(folder, 'src'));
  fs.writeFileSync(path.join(folder, 'src/a.js'), 'export const value = 1;\n');
  command(['add', 'src/a.js']); command(['commit', '-qm', 'Fixture']);
  const git = createGit((args, env, input) => spawnSync('git', args, { cwd: folder, encoding: 'utf8', input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } }));
  const fake = setup(); fake.addIssue();
  const run = (args, { env = {}, user = 'alice', runner = fake.runGh, doctorCheck = () => ({ ready: true }) } = {}) => {
    fake.store.cliUser = user;
    return runCli(parseCliArgs(args), { gh: createGh(runner), git, now: () => fake.clock.now,
      sleep: async () => { fake.clock.now += 1000; }, env, cwd: folder, doctorCheck });
  };
  return { folder, git, fake, run, command };
}

test('begin confirms a claim before posting its hashed plan and mints a ready worktree ticket', async t => {
  const f = fixture(t);
  const result = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD', '--json']);
  assert.equal(result.ready, true); assert.equal(result.outcome, 'ready');
  assert.equal(result.issue, 1); assert.ok(result.session > 0); assert.ok(result.plan > 0);
  const comments = f.fake.store.comments.map(x => x.body);
  assert.equal(comments[0], '/atc claim');
  assert.match(comments[1], /^\/atc plan [1-9][0-9]* [a-f0-9]{40} [a-f0-9]{32} [a-f0-9]{32}$/);
  assert.doesNotMatch(JSON.stringify(comments), /src\/a\.js|alice|Fixture/);
  const ticket = readWorkTicket(f.git);
  assert.equal(ticket.issue, 1); assert.equal(ticket.session, result.session); assert.equal(ticket.plan, result.plan);
  assert.equal(ticket.files.length, 1); assert.equal(JSON.stringify(ticket).includes('src/a.js'), false);
  const guard = await f.run(['guard', path.join(f.folder, 'src/a.js'), '--json']);
  assert.equal(guard.ready, true); assert.equal(guard.outcome, 'ready');
  assert.equal(f.fake.store.comments.length, 2);
});

test('guard denies edits outside the declared scope, changed bases and released or expired work', async t => {
  const f = fixture(t);
  await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD']);
  assert.equal((await f.run(['guard', 'src/other.js'])).outcome, 'notInScope');
  fs.writeFileSync(path.join(f.folder, 'other.txt'), 'unplanned');
  assert.equal((await f.run(['guard'])).outcome, 'notInScope');
  fs.unlinkSync(path.join(f.folder, 'other.txt'));
  fs.writeFileSync(path.join(f.folder, 'src/a.js'), 'export const value = 2;\n');
  assert.equal((await f.run(['guard'])).ready, true);
  f.command(['add', 'src/a.js']); f.command(['commit', '-qm', 'Changed base']);
  assert.equal((await f.run(['guard'])).outcome, 'baseChanged');
  await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD']);
  await f.run(['release', '1']);
  assert.equal((await f.run(['guard'])).outcome, 'claimRequired');
  await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD']);
  f.fake.clock.now += planTtlMs + 1;
  const expired = await f.run(['guard']);
  assert.equal(expired.ready, false); assert.equal(expired.outcome, 'planExpired');
});

test('plan cannot claim free work and begin cannot steal another contributor\'s claim', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['plan', '1', 'src/a.js', '--base', 'HEAD'])).outcome, 'claimRequired');
  assert.equal(f.fake.store.comments.length, 0);
  await f.run(['claim', '1'], { user: 'bob' });
  const result = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD']);
  assert.equal(result.ready, false); assert.equal(result.outcome, 'claimRequired');
  assert.equal(f.fake.store.comments.length, 1); assert.equal(readWorkTicket(f.git), null);
});

test('dry runs and read-only begin do not post, start presence or persist a ticket', async t => {
  const f = fixture(t);
  const before = f.command(['for-each-ref', '--format=%(refname)']);
  const preview = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD', '--dry-run']);
  assert.equal(preview.outcome, 'dryRun');
  const readOnly = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'], { env: { ATC_READ_ONLY: '1' } });
  assert.equal(readOnly.ready, false); assert.equal(readOnly.outcome, 'readOnly');
  assert.equal(f.fake.store.comments.length, 0); assert.equal(readWorkTicket(f.git), null);
  assert.equal(f.command(['for-each-ref', '--format=%(refname)']), before);
  assert.equal(fs.existsSync(path.join(f.git.commonDir(), 'atc')), false);
});

test('absent-ticket guard stays offline and a ticket for a different repository fails closed', async t => {
  const f = fixture(t);
  const offline = await f.run(['guard'], { runner: () => assert.fail('no network without a ticket') });
  assert.equal(offline.ready, true); assert.equal(offline.outcome, 'noTicket');
  await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD']);
  const file = ticketLocation(f.git).file;
  const ticket = JSON.parse(fs.readFileSync(file)); ticket.repository = 'other/project'; fs.writeFileSync(file, JSON.stringify(ticket));
  const result = await f.run(['guard']);
  assert.equal(result.ready, false); assert.equal(result.outcome, 'claimRequired');
});

test('unconfirmed plans and ambiguous claims never mint ready tickets or repeat a write', async t => {
  const f = fixture(t);
  const run = f.fake.runGh;
  const hiddenPlan = args => {
    const output = run(args);
    if (args.includes('POST') && args.some(x => typeof x === 'string' && x.startsWith('body=/atc plan '))) f.fake.store.comments.at(-1).hidden = true;
    return output;
  };
  const pending = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'], { runner: hiddenPlan });
  assert.equal(pending.ready, false); assert.equal(pending.outcome, 'pending');
  assert.equal(readWorkTicket(f.git), null); assert.equal(f.fake.store.comments.length, 2);
  const g = fixture(t);
  const unknown = args => {
    const output = g.fake.runGh(args);
    return args.includes('POST') ? { status: 1, stdout: '' } : output;
  };
  const uncertain = await g.run(['begin', '1', 'src/a.js', '--base', 'HEAD'], { runner: unknown });
  assert.equal(uncertain.ready, false); assert.equal(uncertain.outcome, 'uncertain');
  assert.equal(readWorkTicket(g.git), null); assert.equal(g.fake.store.comments.length, 1);
});

test('the posted selector prevents a local ticket from switching its remote base policy to HEAD', async t => {
  const f = fixture(t);
  const base = f.command(['rev-parse', 'HEAD']);
  const runner = args => args.includes('repos/acme/widgets/commits/main') ? { status: 0, stdout: JSON.stringify({ sha: base }) } : f.fake.runGh(args);
  assert.equal((await f.run(['begin', '1', 'src/a.js'], { runner })).ready, true);
  assert.equal((await f.run(['guard'], { runner })).ready, true);
  const file = ticketLocation(f.git).file;
  const ticket = JSON.parse(fs.readFileSync(file)); assert.equal(ticket.ref, null);
  ticket.ref = 'HEAD'; fs.writeFileSync(file, JSON.stringify(ticket));
  const guarded = await f.run(['guard'], { runner });
  assert.equal(guarded.ready, false); assert.equal(guarded.outcome, 'scopeChanged');
});

test('failed prerequisites stop begin before network coordination or local session state', async t => {
  const f = fixture(t);
  const before = f.command(['for-each-ref', '--format=%(refname)']);
  const result = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'], {
    doctorCheck: () => ({ ready: false }), runner: () => assert.fail('No GitHub coordination after failed prerequisites')
  });
  assert.equal(result.ready, false); assert.equal(result.outcome, 'prerequisitesUnavailable');
  assert.equal(f.fake.store.comments.length, 0); assert.equal(readWorkTicket(f.git), null);
  assert.equal(f.command(['for-each-ref', '--format=%(refname)']), before);
  assert.equal(fs.existsSync(path.join(f.git.commonDir(), 'atc')), false);
});

test('publication guard detects a real PR merge conflict and refuses untestable PR heads', async t => {
  const f = fixture(t);
  const origin = `${f.folder}-origin.git`;
  t.after(() => fs.rmSync(origin, { recursive: true, force: true }));
  f.command(['init', '-q', '--bare', origin]); f.command(['remote', 'add', 'origin', origin]);
  f.git.remoteFor = () => 'origin';
  const pull = f.fake.addPull({ author: 'bob', files: ['src/a.js'] });
  pull.base = { sha: f.command(['rev-parse', 'HEAD']), repo: { full_name: f.fake.repository } };
  const ref = `refs/pull/${pull.number}/head`;
  f.command(['checkout', '-qb', 'other-agent', 'main']);
  fs.writeFileSync(path.join(f.folder, 'src/a.js'), 'export const value = 20;\n');
  f.command(['commit', '-qam', 'Other change']); f.command(['push', '-q', 'origin', `HEAD:${ref}`]);
  pull.head = { sha: f.command(['rev-parse', 'HEAD']) };
  f.command(['checkout', '-q', 'main']);
  assert.equal((await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'])).ready, true);
  fs.writeFileSync(path.join(f.folder, 'src/a.js'), 'export const value = 30;\n');
  assert.equal((await f.run(['guard'])).ready, true);
  const conflict = await f.run(['guard', '--publish']);
  assert.equal(conflict.ready, false); assert.equal(conflict.outcome, 'mergeConflicts');
  f.command(['--git-dir', origin, 'update-ref', '-d', ref]);
  pull.head = { sha: 'f'.repeat(40) };
  const unknown = await f.run(['guard', '--publish']);
  assert.equal(unknown.ready, false); assert.equal(unknown.outcome, 'incomplete'); assert.equal(unknown.complete, false);
});

test('publication guard refuses a pull request that renamed the file you deleted', async t => {
  const f = fixture(t);
  const origin = `${f.folder}-origin.git`;
  t.after(() => fs.rmSync(origin, { recursive: true, force: true }));
  f.command(['init', '-q', '--bare', origin]); f.command(['remote', 'add', 'origin', origin]);
  f.git.remoteFor = () => 'origin';
  const pull = f.fake.addPull({ author: 'bob', files: ['src/a.js', 'src/b.js'] });
  pull.base = { sha: f.command(['rev-parse', 'HEAD']), repo: { full_name: f.fake.repository } };
  f.command(['checkout', '-qb', 'other-agent', 'main']);
  f.command(['mv', 'src/a.js', 'src/b.js']); f.command(['commit', '-qm', 'Rename']);
  pull.head = { sha: f.command(['rev-parse', 'HEAD']) };
  f.command(['push', '-q', 'origin', `HEAD:refs/pull/${pull.number}/head`]);
  f.command(['checkout', '-q', 'main']);
  assert.equal((await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'])).ready, true);
  fs.rmSync(path.join(f.folder, 'src/a.js'));
  assert.equal((await f.run(['guard'])).ready, true);
  const result = await f.run(['guard', '--publish']);
  assert.equal(result.ready, false); assert.equal(result.outcome, 'mergeConflicts');
});

test('pre-edit guard canonicalizes an absolute fixture path against its ticket worktree root', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'])).ready, true);
  const root = ticketLocation(f.git).root;
  const file = path.join(f.folder, 'src/a.js');
  const verified = await f.run(['guard', file, '--json']);
  assert.equal(verified.ready, true);
  const calls = [];
  const output = preEditOutput({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: f.folder,
    tool_input: { file_path: file } }, { gitContext: () => ({ root, github: true, configured: true }),
    ticketStatus: () => 'present', run(args, options) { calls.push({ args, options }); return verified; } });
  assert.equal(output, null);
  assert.deepEqual(calls.map(call => call.args), [['guard', path.join(root, 'src/a.js'), '--json']]);
});
