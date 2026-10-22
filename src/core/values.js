const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const areaPattern = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,23}$/;
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const idPattern = /^[1-9][0-9]{0,15}$/;
const timestampPattern = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const cursorPattern = /^[A-Za-z0-9+/=_-]{1,200}$/;

export function isLogin(value) {
  return matches(value, loginPattern);
}

export function isActorLogin(value) {
  return isLogin(value) || typeof value === 'string' && value.endsWith('[bot]') && isLogin(value.slice(0, -5));
}

export function isArea(value) {
  return matches(value, areaPattern);
}

export function isRepository(value) {
  return matches(value, repositoryPattern) && !/\/\.+$/.test(value);
}

export function isNumber(value) {
  return Number.isSafeInteger(value) && value > 0 && value < 1000000000;
}

export function isId(value) {
  return Number.isSafeInteger(value) && idPattern.test(String(value));
}

export function isCursor(value) {
  return matches(value, cursorPattern);
}

export function readTimestamp(value) {
  if (typeof value !== 'string' || !timestampPattern.test(value)) return null;
  const at = Date.parse(value);
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  return Number.isSafeInteger(at) && new Date(at).toISOString() === canonical ? at : null;
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matches(value, pattern) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && pattern.test(value);
}
