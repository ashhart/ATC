import { Failure, ensure } from '../core/failure.js';
import { isActorLogin, isNumber, isRepository } from '../core/values.js';
import { isRef } from './git.js';

const filePattern = /^[^\u0000-\u001f\u007f]{1,4096}$/;

export function createReader(gh, repository) {
  ensure(isRepository(repository), 'Invalid repository');
  const base = `repos/${repository}`;

  function pages(path, limit) {
    const items = [];
    for (let page = 1; page <= limit; page += 1) {
      const batch = gh.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      ensure(Array.isArray(batch) && batch.length <= 100, 'GitHub returned an invalid list');
      items.push(...batch);
      if (batch.length < 100) return { items, partial: false, requests: page };
    }
    const extra = gh.get(`${path}${path.includes('?') ? '&' : '?'}per_page=1&page=${limit * 100 + 1}`);
    ensure(Array.isArray(extra) && extra.length <= 1, 'GitHub returned an invalid list');
    return { items, partial: extra.length > 0, requests: limit + 1 };
  }

  return {
    comments(since) {
      return pages(`${base}/issues/comments?sort=created&direction=asc&since=${encodeURIComponent(since)}`, 30);
    },
    issueComments(number, limit = 30) {
      ensure(isNumber(number) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 30, 'Invalid comment request');
      const fetched = pages(`${base}/issues/${number}/comments`, limit);
      return fetched;
    },
    openPulls: () => pages(`${base}/pulls?state=open&sort=created&direction=asc`, 3),
    closedSince(since) {
      const { items, partial } = pages(`${base}/issues?state=closed&since=${encodeURIComponent(since)}`, 5);
      ensure(items.every(issue => isNumber(issue?.number) && issue.state === 'closed'), 'GitHub returned an invalid issue');
      return { numbers: new Set(items.map(issue => issue.number)), partial };
    },
    issue(number) {
      ensure(isNumber(number), 'Invalid issue number');
      const issue = gh.getOptional(`${base}/issues/${number}`);
      if (issue === null) return null;
      ensure(issue?.number === number && ['open', 'closed'].includes(issue.state) && Array.isArray(issue.assignees)
        && issue.assignees.length <= 100 && issue.assignees.every(user => isActorLogin(user?.login)), 'GitHub returned an invalid issue');
      return { number, state: issue.state, pull_request: Boolean(issue.pull_request), assignees: issue.assignees.map(user => ({ login: user.login.toLowerCase() })) };
    },
    pullFiles(number) {
      ensure(isNumber(number), 'Invalid pull request number');
      const { items, partial } = pages(`${base}/pulls/${number}/files`, 3);
      const files = [];
      let invalid = false;
      for (const file of items) {
        const names = [file?.filename, ...(file?.previous_filename === undefined ? [] : [file.previous_filename])];
        for (const name of names) {
          if (isFilePath(name)) files.push(name);
          else invalid = true;
        }
      }
      return { files, partial, invalid };
    },
    config() {
      const file = gh.getOptional(`${base}/contents/.github/atc.json`);
      if (file === null) return null;
      const message = 'Invalid .github/atc.json';
      ensure(file?.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string'
        && file.content.length <= 90000 && /^[A-Za-z0-9+/=\r\n]*$/.test(file.content)
        && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 65536, message);
      const compact = file.content.replace(/\r?\n/g, '');
      const bytes = Buffer.from(compact, 'base64');
      ensure(bytes.length === file.size && bytes.toString('base64') === compact, message);
      try {
        return JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new Failure(message);
      }
    },
    defaultBranch() {
      const branch = gh.get(base)?.default_branch;
      ensure(isRef(branch), 'Could not read the repository\'s default branch');
      return branch;
    }
  };
}

export function isFilePath(value) {
  return typeof value === 'string' && filePattern.test(value) && !/[\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/')
    && !value.split('/').some(part => part === '.' || part === '..' || part === '');
}
