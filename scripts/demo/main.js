#!/usr/bin/env node
import { runDemo } from './demo.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--fast')) {
  process.stderr.write('Usage: npm run demo [-- --fast]\n');
  process.exitCode = 1;
} else {
  try {
    await runDemo({ fast: args.includes('--fast'), color: process.stdout.isTTY === true && !process.env.NO_COLOR });
  } catch {
    process.stderr.write('The demo stopped early. Run npm run check to confirm the CLI works here.\n');
    process.exitCode = 1;
  }
}
