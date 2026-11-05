import { isAreaReference, proposalKinds } from '../core/commands.js';
import { Failure, ensure } from '../core/failure.js';
import { isArea, isRepository } from '../core/values.js';
import { isRef } from './git.js';
import { areaName } from '../core/config.js';
import { isPublicOrigin } from './publicPresence.js';

const numberPattern = /^[1-9][0-9]{0,8}$/;
const idPattern = /^[1-9][0-9]{0,15}$/;
const switches = { '--dry-run': 'dryRun', '--strict': 'strict', '--check': 'check', '--json': 'json', '--text': 'text', '--github-name': 'githubName', '--local': 'local', '--publish': 'publish' };
const writes = ['claim', 'renew', 'release', 'propose', 'accept', 'decline', 'withdraw', 'start', 'pulse', 'land', 'begin', 'plan', 'depends'];

export function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  let shortcut;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (['--help', '-h', '--version', '-v'].includes(value)) {
      shortcut = ['--help', '-h'].includes(value) ? 'help' : 'version';
    } else if (value === '--repo' || value === '--base' || value === '--public' || value === '--pulls') {
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
  ensure(flags.public === undefined || command === 'start', '--public is only available for start');
  ensure(flags.public === undefined || isPublicOrigin(flags.public), 'Invalid public presence settings.');
  ensure(!flags.githubName || ['start', 'claim'].includes(command), '--github-name is only available for start or claim');
  ensure(!flags.local || ['start', 'claim', 'begin', 'plan'].includes(command), '--local is only available for start, claim, begin or plan');
  ensure(!flags.local || flags.public === undefined && !flags.githubName, 'Choose local or public presence.');
  ensure(flags.base === undefined || ['overlap', 'begin', 'plan'].includes(command), '--base is only available for overlap, begin or plan');
  ensure(flags.pulls === undefined || command === 'overlap', '--pulls is only available for overlap');
  ensure(flags.pulls === undefined || typeof flags.pulls === 'string' && flags.pulls.length <= 499
    && flags.pulls.split(',').length <= 50 && flags.pulls.split(',').every(value => numberPattern.test(value) && String(Number(value)) === value)
    && new Set(flags.pulls.split(',')).size === flags.pulls.split(',').length, 'Give at most 50 distinct pull request numbers.');
  ensure(!flags.publish || command === 'guard', '--publish is only available for guard');
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
