#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { Failure } from '../core/failure.js';
import { helpText, runCli } from './actions.js';
import { parseCliArgs } from './args.js';
import { createGh } from './gh.js';
import { createGit } from './git.js';
import { referencedNumbers, renderHuman } from './human/render.js';
import { resultExitCode } from './result.js';
import { createLabels } from './terminalText.js';
import { fetchTitles } from './titles.js';
import { version } from './version.js';

try {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help' || parsed.command === 'version') {
    if (parsed.rest.length > 0) throw new Failure('Help and version take no arguments.');
    process.stdout.write(parsed.command === 'help' ? helpText : `${version}\n`);
  } else {
    const human = !parsed.flags.json && (parsed.flags.text || process.stdout.isTTY === true);
    const labels = human ? createLabels() : undefined;
    const result = await runCli(parsed, { gh: createGh(), git: createGit(), sleep, env: process.env, labels, cache: true });
    if (human) {
      if (labels.repository) {
        const found = fetchTitles(createGh(), labels.repository, referencedNumbers(result, labels));
        for (const [number, title] of found) if (!labels.titles.has(number)) labels.titles.set(number, title);
      }
      const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
      process.stdout.write(`${renderHuman(result, labels, { color, now: Date.now() })}\n`);
    } else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = resultExitCode(result, parsed.flags.strict);
  }
} catch (error) {
  process.stderr.write(`atc: ${error instanceof Failure ? error.message : 'unexpected error'}\n`);
  process.exitCode = 1;
}
