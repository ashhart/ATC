import { parseCommand } from './commands.js';
import { isId, isLogin } from './values.js';

const maintainerRoles = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const pathPattern = /^(issues|pull)\/([1-9][0-9]{0,8})#issuecomment-([1-9][0-9]{0,15})$/;

export function readEvents(comments, repository) {
  const prefix = `https://github.com/${repository.toLowerCase()}/`;
  const events = [];
  for (const comment of comments) {
    if (!isId(comment?.id) || comment.user?.type !== 'User' || !isLogin(comment.user.login)) continue;
    if (typeof comment.created_at !== 'string' || comment.created_at !== comment.updated_at) continue;
    const command = parseCommand(comment.body);
    const url = typeof comment.html_url === 'string' ? comment.html_url : '';
    if (!command || !url.toLowerCase().startsWith(prefix)) continue;
    const match = url.slice(prefix.length).match(pathPattern);
    const at = Date.parse(comment.created_at);
    if (!match || Number(match[3]) !== comment.id || !Number.isSafeInteger(at)) continue;
    events.push({ id: comment.id, issue: Number(match[2]), onPull: match[1] === 'pull', login: comment.user.login,
      maintainer: maintainerRoles.includes(comment.author_association), at, command });
  }
  return events.sort((first, second) => first.id - second.id);
}
