export function createFakeGithub({ repository = 'acme/widgets', botLogin = 'github-actions[bot]' } = {}) {
  const base = `/repos/${repository}`;
  const clock = { now: Date.UTC(2026, 9, 17, 12) };
  const store = { issues: new Map(), comments: [], files: new Map(), reactions: [], labels: new Set(), config: null,
    calls: [], cliUser: 'alice', nextNumber: 1, nextComment: 3000000001 };
  const iso = () => new Date(clock.now).toISOString();
  const account = login => ({ login, type: login.endsWith('[bot]') ? 'Bot' : 'User' });

  function addIssue({ author = 'maintainer', title = 'Something to do', body = '', labels = [], files = null } = {}) {
    const number = store.nextNumber++;
    const issue = { number, title, body, user: account(author), labels: labels.map(name => ({ name })), state: 'open',
      locked: false, assignees: [], created_at: iso(), updated_at: iso() };
    if (files) {
      issue.pull_request = { url: `https://api.github.test${base}/pulls/${number}` };
      store.files.set(number, [...files]);
    }
    store.issues.set(number, issue);
    return issue;
  }

  function addComment(number, author, body, association = 'NONE') {
    const comment = { id: store.nextComment++, user: account(author), body, author_association: association, created_at: iso(), updated_at: iso(),
      issue_url: `https://api.github.test${base}/issues/${number}` };
    store.comments.push(comment);
    return comment;
  }

  function page(list, query) {
    const size = Number(query.get('per_page') || 30);
    const index = Number(query.get('page') || 1);
    return list.slice((index - 1) * size, index * size);
  }

  function handleIssues(actor, method, path, query, body) {
    let match;
    if (path === '/issues' && method === 'GET') {
      const state = query.get('state') || 'open';
      const label = query.get('labels');
      const since = query.get('since');
      return [200, page([...store.issues.values()].filter(issue => (state === 'all' || issue.state === state)
        && (!label || issue.labels.some(entry => entry.name === label)) && (!since || issue.updated_at >= since)), query)];
    }
    if (path === '/issues' && method === 'POST') return [201, addIssue({ author: actor, title: body.title, body: body.body, labels: body.labels })];
    if ((match = path.match(/^\/issues\/(\d+)$/))) {
      const issue = store.issues.get(Number(match[1]));
      if (!issue) return [404, {}];
      if (method === 'PATCH') {
        issue.body = body.body;
        issue.updated_at = iso();
      }
      return [200, issue];
    }
    if (path === '/issues/comments' && method === 'GET') {
      const since = query.get('since');
      return [200, page(store.comments.filter(comment => !since || comment.updated_at >= since).sort((first, second) => first.id - second.id), query)];
    }
    if ((match = path.match(/^\/issues\/(\d+)\/comments$/)) && method === 'POST') return [201, addComment(Number(match[1]), actor, body.body)];
    if ((match = path.match(/^\/issues\/(\d+)\/assignees$/))) {
      if (store.failAssignees) return [422, { message: 'Validation Failed' }];
      const issue = store.issues.get(Number(match[1]));
      if (method === 'POST') for (const login of body.assignees) if (!issue.assignees.some(user => user.login === login)) issue.assignees.push(account(login));
      if (method === 'DELETE') issue.assignees = issue.assignees.filter(user => !body.assignees.includes(user.login));
      return [method === 'POST' ? 201 : 200, issue];
    }
    if ((match = path.match(/^\/issues\/comments\/(\d+)\/reactions$/)) && method === 'POST') {
      store.reactions.push({ comment: Number(match[1]), content: body.content });
      return [201, {}];
    }
    return null;
  }

  function handle(actor, method, target, body) {
    store.calls.push(`${actor} ${method} ${target}`);
    const url = new URL(target, 'https://api.github.test');
    const query = url.searchParams;
    if (url.pathname === '/user') return [200, account(actor)];
    if (!url.pathname.startsWith(base)) return [404, {}];
    const path = url.pathname.slice(base.length);
    if (method === 'GET' && path === '/contents/.github/atc.json') {
      if (store.config === null) return [404, {}];
      const content = Buffer.from(typeof store.config === 'string' ? store.config : JSON.stringify(store.config)).toString('base64');
      return [200, { type: 'file', encoding: 'base64', size: content.length, content }];
    }
    if (path === '/labels/atc-board' && method === 'GET') return store.labels.has('atc-board') ? [200, { name: 'atc-board' }] : [404, {}];
    if (path === '/labels' && method === 'POST') {
      store.labels.add(body.name);
      return [201, { name: body.name }];
    }
    if (path === '/pulls' && method === 'GET') {
      return [200, page([...store.issues.values()].filter(issue => issue.pull_request && issue.state === 'open')
        .map(issue => ({ number: issue.number, user: issue.user, title: issue.title, body: issue.body, updated_at: issue.updated_at, state: 'open' })), query)];
    }
    const files = path.match(/^\/pulls\/(\d+)\/files$/);
    if (files && method === 'GET') return [200, page((store.files.get(Number(files[1])) || []).map(filename => ({ filename })), query)];
    return handleIssues(actor, method, path, query, body) || [404, {}];
  }

  async function fetch(url, options = {}) {
    if (!String(options.headers?.authorization || '').startsWith('Bearer ')) return new Response('{}', { status: 401 });
    const parsed = new URL(url);
    const [status, data] = handle(botLogin, options.method || 'GET', parsed.pathname + parsed.search, options.body ? JSON.parse(options.body) : null);
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  }

  function runGh(args) {
    if (args[0] === 'repo') return { status: 0, stdout: JSON.stringify({ nameWithOwner: repository, isFork: false, parent: null }) };
    const fields = {};
    for (let index = 4; index < args.length; index += 2) {
      const [key, ...value] = args[index + 1].split('=');
      fields[key] = value.join('=');
    }
    const [status, data] = handle(store.cliUser, args[2], `/${args[3]}`, args[2] === 'GET' ? null : fields);
    return { status: status < 400 ? 0 : 1, stdout: status < 400 ? JSON.stringify(data) : '' };
  }

  return { store, clock, fetch, runGh, addIssue, addComment, botLogin, repository,
    addPull: ({ author, body = '', files = [] }) => addIssue({ author, body, title: 'Work in progress', files }),
    closeIssue: number => Object.assign(store.issues.get(number), { state: 'closed', updated_at: iso() }) };
}
