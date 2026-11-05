#!/usr/bin/env node
import { hookDeps } from './hookDeps.js';
import { runHook } from './hookIo.js';
import { preBashOutput } from './pullRequestGate.js';
import { guardFailureOutput } from './workGate.js';

const deps = hookDeps();
await runHook(preBashOutput, deps, { onFailure: () => guardFailureOutput(deps) });
