import { isNumber, isRecord, isRepository } from '../core/values.js';
import { isCommit } from '../core/plans.js';

export function publicationPulls(items, repository) {
  if (!isRepository(repository) || !Array.isArray(items) || items.length > 300) return null;
  const result = [];
  const seen = new Set();
  for (const item of items) {
    if (!isRecord(item)) return null;
    const number = item.number;
    const head = item.head?.sha;
    const base = item.base?.sha;
    const origin = item.base?.repo?.full_name;
    if (!isNumber(number) || seen.has(number) || !isCommit(head) || !isCommit(base)
      || !isRepository(origin) || origin.toLowerCase() !== repository.toLowerCase()) return null;
    seen.add(number);
    result.push({ number, head, base });
  }
  return result.sort((first, second) => first.number - second.number);
}

export function samePublicationPulls(first, second) {
  return first !== null && second !== null && JSON.stringify(first) === JSON.stringify(second);
}
