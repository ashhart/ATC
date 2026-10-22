import { ensure } from './failure.js';
import { isArea, isRecord } from './values.js';

export { areaEntries, areaName, areaReference } from './areas.js';

const prefixPattern = /^[A-Za-z0-9_.-][A-Za-z0-9_./-]{0,199}$/;
const limits = {
  maxClaimsPerUser: [3, 1, 20],
  maxPendingProposalsPerUser: [5, 1, 20],
  idleDays: [7, 1, 90],
  proposalDays: [7, 1, 30]
};

export function readConfig(value) {
  const config = { areas: {}, areaIds: {}, areasPinned: true, enabled: false };
  for (const [key, [fallback]] of Object.entries(limits)) config[key] = fallback;
  if (value === null || value === undefined) return config;
  check(isRecord(value) && Object.keys(value).every(key => ['areas', 'areaIds'].includes(key) || Object.hasOwn(limits, key)));
  config.enabled = true;
  if (Object.hasOwn(value, 'areas')) config.areas = readAreas(value.areas);
  config.areasPinned = Object.keys(config.areas).length === 0;
  if (Object.hasOwn(value, 'areaIds')) {
    config.areaIds = readAreaIds(value.areaIds, config.areas);
    config.areasPinned = true;
  }
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
  return typeof prefix === 'string' && !/[\r\n]/.test(prefix) && prefixPattern.test(prefix) && !prefix.includes('//')
    && !prefix.split('/').some(part => part === '.' || part === '..');
}

function readAreaIds(value, areas) {
  const names = Object.keys(areas);
  check(isRecord(value) && Object.keys(value).length === names.length);
  check(names.every(name => Object.hasOwn(value, name) && Number.isSafeInteger(value[name]) && value[name] >= 1 && value[name] <= 24));
  check(new Set(Object.values(value)).size === names.length);
  return Object.fromEntries(names.map(name => [name, value[name]]));
}

function check(condition) {
  ensure(condition, 'Invalid .github/atc.json');
}
