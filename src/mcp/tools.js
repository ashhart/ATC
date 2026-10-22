import { Failure } from '../core/failure.js';
import { isRepository } from '../core/values.js';
import { isRef } from '../cli/git.js';

const posts = 'Posts a typed /atc comment on GitHub under your gh identity unless dryRun is true.';
const fields = {
  repo: [{ type: 'string', maxLength: 140, description: 'Repository as owner/name. Defaults to the current clone.' },
    value => isRepository(value), 'repo must be owner/name.'],
  issue: [{ type: 'integer', minimum: 1, maximum: 999999999, description: 'Issue number.' },
    value => Number.isSafeInteger(value) && value >= 1 && value <= 999999999, 'issue must be a positive integer.'],
  areas: [{ type: 'array', items: { type: 'integer', minimum: 1, maximum: 24 }, maxItems: 8, uniqueItems: true,
    description: 'Numeric area references shown by atc_board or atc_status.' },
  value => Array.isArray(value) && value.length <= 8 && new Set(value).size === value.length
    && value.every(area => Number.isSafeInteger(area) && area >= 1 && area <= 24), 'areas must be up to 8 distinct integers from 1 to 24.'],
  dryRun: [{ type: 'boolean', description: 'Preview the write without changing anything.' },
    value => typeof value === 'boolean', 'dryRun must be a boolean.'],
  proposal: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Proposal id from atc_status.' },
    value => Number.isSafeInteger(value) && value >= 1 && String(value).length <= 16, 'proposal must be a proposal id from atc_status.'],
  session: [{ type: 'integer', minimum: 1, maximum: 999999999999999, description: 'Session number returned by atc_start.' },
    value => Number.isSafeInteger(value) && value >= 1 && value <= 999999999999999, 'session must be a session number from atc_start.'],
  state: [{ type: 'string', enum: ['working', 'reviewing', 'blocked'] },
    value => ['working', 'reviewing', 'blocked'].includes(value), 'state must be working, reviewing or blocked.'],
  kind: [{ type: 'string', enum: ['pair', 'split', 'takeover', 'review'] },
    value => ['pair', 'split', 'takeover', 'review'].includes(value), 'kind must be pair, split, takeover or review.'],
  base: [{ type: 'string', maxLength: 200, description: 'Local git ref to compare against.' },
    value => isRef(value), 'base must be a branch or ref name.'],
  path: [{ type: 'string', minLength: 1, maxLength: 4096, description: 'File path in the current clone.' },
    value => typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !value.startsWith('-')
      && !/[\u0000-\u001f\u007f]/.test(value), 'path must be a file path in the current clone.']
};

const reading = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const writing = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const local = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const localReading = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const tools = {
  atc_board: ['Read the repository board: contributors, claimed work, pull request overlaps, sessions and ways to help. Never posts.',
    reading, [], ['repo'], () => ['board']],
  atc_status: ['List your claims, proposals for you, your proposals and renewals due. Never posts.',
    reading, [], ['repo'], () => ['status']],
  atc_check: ['Check whether an issue is free, yours or held by someone else before starting work. Never posts.',
    reading, ['issue'], ['areas', 'repo'], args => ['check', String(args.issue), ...numbers(args.areas)]],
  atc_overlap: ['Compare your local changes and open pull requests with other contributors\' open pull requests. Never posts.',
    reading, [], ['base', 'repo'], args => ['overlap', ...(args.base === undefined ? [] : ['--base', args.base])]],
  atc_claim: [`Claim an issue, or update the areas of your existing claim. ${posts}`,
    writing, ['issue'], ['areas', 'dryRun', 'repo'], args => ['claim', String(args.issue), ...numbers(args.areas)]],
  atc_renew: [`Renew your claim without changing its role or areas. ${posts}`,
    writing, ['issue'], ['dryRun', 'repo'], args => ['renew', String(args.issue)]],
  atc_release: [`Release your work or review claim on an issue. ${posts}`,
    writing, ['issue'], ['dryRun', 'repo'], args => ['release', String(args.issue)]],
  atc_propose: [`Offer to pair, split areas, take over or review on an issue someone has claimed. A split needs areas; the other kinds take none. ${posts}`,
    writing, ['issue', 'kind'], ['areas', 'dryRun', 'repo'], args => ['propose', String(args.issue), args.kind, ...numbers(args.areas)]],
  atc_accept: [`Accept a proposal on an issue you hold. ${posts}`,
    writing, ['proposal'], ['dryRun', 'repo'], args => ['accept', String(args.proposal)]],
  atc_decline: [`Decline a proposal on an issue you hold. ${posts}`,
    writing, ['proposal'], ['dryRun', 'repo'], args => ['decline', String(args.proposal)]],
  atc_withdraw: [`Withdraw your own proposal. ${posts}`,
    writing, ['proposal'], ['dryRun', 'repo'], args => ['withdraw', String(args.proposal)]],
  atc_start: ['Start a local agent session on an issue and return its session number. Local presence only; posts nothing to GitHub.',
    local, ['issue'], ['dryRun'], args => ['start', String(args.issue)]],
  atc_pulse: ['Report a local session as working, reviewing or blocked. Check in within five minutes. Local presence only; posts nothing to GitHub.',
    local, ['issue', 'session', 'state'], ['dryRun'], args => ['pulse', String(args.issue), String(args.session), args.state]],
  atc_land: ['End a local agent session without releasing the claim. Local presence only; posts nothing to GitHub.',
    local, ['issue', 'session'], ['dryRun'], args => ['land', String(args.issue), String(args.session)]],
  atc_who: ['Check whether a file in this clone is also changed by another open pull request or local worktree. Never posts.',
    localReading, ['path'], [], args => ['who', args.path]]
};

export function isToolName(name) {
  return typeof name === 'string' && Object.hasOwn(tools, name);
}

export function toolList() {
  return Object.entries(tools).map(([name, [description, annotations, required, optional]]) => ({
    name, description, annotations: { ...annotations },
    inputSchema: { type: 'object', additionalProperties: false, required: [...required],
      properties: Object.fromEntries([...required, ...optional].map(key => [key, structuredClone(fields[key][0])])) }
  }));
}

export function toolArgv(name, args = {}) {
  if (!isToolName(name)) throw new Failure('Unknown tool.');
  if (args === null || typeof args !== 'object' || Array.isArray(args) || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
    throw new Failure('Tool arguments must be an object.');
  }
  const [, , required, optional, build] = tools[name];
  const allowed = [...required, ...optional];
  const keys = Reflect.ownKeys(args);
  if (!keys.every(key => typeof key === 'string' && allowed.includes(key))) throw new Failure('Tool arguments contain an unsupported property.');
  for (const key of required) {
    if (!Object.hasOwn(args, key)) throw new Failure(`Missing required argument ${key}.`);
  }
  for (const key of keys) {
    const [, valid, message] = fields[key];
    if (!valid(args[key])) throw new Failure(`Invalid tool arguments: ${message}`);
  }
  if (name === 'atc_propose' && (args.kind === 'split') !== (args.areas?.length > 0)) throw new Failure('A split needs areas; the other kinds take none.');
  return [...build(args), ...(args.dryRun ? ['--dry-run'] : []), ...(args.repo === undefined ? [] : ['--repo', args.repo])];
}

function numbers(values = []) {
  return values.map(String);
}
