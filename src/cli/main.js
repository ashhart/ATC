#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { Failure } from '../core/failure.js';
import { helpText, runCli } from './actions.js';
import { parseCliArgs } from './args.js';
import { createGh } from './gh.js';
import { createGit } from './git.js';

try {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help') process.stdout.write(helpText);
  else process.stdout.write(`${JSON.stringify(await runCli(parsed, { gh: createGh(), git: createGit(), sleep, env: process.env }), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`atc: ${error instanceof Failure ? error.message : 'unexpected error'}\n`);
  process.exitCode = 1;
}
