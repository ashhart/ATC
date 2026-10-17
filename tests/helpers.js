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

export function stubGit(files = []) {
  return { remoteFor: () => 'origin', mergeBase: () => 'a'.repeat(40), changedFiles: () => new Set(files) };
}

export function cli(fake, user, args, { git = stubGit(), env = {} } = {}) {
  fake.store.cliUser = user;
  const sleep = async () => { fake.clock.now += 1000; };
  return runCli(parseCliArgs(args), { gh: createGh(fake.runGh), git, sleep, now: () => fake.clock.now, env });
}

export function posted(fake) {
  return fake.store.comments.map(comment => [comment.user.login, comment.body]);
}

export function days(count) {
  return count * 86400000;
}
