const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const botLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,33}\[bot\]$/;
const areaPattern = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,23}$/;
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9_.-]{1,100}$/;

export function isLogin(value) {
  return typeof value === 'string' && loginPattern.test(value);
}

export function isBotLogin(value) {
  return typeof value === 'string' && botLoginPattern.test(value);
}

export function isArea(value) {
  return typeof value === 'string' && areaPattern.test(value);
}

export function isRepository(value) {
  return typeof value === 'string' && repositoryPattern.test(value) && !/\/\.+$/.test(value);
}

export function isNumber(value) {
  return Number.isSafeInteger(value) && value > 0 && value < 1000000000;
}

export function isId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
