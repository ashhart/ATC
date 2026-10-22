import fs from 'node:fs';
import path from 'node:path';

export function canonicalFolder(folder) {
  const resolved = path.resolve(folder);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

export function canonicalFile(file) {
  const resolved = path.resolve(file);
  return path.join(canonicalFolder(path.dirname(resolved)), path.basename(resolved));
}
