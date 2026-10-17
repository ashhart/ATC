import fs from 'node:fs';
import { Failure } from '../core/failure.js';
import { isBotLogin, isRepository } from '../core/values.js';
import { createGithub } from './github.js';
import { runCoordinator } from './run.js';

try {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.INPUT_TOKEN;
  const botLogin = process.env['INPUT_BOT-LOGIN'] || 'github-actions[bot]';
  if (!isRepository(repository) || !token || !isBotLogin(botLogin)) throw new Failure('Missing or invalid action settings');
  const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const github = createGithub({ token, repository, apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com' });
  await runCoordinator({ github, eventName: process.env.GITHUB_EVENT_NAME, payload, botLogin, log: line => process.stdout.write(`${line}\n`) });
} catch (error) {
  process.stdout.write(`::error::${error instanceof Failure ? error.message : 'ATC failed unexpectedly'}\n`);
  process.exitCode = 1;
}
