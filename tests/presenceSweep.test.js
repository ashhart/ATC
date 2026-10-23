import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { proofText } from '../src/cli/presenceProof.js';
import { publishPresence } from '../src/cli/publicPresence.js';
import { reportPresence } from '../src/cli/presenceCommand.js';
import { sweepProofs } from '../src/cli/presenceSweep.js';
import { presenceGit } from './helpers.js';

const later = () => Date.now() + 600000;

function fixture() {
  const git = presenceGit(), folder = path.join(git.commonDir(), 'atc'), comments = new Map(), deletes = [];
  fs.mkdirSync(folder, { recursive: true });
  const gh = { getOptional: target => {
    const match = target.match(/^repos\/example\/project\/issues\/comments\/([0-9]+)$/);
    if (match) return comments.get(Number(match[1])) || null;
    return target.endsWith('atc.json') ? { type: 'file', encoding: 'base64', size: 2, content: 'e30=' } : { number: 42, state: 'open', assignees: [] };
  }, get: target => target === 'repos/example/project' ? { private: false } : { number: 42, state: 'open' },
  post: () => ({ id: 999 }), deleteComment: (repository, id) => { deletes.push(id); return true; } };
  function session(number, comment, change = {}) {
    const token = String(number % 10).repeat(64), file = path.join(folder, `public-${number}.json`);
    fs.writeFileSync(file, JSON.stringify({ origin: 'https://example.org', issue: 42, token, comment, display: 'anonymous' }));
    comments.set(comment, { id: comment, body: proofText(token), issue_url: 'https://api.github.com/repos/example/project/issues/42', ...change });
    return file;
  }
  return { git, gh, comments, deletes, session, sweep: (now = later, keep) => sweepProofs({ gh, git, now, repository: 'example/project', keep }) };
}

test('starting a session removes proof comments of sessions that expired without landing', () => {
  const f = fixture(), stale = f.session(11, 101), gone = f.session(12, 102); f.comments.delete(102);
  f.sweep();
  assert.deepEqual(f.deletes, [101]);
  assert.equal(fs.existsSync(stale), false); assert.equal(fs.existsSync(gone), false);
});

test('live, recent, kept and mismatched sessions keep their proofs and files', () => {
  const f = fixture();
  const live = reportPresence('start', { issue: 42 }, { git: f.git, now: Date.now });
  const liveFile = f.session(live.session, 201), old = new Date(Date.now() - 600000);
  fs.utimesSync(liveFile, old, old);
  const recent = f.session(21, 202);
  f.sweep(Date.now);
  assert.deepEqual(f.deletes, []); assert.equal(fs.existsSync(liveFile), true); assert.equal(fs.existsSync(recent), true);
  const g = fixture(), kept = g.session(31, 301);
  const files = [{ body: proofText('f'.repeat(64)) }, { id: 1 }, { issue_url: 'https://api.github.com/repos/example/project/issues/43' },
    { issue_url: 'https://api.github.com/repos/other/project/issues/42' }].map((change, index) => g.session(32 + index, 302 + index, change));
  fs.writeFileSync(path.join(path.dirname(kept), 'public-40.json'), '{"token":"hostile"}');
  fs.symlinkSync(kept, path.join(path.dirname(kept), 'public-41.json'));
  g.sweep(later, 31);
  assert.deepEqual(g.deletes, []);
  for (const file of [kept, ...files]) assert.equal(fs.existsSync(file), true);
});

test('one start removes at most five stale proofs and a failed removal keeps its file', () => {
  const f = fixture(), files = [1, 2, 3, 4, 5, 6, 7].map(number => f.session(number, 400 + number));
  f.gh.deleteComment = (repository, id) => { if (id === 402) throw new Error('denied'); f.deletes.push(id); return true; };
  f.sweep();
  assert.deepEqual(f.deletes, [401, 403, 404, 405]);
  assert.deepEqual(files.map(file => fs.existsSync(file)), [false, true, false, false, false, true, true]);
});

test('a public start sweeps stale proofs after publishing its own check-in', async () => {
  const f = fixture(), stale = f.session(51, 501), old = new Date(Date.now() - 600000);
  fs.utimesSync(stale, old, old);
  const start = reportPresence('start', { issue: 42 }, { git: f.git, now: Date.now });
  const fetcher = async () => Response.json({ outcome: 'published' });
  const result = await publishPresence(start, { command: 'start', flags: { public: 'https://example.org' }, gh: f.gh, git: f.git, fetcher,
    repository: () => 'example/project' });
  assert.equal(result.publication, 'public');
  assert.deepEqual(f.deletes, [501]); assert.equal(fs.existsSync(stale), false);
});
