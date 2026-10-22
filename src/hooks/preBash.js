#!/usr/bin/env node
import { hookDeps } from './hookDeps.js';
import { runHook } from './hookIo.js';
import { preBashOutput } from './pullRequestGate.js';

await runHook(preBashOutput, hookDeps());
