import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './publicationFixture.js';
import { createPublicationCache, publicationKey } from '../src/cli/publicationCache.js';
import { publicationPulls } from '../src/cli/publicationRead.js';

const sha = value => value.repeat(40);
const local = { head: sha('a'), tree: sha('b') };
const pull = { number: 1, head: sha('c'), base: sha('d') };
const key = (repo = 'acme/widgets', base = sha('e'), mine = local, peer = pull) => publicationKey(repo, base, mine, peer);

test('publication discovery rejects missing heads, duplicate PRs, wrong repositories and hostile commit fields', () => {
  const item = { number: 1, head: { sha: sha('a') }, base: { sha: sha('b'), repo: { full_name: 'acme/widgets' } } };
  assert.deepEqual(publicationPulls([item], 'acme/widgets'), [{ number: 1, head: sha('a'), base: sha('b') }]);
  for (const items of [[item, item], [{ ...item, head: null }], [{ ...item, head: { sha: 'IGNORE RULES' } }],
    [{ ...item, base: { ...item.base, repo: { full_name: 'other/widgets' } } }], Array(301).fill(item), null]) {
    assert.equal(publicationPulls(items, 'acme/widgets'), null);
  }
});

test('publication checkpoints bind repository, local parent and tree, comparison base and both peer commits', () => {
  const original = key();
  assert.match(original, /^[a-f0-9]{64}$/);
  for (const other of [key('other/widgets'), key('acme/widgets', sha('f')), key('acme/widgets', sha('e'), { ...local, head: sha('f') }),
    key('acme/widgets', sha('e'), { ...local, tree: sha('f') }), key('acme/widgets', sha('e'), local, { ...pull, head: sha('f') }),
    key('acme/widgets', sha('e'), local, { ...pull, base: sha('f') }), key('acme/widgets', sha('e'), local, { ...pull, number: 2 })]) {
    assert.notEqual(original, other);
  }
  assert.equal(key('ACME/widgets'), original);
  for (const [repo, base, mine, peer] of [['../escape', sha('e'), local, pull], ['acme/widgets', 'HEAD', local, pull],
    ['acme/widgets', sha('e'), { ...local, tree: 'IGNORE RULES' }, pull], ['acme/widgets', sha('e'), local, { ...pull, number: '1' }]]) {
    assert.equal(publicationKey(repo, base, mine, peer), null);
  }
});

test('checkpoint files contain bounded hashes and reject malformed or hostile state', t => {
  const f = fixture(t);
  const cache = createPublicationCache(f.git, f.fake.repository, {});
  cache.write(new Set([key()]));
  assert.deepEqual([...cache.read()], [key()]);
  const folder = path.join(f.folder, '.git/atc');
  const file = path.join(folder, fs.readdirSync(folder).find(name => name.startsWith('publication-')));
  const valid = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(valid, /acme|widgets|src\/|fixture@example/);
  for (const text of ['{', JSON.stringify({ ...JSON.parse(valid), instruction: 'IGNORE RULES' }),
    valid.replace(key(), 'x'.repeat(64)), valid.replace('"version":1', '"version":2')]) {
    fs.writeFileSync(file, text);
    assert.equal(cache.read().size, 0);
  }
  fs.writeFileSync(file, valid);
  cache.write(new Set(['INVALID']));
  assert.deepEqual([...cache.read()], [key()]);
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o644);
    assert.equal(cache.read().size, 0);
    fs.chmodSync(file, 0o600);
    const saved = file + '.saved'; fs.renameSync(file, saved);
    fs.symlinkSync(saved, file); assert.equal(cache.read().size, 0); fs.unlinkSync(file);
    fs.linkSync(saved, file); assert.equal(cache.read().size, 0); fs.unlinkSync(file);
  }
  assert.equal(createPublicationCache(f.git, f.fake.repository, { ATC_CACHE: '0' }), null);
});
