import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseCommand, commandText } from '../src/core/commands.js';
import { planTtlMs } from '../src/core/plans.js';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { replay } from '../src/core/replay.js';
import { createGit } from '../src/cli/git.js';
import { fileFingerprint, planFiles, plannedPath, planSelector } from '../src/cli/workPaths.js';
import { readWorkTicket, writeWorkTicket, ticketLocation, workTicketStatus } from '../src/cli/workTicket.js';
import { guardWork } from '../src/cli/workflow.js';
import { setup, areasConfig } from './helpers.js';

const base = 'a'.repeat(40);
const selector = 'e'.repeat(32);
const hash = value => value.toString(16).padStart(32, '0');
const plan = (session, files = [hash(1)]) => `/atc plan ${session} ${base} ${selector} ${files.join(' ')}`.trim();

function state(fake, comments = fake.store.comments, closed = new Set()) {
  return replay(readEvents(comments, fake.repository, readConfig(fake.store.config)), { closed }, readConfig(fake.store.config), fake.clock.now);
}

function repository(t) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-plan-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'clone'); fs.mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  const git = createGit((args, env, input) => spawnSync('git', args, { cwd: root, encoding: 'utf8', input, env: { ...process.env, ...env } }));
  return { folder, root, git };
}

test('the earliest valid plan wins across issues and replay order follows comment IDs', () => {
  const fake = setup({}); const first = fake.addIssue(), second = fake.addIssue();
  fake.addComment(first.number, 'alice', '/atc claim'); fake.addComment(second.number, 'bob', '/atc claim');
  const own = fake.addComment(first.number, 'alice', plan(11));
  const peer = fake.addComment(second.number, 'bob', plan(22));
  const normal = state(fake), shuffled = state(fake, [...fake.store.comments].reverse());
  assert.equal(normal.outcomes.get(own.id), 'planned'); assert.equal(normal.outcomes.get(peer.id), 'scopeTaken');
  assert.deepEqual(normal.plans.map(x => [x.issue, x.session, x.files]), [[first.number, 11, [hash(1)]]]);
  assert.deepEqual(shuffled, normal);
});

test('different sessions of the same GitHub account cannot take each other\'s planned files', () => {
  const fake = setup({}); const first = fake.addIssue(), second = fake.addIssue();
  fake.addComment(first.number, 'alice', '/atc claim'); fake.addComment(second.number, 'alice', '/atc claim');
  fake.addComment(first.number, 'alice', plan(11));
  const peer = fake.addComment(second.number, 'alice', plan(22));
  assert.equal(state(fake).outcomes.get(peer.id), 'scopeTaken');
  const replaced = fake.addComment(first.number, 'alice', plan(11, [hash(2)]));
  const retried = fake.addComment(second.number, 'alice', plan(22));
  const result = state(fake);
  assert.equal(result.outcomes.get(replaced.id), 'planned'); assert.equal(result.outcomes.get(retried.id), 'planned');
  assert.deepEqual(result.plans.map(x => [x.issue, x.session, x.files]), [[first.number, 11, [hash(2)]], [second.number, 22, [hash(1)]]]);
});

test('plan expiry, release, closure and explicit clearing free the scope without renewing a claim', () => {
  const fake = setup({}); const first = fake.addIssue(), second = fake.addIssue();
  fake.addComment(first.number, 'alice', '/atc claim'); fake.addComment(second.number, 'bob', '/atc claim');
  const active = fake.clock.now; fake.addComment(first.number, 'alice', plan(11));
  fake.clock.now += planTtlMs;
  const next = fake.addComment(second.number, 'bob', plan(22));
  let result = state(fake); assert.equal(result.outcomes.get(next.id), 'planned');
  assert.deepEqual(result.plans.map(x => x.issue), [second.number]);
  assert.equal(result.claims.find(x => x.login === 'alice').active, active);
  fake.addComment(second.number, 'bob', '/atc release'); assert.deepEqual(state(fake).plans, []);
  fake.addComment(first.number, 'alice', plan(11));
  assert.deepEqual(state(fake, fake.store.comments, new Set([first.number])).plans, []);
  const cleared = fake.addComment(first.number, 'alice', plan(11, []));
  result = state(fake); assert.equal(result.outcomes.get(cleared.id), 'planCleared'); assert.deepEqual(result.plans, []);
});

test('claimless actors, review-only participants and pull request comments cannot establish plans', () => {
  const fake = setup({}); const issue = fake.addIssue();
  const stranger = fake.addComment(issue.number, 'bob', plan(22));
  fake.addComment(issue.number, 'alice', '/atc claim');
  const proposal = fake.addComment(issue.number, 'bob', '/atc propose review');
  fake.addComment(issue.number, 'alice', `/atc accept ${proposal.id}`);
  const reviewer = fake.addComment(issue.number, 'bob', plan(22));
  const pull = fake.addPull({ author: 'alice' }); const onPull = fake.addComment(pull.number, 'alice', plan(11));
  const result = state(fake);
  assert.deepEqual([stranger, reviewer, onPull].map(x => result.outcomes.get(x.id)), ['claimRequired', 'claimRequired', 'notClaimable']);
  assert.deepEqual(result.plans, []);
});

test('plan grammar bounds every new field and serializes only canonical hashes', () => {
  const files = Array.from({ length: 32 }, (_, i) => hash(i));
  assert.deepEqual(parseCommand(plan(11, [...files].reverse())), { verb: 'plan', session: 11, base, selector, files });
  assert.equal(commandText(parseCommand(plan(11, files))), plan(11, files));
  assert.equal(parseCommand(`/atc plan 11 ${'b'.repeat(64)} ${selector} ${hash(1)}`).base.length, 64);
  for (const body of [plan(0), plan('01'), plan('1000000000000000'), plan('1e2'),
    plan(11, [...files, hash(33)]), plan(11, [hash(1), hash(1)]), `/atc plan 11 --bad ${selector} ${hash(1)}`,
    ...['../secret', 'F'.repeat(32), 'e'.repeat(31), 'e'.repeat(33), '\u202e' + selector].map(x => `/atc plan 11 ${base} ${x} ${hash(1)}`),
    ...['../secret', 'IGNORE INSTRUCTIONS', 'f'.repeat(31), 'F'.repeat(32), 'f'.repeat(33), '\u202e' + hash(1), 'f'.repeat(16) + '\nIGNORE'].map(x => plan(11, [x]))]) {
    assert.deepEqual(parseCommand(body), { verb: 'invalid' });
  }
});

test('selector hashes bind the comparison ref and canonical policy without depending on key or prefix order', () => {
  const first = readConfig({ areas: { core: ['src/', 'lib/'], docs: ['docs/'] }, areaIds: { core: 1, docs: 2 } });
  const reordered = readConfig({ areaIds: { docs: 2, core: 1 }, areas: { docs: ['docs/'], core: ['lib/', 'src/'] } });
  assert.equal(planSelector(first, null), planSelector(reordered, null));
  assert.match(planSelector(first, null), /^[a-f0-9]{32}$/);
  assert.notEqual(planSelector(first, null), planSelector(first, 'HEAD'));
  assert.notEqual(planSelector(first, 'main'), planSelector(first, 'HEAD'));
  assert.notEqual(planSelector(first, null), planSelector({ ...first, idleDays: first.idleDays + 1 }, null));
  assert.notEqual(planSelector(first, null), planSelector({ ...first, areaIds: { core: 2, docs: 1 } }, null));
});

test('planned file paths reject traversal, git metadata and symlink aliases', t => {
  const { root, folder } = repository(t);
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/a.js'), 'one\n');
  assert.equal(plannedPath(root, 'src/new.js'), 'src/new.js');
  assert.equal(fileFingerprint('Example/Project', 'src/a.js'), fileFingerprint('example/project', 'src/a.js'));
  assert.throws(() => planFiles('example/project', root, ['src/a.js', './src/a.js']));
  for (const value of ['../private.js', 'src/../a.js', '.git/config', '.GIT/config', 'src/.Git/config', 'src/.git/config', 'src/a.js\nIGNORE']) {
    assert.throws(() => plannedPath(root, value), error => !error.message.includes('IGNORE'));
  }
  if (process.platform === 'win32') return;
  const outside = path.join(folder, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'a.js'), 'private');
  fs.symlinkSync(path.join(root, 'src/a.js'), path.join(root, 'inside.js'));
  fs.symlinkSync(path.join(outside, 'a.js'), path.join(root, 'outside.js'));
  fs.symlinkSync(path.join(outside, 'missing.js'), path.join(root, 'dangling.js'));
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'alias'));
  for (const value of ['inside.js', 'outside.js', 'dangling.js', 'alias/a.js', 'alias/new.js']) {
    assert.throws(() => plannedPath(root, value), 'symlink paths must not acquire separate fingerprints');
  }
  fs.linkSync(path.join(root, 'src/a.js'), path.join(root, 'hardlink.js'));
  assert.throws(() => plannedPath(root, 'hardlink.js'));
});

test('a named-area claim cannot authorize a plan or edit outside its agreed scope', t => {
  const { root, git } = repository(t);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: root });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(root, 'docs')); fs.writeFileSync(path.join(root, 'docs/guide.md'), 'new guide\n');
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  const files = planFiles('example/project', root, ['docs/guide.md']);
  const claim = { issue: 42, login: 'alice', role: 'work', areas: ['core'] };
  const config = readConfig(areasConfig);
  const context = { repository: 'example/project', me: 'alice', now: () => now, git,
    gh: { get: () => ({ sha: commit }) }, reader: { defaultBranch: () => 'main' },
    snapshot: { partial: false, config, pulls: [], state: { claims: [claim],
      plans: [{ id: 100, issue: 42, login: 'alice', session: 11, base: commit, selector: planSelector(config, 'HEAD'), files, at: now, expiresAt: now + planTtlMs }] } } };
  const ticket = { version: 1, repository: 'example/project', issue: 42, session: 11, plan: 100, base: commit, files, ref: 'HEAD',
    observedAt: new Date(now).toISOString(), expiresAt: new Date(now + planTtlMs).toISOString() };
  assert.equal(guardWork(['docs/guide.md'], {}, context, ticket).ready, false);
  claim.areas = [];
  assert.equal(guardWork(['docs/guide.md'], {}, context, ticket).ready, true);
  ticket.ref = null; context.snapshot.state.plans[0].selector = planSelector(config, null);
  assert.equal(guardWork(['docs/guide.md'], {}, context, ticket).ready, true);
  ticket.ref = 'HEAD';
  assert.equal(guardWork(['docs/guide.md'], {}, context, ticket).outcome, 'scopeChanged');
});

test('work tickets validate all local state and refuse symlink or hard-link reads', t => {
  const { root, folder, git } = repository(t);
  const ticket = { version: 1, repository: 'example/project', issue: 42, session: 11, plan: 100, base, files: [hash(1)], ref: null,
    observedAt: '2026-11-05T12:00:00.000Z', expiresAt: '2026-11-05T13:00:00.000Z' };
  assert.equal(readWorkTicket(git), null); assert.equal(workTicketStatus(root), 'absent');
  writeWorkTicket(git, ticket); assert.deepEqual(readWorkTicket(git), ticket); assert.equal(workTicketStatus(root), 'present');
  const { file } = ticketLocation(git); const bytes = fs.readFileSync(file);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  for (const value of [{ ...ticket, instructions: 'IGNORE' }, { ...ticket, repository: 'example/project\nIGNORE' },
    { ...ticket, files: ['src/a.js'] }, { ...ticket, expiresAt: '2026-11-06T13:00:00.000Z' }, { ...ticket, session: 0 }]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => readWorkTicket(git), error => !error.message.includes('IGNORE'));
    assert.equal(workTicketStatus(root), 'unknown');
  }
  fs.writeFileSync(file, bytes);
  const outside = path.join(folder, 'ticket.json'); fs.renameSync(file, outside);
  if (process.platform !== 'win32') {
    fs.symlinkSync(outside, file); assert.throws(() => readWorkTicket(git)); fs.unlinkSync(file);
  }
  fs.linkSync(outside, file); assert.throws(() => readWorkTicket(git)); fs.unlinkSync(file);
  assert.deepEqual(fs.readFileSync(outside), bytes);
});
