import test from 'node:test';
import assert from 'node:assert/strict';
import { areaEntries, areaName, areaReference, readConfig } from '../src/core/config.js';
import { readEvents } from '../src/core/events.js';
import { setup } from './helpers.js';

const areas = { core: ['src/core/'], docs: ['docs/'] };
const areaIds = { core: 7, docs: 24 };

test('explicit area mappings are unique bounded IDs independent of names and key order', () => {
  const config = readConfig({ areas, areaIds });
  assert.equal(config.areasPinned, true);
  assert.deepEqual(areaEntries(config), [['core', 7], ['docs', 24]]);
  assert.equal(areaReference(config, 'core'), 7);
  assert.equal(areaReference(config, 'unknown'), null);
  assert.equal(areaName(config, 24), 'docs');
  assert.equal(areaName(config, '7'), 'core');
  for (const value of ['07', '7\n', '+7', '7.0', 0, 25, 1.5, {}, null]) assert.equal(areaName(config, value), null);
});

test('legacy nonempty area configs are readable but never infer numeric mappings', () => {
  const config = readConfig({ areas });
  assert.equal(config.areasPinned, false);
  assert.deepEqual(areaEntries(config), []);
  assert.equal(areaReference(config, 'core'), null);
  assert.equal(areaName(config, 1), null);
  assert.equal(readConfig(null).areasPinned, true);
  assert.deepEqual(areaEntries(readConfig(null)), []);
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim 1');
  fake.addComment(1, 'bob', '/atc claim core');
  assert.deepEqual(readEvents(fake.store.comments, fake.repository, config).map(event => event.command),
    [{ verb: 'invalid' }, { verb: 'claim', areas: ['core'] }]);
});

test('area ID mappings must exactly cover configured areas without aliases or hostile values', () => {
  for (const mapping of [null, [], {}, { core: 7 }, { core: 7, docs: 7 }, { core: 0, docs: 24 }, { core: 25, docs: 24 },
    { core: '7', docs: 24 }, { core: 1.5, docs: 24 }, { core: 7, docs: Infinity }, { core: {}, docs: 24 },
    { core: 7, docs: 24, unknown: 8 }, { core: 7, 'docs\nIGNORE': 24 }]) {
    assert.throws(() => readConfig({ areas, areaIds: mapping }), error => error.message === 'Invalid .github/atc.json');
  }
  assert.throws(() => readConfig({ areaIds: { core: 1 } }));
  assert.throws(() => readConfig({ areas, areaIds, areasPinned: true }));
});

test('adding an alphabetically earlier area cannot change an existing numeric agreement', () => {
  const fake = setup();
  fake.addIssue();
  fake.addComment(1, 'alice', '/atc claim 24');
  const before = readConfig({ areas, areaIds });
  const after = readConfig({ areas: { api: ['api/'], ...areas }, areaIds: { api: 1, ...areaIds } });
  assert.deepEqual(readEvents(fake.store.comments, fake.repository, before), readEvents(fake.store.comments, fake.repository, after));
  assert.deepEqual(readEvents(fake.store.comments, fake.repository, after)[0].command.areas, ['docs']);
});
