import { isCapability, isConsumer } from './collaborationSchema.js';
import { isHead, isKey, isNumber, isOrigin, isRepository, kinds, statuses, decisions, evidenceKinds, isEvidenceIds, requireValue } from './values.js';

const options = {
  identity: ['repo', 'origin'],
  'help-queue': ['repo', 'origin', 'capability', 'after'],
  offer: ['repo', 'origin', 'capability', 'public', 'required', 'independent'],
  take: ['repo', 'origin', 'consumer', 'seconds'], 'help-release': ['repo', 'origin', 'consumer'],
  matrix: ['repo', 'origin'], handoff: ['repo', 'origin', 'id', 'head', 'base', 'recipient', 'report'],
  'handoff-decide': ['repo', 'origin'], 'handoff-export': ['repo', 'origin', 'output'],
  catchup: ['repo', 'origin', 'consumer'], ack: ['repo', 'origin', 'consumer', 'cursor'],
  serve: ['repo', 'origin', 'data', 'port'], connect: ['repo', 'origin'], inbox: ['repo', 'origin', 'text', 'json'],
  request: ['repo', 'origin', 'id', 'head', 'base', 'evidence'], respond: ['repo', 'origin', 'id', 'head', 'base', 'evidence'],
  resolve: ['repo', 'origin'], upload: ['repo', 'origin', 'id', 'head', 'file'], download: ['repo', 'origin', 'output'],
  export: ['repo', 'origin', 'output', 'text'], id: [], help: []
};
const arity = { identity: 1, 'help-queue': 1, offer: 2, take: 2, 'help-release': 2, matrix: 1, handoff: 2, 'handoff-decide': 3, 'handoff-export': 2, catchup: 1, ack: 1, serve: 0, connect: 1, inbox: 1, request: 2, respond: 3, resolve: 4, upload: 2, download: 2, export: 1, id: 0, help: 0 };
const isPath = x => typeof x === 'string' && x.length > 0 && x.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(x);

export function parseExchangeArgs(args) {
  requireValue(Array.isArray(args) && args.length <= 32 && args.every(x => typeof x === 'string'
    && x.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(x)));
  const command = args[0] === '--help' || args.length === 0 ? 'help' : args[0];
  requireValue(Object.hasOwn(options, command));
  const flags = {};
  const rest = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) { rest.push(arg); continue; }
    const name = arg.slice(2);
    requireValue(options[command].includes(name) && !Object.hasOwn(flags, name));
    if (['json', 'text', 'public', 'required', 'independent'].includes(name)) flags[name] = true;
    else { requireValue(i + 1 < args.length); flags[name] = args[++i]; }
  }
  requireValue(rest.length === arity[command] && !(flags.text && flags.json));
  if (['help', 'id'].includes(command)) return { command, flags, rest };
  requireValue(isRepository(flags.repo) && isOrigin(flags.origin));
  flags.repo = flags.repo.toLowerCase();
  if (command === 'serve') {
    flags.port ??= '4319';
    requireValue(isPath(flags.data) && /^[1-9][0-9]{0,4}$/.test(flags.port) && Number(flags.port) <= 65535);
  } else requireValue(/^[1-9][0-9]{0,8}$/.test(rest[0]) && isNumber(Number(rest[0])));
  if (['request', 'respond', 'upload'].includes(command)) requireValue(isKey(flags.id) && isHead(flags.head));
  if (command === 'request') requireValue(kinds.includes(rest[1]));
  if (flags.base !== undefined) requireValue(isHead(flags.base));
  if (command === 'respond') requireValue(isKey(rest[1]) && statuses.includes(rest[2]) && isHead(flags.base));
  if (command === 'resolve') requireValue(isKey(rest[1]) && isKey(rest[2]) && decisions.includes(rest[3]));
  if (command === 'upload') requireValue(evidenceKinds.includes(rest[1]) && isPath(flags.file));
  if (command === 'download') requireValue(isKey(rest[1]));
  if (['download', 'export'].includes(command)) requireValue(isPath(flags.output));
  if (['request', 'respond'].includes(command)) {
    flags.evidence = flags.evidence === undefined ? [] : flags.evidence.split(',');
    requireValue(isEvidenceIds(flags.evidence));
  }
  if (['offer', 'take', 'help-release', 'handoff-decide', 'handoff-export'].includes(command)) requireValue(isKey(rest[1]));
  if (command === 'offer') { flags.capability ??= 'any'; requireValue(isCapability(flags.capability)); }
  if (command === 'help-queue') {
    requireValue(flags.capability === undefined || isCapability(flags.capability));
    requireValue(flags.after === undefined || isKey(flags.after));
  }
  if (['take', 'help-release', 'catchup', 'ack'].includes(command)) requireValue(isConsumer(flags.consumer));
  if (command === 'take') { flags.seconds ??= '1800'; requireValue(/^[1-9][0-9]{1,3}$/.test(flags.seconds)
    && Number(flags.seconds) >= 60 && Number(flags.seconds) <= 3600); }
  if (command === 'ack') requireValue(typeof flags.cursor === 'string' && /^[a-f0-9]{64}$/.test(flags.cursor));
  if (command === 'handoff') requireValue(/^[1-9][0-9]{0,8}$/.test(rest[1]) && isKey(flags.id) && isHead(flags.head)
    && isHead(flags.base) && isKey(flags.report) && /^[1-9][0-9]{0,15}$/.test(flags.recipient)
    && Number.isSafeInteger(Number(flags.recipient)));
  if (command === 'handoff-decide') requireValue(['accepted', 'cancelled'].includes(rest[2]));
  if (command === 'handoff-export') requireValue(isPath(flags.output));
  return { command, flags, rest };
}
