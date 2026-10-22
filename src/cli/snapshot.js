import { commandText } from '../core/commands.js';
import { areaReference, readConfig } from '../core/config.js';
import { readEvents } from '../core/events.js';
import { ensure } from '../core/failure.js';
import { readPulls } from '../core/pulls.js';
import { replay } from '../core/replay.js';
import { isId } from '../core/values.js';
import { previewOutcome } from './preflight.js';
import { UncertainWrite } from './gh.js';
import { readIssueHistory, readOpenHistory } from './history.js';

export function takeSnapshot(context) {
  const config = readConfig(context.reader.config());
  const now = context.now();
  const history = readOpenHistory(context);
  const fetchedPulls = context.reader.openPulls();
  const pulls = readPulls(fetchedPulls.items);
  const openNumbers = new Set(history.issues.map(issue => issue.number));
  const events = readEvents(history.comments, context.repository, config).filter(event => !event.onPull && openNumbers.has(event.issue));
  const closed = new Set();
  const state = replay(events, { closed, pulls }, config, now);
  const limitations = [...new Set([history.commentsPartial && 'commentsLimit', history.inconsistent && 'inconsistentComments',
    history.issuesPartial && 'openIssuesLimit', !config.areasPinned && 'configurationUnpinned', (history.timed || fetchedPulls.timed) && 'timeLimit',
    fetchedPulls.partial && !fetchedPulls.timed && 'pullRequestsLimit', pulls.length !== fetchedPulls.items.length && 'invalidPulls'])]
    .filter(Boolean).sort();
  return { config, pulls, state, partial: limitations.length > 0, limitations, now, events, closed, openIssues: history.issues };
}

function observeIssue(context, issue) {
  const history = readIssueHistory(context, issue);
  if (!history.open || !history.complete) return null;
  const { config, events, pulls } = context.snapshot;
  const fresh = readEvents(history.comments, context.repository, config).filter(event => !event.onPull && event.issue === issue);
  const combined = [...events.filter(event => event.issue !== issue), ...fresh].sort((first, second) => first.id - second.id);
  return { state: replay(combined, { closed: new Set(), pulls }, config, context.now()), evidence: JSON.stringify(fresh) };
}

export function commentBody(command, mentions = [], signature) {
  ensure(Array.isArray(mentions) && mentions.length === 0 && !signature, 'Comments contain commands only.');
  return commandText(command);
}

export async function postAndConfirm(context, issue, command) {
  const encoded = command.areas ? { ...command, areas: command.areas.map(area => String(areaReference(context.snapshot.config, area))) } : command;
  const body = commentBody(encoded);
  const preview = previewOutcome(context.snapshot, context.me, issue, command);
  const presence = command.session ? { session: command.session, ...(command.state ? { state: command.state } : {}) } : {};
  if (!['claimed', 'claimUpdated', 'renewed', 'released', 'proposed', 'accepted', 'declined', 'withdrawn', 'checkedIn', 'landed'].includes(preview)) {
    return { issue, command: command.verb, posted: false, outcome: preview };
  }
  if (context.dryRun) return { issue, command: command.verb, posted: false, outcome: 'dryRun',
    ...Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'verb')) };
  if (context.readOnly) return { issue, command: command.verb, posted: false, outcome: 'readOnly', ...presence };
  let created;
  try { created = context.gh.post(`repos/${context.repository}/issues/${issue}/comments`, { body }); }
  catch (error) {
    if (!(error instanceof UncertainWrite)) throw error;
    return { issue, command: command.verb, posted: null, outcome: 'uncertain', ...presence };
  }
  if (!isId(created?.id)) return { issue, command: command.verb, posted: null, outcome: 'uncertain', ...presence };
  const reply = { issue, command: command.verb, posted: true, comment: created.id, outcome: 'pending', ...presence };
  let previous = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await context.sleep(attempt === 0 ? 1500 : 3000);
    let observed;
    try { observed = observeIssue(context, issue); } catch { return reply; }
    if (!observed) return reply;
    const outcome = observed.state.outcomes.get(created.id);
    const current = outcome ? `${outcome}:${observed.evidence}` : null;
    if (current && current === previous) return { ...reply, outcome };
    previous = current;
  }
  return reply;
}
