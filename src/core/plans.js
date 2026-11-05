import { isId, isNumber } from './values.js';

export const planTtlMs = 3600000;
export const isPlanHash = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) && value.length === 32;
export const isCommit = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) && [40, 64].includes(value.length);
export const isPlanSession = value => isId(value) && value <= 999999999999999;

export function applyPlan(state, event, open) {
  const { command, issue, login, id, at } = event;
  if (!open) return 'notClaimable';
  if (!isNumber(issue) || !isId(id) || !Number.isSafeInteger(at) || !isPlanSession(command.session) || !isCommit(command.base) || !isPlanHash(command.selector)
    || !Array.isArray(command.files) || command.files.length > 32 || !command.files.every(isPlanHash)
    || new Set(command.files).size !== command.files.length) return 'invalid';
  const holder = state.claims.find(claim => claim.issue === issue && claim.login === login && claim.role === 'work');
  if (!holder) return 'claimRequired';
  const others = state.plans.filter(plan => plan.login !== login || plan.session !== command.session);
  if (others.some(plan => plan.files.some(hash => command.files.includes(hash)))) return 'scopeTaken';
  if (others.length >= 1000) return 'planLimit';
  state.plans = others;
  if (command.files.length === 0) return 'planCleared';
  state.plans.push({ id, issue, login, session: command.session, base: command.base, selector: command.selector, files: [...command.files].sort(),
    areas: [...holder.areas].sort(), at, expiresAt: at + planTtlMs });
  return 'planned';
}

export function expirePlans(state, now) {
  state.plans = state.plans.filter(plan => plan.expiresAt > now && state.claims.some(claim => claim.issue === plan.issue
    && claim.login === plan.login && claim.role === 'work' && JSON.stringify([...claim.areas].sort()) === JSON.stringify(plan.areas)));
}

export function planConflicts(plans, { login, session, files }) {
  return plans.filter(plan => plan.login !== login || plan.session !== session)
    .map(plan => ({ issue: plan.issue, plan: plan.id, session: plan.session, sharedFiles: plan.files.filter(hash => files.includes(hash)).length }))
    .filter(row => row.sharedFiles > 0).sort((a, b) => a.plan - b.plan);
}
