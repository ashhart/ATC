import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { requireValue } from './values.js';

export function requireOutsideCheckout(folder) {
  requireValue(typeof folder === 'string' && path.isAbsolute(folder), 'storage', 503);
  let current = path.resolve(folder);
  requireValue(current !== path.parse(current).root, 'storage', 503);
  if (fs.existsSync(current)) {
    requireValue(fs.lstatSync(current).isDirectory() && !fs.lstatSync(current).isSymbolicLink(), 'storage', 503);
    requireValue(fs.readdirSync(current).every(name => ['evidence', 'state.json', 'lock'].includes(name)
      || /^state\.json\.[a-f0-9]{16}\.tmp$/.test(name)), 'storage', 503);
  }
  while (true) {
    requireValue(path.basename(current) !== '.git' && !fs.existsSync(path.join(current, '.git')), 'storage', 503);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function privateDirectory(folder) {
  requireValue(typeof folder === 'string' && path.isAbsolute(folder) && folder.length <= 4096
    && !/[\u0000-\u001f\u007f]/.test(folder), 'storage', 503);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(folder);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'storage', 503);
  if (process.platform !== 'win32') fs.chmodSync(folder, 0o700);
}

export function readPrivate(file, maximum) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    requireValue(stat.isFile() && stat.size <= maximum && !fs.lstatSync(file).isSymbolicLink(), 'storage', 503);
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    requireValue(length === stat.size, 'storage', 503);
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}

export function atomicWrite(file, bytes) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}
