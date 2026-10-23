import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensure } from '../core/failure.js';
import { isId } from '../core/values.js';
import { readConfig } from '../core/config.js';
import { createReader } from './reader.js';
import { isPublicOrigin, presencePolicy } from './presencePolicy.js';
import { proofText, removeProof } from './presenceProof.js';
import { readSettings } from './publicSettings.js';
import { sweepProofs } from './presenceSweep.js';
export { isPublicOrigin } from './presencePolicy.js';

const failure = 'Invalid public presence settings.';

export async function publishPresence(result, { command, flags, gh, git, fetcher = fetch, repository, now = Date.now }) {
  if (flags.public !== undefined) ensure(isPublicOrigin(flags.public), failure);
  if (!['checkedIn', 'landed'].includes(result.outcome) || flags.local) return result;
  const folder = path.join(git.commonDir(), 'atc');
  const file = path.join(folder, `public-${result.session}.json`);
  let settings = readSettings(file);
  const policy = command === 'start' ? presencePolicy(git) : null;
  if (!settings && flags.public === undefined && !policy) {
    ensure(!flags.githubName, 'No public board is configured. Use --public.');
    return result;
  }
  try {
    if (command === 'start') {
      const selected = repository();
      if (flags.public === undefined && policy?.repository !== selected.toLowerCase()) return result;
      ensure(gh.get(`repos/${selected}`)?.private === false, failure);
      ensure(readConfig(createReader(gh, selected).config()).enabled, failure);
      const issue = createReader(gh, selected).issue(result.issue);
      ensure(issue?.state === 'open' && !issue.pull_request, failure);
      const token = randomBytes(32).toString('hex');
      const comment = gh.post(`repos/${selected}/issues/${result.issue}/comments`, { body: proofText(token) });
      ensure(isId(comment?.id), failure);
      settings = { origin: flags.public || policy.origin, issue: result.issue, token, comment: comment.id,
        display: flags.githubName ? 'github' : 'anonymous' };
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
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
    if (command === 'land') {
      fs.unlinkSync(file);
      removeProof(gh, repository(), settings);
    }
    if (command === 'start') sweepProofs({ gh, git, now, repository: repository(), keep: result.session });
    return { ...result, ...(command === 'start' ? { posted: true, comment: settings.comment } : {}), publication: 'public' };
  } catch { return { ...result, ...(command === 'start' && settings ? { posted: true, comment: settings.comment } : {}), publication: 'unavailable' }; }
}
