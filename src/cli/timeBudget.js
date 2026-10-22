import { TimeLimit } from './ghTransport.js';

export function hasTime(gh, reserveMs) {
  return typeof gh?.timeLeft !== 'function' || gh.timeLeft() > reserveMs;
}

export function isTimeLimit(error) {
  return error instanceof TimeLimit;
}
