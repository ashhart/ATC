import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ensure } from '../core/failure.js';
import { isId } from '../core/values.js';
import { readConfig } from '../core/config.js';
import { createReader } from './reader.js';

const failure = 'Invalid public presence settings.';
const tokenPattern = /^[a-f0-9]{64}$/;

export async function publishPresence(result, { command, flags, gh, git, fetcher = fetch, repository }) {
  if (flags.public !== undefined) ensure(isPublicOrigin(flags.public), failure);
  if (!['checkedIn', 'landed'].includes(result.outcome)) return result;
  const folder = path.join(git.commonDir(), 'atc');
  const file = path.join(folder, `public-${result.session}.json`);
  let settings = readSettings(file);
  if (!settings && flags.public === undefined) return result;
  try {
    if (command === 'start') {
      const selected = repository();
      ensure(readConfig(createReader(gh, selected).config()).enabled, failure);
      const issue = createReader(gh, selected).issue(result.issue);
      ensure(issue?.state === 'open' && !issue.pull_request, failure);
      const token = randomBytes(32).toString('hex');
      const proof = createHash('sha256').update(token).digest('hex');
      const comment = gh.post(`repos/${selected}/issues/${result.issue}/comments`, { body: `/atc presence ${proof}` });
      ensure(isId(comment?.id), failure);
      settings = { origin: flags.public, issue: result.issue, token, comment: comment.id,
        display: flags.githubName ? 'github' : 'anonymous' };
      ensure(!fs.lstatSync(folder).isSymbolicLink(), failure);
      fs.writeFileSync(file, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
    }
    ensure(settings && settings.issue === result.issue, failure);
    const response = await fetcher(`${settings.origin}/api/atc/v1/presence`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ issue: result.issue, token: settings.token, comment: settings.comment,
        display: settings.display, state: command === 'land' ? 'landed' : result.state }) });
    await response.body?.cancel();
    ensure(response.status === 200, failure);
    if (command === 'land') fs.unlinkSync(file);
    return { ...result, ...(command === 'start' ? { posted: true, comment: settings.comment } : {}), publication: 'public' };
  } catch { return { ...result, ...(command === 'start' && settings ? { posted: true, comment: settings.comment } : {}), publication: 'unavailable' }; }
}

export function isPublicOrigin(value) {
  return typeof value === 'string' && value.length <= 253
    && !/\s/.test(value)
    && /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value);
}

function readSettings(file) {
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
