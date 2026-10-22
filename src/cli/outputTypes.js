import { ensure } from '../core/failure.js';
import { readTimestamp } from '../core/values.js';

export const invalidOutput = 'ATC output failed validation.';

export function rejectUnless(condition) {
  ensure(condition, invalidOutput);
}

export function numberRange(low, high) {
  return value => {
    rejectUnless(Number.isSafeInteger(value) && value >= low && value <= high);
    return value;
  };
}

export function enumValue(...values) {
  const allowed = new Set(values);
  return value => { rejectUnless(allowed.has(value)); return value; };
}

export const booleanValue = enumValue(true, false);
export const issueNumber = numberRange(1, 999999999);
export const artifactId = numberRange(1, Number.MAX_SAFE_INTEGER);
export const sessionId = numberRange(1, 999999999999999);
export const contributorId = numberRange(1, 20000);
export const count = maximum => numberRange(0, maximum);

export function timestamp(value) {
  const time = readTimestamp(value);
  rejectUnless(time !== null && new Date(time).toISOString() === value);
  return value;
}

export function nullable(validator) {
  return (value, context) => value === null ? null : validator(value, context);
}

export function list(validator, maximum, minimum = 0, unique = false) {
  return (value, context) => {
    rejectUnless(Array.isArray(value) && value.length >= minimum && value.length <= maximum);
    const keys = Reflect.ownKeys(value);
    rejectUnless(keys.length === value.length + 1 && keys.includes('length'));
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      rejectUnless(descriptor && Object.hasOwn(descriptor, 'value'));
      context.nodes += 1;
      rejectUnless(context.nodes <= 2000000);
      result.push(validator(descriptor.value, context));
    }
    rejectUnless(!unique || new Set(result).size === result.length);
    return result;
  };
}

export function record(required, optional = {}) {
  const validators = { ...required, ...optional };
  return (value, context) => {
    rejectUnless(value !== null && typeof value === 'object' && !Array.isArray(value));
    rejectUnless([Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const keys = Reflect.ownKeys(value);
    rejectUnless(keys.length <= Object.keys(validators).length && keys.every(key => typeof key === 'string' && Object.hasOwn(validators, key)));
    rejectUnless(Object.keys(required).every(key => Object.hasOwn(value, key)));
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      rejectUnless(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
      context.nodes += 1;
      rejectUnless(context.nodes <= 2000000);
      result[key] = validators[key](descriptor.value, context);
    }
    return result;
  };
}

export function areaList(value, context) {
  const references = list((area, scope) => scope.area(area), 24)(value, context);
  rejectUnless(new Set(value).size === value.length);
  if (context.suppressAreas) return [];
  rejectUnless(new Set(references).size === references.length);
  return references;
}

export const issueList = maximum => list(issueNumber, maximum, 0, true);
