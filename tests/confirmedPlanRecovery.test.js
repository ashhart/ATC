import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { setup } from './helpers.js';
import { createGh, TimeLimit } from '../src/cli/gh.js';
import { createGit } from '../src/cli/git.js';
import { parseCliArgs } from '../src/cli/args.js';
import { runCli } from '../src/cli/actions.js';
import { readWorkTicket } from '../src/cli/workTicket.js';
import { planTtlMs } from '../src/core/plans.js';

function fixture(t) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-plan-recovery-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const command = args => execFileSync('git', args, { cwd: folder, encoding: 'utf8' }).trim();
  command(['init', '-q', '-b', 'main']);
  command(['config', 'user.name', 'Fixture']); command(['config', 'user.email', 'fixture@example.invalid']);
  fs.mkdirSync(path.join(folder, 'src'));
  fs.writeFileSync(path.join(folder, 'src/a.js'), 'export const value = 1;\n');
  command(['add', '.']); command(['commit', '-qm', 'Fixture']);
  const git = createGit((args, env, input) => spawnSync('git', args, { cwd: folder, encoding: 'utf8', input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } }));
  const fake = setup(); fake.addIssue();
  fake.store.nextComment = 3000000101;
  const run = (args, { lateIncomplete = false } = {}) => {
    const gh = createGh(fake.runGh);
    const graphql = gh.graphql;
    gh.graphql = (query, variables) => {
      if (lateIncomplete && query.includes('issues(states: OPEN')
        && fake.store.comments.some(comment => comment.body.startsWith('/atc plan '))) throw new TimeLimit('Fixture deadline.');
      return graphql(query, variables);
    };
    return runCli(parseCliArgs(args), { gh, git, now: () => fake.clock.now,
      sleep: async () => { fake.clock.now += 1000; }, cwd: folder, doctorCheck: () => ({ ready: true }) });
  };
  return { folder, command, git, fake, run };
}

async function interrupted(t) {
  const f = fixture(t);
  const result = await f.run(['begin', '1', 'src/a.js', '--base', 'HEAD'], { lateIncomplete: true });
  assert.equal(result.ready, false); assert.equal(result.outcome, 'incomplete'); assert.equal(result.complete, false);
  assert.equal(f.fake.store.comments.length, 2);
  const ticket = readWorkTicket(f.git);
  assert.ok(ticket, 'a confirmed reservation must survive the final incomplete read');
  assert.equal(ticket.session, result.session);
  return { ...f, ticket };
}

test('a confirmed plan survives a final incomplete snapshot and ordinary plan resumes its session', async t => {
  const f = await interrupted(t);
  const blocked = await f.run(['guard', 'src/a.js'], { lateIncomplete: true });
  assert.equal(blocked.ready, false); assert.equal(blocked.outcome, 'incomplete');
  assert.equal((await f.run(['guard', 'src/a.js'])).ready, true);
  const resumed = await f.run(['plan', '1', 'src/a.js', '--base', 'HEAD']);
  assert.equal(resumed.ready, true); assert.equal(resumed.session, f.ticket.session);
  assert.equal(f.fake.store.comments.length, 3);
  assert.equal(f.fake.store.comments.filter(comment => comment.body === '/atc claim').length, 1);
  assert.equal((await f.run(['guard', '--publish'])).ready, true);
});

for (const kind of ['released', 'expired', 'baseChanged', 'foreignPlan', 'policyChanged']) {
  test(`a recovered ticket still denies ${kind} work`, async t => {
    const f = await interrupted(t);
    let expected;
    if (kind === 'released') {
      await f.run(['release', '1']); expected = 'claimRequired';
    } else if (kind === 'expired') {
      f.fake.clock.now += planTtlMs + 1; expected = 'planExpired';
    } else if (kind === 'baseChanged') {
      fs.writeFileSync(path.join(f.folder, 'src/a.js'), 'export const value = 2;\n');
      f.command(['commit', '-qam', 'Changed base']); expected = 'baseChanged';
    } else if (kind === 'foreignPlan') {
      const now = f.fake.clock.now;
      f.fake.clock.now -= 10000; f.fake.store.nextComment = 3000000001;
      f.fake.addIssue();
      f.fake.addComment(2, 'bob', '/atc claim');
      const selector = f.fake.store.comments.find(comment => comment.body.startsWith('/atc plan ')).body.split(' ')[4];
      f.fake.addComment(2, 'bob', `/atc plan ${f.ticket.session + 1} ${f.ticket.base} ${selector} ${f.ticket.files.join(' ')}`);
      f.fake.clock.now = now; expected = 'scopeChanged';
    } else {
      f.fake.store.config.areas.core.push('other/'); expected = 'scopeChanged';
    }
    const guarded = await f.run(['guard', '--publish']);
    assert.equal(guarded.ready, false); assert.equal(guarded.outcome, expected);
    if (kind === 'foreignPlan') assert.equal((await f.run(['plan', '1', 'src/a.js', '--base', 'HEAD'])).outcome, 'scopeTaken');
  });
}

test('a later conflicting plan cannot displace a recovered reservation', async t => {
  const f = await interrupted(t);
  f.fake.addIssue(); f.fake.addComment(2, 'bob', '/atc claim');
  const selector = f.fake.store.comments.find(comment => comment.body.startsWith('/atc plan ')).body.split(' ')[4];
  f.fake.addComment(2, 'bob', `/atc plan ${f.ticket.session + 1} ${f.ticket.base} ${selector} ${f.ticket.files.join(' ')}`);
  assert.equal((await f.run(['guard', '--publish'])).ready, true);
});
