import { areaReference } from '../core/config.js';
import { boardOutput } from './outputBoard.js';
import { checkOutput, overlapOutput, statusOutput, whoOutput } from './outputRead.js';
import { doctorOutput, initOutput } from './outputSetup.js';
import { numberRange, rejectUnless } from './outputTypes.js';
import { writeOutput } from './outputWrite.js';

export function displayResult(result, knownAreasOrConfig = []) {
  const context = { nodes: 0, area: areaProjector(knownAreasOrConfig), suppressAreas: knownAreasOrConfig?.areasPinned === false };
  const resultValue = projectResult(result, context);
  if (context.suppressAreas) rejectUnless(resultValue.complete === false && resultValue.limitations.includes('configurationUnpinned')
    || ['configurationUnpinned', 'incomplete'].includes(resultValue.outcome));
  return resultValue;
}

export function validatePublicResult(result) {
  return projectResult(result, { nodes: 0, area: numberRange(1, 24), suppressAreas: false });
}

function projectResult(result, context) {
  rejectUnless(result !== null && typeof result === 'object' && !Array.isArray(result));
  const field = key => Object.getOwnPropertyDescriptor(result, key)?.value;
  const command = field('command');
  const validator = command === 'init' ? initOutput : command === 'doctor' ? doctorOutput : command === 'who' ? whoOutput
    : command !== undefined ? writeOutput
    : Object.hasOwn(result, 'observedAt') ? boardOutput : Object.hasOwn(result, 'advice') ? checkOutput
      : Object.hasOwn(result, 'overlaps') ? overlapOutput : statusOutput;
  const output = validator(result, context);
  if (Object.hasOwn(output, 'complete')) rejectUnless(output.complete === (output.limitations.length === 0));
  return output;
}

function areaProjector(value) {
  if (Array.isArray(value)) {
    rejectUnless(value.length <= 24 && value.every(name => typeof name === 'string') && new Set(value).size === value.length);
    const references = new Map([...value].sort().map((name, index) => [name, index + 1]));
    return name => { const reference = references.get(name); rejectUnless(reference !== undefined); return reference; };
  }
  rejectUnless(value !== null && typeof value === 'object' && !Array.isArray(value));
  return name => {
    rejectUnless(typeof name === 'string');
    if (value.areasPinned === false) {
      rejectUnless(value.areas && Object.hasOwn(value.areas, name));
      return null;
    }
    const reference = areaReference(value, name);
    rejectUnless(Number.isSafeInteger(reference) && reference >= 1 && reference <= 24);
    return reference;
  };
}
