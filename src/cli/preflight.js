import { ensure } from '../core/failure.js';
import { replay } from '../core/replay.js';

export function previewOutcome(snapshot, login, issue, command) {
  const id = Math.max(0, ...snapshot.events.map(event => event.id)) + 1;
  ensure(Number.isSafeInteger(id), 'Could not preview the command');
  const event = { id, issue, command, login, onPull: false, maintainer: false, at: snapshot.now };
  return replay([...snapshot.events, event], { closed: snapshot.closed, pulls: snapshot.pulls }, snapshot.config, snapshot.now).outcomes.get(id);
}
