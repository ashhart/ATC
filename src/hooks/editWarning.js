import path from 'node:path';
import { readWhoResult } from './cliResults.js';
import { contextOutput } from './hookIo.js';
import { isAbsolutePath, isPathText, isRecord, issueList, plural } from './hookValues.js';

export function postEditOutput(input, deps) {
  if (!isRecord(input) || input.hook_event_name !== 'PostToolUse' || !isAbsolutePath(input.cwd) || !isRecord(input.tool_input)) return null;
  const raw = input.tool_input.file_path ?? input.tool_input.notebook_path;
  if (!isPathText(raw)) return null;
  const file = path.resolve(input.cwd, raw);
  if (!isAbsolutePath(file) || !deps.gitContext(input.cwd)) return null;
  const who = readWhoResult(deps.run(['who', file, '--json'], { cwd: input.cwd, timeout: 8000 }));
  if (!who || (who.pullRequests.length === 0 && who.worktrees === 0 && who.agents === 0)) return null;
  const places = [];
  if (who.pullRequests.length > 0) {
    const newest = [...who.pullRequests].sort((first, second) => second - first);
    places.push(`open pull ${plural(who.pullRequests.length, 'request', 'requests')} ${issueList(newest)}`);
  }
  if (who.worktrees > 0) places.push(`${who.worktrees} other local ${plural(who.worktrees, 'worktree', 'worktrees')}`);
  if (who.agents > 0) places.push(`${who.agents} ${plural(who.agents, 'agent', 'agents')} on other machines`);
  const coverage = who.complete ? '' : ' ATC coverage was incomplete, so other changes may also touch it.';
  return contextOutput('PostToolUse',
    `ATC: this file is also changed in ${places.join(' and ')}.${coverage} \`atc overlap\` shows whether the changes conflict.`);
}
