import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/core/config.js';
import { areasConfig, cli, setup } from './helpers.js';

test('work claim capacity accepts 25 and rejects values outside its bounded integer range', () => {
  for (const value of [1, 3, 8, 20, 21, 25]) {
    assert.equal(readConfig({ maxClaimsPerUser: value }).maxClaimsPerUser, value);
  }
  assert.equal(readConfig({}).maxClaimsPerUser, 3);
  for (const value of [0, -1, 26, 25.5, '25', null, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => readConfig({ maxClaimsPerUser: value }), /Invalid \.github\/atc\.json/);
  }
  assert.throws(() => readConfig({ maxPendingProposalsPerUser: 25 }), /Invalid \.github\/atc\.json/);
});

test('raising capacity preserves eight claims, admits the next seventeen and blocks the twenty-sixth', async () => {
  const fake = setup({ ...areasConfig, maxClaimsPerUser: 8 });
  const issues = Array.from({ length: 26 }, () => fake.addIssue().number);
  for (const issue of issues.slice(0, 8)) fake.addComment(issue, 'alice', '/atc claim');
  const original = fake.store.comments.map(comment => structuredClone(comment));
  assert.equal((await cli(fake, 'alice', ['claim', String(issues[8])])).outcome, 'claimLimit');
  fake.store.config.maxClaimsPerUser = 25;
  for (const issue of issues.slice(8, 25)) {
    assert.equal((await cli(fake, 'alice', ['claim', String(issue)])).outcome, 'claimed');
  }
  const before = fake.store.comments.length;
  const refused = await cli(fake, 'alice', ['claim', String(issues[25])]);
  assert.equal(refused.outcome, 'claimLimit');
  assert.equal(refused.posted, false);
  assert.equal(fake.store.comments.length, before);
  assert.deepEqual(fake.store.comments.slice(0, 8), original);
  const status = await cli(fake, 'alice', ['status']);
  assert.equal(status.complete, true);
  assert.deepEqual(status.claims.filter(claim => claim.mine && claim.role === 'work').map(claim => claim.issue), issues.slice(0, 25));
});
