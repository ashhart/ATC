#!/usr/bin/env node
import { postEditOutput } from './editWarning.js';
import { hookDeps } from './hookDeps.js';
import { runHook } from './hookIo.js';

await runHook(postEditOutput, hookDeps());
