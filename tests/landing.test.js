import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyGraph } from '../src/core/dependencyGraph.js';
import { runLanding, displayLanding } from '../src/cli/landing.js';

const head = 'a'.repeat(40), base = 'b'.repeat(40), now = Date.parse('2026-11-05T12:00:00Z');
const repository = 'example/project';

function fixture() {
  const pulls = new Map(), comments = new Map(), posts = [];
  const f = { pulls, comments, posts, enabled: true, partial: false, permission: 'read', remaining: 30000 };
  f.add = (number, state = 'open') => {
    pulls.set(number, { number, state: state === 'merged' ? 'closed' : state, merged: state === 'merged',
      user: { login: 'owner' }, head: { sha: head }, base: { sha: base, repo: { full_name: repository } } });
    comments.set(number, []);
  };
  f.comment = (pull, id, dependencies, user = 'owner', extra = {}) => {
    const comment = { id, body: ['/atc', 'depends', ...dependencies].join(' '), user: { login: user, type: 'User' },
      issue_url: `https://api.github.com/repos/${repository}/issues/${pull}`, created_at: '2026-11-05T11:00:00Z', updated_at: '2026-11-05T11:00:00Z',
      author_association: 'NONE', ...extra };
    comments.get(pull).push(comment); return comment;
  };
  const gh = {
    timeLeft: () => f.remaining,
    getOptional(route) {
      if (route.endsWith('/permission')) return { permission: f.permission, user: { login: route.split('/').at(-2) } };
      return pulls.get(Number(route.split('/').at(-1))) || null;
    },
    post(route, fields) {
      posts.push({ route, fields }); const pull = Number(route.split('/').at(-2));
      const dependencies = fields.body.split(' ').slice(2).map(Number);
      f.comment(pull, 100 + posts.length, dependencies);
      return { id: 100 + posts.length };
    }
  };
  const reader = { config: () => f.enabled ? {} : null,
    issueComments: number => ({ items: comments.get(number) || [], partial: f.partial }) };
  f.context = { gh, reader, repository, me: 'owner', now: () => now, readOnly: false, dryRun: false };
  return f;
}

test('dependency order is deterministic, marks ready prerequisites and blocks cycles and abandoned work', () => {
  const nodes = [{ pull: 3, state: 'open', dependencies: [2] }, { pull: 2, state: 'open', dependencies: [1] },
    { pull: 1, state: 'merged', dependencies: [] }];
  const plan = dependencyGraph(nodes, [3]);
  assert.deepEqual(plan.order, [2, 3]); assert.deepEqual(plan.ready, [2]);
  assert.deepEqual(dependencyGraph([...nodes].reverse(), [3]), plan);
  const cyclic = dependencyGraph([{ pull: 1, state: 'open', dependencies: [2] }, { pull: 2, state: 'open', dependencies: [1] }], [1]);
  assert.deepEqual(cyclic.cycles, [1, 2]); assert.deepEqual(cyclic.order, []);
  const abandoned = dependencyGraph([{ pull: 3, state: 'open', dependencies: [2] }, { pull: 2, state: 'closed', dependencies: [] }], [3]);
  assert.deepEqual(abandoned.blocked, [2, 3]);
  assert.throws(() => dependencyGraph([{ pull: 1, state: 'open', dependencies: ['INJECT'] }], [1]));
});

test('landing follows only the latest immutable authorized dependency command, without printing source text', () => {
  const f = fixture(); for (const id of [1, 2, 3, 4]) f.add(id);
  f.comment(3, 1, [4]);
  f.comment(3, 5, [2]);
  f.comment(3, 9, [4], 'attacker');
  f.comment(3, 10, [4], 'owner', { updated_at: '2026-11-05T11:30:00Z' });
  f.comment(3, 11, [4], 'owner', { user: { type: 'Bot', login: 'bot' } });
  f.comment(2, 3, [1]); f.pulls.get(1).state = 'closed'; f.pulls.get(1).merged = true;
  const result = runLanding('landing', ['3'], f.context);
  assert.equal(result.complete, true); assert.equal(result.advice, 'waiting');
  assert.deepEqual(result.order, [2, 3]); assert.deepEqual(result.ready, [2]);
  assert.equal(result.pulls.some(x => x.pull === 4), false);
  assert.doesNotMatch(JSON.stringify(result), /attacker|owner|user|comment|INJECT/);
  f.comment(3, 20, [], 'maintainer', { author_association: 'COLLABORATOR' });
  assert.equal(runLanding('landing', ['3'], f.context).advice, 'waiting');
  f.permission = 'write';
  assert.equal(runLanding('landing', ['3'], f.context).advice, 'ready');
});

test('typed dependency writes preserve auth, opt-in, dry-run and read-only boundaries and confirm their result', () => {
  const f = fixture(); for (const id of [1, 2]) f.add(id);
  f.enabled = false; assert.equal(runLanding('depends', ['2', '1'], f.context).outcome, 'notEnabled');
  f.enabled = true;
  assert.equal(runLanding('depends', ['2', '1'], { ...f.context, readOnly: true }).outcome, 'readOnly');
  assert.equal(runLanding('depends', ['2', '1'], { ...f.context, dryRun: true }).outcome, 'dryRun');
  assert.equal(f.posts.length, 0);
  assert.equal(runLanding('depends', ['2', '1'], { ...f.context, me: 'reader' }).outcome, 'notAuthorized');
  f.permission = 'write';
  assert.equal(runLanding('depends', ['2', '1'], { ...f.context, me: 'reader' }).outcome, 'dependenciesUpdated');
  assert.deepEqual(f.posts[0], { route: 'repos/example/project/issues/2/comments', fields: { body: '/atc depends 1' } });
  assert.equal(runLanding('landing', ['2'], f.context).advice, 'waiting');
  assert.equal(runLanding('depends', ['2'], f.context).outcome, 'dependenciesUpdated');
  assert.equal(runLanding('landing', ['2'], f.context).advice, 'ready');
  assert.throws(() => runLanding('depends', ['2', '2'], f.context));
});

test('missing PRs, bounded-read failures and corrupt metadata are explicit incomplete coverage', () => {
  const f = fixture(); f.add(1); f.comment(1, 1, [2]);
  let result = runLanding('landing', ['1'], f.context);
  assert.equal(result.complete, false); assert.equal(result.advice, 'incomplete'); assert.deepEqual(result.missing, [2]);
  f.add(2); f.partial = true;
  result = runLanding('landing', ['1'], f.context); assert.ok(result.limitations.includes('commentsLimit'));
  f.partial = false; f.remaining = 0;
  result = runLanding('landing', ['1'], f.context); assert.ok(result.limitations.includes('timeLimit'));
  f.remaining = 30000; f.pulls.get(2).head.sha = 'hostile';
  assert.equal(runLanding('landing', ['1'], f.context).complete, false);
  assert.throws(() => displayLanding({ command: 'depends', repository: 'selected', pull: 1, dependencies: [],
    outcome: 'INJECT', posted: false, comment: null }));
});
