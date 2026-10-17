import { ensure } from './failure.js';
import { isArea, isRecord } from './values.js';

const prefixPattern = /^[A-Za-z0-9_.-][A-Za-z0-9_./-]{0,199}$/;
const limits = {
  maxClaimsPerUser: [3, 1, 20],
  maxPendingProposalsPerUser: [5, 1, 20],
  idleDays: [7, 1, 90],
  proposalDays: [7, 1, 30],
  windowDays: [30, 7, 90]
};

export function readConfig(value) {
  const config = { areas: {} };
  for (const [key, [fallback]] of Object.entries(limits)) config[key] = fallback;
  if (value === null || value === undefined) return config;
  check(isRecord(value) && Object.keys(value).every(key => key === 'areas' || Object.hasOwn(limits, key)));
  if (Object.hasOwn(value, 'areas')) config.areas = readAreas(value.areas);
  for (const [key, [, low, high]] of Object.entries(limits)) {
    if (!Object.hasOwn(value, key)) continue;
    check(Number.isSafeInteger(value[key]) && value[key] >= low && value[key] <= high);
    config[key] = value[key];
  }
  return config;
}

export function areasForPath(config, filePath) {
  return Object.keys(config.areas).filter(area => config.areas[area].some(prefix =>
    prefix.endsWith('/') ? filePath.startsWith(prefix) : filePath === prefix || filePath.startsWith(`${prefix}/`)
  ));
}

function readAreas(value) {
  check(isRecord(value) && Object.keys(value).length <= 24);
  const areas = {};
  for (const [area, prefixes] of Object.entries(value)) {
    check(isArea(area) && Array.isArray(prefixes) && prefixes.length >= 1 && prefixes.length <= 20 && prefixes.every(isSafePrefix));
    areas[area] = [...prefixes];
  }
  return areas;
}

function isSafePrefix(prefix) {
  return typeof prefix === 'string' && prefixPattern.test(prefix) && !prefix.includes('//')
    && !prefix.split('/').some(part => part === '.' || part === '..');
}

function check(condition) {
  ensure(condition, 'Invalid .github/atc.json');
}
