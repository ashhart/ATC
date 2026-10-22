import { isArea } from './values.js';

export const proposalKinds = ['split', 'pair', 'takeover', 'review'];
const idPattern = /^[1-9][0-9]{0,15}$/;
const areaReferencePattern = /^(?:[1-9]|1[0-9]|2[0-4])$/;

export function isAreaReference(value) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && areaReferencePattern.test(value);
}

export function parseCommand(body) {
  if (typeof body !== 'string') return null;
  const line = body.split(/\r?\n/, 1)[0].trim();
  const words = line.split(/\s+/);
  if (words[0] !== '/atc') return null;
  if (line.length > 200) return { verb: 'invalid' };
  return readWords(words.slice(1)) || { verb: 'invalid' };
}

export function commandText(command) {
  if (command.verb === 'claim') return ['/atc', 'claim', ...command.areas].join(' ');
  if (['release', 'reset', 'renew'].includes(command.verb)) return `/atc ${command.verb}`;
  if (command.verb === 'propose') return ['/atc', 'propose', command.kind, ...command.areas].join(' ');
  return `/atc ${command.verb} ${command.proposal}`;
}

function readWords([verb, ...rest]) {
  if (verb === 'claim') {
    const areas = readAreas(rest);
    return areas && { verb, areas };
  }
  if (['release', 'reset', 'renew'].includes(verb)) return rest.length === 0 ? { verb } : null;
  if (verb === 'propose') {
    const [kind, ...areaWords] = rest;
    const areas = readAreas(areaWords);
    if (!proposalKinds.includes(kind) || !areas || (kind === 'split') !== (areas.length > 0)) return null;
    return { verb, kind, areas };
  }
  if (['accept', 'decline', 'withdraw'].includes(verb)) {
    if (rest.length !== 1 || !idPattern.test(rest[0]) || !Number.isSafeInteger(Number(rest[0]))) return null;
    return { verb, proposal: Number(rest[0]) };
  }
  return null;
}

function readAreas(words) {
  if (words.length > 8 || !words.every(word => isArea(word) || isAreaReference(word)) || new Set(words).size !== words.length) return null;
  return [...words].sort(words.every(isAreaReference) ? (first, second) => Number(first) - Number(second) : undefined);
}
