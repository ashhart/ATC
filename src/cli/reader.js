import { Failure, ensure } from '../core/failure.js';
import { isNumber } from '../core/values.js';
import { isRef } from './git.js';

export function createReader(gh, repository) {
  const base = `repos/${repository}`;

  function pages(path, limit) {
    const items = [];
    for (let page = 1; page <= limit; page += 1) {
      const batch = gh.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) break;
      items.push(...batch);
      if (batch.length < 100) return { items, partial: false };
    }
    return { items, partial: items.length >= limit * 100 };
  }

  return {
    comments: since => pages(`${base}/issues/comments?sort=created&direction=asc&since=${encodeURIComponent(since)}`, 30),
    openPulls: () => pages(`${base}/pulls?state=open&sort=created&direction=desc`, 1).items,
    closedSince(since) {
      const { items, partial } = pages(`${base}/issues?state=closed&since=${encodeURIComponent(since)}`, 5);
      return { numbers: new Set(items.filter(issue => isNumber(issue?.number)).map(issue => issue.number)), partial };
    },
    issue: number => gh.getOptional(`${base}/issues/${number}`),
    pullFiles: number => pages(`${base}/pulls/${number}/files`, 3).items.map(file => file?.filename).filter(name => typeof name === 'string'),
    config() {
      const file = gh.getOptional(`${base}/contents/.github/atc.json`);
      if (file === null) return null;
      ensure(file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' && Number(file.size) <= 65536, 'Invalid .github/atc.json');
      try {
        return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      } catch {
        throw new Failure('Invalid .github/atc.json');
      }
    },
    defaultBranch() {
      const branch = gh.get(base)?.default_branch;
      ensure(isRef(branch), 'Could not read the repository\'s default branch');
      return branch;
    }
  };
}
