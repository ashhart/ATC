import { digest, requireValue, isId } from './values.js';
import { isLogin, readTimestamp } from '../core/values.js';
import { parseCommand } from '../core/commands.js';

export async function observePull(gh, repository, pull) {
  const base = `repos/${repository}`;
  async function pages(route) {
    const rows = [];
    for (let page = 1; page <= 6; page++) {
      const batch = await gh.get(`${route}?per_page=100&page=${page}`);
      requireValue(Array.isArray(batch) && batch.length <= 100, 'upstream', 502);
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    requireValue(false, 'capacity', 429);
  }
  const [reviews, comments, discussion, target] = await Promise.all([
    pages(`${base}/pulls/${pull}/reviews`), pages(`${base}/pulls/${pull}/comments`),
    pages(`${base}/issues/${pull}/comments`), gh.get(`${base}/pulls/${pull}`)
  ]);
  const feedback = [...reviews, ...comments, ...discussion.filter(x => parseCommand(x.body) === null)].map(x => {
    const at = x.updated_at || x.submitted_at || x.created_at;
    requireValue(isId(x.id) && (readTimestamp(at) !== null || x.state === 'PENDING' && at == null), 'upstream', 502);
    return [x.id, at ?? null, ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'].includes(x.state) ? x.state : null];
  }).sort((a, b) => a[0] - b[0]);
  let dependencies = [];
  for (const comment of [...discussion].sort((a, b) => a.id - b.id)) {
    const command = parseCommand(comment.body);
    if (command?.verb !== 'depends' || comment.created_at !== comment.updated_at || !isLogin(comment.user?.login)) continue;
    let allowed = comment.user.id === target.user?.id;
    if (!allowed && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association)) {
      const permission = await gh.get(`${base}/collaborators/${comment.user.login}/permission`);
      allowed = ['write', 'admin'].includes(permission?.permission) && permission.user?.id === comment.user.id;
    }
    if (allowed) dependencies = command.pulls;
  }
  return { feedback: digest(JSON.stringify(feedback)), dependencies: digest(JSON.stringify(dependencies)) };
}
