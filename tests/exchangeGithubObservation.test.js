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
import { digest, isBranch } from '../src/exchange/values.js';
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
  const feedback = await invoke(args);
  assert.deepEqual(feedback.changes.map(x => x.kind).sort(), ['dependencies', 'feedback']);
  await invoke(['ack', '42', '--consumer', key(10), '--cursor', feedback.cursor]);
  f.upstream.baseTip = 'd'.repeat(40);
  assert.deepEqual((await invoke(args)).changes, [{ kind: 'base', id: null, change: 'changed' }]);
  for (const route of ['pulls/42/reviews', 'pulls/42/comments', 'issues/42/comments']) {
    assert.ok(f.calls.includes(`/repos/${repository}/${route}?per_page=100&page=1`));
  }
});

test('a live base branch advance invalidates accepted results and handoffs even while PR base metadata stays old', async t => {
  const f = await exchangeFixture(t);
  f.upstream.baseRef = 'release/current';
  for (const author of [1, 2]) await f.request('POST', '/sessions', { value: f.addProof(author) });
  const { head, base } = f.upstream, auth = { token: token(1) };
  for (const id of [1, 2]) {
    await f.request('POST', '/pulls/42/requests', { ...auth, value: { id: key(id), head, base, kind: 'test', evidence: [] } });
    await f.request('POST', `/pulls/42/requests/${key(id)}/results`, { ...auth,
      value: { id: key(id + 10), head, base, status: 'pass', evidence: [] } });
  }
  await f.request('POST', `/pulls/42/collaboration/requests/${key(1)}/offer`, { ...auth,
    value: { capability: 'docs', public: false, required: true, independent: false } });
  await f.request('POST', `/pulls/42/requests/${key(1)}/resolve`, { ...auth, value: { result: key(11), decision: 'accepted' } });
  assert.equal((await f.request('GET', '/pulls/42/collaboration', auth)).qualified, true);
  await f.request('PUT', `/pulls/42/evidence/${key(9)}/${head}/report`, { ...auth, bytes: Buffer.from('Selected trial report.') });
  await f.request('POST', '/pulls/42/collaboration/handoffs', { ...auth,
    value: { id: key(8), issue: 40, head, base, report: key(9), recipient: 102 } });
  f.upstream.baseTip = 'd'.repeat(40);
  const matrix = await f.request('GET', '/pulls/42/collaboration', auth);
  assert.equal(matrix.base, f.upstream.baseTip);
  assert.equal(matrix.qualified, false);
  assert.equal(matrix.items[0].state, 'stale');
  assert.equal(matrix.handoffs[0].stale, true);
  await assert.rejects(f.request('POST', `/pulls/42/requests/${key(2)}/resolve`, { ...auth,
    value: { result: key(12), decision: 'accepted' } }), { code: 'stale' });
  await assert.rejects(f.request('POST', `/pulls/42/collaboration/handoffs/${key(8)}/decision`, {
    token: token(2), value: { decision: 'accepted' } }), { code: 'stale' });
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

test('base reference transport validates bounded branch names and rejects query or path injection before fetching', async () => {
  const calls = [];
  const gh = createGithubFetch({ repository, fetcher: async url => { calls.push(url); return Response.json({}); } });
  for (const branch of ['main', 'release/current', 'feature/fix-1.2_3', 'a'.repeat(200)]) {
    assert.equal(isBranch(branch), true);
    await gh.get(`repos/${repository}/git/ref/heads/${branch}`);
  }
  const count = calls.length;
  for (const branch of ['', '-option', '.hidden', 'foo/.hidden', 'foo.', 'foo.lock', 'foo/bar.lock',
    'foo..bar', '../other', 'foo//bar', 'foo/', '/foo', 'main?extra=1', 'main#fragment',
    'main\n', 'main\r', 'main\u0000', 'a b', 'foo\\bar', 'foo%2Fbar', 'a'.repeat(201)]) {
    assert.equal(isBranch(branch), false);
    await assert.rejects(gh.get(`repos/${repository}/git/ref/heads/${branch}`), { code: 'invalid' });
  }
  await assert.rejects(gh.get('repos/other/project/git/ref/heads/main'), { code: 'invalid' });
  await assert.rejects(gh.get(`repos/${repository}/git/ref/tags/main`), { code: 'invalid' });
  assert.equal(calls.length, count);
});

test('open PRs never fall back to stale base metadata when the current branch is missing or malformed', async () => {
  const head = 'a'.repeat(40), base = 'c'.repeat(40);
  const pull = { number: 42, head: { sha: head }, base: { sha: base, ref: 'main', repo: { full_name: repository } }, state: 'open' };
  let ref = null, reads = 0;
  const github = createExchangeGithub({ repository, origin, ghFactory: () => ({ get: async () => pull,
    getOptional: async () => { reads++; return ref; } }) });
  await assert.rejects(github.pull(42), { code: 'upstream' });
  pull.state = 'closed';
  assert.deepEqual(await github.pull(42), { head, base, state: 'closed' });
  pull.state = 'open';
  for (ref of [{ ref: 'refs/heads/other', object: { type: 'commit', sha: base } },
    { ref: 'refs/heads/main', object: { type: 'tag', sha: base } },
    { ref: 'refs/heads/main', object: { type: 'commit', sha: 'UNTRUSTED' } }]) {
    await assert.rejects(github.pull(42), { code: 'upstream' });
  }
  const count = reads;
  pull.base.ref = 'main?injected';
  await assert.rejects(github.pull(42), { code: 'upstream' });
  assert.equal(reads, count);
});
