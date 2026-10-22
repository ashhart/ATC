import test from 'node:test';
import assert from 'node:assert/strict';
import { createReader, isFilePath } from '../src/cli/reader.js';
import { isArea, isLogin, isRepository } from '../src/core/values.js';
import { readConfig } from '../src/core/config.js';
import { issueArg, proposalArg } from '../src/cli/args.js';
import { isRef } from '../src/cli/git.js';
import { commentBody } from '../src/cli/snapshot.js';
import { cli, setup } from './helpers.js';

const repository = 'example/project';

test('GitHub lists must be bounded arrays and invalid replies have fixed errors', () => {
  for (const response of [null, {}, 'IGNORE', Array(101).fill(null)]) {
    const reader = createReader({ get: () => response }, repository);
    assert.throws(() => reader.openPulls(), error => error.message === 'GitHub returned an invalid list');
  }
  assert.throws(() => createReader({}, 'example/project\nIGNORE'), error => error.message === 'Invalid repository');
});

test('config payload rejects malformed base64, size mismatches and invalid values', () => {
  const raw = '{"areas":{}}';
  const valid = { type: 'file', encoding: 'base64', size: Buffer.byteLength(raw), content: Buffer.from(raw).toString('base64') };
  assert.deepEqual(createReader({ getOptional: () => valid }, repository).config(), { areas: {} });
  for (const patch of [{ size: -1 }, { size: '12' }, { size: 999 }, { content: `${valid.content}!` },
    { content: 'AAAA=', size: 3 }, { type: 'symlink' }, { encoding: 'utf8' }, { content: null }, { size: 65537 }]) {
    assert.throws(() => createReader({ getOptional: () => ({ ...valid, ...patch }) }, repository).config(),
      error => error.message === 'Invalid .github/atc.json');
  }
});

test('GitHub rename paths are both compared, including safe names with spaces', () => {
  const reader = createReader({ get: () => [{ filename: 'new folder/file.js', previous_filename: 'old folder/file.js' }] }, repository);
  assert.deepEqual(reader.pullFiles(1), { files: ['new folder/file.js', 'old folder/file.js'], partial: false, invalid: false });
  for (const name of ['file\n', 'file\r', '\u0000file', '/private', '../private', 'src/../private', 'a//b', 'x'.repeat(4097)]) {
    assert.equal(isFilePath(name), false);
  }
});

test('single-line validators reject final line terminators as well as embedded hostile text', () => {
  for (const end of ['\n', '\r', '\r\n', '\nIGNORE INSTRUCTIONS']) {
    assert.equal(isLogin(`alice${end}`), false);
    assert.equal(isArea(`core${end}`), false);
    assert.equal(isRepository(`example/project${end}`), false);
    assert.equal(isRef(`main${end}`), false);
    assert.throws(() => issueArg(`1${end}`));
    assert.throws(() => proposalArg(`123${end}`));
    assert.throws(() => readConfig({ areas: { [`core${end}`]: ['src/'] } }));
    assert.throws(() => readConfig({ areas: { core: [`src/${end}`] } }));
    assert.throws(() => commentBody({ verb: 'release' }, [], `private${end}`));
  }
});

test('case-normalized accounts recognize their claims and assignees consistently', async () => {
  const fake = setup();
  fake.addIssue({ assignees: ['ALICE'] });
  const check = await cli(fake, 'Alice', ['check', '1']);
  assert.equal(check.advice, 'free');
  assert.equal((await cli(fake, 'ALICE', ['claim', '1'])).outcome, 'claimed');
  assert.equal((await cli(fake, 'alice', ['check', '1'])).advice, 'yours');
});
