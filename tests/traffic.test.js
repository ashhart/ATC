import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/core/config.js';
import { trafficView } from '../src/core/traffic.js';
import { areasConfig, days } from './helpers.js';

const now = Date.UTC(2026, 9, 19, 12);
const config = readConfig(areasConfig);
const identities = new Map([['alice', 1], ['bob', 2], ['carol', 3], ['helper[bot]', 4]]);
const claim = (issue, login, role = 'work', areas = []) => ({ issue, login, role, areas, since: now - days(2), active: now - days(1) });
const issue = (number, extra = {}) => ({ number, assignees: [], helpWanted: false, goodFirstIssue: false, ...extra });
const pull = (number, author, issues = [], draft = false) => ({ number, author, issues, draft, createdAt: now - days(3), updatedAt: now - days(1) });

function board({ claims = [], pulls = [], issues = [], files = new Map(), refs = identities, me = 'bob', partial = false, limitations = [] } = {}) {
  return trafficView({ state: { claims, proposals: [] }, pulls, config, partial, limitations, now },
    { me, repository: 'private-owner/private-repo', openIssues: issues, identities: refs, pullFiles: files });
}

test('traffic groups contributors across claims, reviews, GitHub assignments and pull requests', () => {
  const claims = [claim(1, 'alice', 'work', ['core']), claim(1, 'bob', 'review'), claim(2, 'bob', 'work', ['docs'])];
  const issues = [issue(1, { assignees: [{ login: 'alice', id: 987654321 }] }), issue(2, { assignees: [{ login: 'carol', id: 987654322 }] })];
  const pulls = [pull(10, 'alice', [1]), pull(11, 'carol', [2], true), pull(12, 'helper[bot]')];
  const files = new Map([[10, new Set(['src/core/a.js'])], [11, new Set(['docs/readme.md'])], [12, new Set(['tests/a.test.js'])]]);
  const result = board({ claims, issues, pulls, files });
  assert.equal(result.repository, 'selected');
  assert.equal(result.observedAt, new Date(now).toISOString());
  assert.equal(result.complete, true);
  assert.deepEqual(result.limitations, []);
  assert.deepEqual(result.contributors, [
    { id: 1, mine: false, workingIssues: [1], reviewingIssues: [], assignedIssues: [1], pullRequests: [10] },
    { id: 2, mine: true, workingIssues: [2], reviewingIssues: [1], assignedIssues: [], pullRequests: [] },
    { id: 3, mine: false, workingIssues: [], reviewingIssues: [], assignedIssues: [2], pullRequests: [11] },
    { id: 4, mine: false, workingIssues: [], reviewingIssues: [], assignedIssues: [], pullRequests: [12] }
  ]);
  assert.deepEqual(result.issues[0].claims.map(entry => [entry.contributor, entry.role, entry.areas]), [[1, 'work', ['core']], [2, 'review', []]]);
  assert.deepEqual(result.issues[0].assignees, [{ contributor: 1, mine: false }]);
  assert.deepEqual(result.issues[0].pullRequests, [10]);
  assert.deepEqual(result.pullRequests.map(entry => [entry.pullRequest, entry.contributor, entry.draft, entry.areas, entry.changedFiles]),
    [[10, 1, false, ['core'], 1], [11, 3, true, ['docs'], 1], [12, 4, false, ['tests'], 1]]);
  assert.equal(result.pullRequests[0].createdAt, new Date(now - days(3)).toISOString());
  assert.equal(result.pullRequests[0].updatedAt, new Date(now - days(1)).toISOString());
});

test('exact file collisions stay distinct from shared configured areas', () => {
  const pulls = [pull(10, 'alice'), pull(11, 'carol'), pull(12, 'helper[bot]'), pull(13, 'alice')];
  const files = new Map([[10, new Set(['src/core/a.js'])], [11, new Set(['src/core/a.js', 'docs/guide.md'])],
    [12, new Set(['src/core/b.js'])], [13, new Set(['src/core/a.js'])]]);
  const result = board({ pulls, files });
  assert.deepEqual(result.fileOverlaps, [
    { pullRequests: [10, 11], sharedFiles: 1, areas: ['core'] }, { pullRequests: [11, 13], sharedFiles: 1, areas: ['core'] }
  ]);
  assert.equal(result.areaOverlaps.some(entry => entry.pullRequests.join() === '10,12'), true);
  assert.equal(result.fileOverlaps.some(entry => entry.pullRequests.join() === '10,12'), false);
  assert.equal(result.areaOverlaps.some(entry => entry.pullRequests.join() === '10,13'), false);
});

test('help labels are explicit requests while contribution suggestions remain candidates', () => {
  const issues = [issue(1, { helpWanted: true }), issue(2, { goodFirstIssue: true, assignees: [{ login: 'carol', id: 12345 }] }),
    issue(3), issue(4), issue(5), issue(6, { helpWanted: true }), issue(7), issue(8)];
  const claims = [claim(3, 'alice', 'work', ['core', 'docs']), claim(4, 'alice', 'work', ['core']), claim(7, 'alice'),
    claim(8, 'alice', 'work', ['core']), claim(8, 'carol', 'work', ['docs'])];
  const pulls = [pull(10, 'carol', [5, 6])];
  const result = board({ claims, pulls, issues, files: new Map([[10, new Set()]]) });
  const opportunities = number => result.opportunities.filter(entry => entry.issue === number);
  assert.deepEqual(opportunities(1), [
    { issue: 1, reason: 'helpWanted', signal: 'request', actions: ['check', 'claim'] },
    { issue: 1, reason: 'unassigned', signal: 'candidate', actions: ['check', 'claim'] }
  ]);
  assert.deepEqual(opportunities(2), [{ issue: 2, reason: 'goodFirstIssue', signal: 'candidate', actions: ['check'] }]);
  assert.deepEqual(opportunities(3), [{ issue: 3, reason: 'activeClaim', signal: 'candidate', actions: ['check', 'proposePair', 'proposeReview', 'proposeSplit'] }]);
  assert.deepEqual(opportunities(4)[0].actions, ['check', 'proposePair', 'proposeReview']);
  assert.deepEqual(opportunities(5), []);
  assert.deepEqual(opportunities(6), [{ issue: 6, reason: 'helpWanted', signal: 'request', actions: ['check'] }]);
  assert.equal(opportunities(7)[0].actions.includes('proposeSplit'), true);
  assert.equal(opportunities(8)[0].actions.includes('proposeSplit'), false);
});

test('a contributor already involved in an issue receives no duplicate proposal suggestion', () => {
  const result = board({ claims: [claim(1, 'alice'), claim(1, 'bob', 'review')], issues: [issue(1, { helpWanted: true })] });
  assert.deepEqual(result.opportunities, [{ issue: 1, reason: 'helpWanted', signal: 'request', actions: ['check'] }]);
});

test('unlisted issue references remain unknown and do not become free-work suggestions', () => {
  const result = board({ pulls: [pull(10, 'alice', [99])], files: new Map([[10, new Set()]]) });
  assert.equal(result.issues[0].state, 'unknown');
  assert.deepEqual(result.issues[0].pullRequests, [10]);
  assert.deepEqual(result.opportunities, []);
});

test('incomplete snapshots retain organic activity but suggest only checking', () => {
  const result = board({ partial: true, limitations: ['openIssuesLimit'], pulls: [pull(10, 'carol')], issues: [issue(1, { helpWanted: true })],
    files: new Map([[10, new Set(['docs/guide.md'])]]) });
  assert.equal(result.complete, false);
  assert.deepEqual(result.limitations, ['openIssuesLimit']);
  assert.equal(result.pullRequests.length, 1);
  assert.equal(result.contributors.length, 1);
  assert.equal(result.opportunities.every(entry => entry.actions.join() === 'check'), true);
});

test('missing contributor references or file sets are explicit incomplete coverage', () => {
  const result = board({ pulls: [pull(10, 'alice', [1])], issues: [issue(1)], refs: new Map() });
  assert.equal(result.complete, false);
  assert.deepEqual(result.limitations, ['contributorReferencesUnavailable', 'pullFilesUnavailable']);
  assert.equal(result.contributors[0].id, null);
  assert.equal(result.pullRequests[0].contributor, null);
  assert.equal(result.pullRequests[0].changedFiles, null);
  assert.deepEqual(result.pullRequests[0].areas, []);
  assert.deepEqual(result.fileOverlaps, []);
});

test('traffic output hides names, account IDs, private paths, profile URLs and repository identity', () => {
  const refs = new Map([['privatename', 1], ['otherperson', 2]]);
  const claims = [claim(1, 'privatename', 'work', ['core'])];
  const pulls = [{ ...pull(10, 'otherperson', [1]), id: 987654321, title: 'Private title', body: 'private.person@example.com' }];
  const issues = [issue(1, { assignees: [{ login: 'privatename', id: 987654322, avatar_url: 'https://private.invalid/profile' }] })];
  const files = new Map([[10, new Set(['src/core/private.person@example.com'])]]);
  const result = board({ claims, pulls, issues, refs, files, me: 'privatename' });
  const text = JSON.stringify(result);
  for (const canary of ['privatename', 'otherperson', '987654321', '987654322', 'Private title', 'private.person@example.com',
    'private.invalid', 'private-owner', 'private-repo', 'src/core/']) assert.equal(text.includes(canary), false);
  assert.deepEqual(result.contributors.map(entry => entry.id), [1, 2]);
  assert.equal(result.contributors[0].mine, true);
  assert.deepEqual(result.pullRequests[0].areas, ['core']);
});

test('real external account IDs cannot accidentally act as snapshot-local ordinals', () => {
  const result = board({ claims: [claim(1, 'alice')], refs: new Map([['alice', 987654321]]) });
  assert.equal(result.complete, false);
  assert.equal(result.contributors[0].id, null);
  assert.equal(JSON.stringify(result).includes('987654321'), false);
});

test('board output is deterministic across input and file-set ordering', () => {
  const claims = [claim(1, 'alice', 'work', ['docs', 'core']), claim(1, 'bob', 'review')];
  const issues = [issue(2), issue(1, { assignees: [{ login: 'carol' }, { login: 'alice' }] })];
  const pulls = [pull(11, 'carol', [2, 1]), pull(10, 'alice', [1])];
  const files = new Map([[10, new Set(['docs/guide.md', 'src/core/a.js'])], [11, new Set(['src/core/a.js', 'tests/a.test.js'])]]);
  const first = board({ claims, issues, pulls, files });
  const second = board({ claims: [...claims].reverse(), issues: [...issues].reverse().map(value => ({ ...value, assignees: [...value.assignees].reverse() })),
    pulls: [...pulls].reverse(), refs: new Map([...identities].reverse()), files: new Map([...files].reverse().map(([number, paths]) => [number, new Set([...paths].reverse())])) });
  assert.deepEqual(second, first);
});

test('incomplete missing-reference boards retain deterministic contributor and claim ordering', () => {
  const claims = [claim(1, 'alice', 'work', ['core']), claim(1, 'bob', 'work', ['docs'])];
  const issues = [issue(1, { assignees: [{ login: 'alice' }, { login: 'bob' }] })];
  const first = board({ claims, issues, refs: new Map() });
  const second = board({ claims: [...claims].reverse(), issues: [issue(1, { assignees: [...issues[0].assignees].reverse() })], refs: new Map() });
  assert.deepEqual(second, first);
});
