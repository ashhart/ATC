import path from 'node:path';
import { readGuardResult } from './guardResults.js';
import { denyOutput } from './hookIo.js';
import { isAbsolutePath, isPathText, isRecord } from './hookValues.js';

const failed = 'ATC could not revalidate this work ticket. Run `atc guard --json` and resolve its result before continuing.';
const denied = 'ATC requires this work ticket to be refreshed or its scope to be corrected before continuing. Run `atc guard --json` for the fixed outcome.';
const editTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const gitPush = /(?:^|[\s;&|(`$"'])(?:[A-Za-z0-9_./-]+\/)?git\b[^;&|`\n]*?\bpush(?=$|[\s;&|)`"'])/;
const prPublish = /(?:^|[\s;&|(`$"'])(?:[A-Za-z0-9_./-]+\/)?gh\b[^;&|`\n]*?\bpr\b[^;&|`\n]*?\b(?:create|new|edit)(?=$|[\s;&|)`"'])/;

export function isPublishCommand(command) {
  if (typeof command !== 'string' || command.length > 100000) return false;
  const normalized = command.replace(/\\\r?\n/g, ' ');
  return gitPush.test(normalized) || prPublish.test(normalized);
}

export function hookTicketStatus(cwd, deps) {
  let status = 'absent';
  try { status = deps.ticketStatus?.(cwd) ?? 'absent'; } catch { status = 'unknown'; }
  return ['present', 'absent'].includes(status) ? status : 'unknown';
}

export function workGuardOutput(args, cwd, deps, status = hookTicketStatus(cwd, deps)) {
  if (status === 'absent') return null;
  let result;
  try { result = readGuardResult(deps.run(['guard', ...args, '--json'], { cwd, timeout: 75000 })); }
  catch { return denyOutput(failed); }
  if (!result) return denyOutput(failed);
  return result.ready ? null : denyOutput(denied);
}

export function guardFailureOutput(deps, cwd = process.cwd()) {
  let status;
  try { status = deps.ticketStatus?.(cwd) ?? 'absent'; } catch { status = 'unknown'; }
  if (status === 'absent') return null;
  if (status === 'present') return denyOutput(failed);
  try { return deps.gitContext(cwd) ? denyOutput(failed) : null; } catch { return denyOutput(failed); }
}

export function preEditOutput(input, deps) {
  if (!isRecord(input) || input.hook_event_name !== 'PreToolUse' || !editTools.includes(input.tool_name)
    || !isAbsolutePath(input.cwd) || !isRecord(input.tool_input)) return null;
  const git = deps.gitContext(input.cwd);
  if (!git) return null;
  const status = hookTicketStatus(input.cwd, deps);
  if (status === 'absent') return null;
  const raw = input.tool_input.file_path ?? input.tool_input.notebook_path;
  if (!isPathText(raw) || !isAbsolutePath(git.root)) return denyOutput(failed);
  const file = path.resolve(input.cwd, raw);
  const relative = path.relative(git.root, file);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return denyOutput(denied);
  return workGuardOutput([file], input.cwd, deps, status);
}
