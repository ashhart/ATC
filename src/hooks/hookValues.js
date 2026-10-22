import path from 'node:path';

const hiddenCharacters = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
const timestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPathText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !hiddenCharacters.test(value);
}

export function isAbsolutePath(value) {
  return isPathText(value) && path.isAbsolute(value);
}

export function isNumberIn(value, low, high) {
  return Number.isSafeInteger(value) && value >= low && value <= high;
}

export function isTimestamp(value) {
  if (typeof value !== 'string' || !timestampPattern.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function readNumbers(value, maximum, low, high) {
  if (!Array.isArray(value) || value.length > maximum || !value.every(item => isNumberIn(item, low, high))) return null;
  return [...new Set(value)].sort((first, second) => first - second);
}

export function plural(amount, one, many) {
  return amount === 1 ? one : many;
}

export function issueList(numbers, limit = 10) {
  const shown = numbers.slice(0, limit).map(number => `#${number}`);
  if (numbers.length > limit) shown.push(`${numbers.length - limit} more`);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}
