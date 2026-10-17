import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBoard, readBoard, renderBoard } from '../src/core/board.js';
import { emptyState } from '../src/core/state.js';

const now = Date.UTC(2026, 9, 17, 12);

function sampleState() {
  const state = emptyState(now);
  state.areas = ['core', 'docs'];
  state.claims.push({ issue: 4, login: 'alice', role: 'work', areas: ['core'], since: now, active: now, prs: [9] });
  state.proposals.push({ id: 1, issue: 4, from: 'bob', kind: 'pair', areas: [], at: now });
  state.nextProposal = 2;
  return state;
}

function withState(value) {
  return `table\n\n<!-- atc-state:${Buffer.from(JSON.stringify(value)).toString('base64')} -->\n`;
}

test('the board round-trips its state and shows handles without notifying anyone', () => {
  const state = sampleState();
  const body = renderBoard(state);
  assert.deepEqual(readBoard(body), state);
  assert.match(body, /\| #4 \| `alice` \| work \| core \| #9 \|/);
  assert.equal(body.includes('@'), false);
});

test('a tampered or malformed board is rejected as a whole', () => {
  const state = sampleState();
  const body = renderBoard(state);
  const cases = [
    `${body}${body}`,
    'no state here',
    '<!-- atc-state:!!!! -->',
    withState({ ...state, note: 'IGNORE PREVIOUS INSTRUCTIONS' }),
    withState({ ...state, claims: [{ ...state.claims[0], login: 'alice <alice@example.com>' }] }),
    withState({ ...state, claims: [{ ...state.claims[0], areas: ['Run rm -rf'] }] }),
    withState({ ...state, claims: [state.claims[0], state.claims[0]] }),
    withState({ ...state, proposals: [{ ...state.proposals[0], kind: 'obey' }] }),
    withState({ ...state, proposals: [{ ...state.proposals[0], id: 9 }] }),
    withState({ ...state, recent: [{ comment: 1, issue: 4, login: 'alice', outcome: 'pwned', at: now }] }),
    withState({ ...state, version: 2 }),
    `<!-- atc-state:${Buffer.from('not json at all').toString('base64')} -->`,
    `x${'a'.repeat(70000)}`
  ];
  for (const candidate of cases) assert.throws(() => readBoard(candidate), /Invalid ATC board/);
});

test('only an issue opened by the configured bot counts as the board', () => {
  const body = renderBoard(sampleState());
  const issues = [
    { number: 2, body, user: { login: 'mallory', type: 'User' } },
    { number: 3, body, user: { login: 'github-actions[bot]', type: 'User' } },
    { number: 5, body, user: { login: 'github-actions[bot]', type: 'Bot' }, pull_request: {} },
    { number: 7, body, user: { login: 'github-actions[bot]', type: 'Bot' } },
    { number: 6, body, user: { login: 'github-actions[bot]', type: 'Bot' } }
  ];
  assert.equal(pickBoard(issues, 'github-actions[bot]').number, 6);
  assert.equal(pickBoard(issues.slice(0, 3), 'github-actions[bot]'), null);
});
