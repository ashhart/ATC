import { ensure } from '../core/failure.js';
import { isActorLogin, isCursor, isId, isNumber, isRecord } from '../core/values.js';
import { hasTime, isTimeLimit } from './timeBudget.js';

const invalid = 'GitHub returned an invalid issue';
const pageSize = 50;
const maxPages = 20;
const commentFields = 'comments(first: 100) { totalCount pageInfo { hasNextPage } '
  + 'nodes { fullDatabaseId author { __typename login } authorAssociation body createdAt updatedAt url } }';
const issuesQuery = 'query($owner: String!, $name: String!, $cursor: String) { repository(owner: $owner, name: $name) { '
  + `issues(states: OPEN, first: ${pageSize}, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) { pageInfo { hasNextPage endCursor } `
  + `nodes { number state assignees(first: 100) { totalCount nodes { login } } labels(first: 100) { totalCount nodes { name } } ${commentFields} } } } }`;
const issueQuery = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { '
  + `issue(number: $number) { number state ${commentFields} } } }`;

export function readOpenIssues(gh, repository) {
  const [owner, name] = repository.split('/');
  const items = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0 && !hasTime(gh, 6000)) return { items: sorted(items), partial: true, timed: true };
    let connection;
    try {
      connection = gh.graphql(issuesQuery, { owner, name, ...(cursor ? { cursor } : {}) })?.data?.repository?.issues;
    } catch (error) {
      if (!isTimeLimit(error)) throw error;
      return { items: sorted(items), partial: true, timed: true };
    }
    ensure(isRecord(connection) && Array.isArray(connection.nodes) && connection.nodes.length <= pageSize
      && typeof connection.pageInfo?.hasNextPage === 'boolean', invalid);
    items.push(...connection.nodes.map(readIssueNode));
    if (!connection.pageInfo.hasNextPage) return { items: sorted(items), partial: false };
    ensure(isCursor(connection.pageInfo.endCursor), invalid);
    cursor = connection.pageInfo.endCursor;
  }
  return { items: sorted(items), partial: true };
}

export function readIssue(gh, repository, number) {
  ensure(isNumber(number), 'Invalid issue number');
  const [owner, name] = repository.split('/');
  const found = gh.graphql(issueQuery, { owner, name, number })?.data?.repository;
  ensure(isRecord(found), invalid);
  if (found.issue === null) return { open: false, comments: [], overflow: false, commentCount: 0 };
  ensure(isRecord(found.issue) && found.issue.number === number && ['OPEN', 'CLOSED'].includes(found.issue.state), invalid);
  const history = readComments(found.issue.comments);
  return { open: found.issue.state === 'OPEN', ...history };
}

function readIssueNode(node) {
  ensure(isRecord(node) && isNumber(node.number) && node.state === 'OPEN', invalid);
  const assignees = readNodes(node.assignees);
  ensure(assignees.every(user => isActorLogin(user?.login)), invalid);
  const known = readNodes(node.labels).map(label => label?.name).filter(name => typeof name === 'string' && name.length <= 50)
    .map(name => name.toLowerCase());
  const { comments, overflow, commentCount } = readComments(node.comments);
  return { issue: { number: node.number, assignees: assignees.map(user => ({ login: user.login.toLowerCase() })),
    helpWanted: known.includes('help wanted'), goodFirstIssue: known.includes('good first issue'), commentCount }, comments, overflow };
}

function readNodes(connection) {
  ensure(isRecord(connection) && Array.isArray(connection.nodes) && connection.nodes.length <= 100
    && connection.totalCount === connection.nodes.length, invalid);
  return connection.nodes;
}

function readComments(connection) {
  ensure(isRecord(connection) && Number.isSafeInteger(connection.totalCount) && connection.totalCount >= 0 && connection.totalCount <= 1000000
    && typeof connection.pageInfo?.hasNextPage === 'boolean' && Array.isArray(connection.nodes) && connection.nodes.length <= 100, invalid);
  return { comments: connection.nodes.map(readComment), overflow: connection.pageInfo.hasNextPage, commentCount: connection.totalCount };
}

function readComment(node) {
  const id = typeof node?.fullDatabaseId === 'string' ? Number(node.fullDatabaseId) : null;
  const author = isRecord(node?.author) ? { login: node.author.login, type: node.author.__typename } : null;
  return { id: isId(id) && String(id) === node.fullDatabaseId ? id : null, user: author, author_association: node?.authorAssociation,
    body: node?.body, created_at: node?.createdAt, updated_at: node?.updatedAt, html_url: node?.url };
}

function sorted(items) {
  ensure(new Set(items.map(item => item.issue.number)).size === items.length, invalid);
  return items.sort((first, second) => first.issue.number - second.issue.number);
}
