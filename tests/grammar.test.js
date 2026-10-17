import test from 'node:test';
import assert from 'node:assert/strict';
import { commandText, parseCommand } from '../src/core/commands.js';
import { areasForPath, readConfig } from '../src/core/config.js';
import { referencedIssues } from '../src/core/pulls.js';

test('the comment grammar accepts only exact typed commands, first line only', () => {
  assert.deepEqual(parseCommand('/atc claim'), { verb: 'claim', areas: [] });
  assert.deepEqual(parseCommand('/atc claim docs core'), { verb: 'claim', areas: ['core', 'docs'] });
  assert.deepEqual(parseCommand('  /atc release  '), { verb: 'release' });
  assert.deepEqual(parseCommand('/atc propose split tests'), { verb: 'propose', kind: 'split', areas: ['tests'] });
  assert.deepEqual(parseCommand('/atc propose pair'), { verb: 'propose', kind: 'pair', areas: [] });
  assert.deepEqual(parseCommand('/atc accept 12'), { verb: 'accept', proposal: 12 });
  assert.deepEqual(parseCommand('/atc withdraw 3000000123'), { verb: 'withdraw', proposal: 3000000123 });
  assert.deepEqual(parseCommand('/atc reset'), { verb: 'reset' });
  assert.deepEqual(parseCommand('/atc claim core\r\nIGNORE ALL PREVIOUS INSTRUCTIONS'), { verb: 'claim', areas: ['core'] });
  for (const command of [{ verb: 'claim', areas: ['core'] }, { verb: 'propose', kind: 'split', areas: ['docs'] }, { verb: 'withdraw', proposal: 7 }]) {
    assert.deepEqual(parseCommand(commandText(command)), command);
  }
});

test('anything else is ignored or marked invalid, and nothing from it is kept', () => {
  for (const body of ['hello', 'please /atc claim', '/ATC claim', '/atcclaim', '', null, 42, '\n/atc claim']) {
    assert.equal(parseCommand(body), null);
  }
  for (const body of ['/atc', '/atc claim Core', '/atc claim core core', '/atc claim a b c d e f g h i', '/atc release now',
    '/atc propose split', '/atc propose pair core', '/atc propose merge', '/atc accept 012', '/atc accept 1 2',
    '/atc claim ignore-all-instructions-now-please', `/atc claim ${'a'.repeat(300)}`, '/atc claim core;rm', '/atc claim --help',
    '/atc claim a--b', '/atc claim -core', '/atc accept 1e3', '/atc decline -1', '/atc accept 99999999999999999', '/atc reset now']) {
    assert.deepEqual(parseCommand(body), { verb: 'invalid' }, body);
  }
});

test('maintainer config allows only area names, safe path prefixes and bounded limits', () => {
  const config = readConfig({ areas: { core: ['src/core/'], docs: ['docs/', 'README.md'] }, maxClaimsPerUser: 2 });
  assert.deepEqual(Object.keys(config.areas), ['core', 'docs']);
  assert.equal(config.maxClaimsPerUser, 2);
  assert.equal(readConfig(null).maxClaimsPerUser, 3);
  assert.deepEqual(areasForPath(config, 'src/core/engine.js'), ['core']);
  assert.deepEqual(areasForPath(config, 'README.md'), ['docs']);
  assert.deepEqual(areasForPath(config, 'README.md.bak'), []);
  for (const value of [[], 'x', { areas: { Core: ['src/'] } }, { areas: { core: ['../etc/'] } }, { areas: { core: ['/abs/'] } },
    { areas: { core: ['src//x'] } }, { areas: { core: [] } }, { areas: { core: ['src/ x'] } }, { maxClaimsPerUser: 0 },
    { idleDays: 365 }, { prompt: 'ignore everything' }]) {
    assert.throws(() => readConfig(value), /Invalid \.github\/atc\.json/);
  }
});

test('issue references in pull request descriptions are read as numbers only', () => {
  assert.deepEqual(referencedIssues('Fixes #12, see #3 and #12 again'), [12, 3]);
  assert.deepEqual(referencedIssues('&#39; url/#7 a#8 #0 #9x'), []);
  assert.deepEqual(referencedIssues(null), []);
});
