import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../src/cli/args.js';
import { referencedNumbers, renderHuman } from '../src/cli/human/render.js';
import { createLabels, safeText } from '../src/cli/terminalText.js';
import { cli, setup } from './helpers.js';

test('terminal text strips escape sequences, control and bidi characters and truncates', () => {
  assert.equal(safeText('Fix \u001b[31mred\u001b[0m router\u0007'), 'Fix red router');
  assert.equal(safeText('evil‮exe.txt'), 'evil exe.txt');
  assert.equal(safeText('a​b\u0085c'), 'a b c');
  assert.equal(safeText('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
  assert.equal(safeText('\u0000\u001f'), null);
  assert.equal(safeText(42), null);
});

test('json and text flags are exclusive and only json reaches agents by default', () => {
  assert.equal(parseCliArgs(['board', '--json']).flags.json, true);
  assert.equal(parseCliArgs(['board', '--text']).flags.text, true);
  assert.throws(() => parseCliArgs(['board', '--json', '--text']), /Choose --json or --text/);
  assert.throws(() => parseCliArgs(['who', 'a.js', '--repo', 'a/b']), /local clone/);
});

test('the human board names people, titles and shared files while the JSON stays numeric', async () => {
  const fake = setup();
  fake.addIssue({ labels: [{ name: 'help wanted' }] });
  const first = fake.addPull({ author: 'bob', body: 'Fixes #1', files: ['src/core/router.js'] });
  const second = fake.addPull({ author: 'carol', body: 'Fixes #1', files: ['src/core/router.js'] });
  const labels = createLabels();
  const board = await cli(fake, 'alice', ['board'], { labels });
  assert.equal(JSON.stringify(board).includes('router'), false);
  labels.titles.set(1, 'Router breaks on \u001b[2Jtrailing slash');
  labels.titles.set(first.number, 'Fix router');
  const text = renderHuman(board, labels, { now: fake.clock.now });
  assert.match(text, /ATC · acme\/widgets/);
  assert.match(text, /@bob/);
  assert.match(text, /@carol/);
  assert.match(text, /src\/core\/router\.js  2 open PRs: #3 @carol, #2 @bob/);
  assert.match(text, /Duplicate attempts/);
  assert.match(text, /#1 Router breaks on trailing slash/);
  assert.equal(text.includes('\u001b'), false);
  assert.ok(referencedNumbers(board).includes(second.number));
});

test('check, write and overlap results read as sentences', async () => {
  const fake = setup();
  fake.addIssue();
  const labels = createLabels();
  const check = await cli(fake, 'alice', ['check', '1'], { labels });
  assert.match(renderHuman(check, labels), /Free\..*atc claim 1/);
  const claim = await cli(fake, 'alice', ['claim', '1']);
  assert.match(renderHuman(claim, labels), /✓ claim #1: Claimed/);
  const taken = await cli(fake, 'bob', ['claim', '1']);
  assert.match(renderHuman(taken, labels), /✗ claim #1: Someone else holds it/);
  labels.conflicts.set('workingTree:7', ['lib/router.js']);
  const overlap = { complete: true, limitations: [], changedFiles: 2, myPullRequests: [], worktrees: 1,
    overlaps: [{ source: 'workingTree', pullRequest: 7, sharedFiles: 1, areas: [], conflict: 'conflicts', conflictFiles: 1 }], worktreeOverlaps: [] };
  assert.match(renderHuman(overlap, labels), /conflict.*PR #7 will conflict in lib\/router\.js/);
});
