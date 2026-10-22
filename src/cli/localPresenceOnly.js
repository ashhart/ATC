import fs from 'node:fs';
import path from 'node:path';
import { ensure } from '../core/failure.js';
const message = 'Could not save local presence settings.';
function file(git, session) {
  ensure(Number.isSafeInteger(session) && session > 0 && session <= 999999999999999, message);
  return path.join(git.commonDir(), 'atc', `local-${session}.json`);
}
export function markLocalOnly(git, session) {
  const target = file(git, session), folder = path.dirname(target);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  ensure(!fs.lstatSync(folder).isSymbolicLink(), message);
  fs.writeFileSync(target, JSON.stringify({ version: 1, session }), { flag: 'wx', mode: 0o600 });
}
export function isLocalOnly(git, session) {
  try { fs.lstatSync(file(git, session)); return true; }
  catch (error) { return error?.code !== 'ENOENT'; }
}
export function clearLocalOnly(git, session) {
  try { fs.unlinkSync(file(git, session)); } catch {}
}
