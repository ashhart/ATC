const cursorPrefix = 'cursor:';

export function graphResponse(store, repository, fields) {
  const [owner, name] = repository.split('/');
  if (fields.owner !== owner || fields.name !== name) return { data: { repository: null }, errors: [{ type: 'NOT_FOUND' }] };
  const query = fields.query;
  if (query.includes('pullRequests(')) {
    const pulls = sortedIssues(store).filter(issue => issue.pull_request && issue.state === 'open');
    return { data: { repository: { pullRequests: page(pulls, fields.cursor, pageSize(query, 'pullRequests'), pull => pullNode(store, pull)) } } };
  }
  if (query.includes('issue(number:')) {
    const issue = store.issues.get(Number(fields.number));
    if (!issue || issue.pull_request) return { data: { repository: { issue: null } }, errors: [{ type: 'NOT_FOUND' }] };
    return { data: { repository: { issue: { number: issue.number, state: issue.state.toUpperCase(), comments: commentConnection(store, issue) } } } };
  }
  const issues = sortedIssues(store).filter(issue => !issue.pull_request && issue.state === 'open');
  return { data: { repository: { issues: page(issues, fields.cursor, pageSize(query, 'issues'), issue => issueNode(store, issue)) } } };
}

export function graphKind(fields) {
  if (fields.query.includes('pullRequests(')) return 'pulls';
  return fields.query.includes('issue(number:') ? `issue ${fields.number}` : 'issues';
}

function issueNode(store, issue) {
  return { number: issue.number, state: issue.state.toUpperCase(), assignees: connection(issue.assignees.map(user => ({ login: user.login }))),
    labels: connection(issue.labels.map(label => ({ name: typeof label === 'string' ? label : label?.name }))), comments: commentConnection(store, issue) };
}

function commentConnection(store, issue) {
  const visible = store.comments.filter(comment => !comment.hidden && comment.html_url.includes(`/${issue.number}#issuecomment-`));
  return { totalCount: issue.comments, pageInfo: { hasNextPage: visible.length > 100 }, nodes: visible.slice(0, 100).map(commentNode) };
}

function commentNode(comment) {
  return { fullDatabaseId: String(comment.id), author: comment.user ? { __typename: comment.user.type, login: comment.user.login } : null,
    authorAssociation: comment.author_association, body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at, url: comment.html_url };
}

function pullNode(store, pull) {
  const files = (store.files.get(pull.number) || []).map(file => typeof file === 'string'
    ? { path: file, changeType: 'MODIFIED' } : { path: file.filename, changeType: file.previous_filename ? 'RENAMED' : 'MODIFIED' });
  return { number: pull.number, files: { totalCount: files.length, pageInfo: { hasNextPage: files.length > 100 }, nodes: files.slice(0, 100) } };
}

function connection(nodes) {
  return { totalCount: nodes.length, nodes };
}

function sortedIssues(store) {
  return [...store.issues.values()].sort((first, second) => first.number - second.number);
}

function pageSize(query, field) {
  return Number(query.match(new RegExp(`${field}\\(states: OPEN, first: (\\d+)`))[1]);
}

function page(items, cursor, size, toNode) {
  const start = cursor ? Number(Buffer.from(cursor, 'base64').toString().slice(cursorPrefix.length)) : 0;
  const nodes = items.slice(start, start + size);
  const end = start + nodes.length;
  return { pageInfo: { hasNextPage: end < items.length, endCursor: nodes.length ? Buffer.from(`${cursorPrefix}${end}`).toString('base64') : null },
    nodes: nodes.map(toNode) };
}
