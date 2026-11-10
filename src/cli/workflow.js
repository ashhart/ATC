import { checkView } from '../core/view.js';
import { planConflicts } from '../core/plans.js';
import { isFilePath } from './reader.js';
import { planFiles, plannedPath, fileFingerprint, insideClaim, planSelector } from './workPaths.js';
import { workBase } from './workBase.js';
import { readWorkTicket, writeWorkTicket, ticketLocation } from './workTicket.js';
import { workResult } from './workOutput.js';
import { postAndConfirm, takeSnapshot } from './snapshot.js';
import { reportPresence } from './presenceCommand.js';
import { claimPresence } from './claimPresence.js';
import { shareResult } from './presenceShare.js';
import { publishPresence } from './publicPresence.js';
import { issueArg } from './args.js';
import { inspectPublication } from './publication.js';
import { publicationGit } from './publicationGit.js';
import { hasTime } from './timeBudget.js';

export async function beginWork(command, rest, flags, context, { claim, fetcher = fetch }) {
  const issue = issueArg(rest[0]);
  const fail = (outcome, values = {}) => workResult(command, { issue, outcome, ready: false, ...values });
  if (!context.snapshot.config.enabled) return fail('notEnabled');
  if (context.snapshot.partial) return fail('incomplete', { complete: false });
  if (context.readOnly) return fail('readOnly');
  const { root } = ticketLocation(context.git);
  const files = planFiles(context.repository, root, rest.slice(1));
  const base = workBase(context, flags.base ?? null, { fetchMissing: true });
  const previous = readWorkTicket(context.git);
  const details = context.reader.issue(issue);
  const view = checkView(context.snapshot, { me: context.me, repository: context.repository, issue, areas: [], details });
  if (!view.open) return fail('notOpen');
  const holder = context.snapshot.state.claims.find(row => row.issue === issue && row.login === context.me && row.role === 'work');
  const owned = Boolean(holder);
  if (!insideClaim(context.snapshot.config, holder, rest.slice(1).map(file => plannedPath(root, file)))) return fail('notInScope');
  if (command === 'plan' && !owned) return fail('claimRequired');
  if (!['free', 'yours'].includes(view.advice)) return fail('claimRequired');
  let session = previous?.repository.toLowerCase() === context.repository.toLowerCase() && previous.issue === issue ? previous.session : null;
  const conflicts = planConflicts(context.snapshot.state.plans, { login: context.me, session, files });
  if (conflicts.length > 0) return fail('scopeTaken', { conflicts, base, files: files.length });
  if (context.dryRun) return workResult(command, { issue, outcome: 'dryRun', ready: false, files: files.length, base });
  if (!owned) {
    const result = await claim(context, context.snapshot, view, []);
    if (!['claimed', 'claimUpdated'].includes(result.outcome)) return fail(['incomplete', 'readOnly', 'claimLimit', 'pending', 'uncertain'].includes(result.outcome) ? result.outcome : 'claimRequired');
    const published = await claimPresence(result, { ...context, flags, repository: () => context.repository, fetcher });
    session = published.session ?? null;
  }
  if (session === null) {
    const local = reportPresence('start', { issue }, { git: context.git, now: context.now, localOnly: flags.local });
    const shared = shareResult(local, { ...context, repository: () => context.repository });
    const presence = await publishPresence(shared, { ...context, flags, command: 'start', repository: () => context.repository, fetcher });
    if (presence.outcome !== 'checkedIn') return fail('prerequisitesUnavailable');
    session = presence.session;
  }
  const selector = planSelector(context.snapshot.config, flags.base ?? null);
  const posted = await postAndConfirm(context, issue, { verb: 'plan', session, base, selector, files });
  if (posted.outcome !== 'planned') return fail(['scopeTaken', 'planLimit', 'pending', 'uncertain'].includes(posted.outcome) ? posted.outcome : 'claimRequired',
    { session, base, files: files.length });
  const confirmed = context.snapshot.state.plans.find(row => row.id === posted.comment && row.login === context.me && row.session === session);
  if (!confirmed) return fail('pending', { session });
  if (confirmed.base !== base || confirmed.selector !== selector) return fail('scopeChanged', { session });
  writeWorkTicket(context.git, { version: 1, repository: context.repository.toLowerCase(), issue, session, plan: confirmed.id, base,
    ref: flags.base ?? null, files, observedAt: new Date(context.now()).toISOString(), expiresAt: new Date(confirmed.expiresAt).toISOString() });
  const snapshot = takeSnapshot(context);
  if (snapshot.partial) return fail('incomplete', { complete: false, session });
  const plan = snapshot.state.plans.find(row => row.id === posted.comment && row.login === context.me && row.session === session);
  if (!plan) return fail('pending', { session });
  if (plan.selector !== planSelector(snapshot.config, flags.base ?? null)) return fail('scopeChanged', { session });
  if (workBase(context, flags.base ?? null) !== base) return fail('baseChanged', { session, base });
  return workResult(command, { issue, session, plan: plan.id, base, files: files.length });
}

export function guardWork(rest, flags, context, ticket) {
  const values = { issue: ticket.issue, session: ticket.session, plan: ticket.plan, base: ticket.base, files: ticket.files.length };
  const fail = (outcome, extra = {}) => workResult('guard', { ...values, outcome, ready: false, ...extra });
  if (ticket.repository.toLowerCase() !== context.repository.toLowerCase()) return fail('claimRequired');
  if (!context.snapshot.config.enabled) return fail('notEnabled');
  if (context.snapshot.partial) return fail('incomplete', { complete: false });
  if (Date.parse(ticket.expiresAt) <= context.now()) return fail('planExpired');
  if (!context.snapshot.state.claims.some(row => row.issue === ticket.issue && row.login === context.me && row.role === 'work')
    && !context.snapshot.pulls.some(pull => pull.author === context.me && pull.issues.includes(ticket.issue))) return fail('claimRequired');
  const plan = context.snapshot.state.plans.find(row => row.id === ticket.plan && row.login === context.me && row.session === ticket.session);
  if (!plan || plan.base !== ticket.base || plan.selector !== planSelector(context.snapshot.config, ticket.ref)
    || JSON.stringify(plan.files) !== JSON.stringify(ticket.files)) return fail('scopeChanged');
  if (workBase(context, ticket.ref) !== ticket.base) return fail('baseChanged');
  const { root } = ticketLocation(context.git);
  const holder = context.snapshot.state.claims.find(row => row.issue === ticket.issue && row.login === context.me && row.role === 'work');
  if (rest.length && !insideClaim(context.snapshot.config, holder, [plannedPath(root, rest[0])])) return fail('notInScope');
  if (rest.length && !ticket.files.includes(fileFingerprint(context.repository, plannedPath(root, rest[0])))) return fail('notInScope');
  const changed = context.git.changedFiles(ticket.base);
  if (!(changed instanceof Set) || [...changed].some(file => !isFilePath(file))) return fail('incomplete', { complete: false });
  if (!insideClaim(context.snapshot.config, holder, [...changed])) return fail('notInScope');
  if ([...changed].some(file => !ticket.files.includes(fileFingerprint(context.repository, file)))) return fail('notInScope');
  const conflicts = planConflicts(context.snapshot.state.plans, { login: context.me, session: ticket.session, files: ticket.files });
  if (conflicts.length) return fail('scopeTaken', { conflicts });
  if (flags.publish) {
    const overlap = inspectPublication(context, ticket.base, changed);
    if (overlap.conflict) return fail('mergeConflicts', { complete: overlap.complete });
    if (!overlap.complete) return fail('incomplete', { complete: false });
    try {
      const scoped = { ...context, git: publicationGit(context) };
      const after = scoped.git.changedFiles(ticket.base);
      if (!(after instanceof Set) || after.size !== changed.size || [...after].some(file => !changed.has(file))) {
        return fail('incomplete', { complete: false });
      }
      const currentBase = workBase(scoped, ticket.ref);
      if (!hasTime(context.gh, 0)) return fail('incomplete', { complete: false });
      if (currentBase !== ticket.base) return fail('baseChanged');
    } catch {
      return fail('incomplete', { complete: false });
    }
    const expired = Date.parse(ticket.expiresAt) <= context.now();
    if (!hasTime(context.gh, 0)) return fail('incomplete', { complete: false });
    if (expired) return fail('planExpired');
  }
  return workResult('guard', values);
}
