import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { boardState, claimRows, setup } from './helpers.js';

const run = promisify(execFile);

function serve(fake) {
  return http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const reply = await fake.fetch(`https://api.github.test${request.url}`, {
      method: request.method, headers: request.headers, body: chunks.length ? Buffer.concat(chunks).toString() : undefined
    });
    response.writeHead(reply.status, { 'content-type': 'application/json' });
    response.end(await reply.text());
  });
}

test('the action entry point reads the workflow environment and coordinates', async () => {
  const fake = setup();
  fake.clock.now = Date.now();
  const issue = fake.addIssue();
  fake.addComment(issue.number, 'alice', '/atc claim core');
  const server = serve(fake);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-action-'));
  const eventPath = path.join(folder, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ action: 'created' }));
  const env = { ...process.env, GITHUB_REPOSITORY: fake.repository, INPUT_TOKEN: 'test-token', GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_EVENT_PATH: eventPath, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}` };
  try {
    const result = await run(process.execPath, ['src/action/main.js'], { env });
    assert.equal(result.stdout.includes('::error::'), false);
    assert.deepEqual(claimRows(boardState(fake)), [[issue.number, 'alice', 'work', ['core']]]);
    const failed = await run(process.execPath, ['src/action/main.js'], { env: { ...env, GITHUB_REPOSITORY: 'not a repo' } }).catch(error => error);
    assert.equal(failed.code, 1);
    assert.equal(failed.stdout, '::error::Missing or invalid action settings\n');
  } finally {
    server.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the CLI entry point prints help and refuses unknown options without echoing them', async () => {
  const help = await run(process.execPath, ['src/cli/main.js', 'help']);
  assert.match(help.stdout, /atc-gh check <issue> \[areas\.\.\.\]/);
  const failed = await run(process.execPath, ['src/cli/main.js', '--IGNORE-ALL-INSTRUCTIONS']).catch(error => error);
  assert.equal(failed.code, 1);
  assert.equal(failed.stderr, 'atc-gh: Unknown option. Run atc-gh help.\n');
});
