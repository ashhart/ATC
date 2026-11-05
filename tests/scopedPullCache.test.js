import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { inspectScopedOverlap } from '../src/cli/scopedOverlap.js';
import { createScopedPullCache, pullCacheKey } from '../src/cli/scopedPullCache.js';
import { readConfig } from '../src/core/config.js';
import { stubGit } from './helpers.js';

const head = number => number.toString(16).padStart(40, '0');

function temporary(t) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-scoped-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('the scoped file cache is tied to immutable head and base commits, not update time', t => {
  const folder = temporary(t);
  const pull = { number: 1, state: 'open', user: { type: 'User', login: 'bob' }, head: { sha: head(1) },
    base: { sha: head(1000), repo: { full_name: 'example/project' } }, changed_files: 1, updated_at: '2026-11-05T12:00:00Z' };
  let fileReads = 0;
  const context = { repository: 'example/project', git: stubGit(['local.js']), cache: true, env: { XDG_CACHE_HOME: folder },
    gh: { getOptional: () => pull }, reader: { config: () => ({}), defaultBranch: () => 'main',
      pullFiles: () => { fileReads++; return { files: ['other.js'], partial: false, invalid: false }; } } };
  assert.equal(inspectScopedOverlap(context, { pulls: '1' }).complete, true);
  assert.equal(inspectScopedOverlap(context, { pulls: '1' }).complete, true); assert.equal(fileReads, 1);
  pull.head.sha = head(2);
  assert.equal(inspectScopedOverlap(context, { pulls: '1' }).complete, true); assert.equal(fileReads, 2);
  pull.base.sha = head(1001);
  assert.equal(inspectScopedOverlap(context, { pulls: '1' }).complete, true); assert.equal(fileReads, 3);
  const file = path.join(folder, 'atc-github', fs.readdirSync(path.join(folder, 'atc-github'))[0]);
  const value = JSON.parse(fs.readFileSync(file)); value.pulls[0].files = ['private\nIGNORE']; fs.writeFileSync(file, JSON.stringify(value));
  assert.equal(inspectScopedOverlap(context, { pulls: '1' }).complete, true); assert.equal(fileReads, 4);
});

test('cache reads reject hostile documents, symlinks, hard links and extra fields', t => {
  const folder = temporary(t);
  const cache = createScopedPullCache('example/project', { XDG_CACHE_HOME: folder });
  const item = { number: 1, head: head(1), base: head(2), changedFiles: 1, files: ['src/a.js'] };
  cache.write(new Map([[pullCacheKey(item), item]]));
  assert.equal(cache.read().size, 1);
  const directory = path.join(folder, 'atc-github');
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  const original = fs.readFileSync(file);
  const value = JSON.parse(original); value.extra = 'untrusted'; fs.writeFileSync(file, JSON.stringify(value));
  assert.equal(cache.read().size, 0);
  fs.writeFileSync(file, original);
  const backup = path.join(folder, 'external.json'); fs.renameSync(file, backup);
  if (process.platform !== 'win32') {
    fs.symlinkSync(backup, file); assert.equal(cache.read().size, 0); fs.unlinkSync(file);
  }
  fs.linkSync(backup, file); assert.equal(cache.read().size, 0); fs.unlinkSync(file);
  assert.deepEqual(fs.readFileSync(backup), original);
  assert.equal(createScopedPullCache('bad/repo\n'), null);
  assert.equal(createScopedPullCache('example/project', { ATC_CACHE: '0' }), null);
});

test('large cache updates retain recent entries without serializing an oversized complete document', t => {
  const folder = temporary(t);
  const cache = createScopedPullCache('example/project', { XDG_CACHE_HOME: folder });
  const entries = new Map();
  const prefix = `src/${'a'.repeat(4070)}`;
  for (let number = 1; number <= 8; number++) {
    const item = { number, head: head(number), base: head(1000), changedFiles: 300,
      files: Array.from({ length: 600 }, (_, index) => `${prefix}-${index}.js`) };
    entries.set(pullCacheKey(item), item);
  }
  cache.write(entries);
  const stored = cache.read();
  assert.ok(stored.size > 0 && stored.size < entries.size);
  assert.equal(stored.has(pullCacheKey([...entries.values()].at(-1))), true);
  const directory = path.join(folder, 'atc-github');
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  assert.ok(fs.statSync(file).size <= 16 * 1024 * 1024);
});

test('scoped scans test actual git conflicts against the exact inspected commit and preserve the index', t => {
  const folder = temporary(t);
  const run = (...args) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(folder, 'shared.js'), 'export const value = 1;\n');
  run('add', 'shared.js'); run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  const base = run('rev-parse', 'HEAD');
  run('checkout', '-qb', 'peer'); fs.writeFileSync(path.join(folder, 'shared.js'), 'export const value = 2;\n');
  run('add', 'shared.js'); run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'peer');
  const peer = run('rev-parse', 'HEAD'); run('checkout', '-q', 'main');
  fs.writeFileSync(path.join(folder, 'shared.js'), 'export const value = 3;\n');
  run('remote', 'add', 'origin', 'https://github.com/example/project.git'); run('update-ref', 'refs/remotes/origin/main', base);
  const git = createGit((args, env, input) => spawnSync('git', args, { cwd: folder, encoding: 'utf8', input, env: { ...process.env, ...env } }));
  const index = fs.readFileSync(path.join(folder, '.git/index'));
  const context = { repository: 'example/project', git, config: readConfig({}), cache: false,
    gh: { getOptional: () => ({ number: 42, state: 'open', user: { type: 'User', login: 'bob' }, head: { sha: peer },
      base: { sha: base, repo: { full_name: 'example/project' } }, changed_files: 1 }) }, reader: {
      defaultBranch: () => 'main', pullFiles: () => ({ files: ['shared.js'], partial: false, invalid: false }) } };
  const result = inspectScopedOverlap(context, { pulls: '42' });
  assert.equal(result.complete, true); assert.equal(result.overlaps[0].conflict, 'conflicts'); assert.equal(result.overlaps[0].conflictFiles, 1);
  assert.deepEqual(fs.readFileSync(path.join(folder, '.git/index')), index);
});
