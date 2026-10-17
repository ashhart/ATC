import { proposalKinds } from '../core/commands.js';
import { Failure, ensure } from '../core/failure.js';
import { isArea, isBotLogin, isRepository } from '../core/values.js';

const numberPattern = /^[1-9][0-9]{0,8}$/;

export function parseCliArgs(argv) {
  const positional = [];
  const flags = { wait: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--wait') flags.wait = true;
    else if (value === '--repo' || value === '--bot') {
      ensure(index + 1 < argv.length, 'Missing value for an option');
      flags[value.slice(2)] = argv[index + 1];
      index += 1;
    } else if (value.startsWith('--')) throw new Failure('Unknown option. Run atc-gh help.');
    else positional.push(value);
  }
  ensure(flags.repo === undefined || isRepository(flags.repo), '--repo must be owner/name');
  ensure(flags.bot === undefined || isBotLogin(flags.bot), '--bot must be a bot login such as github-actions[bot]');
  const [command = 'help', ...rest] = positional;
  return { command, rest, flags };
}

export function issueArg(value) {
  ensure(numberPattern.test(value || ''), 'Give an issue number');
  return Number(value);
}

export function proposalArg(value) {
  ensure(numberPattern.test(value || ''), 'Give a proposal number');
  return Number(value);
}

export function kindArg(value) {
  ensure(proposalKinds.includes(value), `The kind must be one of: ${proposalKinds.join(', ')}`);
  return value;
}

export function areaArgs(values, known) {
  ensure(values.length <= 8 && values.every(isArea) && new Set(values).size === values.length, 'Areas must be lowercase names from the board, at most 8, no repeats');
  ensure(known.length === 0 || values.every(area => known.includes(area)), 'Unknown area. Run atc-gh status to see this project\'s areas.');
  return [...values].sort();
}
