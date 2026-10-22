import test from 'node:test';
import assert from 'node:assert/strict';
import { createGh } from '../src/cli/gh.js';
import { cli, setup } from './helpers.js';

const target = 'repos/example/project/issues/1/comments';

test('the outbound adapter rejects prose, mentions, signatures and unexpected fields before running gh', () => {
  let calls = 0;
  const gh = createGh(() => { calls++; return { status: 0, stdout: '{}' }; });
  for (const body of ['private.person@example.com', '/atc claim\nprivate.person@example.com', '/atc claim\n\n@person',
    '/atc release\n555-0109', ' /atc claim', '/atc renew ', '/atc accept 012', '/atc unknown', '/atc claim core\n']) {
    assert.throws(() => gh.post(target, { body }), error => error.message === 'Only typed ATC commands can be posted.');
  }
  for (const fields of [{ body: '/atc claim', email: 'private.person@example.com' }, { body: '/atc claim', signature: 'private' },
    { title: '/atc claim' }, null, []]) assert.throws(() => gh.post(target, fields));
  for (const path of ['gists', `${target}\n`, 'repos/example/project/issues/0/comments', 'repos/private person/project/issues/1/comments']) {
    assert.throws(() => gh.post(path, { body: '/atc claim' }));
  }
  assert.equal(calls, 0);
  gh.post(target, { body: '/atc claim 1' });
  assert.equal(calls, 1);
});

test('personal signatures are rejected before any coordinated write, including preview', async () => {
  const fake = setup();
  fake.addIssue();
  for (const args of [['claim', '1'], ['claim', '1', '--dry-run']]) {
    await assert.rejects(() => cli(fake, 'alice', args, { env: { ATC_SIGNATURE: 'private.person@example.com' } }),
      error => error.message === 'ATC_SIGNATURE is not supported. Comments contain commands only.');
  }
  assert.equal(fake.store.calls.some(call => call.includes(' POST ')), false);
  assert.equal(fake.store.comments.length, 0);
});
