import { boardLabel, boardTitle } from '../core/board.js';
import { Failure } from '../core/failure.js';

export function createGithub({ token, repository, apiUrl = 'https://api.github.com', fetcher = globalThis.fetch }) {
  const base = `/repos/${repository}`;

  async function call(method, path, body) {
    const response = await fetcher(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'atc-github',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Failure(`GitHub API request failed with HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  async function pages(path, limit) {
    const results = [];
    for (let page = 1; page <= limit; page += 1) {
      const batch = await call('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) break;
      results.push(...batch);
      if (batch.length < 100) break;
    }
    return results;
  }

  return {
    async readConfig() {
      const file = await call('GET', `${base}/contents/.github/atc.json`);
      if (!file) return null;
      if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || !(Number(file.size) <= 65536)) {
        throw new Failure('Invalid .github/atc.json');
      }
      try {
        return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      } catch {
        throw new Failure('Invalid .github/atc.json');
      }
    },
    async listBoards() {
      const issues = await call('GET', `${base}/issues?labels=${boardLabel}&state=open&per_page=20`);
      return Array.isArray(issues) ? issues : [];
    },
    async createBoard(body) {
      if (!await call('GET', `${base}/labels/${boardLabel}`)) {
        await call('POST', `${base}/labels`, { name: boardLabel, color: '1f6feb', description: 'ATC coordination board' });
      }
      return call('POST', `${base}/issues`, { title: boardTitle, body, labels: [boardLabel] });
    },
    updateBoard: (number, body) => call('PATCH', `${base}/issues/${number}`, { body }),
    getIssue: number => call('GET', `${base}/issues/${number}`),
    listComments: since => pages(`${base}/issues/comments?sort=created&direction=asc&since=${encodeURIComponent(since)}`, 10),
    listClosedIssues: since => pages(`${base}/issues?state=closed&since=${encodeURIComponent(since)}`, 3),
    listOpenPulls: () => pages(`${base}/pulls?state=open`, 1),
    async listPullFiles(number) {
      return (await pages(`${base}/pulls/${number}/files`, 3)).map(file => file?.filename).filter(name => typeof name === 'string');
    },
    createComment: (number, body) => call('POST', `${base}/issues/${number}/comments`, { body }),
    addAssignees: (number, assignees) => call('POST', `${base}/issues/${number}/assignees`, { assignees }),
    removeAssignees: (number, assignees) => call('DELETE', `${base}/issues/${number}/assignees`, { assignees }),
    react: (commentId, content) => call('POST', `${base}/issues/comments/${commentId}/reactions`, { content })
  };
}
