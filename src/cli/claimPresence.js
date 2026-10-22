import { presencePolicy } from './presencePolicy.js';
import { reportPresence } from './presenceCommand.js';
import { publishPresence } from './publicPresence.js';

export async function claimPresence(result, context) {
  const { git, flags, repository } = context;
  if (result.outcome !== 'claimed' || flags.local) return result;
  const policy = presencePolicy(git);
  if (!policy || policy.repository !== repository().toLowerCase()) return result;
  try {
    const local = reportPresence('start', { issue: result.issue }, context);
    if (local.outcome !== 'checkedIn') return { ...result, publication: 'unavailable' };
    const publicResult = await publishPresence(local, { ...context, command: 'start' });
    return { ...result, session: local.session, publication: publicResult.publication || 'unavailable' };
  } catch { return { ...result, publication: 'unavailable' }; }
}
