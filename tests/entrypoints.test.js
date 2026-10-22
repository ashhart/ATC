import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

test('the CLI entry point prints help and refuses unknown options without echoing them', async () => {
  const help = await run(process.execPath, ['src/cli/main.js', 'help']);
  assert.match(help.stdout, /atc overlap \[--base <ref>\]/);
  assert.match(help.stdout, /Agent Traffic Control/);
  assert.match(help.stdout, /atc renew <issue>/);
  const failed = await run(process.execPath, ['src/cli/main.js', '--IGNORE-ALL-INSTRUCTIONS']).catch(error => error);
  assert.equal(failed.code, 1);
  assert.equal(failed.stderr, 'atc: Unknown option. Run atc help.\n');
});

test('version and help work offline and doctor strict reports a real process exit code', async () => {
  const env = { ...process.env, PATH: '' };
  assert.equal((await run(process.execPath, ['src/cli/main.js', '--version'], { env })).stdout, '0.6.0\n');
  assert.match((await run(process.execPath, ['src/cli/main.js', '--help'], { env })).stdout, /Agent Traffic Control/);
  const doctor = await run(process.execPath, ['src/cli/main.js', 'doctor', '--strict'], { env }).catch(error => error);
  assert.equal(doctor.code, 2);
  assert.equal(doctor.stderr, '');
  const result = JSON.parse(doctor.stdout);
  assert.equal(result.ready, false);
  assert.equal(result.checks.git, 'missing');
  assert.equal(result.checks.gh, 'missing');
});

test('init check has no writes, strict exit two, and becomes ready after initialization', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-process-')));
  const executable = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
  try {
    await run('git', ['init', '-q', '-b', 'main', folder]);
    const before = await run(process.execPath, [executable, 'init', '--check', '--strict'], { cwd: folder }).catch(error => error);
    assert.equal(before.code, 2);
    assert.equal(JSON.parse(before.stdout).outcome, 'changesNeeded');
    assert.deepEqual(fs.readdirSync(folder), ['.git']);
    assert.equal(JSON.parse((await run(process.execPath, [executable, 'init'], { cwd: folder })).stdout).outcome, 'initialized');
    const after = await run(process.execPath, [executable, 'init', '--check', '--strict'], { cwd: folder });
    assert.equal(JSON.parse(after.stdout).outcome, 'ready');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
