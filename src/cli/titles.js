import { isNumber, isRepository } from '../core/values.js';

const maxNumbers = 60;
const chunkSize = 20;

export function fetchTitles(gh, repository, numbers) {
  const titles = new Map();
  const wanted = [...new Set(numbers)].filter(isNumber).slice(0, maxNumbers);
  if (!isRepository(repository) || typeof gh?.graphql !== 'function') return titles;
  const [owner, name] = repository.split('/');
  for (let start = 0; start < wanted.length; start += chunkSize) {
    const chunk = wanted.slice(start, start + chunkSize);
    const fields = chunk.map(number => `n${number}:issueOrPullRequest(number:${number}){...on Issue{title}...on PullRequest{title}}`);
    let found;
    try {
      found = gh.graphql(`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields.join(' ')}}}`, { owner, name })?.data?.repository;
    } catch {
      return titles;
    }
    if (!found || typeof found !== 'object') return titles;
    for (const number of chunk) {
      const title = found[`n${number}`]?.title;
      if (typeof title === 'string' && title.length <= 1024) titles.set(number, title);
    }
  }
  return titles;
}
