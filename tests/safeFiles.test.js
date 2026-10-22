import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile, unsafe } from '../src/cli/safeFiles.js';

function fixture(t, platform, before, after) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-safe-file-'));
  const file = path.join(folder, 'AGENTS.md');
  fs.writeFileSync(file, '# Contributor instructions\n');
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  t.after(() => {
    Object.defineProperty(process, 'platform', original);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const lstat = fs.lstatSync;
  const fstat = fs.fstatSync;
  const apply = (stat, changes) => {
    for (const [key, value] of Object.entries(changes)) stat[key] = typeof stat[key] === 'bigint' ? BigInt(value) : value;
    return stat;
  };
  t.mock.method(fs, 'lstatSync', (target, ...options) => {
    const stat = lstat(target, ...options);
    return target === file ? apply(stat, before) : stat;
  });
  t.mock.method(fs, 'fstatSync', (...options) => apply(fstat(...options), after));
  return file;
}

test('safe reads accept the missing Windows path device ID reported by older libuv', t => {
  const file = fixture(t, 'win32', { dev: 0 }, { dev: 123 });
  assert.equal(readFile(file, 1024), '# Contributor instructions\n');
});

test('a missing Windows path device ID still rejects a replaced inode', t => {
  const file = fixture(t, 'win32', { dev: 0, ino: 12 }, { dev: 123, ino: 13 });
  assert.throws(() => readFile(file, 1024), error => error.message === unsafe);
});

test('Windows reads reject conflicting known device IDs', t => {
  const file = fixture(t, 'win32', { dev: 123 }, { dev: 456 });
  assert.throws(() => readFile(file, 1024), error => error.message === unsafe);
});

test('the Windows compatibility case does not accept a missing opened device ID', t => {
  const file = fixture(t, 'win32', { dev: 123 }, { dev: 0 });
  assert.throws(() => readFile(file, 1024), error => error.message === unsafe);
});

test('non-Windows reads require matching device IDs even when one is zero', t => {
  const file = fixture(t, 'linux', { dev: 0 }, { dev: 123 });
  assert.throws(() => readFile(file, 1024), error => error.message === unsafe);
});
