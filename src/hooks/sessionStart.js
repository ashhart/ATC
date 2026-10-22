#!/usr/bin/env node
import { hookDeps } from './hookDeps.js';
import { runHook } from './hookIo.js';
import { sessionStartOutput } from './sessionContext.js';

await runHook(sessionStartOutput, hookDeps());
