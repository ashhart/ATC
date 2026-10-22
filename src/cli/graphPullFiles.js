import { isNumber } from '../core/values.js';
import { readFiles } from './graphPulls.js';
import { hasTime, isTimeLimit } from './timeBudget.js';

const chunkSize = 15;

export function readPullFilesByNumber(gh, repository, numbers) {
  const [owner, name] = repository.split('/');
  const sets = new Map();
  const wanted = [...new Set(numbers)].filter(isNumber);
  for (let start = 0; start < wanted.length; start += chunkSize) {
    if (!hasTime(gh, 5000)) return { sets, timed: true };
    const chunk = wanted.slice(start, start + chunkSize);
    const fields = chunk.map(number => `p${number}:pullRequest(number:${number}){files(first:100){totalCount pageInfo{hasNextPage}nodes{path changeType}}}`);
    let found;
    try {
      found = gh.graphql(`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields.join(' ')}}}`, { owner, name })?.data?.repository;
    } catch (error) {
      if (isTimeLimit(error)) return { sets, timed: true };
      return { sets, timed: false };
    }
    if (!found || typeof found !== 'object') return { sets, timed: false };
    for (const number of chunk) {
      const files = readFiles(found[`p${number}`]?.files);
      if (files) sets.set(number, files);
    }
  }
  return { sets, timed: false };
}
