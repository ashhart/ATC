import { ensure } from './failure.js';
import { isArea, isLogin, isNumber } from './values.js';

const kindText = {
  split: values => `split this issue and take ${areaList(values.areas)}`,
  pair: () => 'work on this issue together',
  takeover: () => 'take over this issue',
  review: () => 'review the work on this issue'
};

const templates = {
  claimed: values => `ATC: ${name(values.login)} claimed this issue (${scope(values.areas)}).${overlapText(values.overlaps)}`,
  claimUpdated: values => `ATC: ${name(values.login)} updated their claim (${scope(values.areas)}).`,
  claimTaken: values => `ATC: this issue is already claimed by ${list(values.claimants, name)}. To share it, comment \`/atc propose pair\`, \`/atc propose split <areas>\`, \`/atc propose takeover\` or \`/atc propose review\`.`,
  claimLimit: values => `ATC: ${name(values.login)} already holds ${number(values.limit)} claims, the most this project allows. Release one with \`/atc release\` first.`,
  unknownArea: values => `ATC: unknown area. This project's areas are: ${areaList(values.areas) || 'none configured'}.`,
  notClaimable: () => 'ATC: only open issues can be claimed.',
  released: values => `ATC: ${name(values.login)} released their claim.`,
  reset: () => 'ATC: a maintainer cleared the claims and proposals on this issue.',
  expired: values => `ATC: ${mention(values.login)}, your claim was released after ${number(values.days)} days without activity.`,
  proposed: values => `ATC: ${list(values.claimants, mention)}, ${name(values.from)} proposes to ${kind(values)}. Reply \`/atc accept ${number(values.id)}\` or \`/atc decline ${number(values.id)}\`.`,
  accepted: values => `ATC: ${mention(values.from)}, proposal ${number(values.id)} (${kindName(values.kind)}) was accepted.`,
  declined: values => `ATC: ${mention(values.from)}, proposal ${number(values.id)} was declined.`,
  pullOverlap: values => `ATC: ${list(values.logins, mention)}, pull requests #${number(values.prs[0])} and #${number(values.prs[1])} change ${number(values.files)} of the same files (${scope(values.areas)}). Agree how to share the work on the linked issues with \`/atc propose pair\` or \`/atc propose split <areas>\`.`
};

export function renderMessage(template, values) {
  ensure(Object.hasOwn(templates, template), 'Unknown ATC message');
  return templates[template](values);
}

function kind(values) {
  return kindText[kindName(values.kind)](values);
}

function kindName(value) {
  check(Object.hasOwn(kindText, value));
  return value;
}

function name(value) {
  check(isLogin(value));
  return `\`${value}\``;
}

function mention(value) {
  check(isLogin(value));
  return `@${value}`;
}

function number(value) {
  check(isNumber(value));
  return String(value);
}

function list(values, render) {
  check(Array.isArray(values) && values.length > 0 && values.length <= 10);
  return values.map(render).join(', ');
}

function areaList(values) {
  check(Array.isArray(values) && values.length <= 24 && values.every(isArea));
  return values.join(', ');
}

function scope(values) {
  check(Array.isArray(values));
  return values.length ? `areas: ${areaList(values)}` : 'whole issue';
}

function overlapText(overlaps) {
  if (!overlaps || overlaps.length === 0) return '';
  check(overlaps.length <= 5);
  const parts = overlaps.map(overlap => `#${number(overlap.issue)} (${name(overlap.login)}) also covers ${areaList(overlap.areas)}`);
  return ` Heads up: ${parts.join('; ')}.`;
}

function check(condition) {
  ensure(condition, 'Invalid ATC message value');
}
