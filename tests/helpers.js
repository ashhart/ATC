import { createGithub } from '../src/action/github.js';
import { runCoordinator } from '../src/action/run.js';
import { readBoard } from '../src/core/board.js';
import { runCli } from '../src/cli/actions.js';
import { parseCliArgs } from '../src/cli/args.js';
import { createGh } from '../src/cli/gh.js';
import { createFakeGithub } from './fakeGithub.js';

export const areasConfig = { areas: { core: ['src/core/'], docs: ['docs/', 'README.md'], tests: ['tests/'] } };

export function setup(config = areasConfig) {
  const fake = createFakeGithub();
  fake.store.config = config;
  return fake;
}

export async function runAction(fake, eventName = 'issue_comment', payload = {}) {
  const logs = [];
  const github = createGithub({ token: 'test-token', repository: fake.repository, apiUrl: 'https://api.github.test', fetcher: fake.fetch });
  await runCoordinator({ github, eventName, payload, botLogin: fake.botLogin, now: () => fake.clock.now, log: line => logs.push(line) });
  return logs;
}

export function cli(fake, user, args, sleep = async () => {}) {
  fake.store.cliUser = user;
  return runCli(parseCliArgs(args), { gh: createGh(fake.runGh), sleep, env: {} });
}

export function boardIssue(fake) {
  return [...fake.store.issues.values()].find(issue => issue.user.type === 'Bot' && issue.labels.some(label => label.name === 'atc-board'));
}

export function boardState(fake) {
  return readBoard(boardIssue(fake).body);
}

export function botComments(fake, number) {
  return fake.store.comments
    .filter(comment => comment.user.type === 'Bot' && (number === undefined || comment.issue_url.endsWith(`/issues/${number}`)))
    .map(comment => comment.body);
}

export function assignees(fake, number) {
  return fake.store.issues.get(number).assignees.map(user => user.login).sort();
}

export function reactions(fake, comment) {
  return fake.store.reactions.filter(entry => entry.comment === comment.id).map(entry => entry.content);
}

export function claimRows(state) {
  return state.claims.map(claim => [claim.issue, claim.login, claim.role, claim.areas]);
}
