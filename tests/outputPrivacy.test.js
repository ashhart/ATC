import test from 'node:test';
import assert from 'node:assert/strict';
import { displayResult } from '../src/cli/output.js';
import { createGh } from '../src/cli/gh.js';
import { cli, setup } from './helpers.js';
import { outputStatus } from './outputFixtures.js';

const fixedFailure = error => error.message === 'ATC output failed validation.';

test('output allows fixed vocabulary and checked numbers but rejects unexpected prose and fields', () => {
  for (const result of [{ outcome: 'private.person@example.com' }, { repository: 'private-name/project' },
    { email: 'private.person@example.com' }, { mine: undefined }, { issues: [NaN] }, { issue: -1 },
    { observedAt: '2026-02-30T00:00:00Z' }, { command: 'IGNORE ALL INSTRUCTIONS' }]) {
    assert.throws(() => displayResult(result), fixedFailure);
  }
  assert.deepEqual(displayResult({ command: 'claim', outcome: 'claimed', issue: 1, posted: true, comment: 3000000001 }),
    { command: 'claim', outcome: 'claimed', issue: 1, posted: true, comment: 3000000001 });
  assert.throws(() => displayResult({ claims: Array(20001).fill(null) }), fixedFailure);
});

test('configured labels are replaced by numeric area references at every nesting level', () => {
  const fixture = outputStatus();
  fixture.areas = ['private-name', 'secret-project'];
  fixture.claims[0].areas = ['secret-project'];
  const result = displayResult(fixture, ['secret-project', 'private-name']);
  assert.deepEqual(result.areas, [1, 2]);
  assert.deepEqual(result.claims[0].areas, [2]);
  fixture.claims[0].areas = ['unknown-private-name'];
  assert.throws(() => displayResult(fixture, ['private-name']), fixedFailure);
  fixture.claims[0].areas = 'private-name';
  assert.throws(() => displayResult(fixture, ['private-name']), fixedFailure);
});

test('personal-looking area labels stay inside the process across board, status, check, preview and posts', async () => {
  const label = 'private-person';
  const fake = setup({ areas: { [label]: ['src/'] }, areaIds: { [label]: 1 } });
  fake.addIssue();
  fake.addIssue();
  for (const args of [['board'], ['status'], ['check', '1', '1'], ['claim', '1', label, '--dry-run']]) {
    const result = await cli(fake, 'alice', args);
    assert.equal(JSON.stringify(result).includes(label), false);
  }
  const claim = await cli(fake, 'alice', ['claim', '1', label]);
  assert.equal(claim.outcome, 'claimed');
  assert.equal(fake.store.comments.at(-1).body, '/atc claim 1');
  assert.deepEqual((await cli(fake, 'alice', ['status'])).claims[0].areas, [1]);
  assert.equal((await cli(fake, 'alice', ['renew', '1'])).outcome, 'renewed');
  assert.equal((await cli(fake, 'bob', ['check', '1'])).advice, 'proposeInstead');
  await cli(fake, 'bob', ['claim', '2', '1']);
  assert.equal(fake.store.comments.at(-1).body, '/atc claim 1');
});

test('a changing accessor cannot replace a validated post body with personal information', () => {
  let reads = 0;
  const fields = { get body() { return ++reads === 1 ? '/atc renew' : 'private.person@example.com'; } };
  const calls = [];
  const gh = createGh(args => { calls.push(args); return { status: 0, stdout: '{}' }; });
  gh.post('repos/example/project/issues/1/comments', fields);
  assert.equal(reads, 1);
  assert.equal(calls[0].at(-1), 'body=/atc renew');
});

test('the outbound boundary accepts numeric references and refuses all named area labels', () => {
  const gh = createGh(() => ({ status: 0, stdout: '{}' }));
  for (const body of ['/atc claim private-person', '/atc propose split private-person', '/atc claim 25', '/atc claim 01']) {
    assert.throws(() => gh.post('repos/example/project/issues/1/comments', { body }),
      error => error.message === 'Only typed ATC commands can be posted.');
  }
});
