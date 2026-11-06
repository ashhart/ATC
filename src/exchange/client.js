import { collaborationCommands, collaborationWrites, runCollaborationClient } from './collaborationClient.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createGh } from '../cli/gh.js';
import { createGit } from '../cli/git.js';
import { createExchangeGithub } from './github.js';
import { createExchangeTransport } from './clientTransport.js';
import { clientSession } from './clientSession.js';
import { readPrivate } from './disk.js';
import { digest, isKey, isHead, maximumEvidence, requireValue } from './values.js';
import { renderInbox, upgradeLegacyInbox } from './inbox.js';
import { isInbox } from './output.js';

export async function runExchangeClient({ command, flags, rest }, { gh = createGh(), git = createGit(), fetcher = fetch,
  github, env = process.env } = {}) {
  if (command === 'id') return { id: randomBytes(16).toString('hex') };
  requireValue(env.ATC_READ_ONLY === undefined || ['0', '1'].includes(env.ATC_READ_ONLY));
  requireValue(!env.ATC_SIGNATURE);
  const writes = ['connect', 'request', 'respond', 'resolve', 'upload', ...collaborationWrites];
  requireValue(env.ATC_READ_ONLY !== '1' || !writes.includes(command), 'readOnly', 403);
  const repository = flags.repo;
  const origin = flags.origin;
  const pull = Number(rest[0]);
  const gateway = github || createExchangeGithub({ repository, origin, ghFactory: () => gh });
  await gateway.policy();
  const request = createExchangeTransport(origin, { fetcher });
  const sessions = clientSession({ git, repository, origin, pull });
  if (command === 'connect') {
    await gateway.pull(pull);
    return sessions.connect(gh, request);
  }
  const settings = sessions.read();
  requireValue(settings?.comment, 'unauthorized', 401);
  const token = settings.token;
  if (command === 'identity') {
    await request('GET', `/pulls/${pull}`, { token });
    return { type: 'collaboration', outcome: 'identity', pull, proof: settings.comment };
  }
  if (collaborationCommands.includes(command)) return runCollaborationClient({ command, flags, rest }, { request, token, git });
  const base = `/pulls/${pull}`;
  if (command === 'inbox' || command === 'export') {
    let view = await request('GET', base, { token });
    requireValue(view.pull === pull && isHead(view.head), 'unavailable', 503);
    if (view.version === 1) view = upgradeLegacyInbox(view, await gateway.pull(pull));
    requireValue(isInbox(view), 'unavailable', 503);
    if (command === 'inbox') return view;
    fs.writeFileSync(path.resolve(flags.output), flags.text ? `${renderInbox(view)}\n` : `${JSON.stringify(view, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { outcome: 'exported', pull };
  }
  if (command === 'download') {
    const result = await request('GET', `${base}/evidence/${rest[1]}`, { token, download: true });
    fs.writeFileSync(path.resolve(flags.output), result.bytes, { flag: 'wx', mode: 0o600 });
    return { outcome: 'downloaded', id: rest[1], digest: result.digest, size: result.bytes.length };
  }
  let result;
  if (command === 'upload') {
    const bytes = readPrivate(path.resolve(flags.file), maximumEvidence);
    requireValue(bytes.length > 0);
    result = await request('PUT', `${base}/evidence/${flags.id}/${flags.head}/${rest[1]}`, { token, bytes });
    requireValue(result.outcome === 'uploaded' && result.digest === digest(bytes) && result.size === bytes.length, 'unavailable', 503);
  } else if (command === 'request') {
    const testedBase = flags.base || (await gateway.pull(pull)).base;
    requireValue(isHead(testedBase), 'upstream', 502);
    result = await request('POST', `${base}/requests`, { token,
      value: { id: flags.id, head: flags.head, base: testedBase, kind: rest[1], evidence: flags.evidence } });
  } else if (command === 'respond') {
    result = await request('POST', `${base}/requests/${rest[1]}/results`, { token,
      value: { id: flags.id, head: flags.head, base: flags.base, status: rest[2], evidence: flags.evidence } });
  } else if (command === 'resolve') {
    result = await request('POST', `${base}/requests/${rest[1]}/resolve`, { token, value: { result: rest[2], decision: rest[3] } });
  }
  requireValue(result && isKey(result.id) && result.id === (flags.id || rest[1]), 'unavailable', 503);
  return result;
}
