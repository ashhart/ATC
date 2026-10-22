#!/usr/bin/env node
import { refreshBoard } from './boardSummary.js';
import { createCliRunner } from './cliRunner.js';

try {
  refreshBoard(process.argv.slice(2), createCliRunner());
} catch {
  process.exitCode = 0;
}
