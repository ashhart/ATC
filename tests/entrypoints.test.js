import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('the CLI entry point prints help and refuses unknown options without echoing them', async () => {
  const help = await run(process.execPath, ['src/cli/main.js', 'help']);
  assert.match(help.stdout, /atc overlap \[--base <ref>\]/);
  const failed = await run(process.execPath, ['src/cli/main.js', '--IGNORE-ALL-INSTRUCTIONS']).catch(error => error);
  assert.equal(failed.code, 1);
  assert.equal(failed.stderr, 'atc: Unknown option. Run atc help.\n');
});
