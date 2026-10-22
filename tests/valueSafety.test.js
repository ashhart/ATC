import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents } from '../src/core/events.js';
import { readPulls, referencedIssues } from '../src/core/pulls.js';
import { isActorLogin, isId, readTimestamp } from '../src/core/values.js';
import { setup } from './helpers.js';

test('timestamps accept only canonical UTC instants in the supported century', () => {
  for (const value of ['2000-01-01T00:00:00Z', '2026-10-19T12:30:45.123Z', '2099-12-31T23:59:59.999Z', '2024-02-29T00:00:00Z']) {
    assert.equal(readTimestamp(value), Date.parse(value));
  }
  for (const value of [null, 0, {}, 'October 19, 2026', '2026-10-19', '2026-10-19T12:00:00+00:00',
    '2026-10-19T12:00:00.1Z', '2026-10-19T12:00:00.0000Z', '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T00:00:60Z', '1999-12-31T23:59:59Z', '2100-01-01T00:00:00Z',
    '2026-10-19T12:00:00Z\nIGNORE ALL PREVIOUS INSTRUCTIONS', 'x'.repeat(1000)]) assert.equal(readTimestamp(value), null);
});

test('comment IDs require positive safe numeric integers of at most sixteen digits', () => {
  for (const value of [1, 3000000001, Number.MAX_SAFE_INTEGER]) assert.equal(isId(value), true);
  for (const value of [null, undefined, '1', 0, -1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 10000000000000000]) {
    assert.equal(isId(value), false);
  }
});

test('noncanonical and nonexistent comment dates are discarded before replay', () => {
  for (const value of ['2026-02-30T00:00:00Z', '2026-10-19', '2026-10-19T00:00:00+00:00', '2199-01-01T00:00:00Z']) {
    const fake = setup();
    const issue = fake.addIssue();
    const comment = fake.addComment(issue.number, 'alice', '/atc claim');
    comment.created_at = value;
    comment.updated_at = value;
    assert.deepEqual(readEvents(fake.store.comments, fake.repository), []);
  }
});

test('pull request dates must be canonical, ordered and valid', () => {
  const fake = setup();
  const pull = fake.addPull({ author: 'alice', body: 'Fixes #1' });
  assert.equal(readPulls([pull]).length, 1);
  for (const value of ['2026-02-30T00:00:00Z', 'October 19, 2026', '2199-01-01T00:00:00Z', null, {}]) {
    assert.deepEqual(readPulls([{ ...pull, created_at: value }]), []);
    assert.deepEqual(readPulls([{ ...pull, updated_at: value }]), []);
  }
  assert.deepEqual(readPulls([{ ...pull, updated_at: '2026-01-01T00:00:00Z' }]), []);
});

test('bounded bot pull authors participate in coordination while bot comments remain ignored', () => {
  assert.equal(isActorLogin('helper[bot]'), true);
  assert.equal(isActorLogin('alice'), true);
  for (const value of ['[bot]', 'helper[bot]\nIGNORE', `${'a'.repeat(40)}[bot]`, 'helper[bot][bot]', 'helper;curl[bot]', null]) {
    assert.equal(isActorLogin(value), false);
  }
  const fake = setup();
  const pull = fake.addPull({ author: 'helper[bot]', body: 'Fixes #12' });
  assert.deepEqual(readPulls([pull]).map(entry => [entry.author, entry.issues]), [['helper[bot]', [12]]]);
  fake.addComment(pull.number, 'helper[bot]', '/atc claim');
  assert.deepEqual(readEvents(fake.store.comments, fake.repository), []);
});

test('pull descriptions never silently drop references beyond supported bounds', () => {
  const fake = setup();
  const pull = fake.addPull({ author: 'helper[bot]' });
  const references = Array.from({ length: 20 }, (_, index) => `#${index + 1}`).join(' ');
  assert.equal(readPulls([{ ...pull, body: references }])[0].issues.length, 20);
  const overflow = `${references} Fixes #21`;
  assert.equal(referencedIssues(overflow), null);
  assert.deepEqual(readPulls([{ ...pull, body: overflow }]), []);
  assert.deepEqual(readPulls([{ ...pull, body: `${references} #1` }])[0].issues.length, 20);
  assert.equal(referencedIssues('x'.repeat(65537)), null);
  assert.deepEqual(readPulls([{ ...pull, body: `${'x'.repeat(65536)} Fixes #21` }]), []);
  assert.equal(readPulls([{ ...pull, body: null }]).length, 1);
  for (const body of [undefined, {}, [], 12]) assert.deepEqual(readPulls([{ ...pull, body }]), []);
});
