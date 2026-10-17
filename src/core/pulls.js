import { areasForPath } from './config.js';
import { comment } from './effects.js';
import { caps } from './state.js';

const referencePattern = /(?:^|[^A-Za-z0-9_&/#-])#([1-9][0-9]{0,8})(?![0-9A-Za-z_])/g;

export function referencedIssues(body) {
  if (typeof body !== 'string') return [];
  const found = new Set();
  for (const match of body.slice(0, 65536).matchAll(referencePattern)) {
    found.add(Number(match[1]));
    if (found.size === 20) break;
  }
  return [...found];
}

export function linkPullRequests(state, pulls, now) {
  const open = new Set(pulls.map(pull => pull.number));
  for (const claim of state.claims) claim.prs = claim.prs.filter(number => open.has(number));
  for (const pull of pulls) {
    const mine = state.claims.filter(claim => claim.login === pull.author && claim.role === 'work');
    const named = mine.filter(claim => pull.issues.includes(claim.issue));
    for (const claim of named.length > 0 ? named : mine.length === 1 ? mine : []) {
      if (!claim.prs.includes(pull.number) && claim.prs.length < caps.prsPerClaim) claim.prs.push(pull.number);
      claim.active = Math.max(claim.active, Math.min(pull.updatedAt, now));
    }
  }
}

export function linkedPullAuthors(state) {
  const authors = new Map();
  for (const claim of state.claims) {
    if (claim.role === 'work') for (const number of claim.prs) authors.set(number, claim.login);
  }
  return authors;
}

export function recordOverlaps(state, filesByPull, config, now) {
  const authors = linkedPullAuthors(state);
  const numbers = [...filesByPull.keys()].filter(number => authors.has(number)).sort((first, second) => first - second);
  const found = [];
  for (let left = 0; left < numbers.length; left += 1) {
    for (let right = left + 1; right < numbers.length; right += 1) {
      const pair = [numbers[left], numbers[right]];
      if (authors.get(pair[0]) === authors.get(pair[1])) continue;
      const shared = [...filesByPull.get(pair[0])].filter(file => filesByPull.get(pair[1]).has(file));
      if (shared.length === 0) continue;
      const areas = [...new Set(shared.flatMap(file => areasForPath(config, file)))].sort();
      found.push({ prs: pair, files: shared.length, areas, at: now });
    }
  }
  const known = new Map(state.overlaps.map(overlap => [overlap.prs.join(':'), overlap]));
  const fresh = found.filter(overlap => !known.has(overlap.prs.join(':')));
  state.overlaps = found.slice(0, caps.overlaps).map(overlap => ({ ...overlap, at: known.get(overlap.prs.join(':'))?.at ?? overlap.at }));
  return fresh.slice(0, 10).flatMap(overlap => {
    const values = { prs: overlap.prs, files: overlap.files, areas: overlap.areas, logins: overlap.prs.map(number => authors.get(number)) };
    return overlap.prs.map(number => comment(number, 'pullOverlap', values));
  });
}
