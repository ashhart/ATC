export function createFakeGithub({ repository = 'acme/widgets' } = {}) {
  const base = `/repos/${repository}`;
  const clock = { now: Date.UTC(2026, 9, 17, 12) };
  const store = { issues: new Map(), comments: [], files: new Map(), config: null, cliUser: 'alice', roles: {}, beforePost: null,
    calls: [], nextNumber: 1, nextComment: 3000000001 };
  const iso = () => new Date(clock.now).toISOString();
  const account = login => ({ login, type: login.endsWith('[bot]') ? 'Bot' : 'User' });

  function addIssue({ author = 'maintainer', title = 'Something to do', body = '', files = null, assignees = [] } = {}) {
    const number = store.nextNumber++;
    const issue = { number, title, body, user: account(author), state: 'open', locked: false, assignees: assignees.map(account),
      created_at: iso(), updated_at: iso() };
    if (files) {
      issue.pull_request = { url: `https://api.github.com${base}/pulls/${number}` };
      store.files.set(number, [...files]);
    }
    store.issues.set(number, issue);
    return issue;
  }

  function addComment(number, author, body) {
    const id = store.nextComment++;
    const kind = store.issues.get(number)?.pull_request ? 'pull' : 'issues';
    const comment = { id, user: account(author), body, author_association: store.roles[author] || 'NONE', created_at: iso(), updated_at: iso(),
      html_url: `https://github.com/${repository}/${kind}/${number}#issuecomment-${id}`, issue_url: `https://api.github.com${base}/issues/${number}` };
    store.comments.push(comment);
    return comment;
  }

  function page(list, query) {
    const size = Number(query.get('per_page') || 30);
    const index = Number(query.get('page') || 1);
    return list.slice((index - 1) * size, index * size);
  }

  function handle(actor, method, target, body) {
    store.calls.push(`${actor} ${method} ${target}`);
    const url = new URL(target, 'https://api.github.com');
    const query = url.searchParams;
    if (url.pathname === '/user') return [200, account(actor)];
    if (url.pathname === base && method === 'GET') return [200, { full_name: repository, default_branch: 'main' }];
    if (!url.pathname.startsWith(`${base}/`)) return [404, { message: 'Not Found' }];
    const path = url.pathname.slice(base.length);
    let match;
    if (path === '/contents/.github/atc.json' && method === 'GET') {
      if (store.config === null) return [404, { message: 'Not Found' }];
      const content = Buffer.from(typeof store.config === 'string' ? store.config : JSON.stringify(store.config)).toString('base64');
      return [200, { type: 'file', encoding: 'base64', size: content.length, content }];
    }
    if (path === '/issues' && method === 'GET') {
      const state = query.get('state') || 'open';
      const since = query.get('since');
      return [200, page([...store.issues.values()].filter(issue => (state === 'all' || issue.state === state) && (!since || issue.updated_at >= since)), query)];
    }
    if ((match = path.match(/^\/issues\/(\d+)$/)) && method === 'GET') {
      const issue = store.issues.get(Number(match[1]));
      return issue ? [200, issue] : [404, { message: 'Not Found' }];
    }
    if (path === '/issues/comments' && method === 'GET') {
      const since = query.get('since');
      return [200, page(store.comments.filter(comment => !comment.hidden && (!since || comment.updated_at >= since)).sort((first, second) => first.id - second.id), query)];
    }
    if ((match = path.match(/^\/issues\/(\d+)\/comments$/)) && method === 'POST') {
      if (store.beforePost) store.beforePost();
      const created = addComment(Number(match[1]), actor, body.body);
      if (store.hidePosted) created.hidden = true;
      return [201, created];
    }
    if (path === '/pulls' && method === 'GET') {
      return [200, page([...store.issues.values()].filter(issue => issue.pull_request && issue.state === 'open').reverse()
        .map(issue => ({ number: issue.number, user: issue.user, title: issue.title, body: issue.body, created_at: issue.created_at,
          updated_at: issue.updated_at, state: 'open' })), query)];
    }
    if ((match = path.match(/^\/pulls\/(\d+)\/files$/)) && method === 'GET') {
      return [200, page((store.files.get(Number(match[1])) || []).map(filename => ({ filename })), query)];
    }
    return [404, { message: 'Not Found' }];
  }

  function runGh(args) {
    if (args[0] === 'repo') return { status: 0, stdout: JSON.stringify({ nameWithOwner: repository, isFork: false, parent: null }) };
    const include = args[1] === '--include';
    const rest = include ? args.slice(2) : args.slice(1);
    const fields = {};
    for (let index = 3; index < rest.length; index += 2) {
      const [key, ...value] = rest[index + 1].split('=');
      fields[key] = value.join('=');
    }
    const [status, data] = handle(store.cliUser, rest[1], `/${rest[2]}`, rest[1] === 'GET' ? null : fields);
    const ok = status < 400;
    if (include) return { status: ok ? 0 : 1, stdout: `HTTP/2.0 ${status} Status\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(data)}` };
    return { status: ok ? 0 : 1, stdout: ok ? JSON.stringify(data) : '' };
  }

  return { store, clock, runGh, addIssue, addComment, repository,
    addPull: ({ author, body = '', files = [] }) => addIssue({ author, body, title: 'Work in progress', files }),
    closeIssue: number => Object.assign(store.issues.get(number), { state: 'closed', updated_at: iso() }),
    edit: (comment, body) => Object.assign(comment, { body, updated_at: new Date(clock.now + 1000).toISOString() }) };
}
