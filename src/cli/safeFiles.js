import fs from 'node:fs';
import { ensure } from '../core/failure.js';

export const unsafe = 'Cannot initialize ATC: repository paths must be regular files and directories without symlinks.';
export const failed = 'Cannot initialize ATC: local files could not be updated.';

export function inspectDirectory(folder) {
  try {
    const stat = fs.lstatSync(folder);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), unsafe);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function readFile(file, limit) {
  let descriptor;
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.size <= BigInt(limit), unsafe);
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    ensure(opened.ino === stat.ino && (process.platform === 'win32' || opened.dev === stat.dev) && opened.size <= BigInt(limit), unsafe);
    const content = fs.readFileSync(descriptor, 'utf8');
    ensure(Buffer.byteLength(content) <= limit, unsafe);
    return content;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function createDirectory(folder, created) {
  if (inspectDirectory(folder)) return;
  fs.mkdirSync(folder);
  created.push({ file: folder, directory: true });
}

export function createFile(file, content, created) {
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
  created.push({ file, directory: false });
  try { fs.writeFileSync(descriptor, content); } finally { fs.closeSync(descriptor); }
}

export function appendText(file, previous, addition) {
  const descriptor = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    ensure(stat.isFile() && stat.nlink === 1 && stat.size === Buffer.byteLength(previous), unsafe);
    const current = fs.readFileSync(descriptor, 'utf8');
    ensure(current === previous, unsafe);
    try {
      const written = fs.writeSync(descriptor, addition, Buffer.byteLength(previous), 'utf8');
      ensure(written === Buffer.byteLength(addition), failed);
    }
    catch (error) { fs.ftruncateSync(descriptor, Buffer.byteLength(previous)); throw error; }
  } finally { fs.closeSync(descriptor); }
}
