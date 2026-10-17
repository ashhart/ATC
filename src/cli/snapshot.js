import { commandText } from '../core/commands.js';
import { readConfig } from '../core/config.js';
import { readEvents } from '../core/events.js';
import { ensure } from '../core/failure.js';
import { readPulls } from '../core/pulls.js';
import { replay } from '../core/replay.js';
import { isId, isLogin } from '../core/values.js';

const signaturePattern = /^[^\u0000-\u001f\u007f@]{1,120}$/;

export function takeSnapshot(context) {
  const config = readConfig(context.reader.config());
  const since = new Date(context.now() - config.windowDays * 86400000).toISOString();
  const comments = context.reader.comments(since);
  const closed = context.reader.closedSince(since);
  const pulls = readPulls(context.reader.openPulls());
  const events = readEvents(comments.items, context.repository);
  const state = replay(events, { closed: closed.numbers, pulls }, config, context.now());
  return { config, pulls, state, partial: comments.partial || closed.partial };
}

export function commentBody(command, mentions, signature) {
  ensure(mentions.length <= 10 && mentions.every(isLogin), 'Invalid mention');
  const lines = [commandText(command)];
  if (mentions.length > 0) lines.push('', mentions.map(login => `@${login}`).join(' '));
  if (signature) {
    ensure(signaturePattern.test(signature), 'ATC_SIGNATURE must be one line of at most 120 characters, without @');
    lines.push('', signature);
  }
  return lines.join('\n');
}

export async function postAndConfirm(context, issue, command, mentions = []) {
  const body = commentBody(command, mentions, context.signature);
  const created = context.gh.post(`repos/${context.repository}/issues/${issue}/comments`, { body });
  ensure(isId(created?.id), 'GitHub did not return the new comment');
  const reply = { issue, command: command.verb, posted: true, comment: created.id, outcome: 'pending' };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await context.sleep(attempt === 0 ? 1500 : 3000);
    const outcome = takeSnapshot(context).state.outcomes.get(created.id);
    if (outcome) return { ...reply, outcome };
  }
  return reply;
}
