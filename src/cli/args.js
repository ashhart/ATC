import { proposalKinds } from '../core/commands.js';
import { Failure, ensure } from '../core/failure.js';
import { isArea, isRepository } from '../core/values.js';
import { isRef } from './git.js';

const numberPattern = /^[1-9][0-9]{0,8}$/;
const idPattern = /^[1-9][0-9]{0,15}$/;

export function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo' || value === '--base') {
      ensure(index + 1 < argv.length, 'Missing value for an option');
      flags[value.slice(2)] = argv[index + 1];
      index += 1;
    } else if (value.startsWith('--')) throw new Failure('Unknown option. Run atc help.');
    else positional.push(value);
  }
  ensure(flags.repo === undefined || isRepository(flags.repo), '--repo must be owner/name');
  ensure(flags.base === undefined || isRef(flags.base), '--base must be a branch or ref name');
  const [command = 'help', ...rest] = positional;
  return { command, rest, flags };
}

export function issueArg(value) {
  ensure(numberPattern.test(value || ''), 'Give an issue number');
  return Number(value);
}

export function proposalArg(value) {
  ensure(idPattern.test(value || '') && Number.isSafeInteger(Number(value)), 'Give a proposal id from atc status');
  return Number(value);
}

export function kindArg(value) {
  ensure(proposalKinds.includes(value), `The kind must be one of: ${proposalKinds.join(', ')}`);
  return value;
}

export function areaArgs(values, known) {
  ensure(values.length <= 8 && values.every(isArea) && new Set(values).size === values.length, 'Areas must be lowercase names, at most 8, no repeats');
  ensure(values.every(area => known.includes(area)), 'Unknown area. Run atc status to see this project\'s areas.');
  return [...values].sort();
}
