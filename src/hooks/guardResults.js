import { isNumberIn, isRecord } from './hookValues.js';

const outcomes = ['ready', 'noTicket', 'incomplete', 'scopeTaken', 'claimRequired', 'notEnabled', 'planExpired',
  'scopeChanged', 'baseChanged', 'notInScope', 'readOnly', 'pending', 'notOpen', 'uncertain', 'claimLimit',
  'planLimit', 'prerequisitesUnavailable', 'dryRun', 'mergeConflicts'];
const fields = ['command', 'issue', 'complete', 'outcome', 'ready', 'session', 'plan', 'base', 'files', 'conflicts'];
const nullableNumber = (value, maximum) => value === null || isNumberIn(value, 1, maximum);
const isSha = value => typeof value === 'string' && !/[\r\n]/.test(value) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

export function readGuardResult(value) {
  if (!isRecord(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))
    || value.command !== 'guard' || typeof value.complete !== 'boolean' || typeof value.ready !== 'boolean'
    || !outcomes.includes(value.outcome) || !nullableNumber(value.issue, 999999999)
    || !nullableNumber(value.session, 999999999999999) || !nullableNumber(value.plan, Number.MAX_SAFE_INTEGER)
    || value.base !== null && !isSha(value.base) || !isNumberIn(value.files, 0, 32)
    || !Array.isArray(value.conflicts) || value.conflicts.length > 1000 || !value.conflicts.every(validConflict)) return null;
  if (value.ready !== ['ready', 'noTicket'].includes(value.outcome) || value.ready && !value.complete) return null;
  if (value.outcome === 'noTicket' && (value.issue !== null || value.session !== null || value.plan !== null
    || value.base !== null || value.files !== 0 || value.conflicts.length !== 0)) return null;
  if (value.outcome === 'ready' && (value.issue === null || value.session === null || value.plan === null
    || value.base === null || value.files < 1 || value.conflicts.length !== 0)) return null;
  return { complete: value.complete, ready: value.ready, outcome: value.outcome };
}

function validConflict(value) {
  return isRecord(value) && Object.keys(value).length === 4
    && isNumberIn(value.issue, 1, 999999999) && isNumberIn(value.plan, 1, Number.MAX_SAFE_INTEGER)
    && isNumberIn(value.session, 1, 999999999999999) && isNumberIn(value.sharedFiles, 1, 32);
}
