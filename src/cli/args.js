import { isAreaReference, proposalKinds } from '../core/commands.js';
import { Failure, ensure } from '../core/failure.js';
import { isArea, isRepository } from '../core/values.js';
import { isRef } from './git.js';
import { areaName } from '../core/config.js';

const numberPattern = /^[1-9][0-9]{0,8}$/;
const idPattern = /^[1-9][0-9]{0,15}$/;
const switches = { '--dry-run': 'dryRun', '--strict': 'strict', '--check': 'check', '--json': 'json', '--text': 'text' };
const writes = ['claim', 'renew', 'release', 'propose', 'accept', 'decline', 'withdraw', 'start', 'pulse', 'land'];

export function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  let shortcut;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (['--help', '-h', '--version', '-v'].includes(value)) {
      shortcut = ['--help', '-h'].includes(value) ? 'help' : 'version';
    } else if (value === '--repo' || value === '--base') {
      const key = value.slice(2);
      ensure(index + 1 < argv.length && !Object.hasOwn(flags, key), 'Missing or repeated option');
      flags[key] = argv[++index];
    } else if (Object.hasOwn(switches, value)) {
      const key = switches[value];
      ensure(!Object.hasOwn(flags, key), 'Repeated option');
      flags[key] = true;
    } else if (value.startsWith('-')) throw new Failure('Unknown option. Run atc help.');
    else positional.push(value);
  }
  ensure(flags.repo === undefined || isRepository(flags.repo), '--repo must be owner/name');
  ensure(flags.base === undefined || isRef(flags.base), '--base must be a branch or ref name');
  if (shortcut) return { command: shortcut, rest: [], flags: {} };
  const [command = 'board', ...rest] = positional;
  ensure(flags.base === undefined || command === 'overlap', '--base is only available for overlap');
  ensure(!flags.check || command === 'init', '--check is only available for init');
  ensure(!flags.dryRun || writes.includes(command), '--dry-run is only available for coordinating writes');
  ensure(command !== 'init' || flags.repo === undefined, 'init uses the local repository');
  ensure(!(flags.json && flags.text), 'Choose --json or --text, not both');
  ensure(!['who', 'start', 'pulse', 'land'].includes(command) || flags.repo === undefined, 'This command uses the local clone');
  return { command, rest, flags };
}

export function issueArg(value) {
  ensure(typeof value === 'string' && numberPattern.test(value) && String(Number(value)) === value, 'Give an issue number');
  return Number(value);
}

export function proposalArg(value) {
  ensure(typeof value === 'string' && idPattern.test(value) && Number.isSafeInteger(Number(value))
    && String(Number(value)) === value, 'Give a proposal id from atc status');
  return Number(value);
}

export function kindArg(value) {
  ensure(proposalKinds.includes(value), 'The kind must be pair, split, takeover or review');
  return value;
}

export function areaArgs(values, config) {
  const names = Object.keys(config.areas);
  const resolved = values.map(value => isAreaReference(value) ? areaName(config, value) : value);
  ensure(values.length <= 8 && resolved.every(isArea) && new Set(resolved).size === resolved.length,
    'Use at most 8 distinct configured area references');
  ensure(resolved.every(area => names.includes(area)), 'Unknown area. Run atc status to see this project\'s areas.');
  return resolved.sort();
}

export function sessionArg(value) {
  ensure(typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value) && String(Number(value)) === value, 'Give a session number from atc start');
  return Number(value);
}

export function presenceArg(value) {
  ensure(['working', 'reviewing', 'blocked'].includes(value), 'Presence must be working, reviewing or blocked');
  return value;
}
