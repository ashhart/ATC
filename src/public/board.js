import { readConfig } from '../core/config.js';
import { readEvents } from '../core/events.js';
import { ensure } from '../core/failure.js';
import { readPulls } from '../core/pulls.js';
import { replay } from '../core/replay.js';
import { trafficView } from '../core/traffic.js';
import { isActorLogin, isNumber, isRepository, readTimestamp } from '../core/values.js';
import { displayResult } from '../cli/output.js';
import { readPublicDiff, readPublicPages, readPublicResource } from './transport.js';

export async function collectPublicBoard(repository, { read = readPublicResource, now = Date.now } = {}) {
  ensure(isRepository(repository), 'Invalid repository.');
  const base = `https://api.github.com/repos/${repository}`;
  const details = JSON.parse(await read(base));
  ensure(details?.private === false, 'Public traffic unavailable.');
  const [file, opened, fetched] = await Promise.all([
    read(`${base}/contents/.github/atc.json`, { optional: true }),
    readPublicPages(read, `${base}/issues?state=open&sort=created&direction=asc`, 10),
    readPublicPages(read, `${base}/pulls?state=open&sort=created&direction=asc`, 3)
  ]);
  const config = readConfig(readConfiguration(file));
  const limits = new Set();
  if (!config.areasPinned) limits.add('configurationUnpinned');
  if (opened.partial) limits.add('openIssuesLimit');
  if (fetched.partial) limits.add('pullRequestsLimit');
  const openIssues = opened.items.filter(issue => !issue.pull_request).map(readIssue);
  ensure(new Set(openIssues.map(issue => issue.number)).size === openIssues.length, 'Public traffic unavailable.');
  const pulls = readPulls(fetched.items);
  ensure(new Set(pulls.map(pull => pull.number)).size === pulls.length, 'Public traffic unavailable.');
  if (pulls.length !== fetched.items.length) limits.add('invalidPulls');
  const comments = [];
  const pullFiles = new Map();
  const jobs = fetched.items.filter(pull => pulls.some(item => item.number === pull.number)).map(pull => async () => {
    try {
      ensure(/^[a-f0-9]{40}$/.test(pull.head?.sha), 'Public traffic unavailable.');
      const text = await read(`https://patch-diff.githubusercontent.com/raw/${repository}/pull/${pull.number}.diff?atc_head=${pull.head.sha}`);
      pullFiles.set(pull.number, readPublicDiff(text));
    } catch { limits.add('pullFilesUnavailable'); }
  });
  if (config.enabled) for (const issue of openIssues.filter(issue => issue.commentCount > 0)) jobs.push(async () => {
    try {
      const revision = issue.updatedAt === null ? '' : `?atc_updated=${encodeURIComponent(issue.updatedAt)}`;
      const result = await readPublicPages(read, `${base}/issues/${issue.number}/comments${revision}`, 30);
      comments.push(...result.items);
      if (result.partial) limits.add('commentsLimit');
      if (result.items.length !== issue.commentCount) limits.add('inconsistentComments');
    } catch { limits.add('commentsLimit'); }
  });
  await runJobs(jobs);
  const observed = now();
  const numbers = new Set(openIssues.map(issue => issue.number));
  const events = readEvents(comments, repository, config).filter(event => !event.onPull && numbers.has(event.issue));
  const state = replay(events, { closed: new Set() }, config, observed);
  const logins = new Set([...pulls.map(pull => pull.author), ...openIssues.flatMap(issue => issue.assignees.map(user => user.login)),
    ...state.claims.map(claim => claim.login)]);
  const identities = new Map([...logins].sort().map((login, index) => [login, index + 1]));
  return displayResult(trafficView({ state, pulls, config, partial: limits.size > 0, limitations: [...limits], now: observed },
    { me: null, openIssues, identities, pullFiles, presence: [] }), config);
}

function readConfiguration(text) {
  if (text === null) return null;
  const file = JSON.parse(text);
  ensure(file?.type === 'file' && file.encoding === 'base64' && Number.isSafeInteger(file.size) && file.size <= 65536
    && typeof file.content === 'string' && file.content.length <= 90000 && /^[A-Za-z0-9+/=\r\n]*$/.test(file.content), 'Invalid .github/atc.json');
  const bytes = Uint8Array.from(atob(file.content.replace(/\r?\n/g, '')), letter => letter.charCodeAt(0));
  ensure(bytes.length === file.size, 'Invalid .github/atc.json');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function readIssue(issue) {
  ensure(isNumber(issue?.number) && issue.state === 'open' && Array.isArray(issue.assignees) && issue.assignees.length <= 100
    && issue.assignees.every(user => isActorLogin(user?.login)) && Number.isSafeInteger(issue.comments)
    && issue.comments >= 0 && issue.comments <= 1000000 && Array.isArray(issue.labels) && issue.labels.length <= 100, 'Public traffic unavailable.');
  const labels = issue.labels.map(label => label?.name);
  return { number: issue.number, assignees: issue.assignees.map(user => ({ login: user.login.toLowerCase() })), commentCount: issue.comments,
    updatedAt: readTimestamp(issue.updated_at) === null ? null : issue.updated_at,
    helpWanted: labels.includes('help wanted'), goodFirstIssue: labels.includes('good first issue') };
}

async function runJobs(jobs) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]();
  }));
}
