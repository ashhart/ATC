import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensure } from '../core/failure.js';
import { isRepository } from '../core/values.js';
import { isFilePath } from './reader.js';
import { areasForPath } from '../core/config.js';

const failure = 'Planned files must be inside this worktree.';

export function plannedPath(root, value) {
  ensure(typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value), failure);
  ensure(!value.split(/[\\/]/).includes('..'), failure);
  const full = path.resolve(root, value);
  const relative = path.relative(root, full).split(path.sep).join('/');
  ensure(isFilePath(relative) && !relative.split('/').includes('.git'), failure);
  let ancestor = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    ancestor = path.join(ancestor, parts[index]);
    let stat;
    try { stat = fs.lstatSync(ancestor); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    ensure(!stat.isSymbolicLink() && (index < parts.length - 1 ? stat.isDirectory() : stat.isFile() && stat.nlink === 1), failure);
  }
  return relative;
}

export function fileFingerprint(repository, file) {
  ensure(isRepository(repository) && isFilePath(file), failure);
  return createHash('sha256').update(`atc-plan-v1\0${repository.toLowerCase()}\0${file}`).digest('hex').slice(0, 32);
}

export function planFiles(repository, root, files) {
  ensure(Array.isArray(files) && files.length >= 1 && files.length <= 32, 'Plan between 1 and 32 distinct files.');
  const hashes = files.map(file => fileFingerprint(repository, plannedPath(root, file))).sort();
  ensure(new Set(hashes).size === hashes.length, 'Plan between 1 and 32 distinct files.');
  return hashes;
}

export function insideClaim(config, claim, files) {
  if (!claim?.areas.length) return true;
  return files.every(file => {
    const areas = areasForPath(config, file);
    return areas.length > 0 && areas.every(area => claim.areas.includes(area));
  });
}

export function planSelector(config, ref) {
  const areas = Object.keys(config.areas).sort().map(name => [name, config.areaIds[name] ?? null, [...config.areas[name]].sort()]);
  const policy = { ref, areas, enabled: config.enabled, pinned: config.areasPinned, idleDays: config.idleDays };
  return createHash('sha256').update(`atc-plan-selector-v1\0${JSON.stringify(policy)}`).digest('hex').slice(0, 32);
}
