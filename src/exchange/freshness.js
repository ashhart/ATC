import { isHead } from './values.js';

export const freshnessKinds = ['current', 'headChanged', 'baseChanged', 'unknownBase'];

export function receiptFreshness(record, current) {
  if (record.head !== current.head) return 'headChanged';
  if (!isHead(record.base) || !isHead(current.base)) return 'unknownBase';
  return record.base === current.base ? 'current' : 'baseChanged';
}
