import { ensure } from '../core/failure.js';
import { isCursor, isNumber, isRecord } from '../core/values.js';
import { isFilePath } from './reader.js';

const invalid = 'GitHub returned an invalid list';
const pageSize = 50;
const maxPages = 4;
const changeTypes = ['ADDED', 'CHANGED', 'COPIED', 'DELETED', 'MODIFIED', 'RENAMED'];
const pullsQuery = 'query($owner: String!, $name: String!, $cursor: String) { repository(owner: $owner, name: $name) { '
  + `pullRequests(states: OPEN, first: ${pageSize}, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) { pageInfo { hasNextPage endCursor } `
  + 'nodes { number files(first: 100) { totalCount pageInfo { hasNextPage } nodes { path changeType } } } } } }';

export function readPullFileSets(gh, repository, wanted) {
  const [owner, name] = repository.split('/');
  const sets = new Map();
  const missing = new Set(wanted);
  let cursor;
  for (let page = 0; page < maxPages && missing.size > 0; page += 1) {
    const connection = gh.graphql(pullsQuery, { owner, name, ...(cursor ? { cursor } : {}) })?.data?.repository?.pullRequests;
    ensure(isRecord(connection) && Array.isArray(connection.nodes) && connection.nodes.length <= pageSize
      && typeof connection.pageInfo?.hasNextPage === 'boolean', invalid);
    for (const node of connection.nodes) {
      if (!isRecord(node) || !isNumber(node.number) || !missing.has(node.number)) continue;
      missing.delete(node.number);
      const files = readFiles(node.files);
      if (files) sets.set(node.number, files);
    }
    if (!connection.pageInfo.hasNextPage) break;
    ensure(isCursor(connection.pageInfo.endCursor), invalid);
    cursor = connection.pageInfo.endCursor;
  }
  return sets;
}

export function readFiles(connection) {
  if (!isRecord(connection) || connection.pageInfo?.hasNextPage !== false || !Array.isArray(connection.nodes)
    || connection.nodes.length > 100 || connection.totalCount !== connection.nodes.length) return null;
  if (connection.nodes.some(file => !changeTypes.includes(file?.changeType) || ['COPIED', 'RENAMED'].includes(file.changeType))) return null;
  const paths = connection.nodes.map(file => file.path);
  return { files: paths.filter(isFilePath), partial: false, invalid: !paths.every(isFilePath) };
}
