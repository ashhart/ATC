import { readConfig } from '../core/config.js';
import { isLogin, readTimestamp } from '../core/values.js';
import { isHead, isId, isNumber, isOrigin, isPolicy, isRepository, proofFor, requireValue } from './values.js';

export function createExchangeGithub({ repository, origin, ghFactory }) {
  requireValue(isRepository(repository) && isOrigin(origin) && typeof ghFactory === 'function');
  repository = repository.toLowerCase();
  const base = `repos/${repository}`;
  return {
    async policy() {
      const gh = ghFactory();
      requireValue(readConfig(decodeFile(await gh.getOptional(`${base}/contents/.github/atc.json`), 65536)).enabled, 'notEnabled', 403);
      const policy = decodePolicy(await gh.getOptional(`${base}/contents/.github/atc-exchange.json`));
      requireValue(policy.origin === origin, 'notEnabled', 403);
      return policy;
    },
    async pull(number) {
      requireValue(isNumber(number));
      const value = await ghFactory().get(`${base}/pulls/${number}`);
      requireValue(value?.number === number && isHead(value.head?.sha) && ['open', 'closed'].includes(value.state)
        && isRepository(value.base?.repo?.full_name) && value.base.repo.full_name.toLowerCase() === repository, 'upstream', 502);
      return { head: value.head.sha, state: value.state };
    },
    async verify({ pull, comment, token }) {
      requireValue(isNumber(pull) && isId(comment));
      const value = await ghFactory().get(`${base}/issues/comments/${comment}`);
      requireValue(value?.id === comment && typeof value.issue_url === 'string' && value.issue_url.length <= 256
        && value.issue_url.toLowerCase() === `https://api.github.com/${base}/issues/${pull}`
        && value.body === `/atc exchange ${proofFor(token, origin, repository, pull)}`
        && readTimestamp(value.created_at) !== null && value.created_at === value.updated_at
        && value.user?.type === 'User' && isId(value.user.id) && isLogin(value.user.login), 'unauthorized', 401);
      const metadata = await ghFactory().get(base);
      requireValue(typeof metadata?.private === 'boolean', 'upstream', 502);
      if (metadata.private) {
        const access = await ghFactory().get(`${base}/collaborators/${value.user.login}/permission`);
        requireValue(['read', 'write', 'admin'].includes(access?.permission)
          && access.user?.id === value.user.id, 'forbidden', 403);
      }
      return value.user.id;
    }
  };
}

export function decodePolicy(file) {
  const policy = decodeFile(file, 1024);
  requireValue(isPolicy(policy), 'notEnabled', 403);
  return policy;
}

function decodeFile(file, maximum) {
  requireValue(file?.type === 'file' && file.encoding === 'base64' && Number.isInteger(file.size)
    && file.size > 0 && file.size <= maximum && typeof file.content === 'string'
    && file.content.length <= maximum * 2 && /^[A-Za-z0-9+/=\r\n]*$/.test(file.content), 'notEnabled', 403);
  const compact = file.content.replace(/\r?\n/g, '');
  const bytes = Buffer.from(compact, 'base64');
  requireValue(bytes.length === file.size && bytes.toString('base64') === compact, 'notEnabled', 403);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { requireValue(false, 'notEnabled', 403); }
}
