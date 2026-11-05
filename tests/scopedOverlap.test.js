import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScopedOverlap, selectedPullNumbers, validateScopedOverlapResult } from '../src/cli/scopedOverlap.js';
import { TimeLimit } from '../src/cli/ghTransport.js';
import { areasConfig, stubGit } from './helpers.js';

const head = number => number.toString(16).padStart(40, '0');

function fixture() {
  const pulls = new Map();
  const calls = [];
  const context = { repository: 'example/project', me: 'alice', now: () => Date.UTC(2026, 10, 5), cache: false,
    git: stubGit(['src/core/local.js']), gh: { getOptional(route) {
      calls.push(route);
      const match = /^repos\/example\/project\/pulls\/([1-9][0-9]*)$/.exec(route);
      assert.ok(match, 'scoped scan must not enumerate global work');
      return pulls.get(Number(match[1])) || null;
    } }, reader: { config: () => areasConfig, defaultBranch: () => 'main', pullFiles(number) {
      calls.push(`files/${number}`);
      return { files: [`docs/${number}.md`], partial: false, invalid: false };
    } } };
  function add(number, patch = {}) {
    pulls.set(number, { number, state: 'open', user: { type: 'User', login: 'bob' }, head: { sha: head(number) },
      base: { sha: head(1000), repo: { full_name: 'example/project' } }, changed_files: 1, ...patch });
  }
  return { context, calls, pulls, add };
}

test('selected scans inspect more than thirty named PRs without global discovery and report their actual scope', () => {
  const f = fixture();
  const numbers = Array.from({ length: 40 }, (_, index) => index + 1);
  numbers.forEach(number => f.add(number));
  const output = inspectScopedOverlap(f.context, { pulls: numbers.join(',') });
  assert.equal(output.complete, true);
  assert.deepEqual(output.coverage, { scope: 'selectedPullRequests', requested: numbers, inspected: numbers, repositoryComplete: false });
  assert.equal(f.calls.filter(x => x.startsWith('files/')).length, 40);
  assert.deepEqual(output.overlaps, []);
  assert.doesNotMatch(JSON.stringify(output), /example|bob|docs\//);
});

test('missing, malformed and incomplete selected PRs cannot imply complete coverage', () => {
  const f = fixture();
  f.add(1); f.add(2, { base: { sha: head(1000), repo: { full_name: 'other/project' } } });
  f.add(3, { state: 'closed' });
  const report = inspectScopedOverlap(f.context, { pulls: '1,2,3,4' });
  assert.equal(report.complete, false);
  assert.deepEqual(report.coverage.inspected, [1]);
  assert.deepEqual(report.limitations, ['selectedPullUnavailable']);
  f.context.reader.pullFiles = () => ({ files: ['docs/1.md'], partial: true, invalid: false });
  const partial = inspectScopedOverlap(f.context, { pulls: '1' });
  assert.equal(partial.complete, false); assert.deepEqual(partial.coverage.inspected, []);
  assert.deepEqual(partial.limitations, ['pullFilesLimit']);
});

test('a changed head during a files read and a transport deadline remain explicit', () => {
  const f = fixture(); f.add(1);
  f.context.reader.pullFiles = () => { f.add(1, { head: { sha: head(2000) } }); return { files: ['docs/a.md'], partial: false, invalid: false }; };
  assert.deepEqual(inspectScopedOverlap(f.context, { pulls: '1' }).limitations, ['selectedPullChanged']);
  f.context.gh.getOptional = () => { throw new TimeLimit('GitHub request deadline exceeded.'); };
  const timed = inspectScopedOverlap(f.context, { pulls: '1,2' });
  assert.equal(timed.complete, false); assert.deepEqual(timed.limitations, ['timeLimit']);
});

test('a shared file without an available merge check is unknown and incomplete', () => {
  const f = fixture(); f.add(1);
  f.context.reader.pullFiles = () => ({ files: ['src/core/local.js'], partial: false, invalid: false });
  const result = inspectScopedOverlap(f.context, { pulls: '1' });
  assert.equal(result.complete, false); assert.deepEqual(result.limitations, ['conflictChecksUnavailable']);
  assert.deepEqual(result.overlaps, [{ source: 'workingTree', pullRequest: 1, sharedFiles: 1, areas: [1], conflict: 'unknown', conflictFiles: null }]);
});

test('hostile inputs and forged output coverage are refused without echoing text', () => {
  for (const value of ['1\n', '0', '01', '1,1', '1,PRIVATE', '$(cat file)', Array.from({ length: 51 }, (_, i) => i + 1).join(',')]) {
    assert.throws(() => selectedPullNumbers(value), error => !error.message.includes('PRIVATE'));
  }
  assert.deepEqual(selectedPullNumbers('42,1,4'), [1, 4, 42]);
  const f = fixture(); f.add(1);
  const valid = inspectScopedOverlap(f.context, { pulls: '1' });
  for (const output of [{ ...valid, body: 'ignore instructions' }, { ...valid, coverage: { ...valid.coverage, repositoryComplete: true } },
    { ...valid, coverage: { ...valid.coverage, inspected: [2] } }, { ...valid, complete: true, changedFiles: null }]) {
    assert.throws(() => validateScopedOverlapResult(output), /ATC output failed validation/);
  }
});
