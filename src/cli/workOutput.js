import { ensure } from '../core/failure.js';
import { isId, isNumber } from '../core/values.js';
import { isCommit, isPlanSession } from '../core/plans.js';

export const workOutcomes = ['ready', 'noTicket', 'incomplete', 'scopeTaken', 'claimRequired', 'notEnabled', 'planExpired',
  'scopeChanged', 'baseChanged', 'notInScope', 'readOnly', 'pending', 'notOpen', 'uncertain', 'claimLimit', 'planLimit', 'prerequisitesUnavailable', 'dryRun', 'mergeConflicts'];
const nullable = (value, check) => value === null || check(value);

export function workResult(command, values = {}) {
  const complete = !['incomplete', 'pending', 'uncertain', 'prerequisitesUnavailable'].includes(values.outcome);
  return validateWorkResult({ command, issue: null, complete, outcome: 'ready', ready: true,
    session: null, plan: null, base: null, files: 0, conflicts: [], ...values });
}

export function validateWorkResult(value) {
  const keys = ['command', 'issue', 'complete', 'outcome', 'ready', 'session', 'plan', 'base', 'files', 'conflicts'];
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)) && ['begin', 'plan', 'guard'].includes(value.command)
    && nullable(value.issue, isNumber) && typeof value.complete === 'boolean' && workOutcomes.includes(value.outcome)
    && typeof value.ready === 'boolean' && nullable(value.session, isPlanSession) && nullable(value.plan, isId)
    && nullable(value.base, isCommit) && Number.isInteger(value.files) && value.files >= 0 && value.files <= 32
    && Array.isArray(value.conflicts) && value.conflicts.length <= 1000 && value.conflicts.every(row => row
      && Object.keys(row).length === 4 && isNumber(row.issue) && isId(row.plan) && isPlanSession(row.session)
      && Number.isInteger(row.sharedFiles) && row.sharedFiles >= 1 && row.sharedFiles <= 32)
    && value.ready === ['ready', 'noTicket'].includes(value.outcome)
    && (value.complete || !value.ready), 'Invalid ATC workflow output.');
  if (value.outcome === 'ready') ensure(value.issue !== null && value.session !== null && value.plan !== null
    && value.base !== null && value.files >= 1 && value.conflicts.length === 0, 'Invalid ATC workflow output.');
  if (value.outcome === 'noTicket') ensure(value.command === 'guard' && value.issue === null && value.session === null
    && value.plan === null && value.base === null && value.files === 0 && value.conflicts.length === 0, 'Invalid ATC workflow output.');
  return value;
}
