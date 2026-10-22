import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDemo } from '../scripts/demo/demo.js';

const entry = fileURLToPath(new URL('../scripts/demo/main.js', import.meta.url));

test('the demo shows two of four PRs wasted without ATC and none wasted with it', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-demo-test-'));
  try {
    const chunks = [];
    const score = await runDemo({ fast: true, write: text => chunks.push(text), temporary });
    const output = chunks.join('');
    assert.deepEqual(score.without, { merged: 2, wasted: 2, conflicts: 2, duplicates: 1 });
    assert.deepEqual(score.with, { merged: 4, wasted: 0, conflicts: 0, duplicates: 0, caught: 1 });
    assert.match(output, /without ATC {2}merged 2 {2}wasted 2 {2}conflicts 2\n/);
    assert.match(output, /with ATC {5}merged 4 {2}wasted 0 {2}conflicts 0\n$/);
    assert.match(output, /Duplicate attempts/);
    assert.match(output, /Claimed by someone else/);
    assert.match(output, /will conflict in src\/router\.js/);
    assert.equal(output.includes('\u001b'), false);
    assert.deepEqual(fs.readdirSync(temporary), []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('the entry point runs in fast mode, rejects unknown flags and leaves no temporary folders', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-demo-entry-'));
  try {
    const env = { ...process.env, TMPDIR: temporary, NO_COLOR: '1' };
    const run = spawnSync(process.execPath, [entry, '--fast'], { encoding: 'utf8', env, timeout: 120000 });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /with ATC {5}merged 4/);
    assert.deepEqual(fs.readdirSync(temporary), []);
    const bad = spawnSync(process.execPath, [entry, '--slow'], { encoding: 'utf8', env });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
