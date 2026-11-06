import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createGithubFetch } from '../src/exchange/githubFetch.js';
import { createExchangeGithub } from '../src/exchange/github.js';
import { createExchangeStore } from '../src/exchange/store.js';
import { createExchangeWebHandler } from '../src/exchange/webHandler.js';
import { runExchangeClient } from '../src/exchange/client.js';
import { parseExchangeArgs } from '../src/exchange/args.js';
import { digest } from '../src/exchange/values.js';
import { exchangeFixture, token, key, repository, origin } from './exchangeHelpers.js';

test('Worker catch-up reaches GitHub observations through its restricted transport and acknowledges the delivered snapshot', async t => {
  const f = await exchangeFixture(t);
  const github = createExchangeGithub({ repository, origin,
    ghFactory: () => createGithubFetch({ repository, fetcher: f.githubFetcher }) });
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-worker-catchup-'));
  const store = createExchangeStore({ folder: storage, repository, origin, now: f.now });
  t.after(() => { store.close(); fs.rmSync(storage, { recursive: true, force: true }); });
  const handle = createExchangeWebHandler({ store, github, origin, now: f.now });
  const proof = f.addProof(1);
  const connected = await handle(new Request(`${origin}/api/exchange/v1/sessions`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(proof) }));
  assert.equal(connected.status, 200);
  const git = { commonDir: () => path.join(f.folder, '.git') };
  const folder = path.join(git.commonDir(), 'atc/exchange');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${digest(`${repository}\n${origin}\n42`)}.json`),
    JSON.stringify({ token: token(1), comment: proof.comment }), { mode: 0o600 });
  const invoke = args => runExchangeClient(parseExchangeArgs([...args, '--repo', repository, '--origin', origin]),
    { gh: {}, git, github, fetcher: (url, options) => handle(new Request(url, options)), env: {} });
  const args = ['catchup', '42', '--consumer', key(10)];
  const first = await invoke(args);
  assert.deepEqual(first.changes.map(x => x.kind).sort(), ['base', 'dependencies', 'feedback', 'head']);
  await invoke(['ack', '42', '--consumer', key(10), '--cursor', first.cursor]);
  assert.deepEqual((await invoke(args)).changes, []);
  const at = '2026-10-30T12:00:00Z';
  f.upstream.reviews = [{ id: 8, state: 'CHANGES_REQUESTED', submitted_at: at }];
  f.upstream.reviewComments = [{ id: 9, updated_at: at }];
  f.upstream.discussion = [{ id: 10, body: '/atc depends 50', user: { id: 1, login: 'user1' }, created_at: at, updated_at: at }];
  assert.deepEqual((await invoke(args)).changes.map(x => x.kind).sort(), ['dependencies', 'feedback']);
  for (const route of ['pulls/42/reviews', 'pulls/42/comments', 'issues/42/comments']) {
    assert.ok(f.calls.includes(`/repos/${repository}/${route}?per_page=100&page=1`));
  }
});

test('Worker observation reads allow only bounded pages on the three required GitHub endpoints', async () => {
  const calls = [];
  const gh = createGithubFetch({ repository, fetcher: async url => { calls.push(url); return Response.json([]); } });
  for (const route of ['pulls/42/reviews', 'pulls/42/comments', 'issues/42/comments']) {
    for (let page = 1; page <= 6; page++) {
      assert.deepEqual(await gh.get(`repos/${repository}/${route}?per_page=100&page=${page}`), []);
    }
  }
  const count = calls.length;
  for (const route of ['pulls/42/files?per_page=100&page=1', 'issues/42/reviews?per_page=100&page=1',
    'pulls/42/reviews?per_page=100&page=0', 'pulls/42/reviews?per_page=100&page=7',
    'pulls/42/reviews?per_page=100&page=01', 'pulls/42/reviews?per_page=101&page=1',
    'pulls/42/reviews?page=1&per_page=100', 'pulls/42/reviews?per_page=100&page=1&extra=1',
    'pulls/42/reviews?per_page=100&page=1#fragment', 'pulls/42/reviews',
    'pulls/0/reviews?per_page=100&page=1', 'pulls/1000000000/reviews?per_page=100&page=1',
    '../other/pulls/42/reviews?per_page=100&page=1']) {
    await assert.rejects(gh.get(`repos/${repository}/${route}`), { code: 'invalid' });
  }
  await assert.rejects(gh.get('repos/other/project/pulls/42/reviews?per_page=100&page=1'), { code: 'invalid' });
  assert.equal(calls.length, count);
});
