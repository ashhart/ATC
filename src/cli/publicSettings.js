import fs from 'node:fs';
import { isId } from '../core/values.js';
import { isPublicOrigin } from './presencePolicy.js';

const tokenPattern = /^[a-f0-9]{64}$/;

export function readSettings(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || Object.keys(value).length !== 5 || !isPublicOrigin(value.origin) || !isId(value.comment)
      || !Number.isSafeInteger(value.issue) || value.issue < 1 || value.issue > 999999999
      || typeof value.token !== 'string' || value.token.length !== 64 || !tokenPattern.test(value.token) || !['anonymous', 'github'].includes(value.display)) return null;
    return { origin: value.origin, issue: value.issue, token: value.token, comment: value.comment, display: value.display };
  } catch { return null; }
}
