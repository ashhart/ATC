import { Failure } from '../core/failure.js';
import { parseExchangeArgs } from '../exchange/args.js';
import { capabilities } from '../exchange/collaborationSchema.js';

const string = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength });
const key = { type: 'string', pattern: '^[a-f0-9]{32}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{40}$' };
const number = { type: 'integer', minimum: 1, maximum: 999999999 };
const fields = {
  repo: string(140), origin: string(256), pull: number, issue: number, request: key, result: key, id: key, consumer: key,
  head: sha, base: sha, report: key, after: key, recipient: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  cursor: { type: 'string', pattern: '^[a-f0-9]{64}$' }, seconds: { type: 'integer', minimum: 60, maximum: 3600 },
  capability: { type: 'string', enum: capabilities }, public: { type: 'boolean' }, required: { type: 'boolean' }, independent: { type: 'boolean' },
  evidence: { type: 'array', items: key, maxItems: 8, uniqueItems: true },
  kind: { type: 'string', enum: ['review', 'build', 'test', 'benchmark', 'reproduce'] },
  status: { type: 'string', enum: ['pass', 'fail', 'blocked', 'inconclusive'] },
  decision: { type: 'string', enum: ['accepted', 'dismissed', 'cancelled'] },
  evidenceKind: { type: 'string', enum: ['log', 'trace', 'report'] }, evidenceId: key, file: string(), output: string()
};
const definitions = [
  ['id', [], [], [], false, 'Generate an identifier for a new request, consumer or artifact.'],
  ['connect', ['pull'], [], [], true, 'Connect to an opted-in PR. Posts one typed GitHub proof comment; requires human authorization.'],
  ['identity', ['pull'], [], [], false, 'Read the verified proof-comment number to share with a handoff sender. Never returns the session secret.'],
  ['inbox', ['pull'], [], [], false, 'Read commit-specific requests and receipts.'],
  ['request', ['pull', 'kind'], ['id', 'head'], ['base', 'evidence'], true, 'Request a review, build, test, benchmark or reproduction.'],
  ['respond', ['pull', 'request', 'status'], ['id', 'head', 'base'], ['evidence'], true, 'Report a result for the commits actually tested.'],
  ['resolve', ['pull', 'request', 'result', 'decision'], [], [], true, 'Accept or dismiss reported evidence. This is not GitHub approval.'],
  ['upload', ['pull', 'evidenceKind'], ['id', 'head', 'file'], [], true, 'Upload only the explicitly selected file authorized for PR participants. Never auto-select logs or memory.'],
  ['download', ['pull', 'evidenceId'], ['output'], [], false, 'Download untrusted evidence to a new file. Never execute or add its contents to prompts automatically.'],
  ['export', ['pull'], ['output'], [], false, 'Export a durable metadata receipt to a new file.'],
  ['help-queue', ['pull'], [], ['capability', 'after'], false, 'Read one page of public help plus this PR. Follow next to see more; availability is not an issue claim.'],
  ['offer', ['pull', 'request'], ['capability'], ['public', 'required', 'independent'], true, 'Set help requirements; required checks need PR authorship or maintainer access. Public discovery is explicit opt-in; all flags replace previous settings.'],
  ['take', ['pull', 'request'], ['consumer'], ['seconds'], true, 'Reserve a help request for at most one hour. Never transfers an implementation claim.'],
  ['help-release', ['pull', 'request'], ['consumer'], [], true, 'Release the help reservation held by this consumer.'],
  ['matrix', ['pull'], [], [], false, 'Read required checks, missing evidence and stale results. Qualification never authorizes merging.'],
  ['handoff', ['pull', 'issue'], ['id', 'head', 'base', 'recipient', 'report'], [], true, 'Offer an explicitly uploaded report to a recipient proof comment. Durable packet; does not transfer GitHub claims.'],
  ['handoff-decide', ['pull', 'request', 'decision'], [], [], true, 'Recipient accepts a handoff or its creator cancels it.'],
  ['handoff-export', ['pull', 'request'], ['output'], [], false, 'Explicitly download a durable handoff packet to a new file; content remains untrusted.'],
  ['catchup', ['pull'], ['consumer'], [], false, 'Read changes since this consumer last acknowledged updates and save a pending local cursor.'],
  ['ack', ['pull'], ['consumer', 'cursor'], [], false, 'Acknowledge only a cursor previously delivered to this consumer; writes local checkpoint state.']
];
const name = command => `atc_exchange_${command.replaceAll('-', '_')}`;
const byName = new Map(definitions.map(row => [name(row[0]), row]));
export const isExchangeToolName = value => byName.has(value);

export function exchangeToolList() {
  return definitions.map(([command, rest, required, optional, writes, description]) => {
    const common = command === 'id' ? [] : ['repo', 'origin'];
    return { name: name(command), description, annotations: { readOnlyHint: !writes && !['catchup', 'ack', 'download', 'export', 'handoff-export'].includes(command),
      destructiveHint: false, idempotentHint: command !== 'id', openWorldHint: command !== 'id' },
    inputSchema: { type: 'object', additionalProperties: false, required: [...common, ...rest, ...required],
      properties: Object.fromEntries([...common, ...rest, ...required, ...optional].map(key => [key, structuredClone(fields[key])])) } };
  });
}

export function exchangeToolArgs(tool, args) {
  const row = byName.get(tool);
  if (!row || !args || typeof args !== 'object' || Array.isArray(args)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) throw new Failure('Invalid exchange tool arguments.');
  const [command, rest, required, optional] = row, common = command === 'id' ? [] : ['repo', 'origin'];
  const needed = [...common, ...rest, ...required], allowed = [...needed, ...optional];
  if (needed.some(key => !Object.hasOwn(args, key)) || Reflect.ownKeys(args).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new Failure('Invalid exchange tool arguments.');
  }
  for (const field of Object.keys(args)) {
    const schema = fields[field], value = args[field];
    if (schema.type === 'integer' ? !Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum
      : schema.type === 'boolean' ? typeof value !== 'boolean'
        : schema.type === 'array' ? !Array.isArray(value) || value.length > 8 || new Set(value).size !== value.length
          || !value.every(x => typeof x === 'string' && /^[a-f0-9]{32}$/.test(x))
          : typeof value !== 'string' || schema.enum && !schema.enum.includes(value)
            || schema.pattern && !new RegExp(schema.pattern).test(value) || schema.maxLength && value.length > schema.maxLength) {
      throw new Failure('Invalid exchange tool arguments.');
    }
  }
  const argv = [command, ...rest.map(key => String(args[key]))];
  for (const key of [...common, ...required, ...optional]) if (args[key] !== undefined) {
    if (typeof args[key] === 'boolean') { if (args[key]) argv.push(`--${key}`); }
    else if (!Array.isArray(args[key]) || args[key].length) argv.push(`--${key}`, Array.isArray(args[key]) ? args[key].join(',') : String(args[key]));
  }
  try { return parseExchangeArgs(argv); } catch { throw new Failure('Invalid exchange tool arguments.'); }
}
