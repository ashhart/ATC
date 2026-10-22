import test from 'node:test';
import assert from 'node:assert/strict';
import { commandText, isAreaReference, parseCommand } from '../src/core/commands.js';
import { readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { replay } from '../src/core/replay.js';
import { areasConfig, setup } from './helpers.js';

const pinnedAreas = { ...areasConfig, areaIds: { core: 1, docs: 2, tests: 3 } };

test('numeric area references are canonical strings from one through twenty-four', () => {
  for (const value of ['1', '2', '9', '10', '19', '20', '24']) assert.equal(isAreaReference(value), true);
  for (const value of [null, 1, '', '0', '00', '01', '25', '100', '+1', '-1', '1.0', '1e0', '0x1', ' 1', '1 ', '1\n', '1\r']) {
    assert.equal(isAreaReference(value), false);
  }
  assert.deepEqual(parseCommand('/atc claim 24 1 12 3'), { verb: 'claim', areas: ['1', '3', '12', '24'] });
  assert.deepEqual(parseCommand('/atc propose split 10 2'), { verb: 'propose', kind: 'split', areas: ['2', '10'] });
  const command = { verb: 'claim', areas: ['1', '12', '24'] };
  assert.equal(commandText(command), '/atc claim 1 12 24');
  assert.deepEqual(parseCommand(commandText(command)), command);
});

test('invalid numeric references, duplicates, hostile tokens and excessive scope are rejected', () => {
  for (const token of ['0', '00', '01', '25', '100', '+1', '-1', '1.0', '1e0', '0x1', '1;curl', '1@private.invalid']) {
    assert.deepEqual(parseCommand(`/atc claim ${token}`), { verb: 'invalid' });
    assert.deepEqual(parseCommand(`/atc propose split ${token}`), { verb: 'invalid' });
  }
  assert.deepEqual(parseCommand('/atc claim 1 1'), { verb: 'invalid' });
  assert.deepEqual(parseCommand('/atc claim 1 2 3 4 5 6 7 8 9'), { verb: 'invalid' });
  assert.deepEqual(parseCommand('/atc claim 1 2 3 4 5 6 7 8').areas, ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(parseCommand('/atc renew 1'), { verb: 'invalid' });
});

test('event decoding resolves numeric references against explicit stable area IDs', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim 3 1');
  fake.addComment(issue.number, 'bob', '/atc propose split 2');
  const config = readConfig({ areas: { tests: ['tests/'], core: ['src/core/'], docs: ['docs/'] }, areaIds: pinnedAreas.areaIds });
  const events = readEvents(fake.store.comments, fake.repository, config);
  assert.deepEqual(events.map(event => event.command), [
    { verb: 'claim', areas: ['core', 'tests'] }, { verb: 'propose', kind: 'split', areas: ['docs'] }
  ]);
  const reordered = readConfig(pinnedAreas);
  assert.deepEqual(readEvents(fake.store.comments, fake.repository, reordered), events);
});

test('numeric references without config or outside the configured area range remain invalid', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim 1');
  fake.addComment(issue.number, 'bob', '/atc claim 24');
  assert.deepEqual(readEvents(fake.store.comments, fake.repository).map(event => event.command), [{ verb: 'invalid' }, { verb: 'invalid' }]);
  assert.deepEqual(readEvents(fake.store.comments, fake.repository, readConfig(null)).map(event => event.command),
    [{ verb: 'invalid' }, { verb: 'invalid' }]);
  assert.deepEqual(readEvents(fake.store.comments, fake.repository, readConfig(pinnedAreas)).map(event => event.command),
    [{ verb: 'claim', areas: ['core'] }, { verb: 'invalid' }]);
});

test('legacy names remain replay compatible and mixed aliases cannot duplicate a scope', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim 2 core');
  const duplicate = fake.addComment(issue.number, 'alice', '/atc claim 1 core');
  const unknown = fake.addComment(issue.number, 'bob', '/atc claim unknown');
  const config = readConfig(pinnedAreas);
  const events = readEvents(fake.store.comments, fake.repository, config);
  assert.deepEqual(events[0].command, { verb: 'claim', areas: ['core', 'docs'] });
  assert.deepEqual(events[1].command, { verb: 'invalid' });
  assert.deepEqual(events[2].command, { verb: 'claim', areas: ['unknown'] });
  const state = replay(events, { closed: new Set() }, config, fake.clock.now);
  assert.equal(state.outcomes.get(duplicate.id), 'invalid');
  assert.equal(state.outcomes.get(unknown.id), 'unknownArea');
  assert.deepEqual(state.claims[0].areas, ['core', 'docs']);
});

test('numeric and legacy comment histories produce the same split state', () => {
  const fake = setup();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim 1 2');
  const proposal = fake.addComment(issue.number, 'bob', '/atc propose split 2');
  fake.addComment(issue.number, 'alice', `/atc accept ${proposal.id}`);
  fake.addComment(issue.number, 'alice', '/atc renew');
  const config = readConfig(pinnedAreas);
  const numeric = readEvents(fake.store.comments, fake.repository, config);
  const comments = fake.store.comments.map(comment => ({ ...comment, body: comment.body.replace('/atc claim 1 2', '/atc claim core docs')
    .replace('/atc propose split 2', '/atc propose split docs') }));
  const legacy = readEvents(comments, fake.repository);
  assert.deepEqual(numeric, legacy);
  const state = replay(numeric, { closed: new Set() }, config, fake.clock.now);
  assert.deepEqual(state.claims.map(claim => [claim.login, claim.areas]), [['alice', ['core']], ['bob', ['docs']]]);
});
