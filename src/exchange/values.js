import { createHash } from 'node:crypto';
import { isId, isNumber, isRecord, isRepository, readTimestamp } from '../core/values.js';
import { isPublicOrigin } from '../cli/presencePolicy.js';

export { isId, isNumber, isRepository };
export const maximumEvidence = 1024 * 1024;
export const kinds = ['review', 'build', 'test', 'benchmark', 'reproduce'];
export const statuses = ['pass', 'fail', 'blocked', 'inconclusive'];
export const evidenceKinds = ['log', 'trace', 'report'];
export const decisions = ['accepted', 'dismissed'];
export const isKey = value => matches(value, /^[a-f0-9]{32}$/);
export const isDigest = value => matches(value, /^[a-f0-9]{64}$/);
export const isHead = value => matches(value, /^[a-f0-9]{40}$/);
export const isTime = value => readTimestamp(value) !== null && value.length === 24;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const iso = now => new Date(now).toISOString();

export class ExchangeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function requireValue(condition, code = 'invalid', status = 400) {
  if (!condition) throw new ExchangeError(code, status);
}

export function exact(value, fields) {
  return isRecord(value) && Object.keys(value).length === Object.keys(fields).length
    && Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]));
}

export function isOrigin(value) {
  if (isPublicOrigin(value)) return true;
  const match = typeof value === 'string' && value.match(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/);
  return Boolean(match && match[0] === value && Number(match[1]) <= 65535);
}

export function proofFor(token, origin, repository, pull) {
  requireValue(isDigest(token) && isOrigin(origin) && isRepository(repository) && isNumber(pull));
  return digest(`atc-exchange-v1\n${origin}\n${repository.toLowerCase()}\n${pull}\n${token}`);
}

export const isPolicy = value => exact(value, { version: x => x === 1, origin: isOrigin,
  retentionHours: x => Number.isInteger(x) && x >= 1 && x <= 720 });
export const isSessionInput = value => exact(value, { pull: isNumber, comment: isId, token: isDigest });
export const isEvidenceIds = x => Array.isArray(x) && x.length <= 8 && x.every(isKey) && new Set(x).size === x.length;
export const isRequestInput = value => exact(value, { id: isKey, head: isHead, kind: x => kinds.includes(x), evidence: isEvidenceIds });
export const isResultInput = value => exact(value, { id: isKey, head: isHead, status: x => statuses.includes(x),
  evidence: isEvidenceIds });
export const isResolutionInput = value => exact(value, { result: isKey, decision: x => decisions.includes(x) });

function matches(value, pattern) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && pattern.test(value);
}
