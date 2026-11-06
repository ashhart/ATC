import fs from 'node:fs';
import path from 'node:path';
import { checkpoint } from './checkpoint.js';
import { requireValue } from './values.js';

export const collaborationCommands = ['help-queue', 'offer', 'take', 'help-release', 'matrix', 'handoff',
  'handoff-decide', 'handoff-export', 'catchup', 'ack'];
export const collaborationWrites = ['offer', 'take', 'help-release', 'handoff', 'handoff-decide'];

export async function runCollaborationClient(parsed, { request, token, git }) {
  const { command, flags, rest } = parsed, pull = Number(rest[0]);
  const base = `/pulls/${pull}/collaboration`;
  const post = (route, value) => request('POST', route, { token, value });
  if (command === 'help-queue') return post('/queue', { after: flags.after || null, capability: flags.capability || null });
  if (command === 'offer') return post(`${base}/requests/${rest[1]}/offer`, { capability: flags.capability,
    public: !!flags.public, required: !!flags.required, independent: !!flags.independent });
  if (command === 'take') return post(`${base}/requests/${rest[1]}/take`, { consumer: flags.consumer, seconds: Number(flags.seconds) });
  if (command === 'help-release') return post(`${base}/requests/${rest[1]}/release`, { consumer: flags.consumer });
  if (command === 'matrix') return request('GET', base, { token });
  if (command === 'handoff') return post(`${base}/handoffs`, { id: flags.id, issue: Number(rest[1]), head: flags.head,
    base: flags.base, recipient: Number(flags.recipient), report: flags.report });
  if (command === 'handoff-decide') return post(`${base}/handoffs/${rest[1]}/decision`, { decision: rest[2] });
  if (command === 'handoff-export') {
    const result = await request('GET', `${base}/handoffs/${rest[1]}/packet`, { token, download: true });
    fs.writeFileSync(path.resolve(flags.output), result.bytes, { flag: 'wx', mode: 0o600 });
    return { outcome: 'downloaded', id: rest[1], digest: result.digest, size: result.bytes.length };
  }
  const cursor = checkpoint({ git, repository: flags.repo, origin: flags.origin, pull, consumer: flags.consumer });
  if (command === 'ack') return cursor.acknowledge(flags.cursor);
  requireValue(command === 'catchup');
  return cursor.changes(await request('GET', `${base}/snapshot`, { token }));
}
