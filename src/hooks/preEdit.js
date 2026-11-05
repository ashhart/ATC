#!/usr/bin/env node
import { hookDeps } from './hookDeps.js';
import { runHook } from './hookIo.js';
import { guardFailureOutput, preEditOutput } from './workGate.js';

const deps = hookDeps();
await runHook(preEditOutput, deps, { onFailure: () => guardFailureOutput(deps) });
