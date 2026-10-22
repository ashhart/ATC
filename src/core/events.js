import { isAreaReference, parseCommand } from './commands.js';
import { isId, isLogin, readTimestamp } from './values.js';
import { areaName } from './areas.js';

const maintainerRoles = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const pathPattern = /^(issues|pull)\/([1-9][0-9]{0,8})#issuecomment-([1-9][0-9]{0,15})$/;

export function readEvents(comments, repository, config) {
  const prefix = `https://github.com/${repository.toLowerCase()}/`;
  const events = [];
  for (const comment of comments) {
    if (!isId(comment?.id) || comment.user?.type !== 'User' || !isLogin(comment.user.login)) continue;
    if (typeof comment.created_at !== 'string' || comment.created_at !== comment.updated_at) continue;
    const command = resolveAreas(parseCommand(comment.body), config);
    const url = typeof comment.html_url === 'string' ? comment.html_url : '';
    if (!command || !url.toLowerCase().startsWith(prefix)) continue;
    const match = url.slice(prefix.length).match(pathPattern);
    const at = readTimestamp(comment.created_at);
    if (!match || match[0] !== url.slice(prefix.length) || Number(match[3]) !== comment.id || at === null) continue;
    events.push({ id: comment.id, issue: Number(match[2]), onPull: match[1] === 'pull', login: comment.user.login.toLowerCase(),
      maintainer: maintainerRoles.includes(comment.author_association), at, command });
  }
  return events.sort((first, second) => first.id - second.id);
}

function resolveAreas(command, config) {
  if (!command?.areas?.some(isAreaReference)) return command;
  const areas = command.areas.map(area => isAreaReference(area) ? areaName(config, area) : area);
  if (areas.some(area => area === null) || new Set(areas).size !== areas.length) return { verb: 'invalid' };
  return { ...command, areas: areas.sort() };
}
