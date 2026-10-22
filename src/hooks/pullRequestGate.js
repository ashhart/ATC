import { readOverlapResult } from './cliResults.js';
import { contextOutput, denyOutput } from './hookIo.js';
import { isAbsolutePath, isRecord, issueList, plural } from './hookValues.js';

const createPattern = /(?:^|[\s;&|(`$])gh(?:\s+(?:-R|--repo)(?:\s+|=)[^\s;&|]+)*\s+pr\s+(?:create|new)(?=$|[\s;&|)`])/;
const unchecked = 'ATC could not check this pull request for overlapping work.';

export function isPullRequestCreate(command) {
  return typeof command === 'string' && command.length <= 100000 && createPattern.test(command);
}

export function preBashOutput(input, deps) {
  if (!isRecord(input) || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash'
    || !isAbsolutePath(input.cwd) || !isRecord(input.tool_input) || !isPullRequestCreate(input.tool_input.command)) return null;
  if (!deps.gitContext(input.cwd)) return null;
  const result = readOverlapResult(deps.run(['overlap', '--json'], { cwd: input.cwd, timeout: 75000 }));
  if (!result) return contextOutput('PreToolUse', unchecked);
  const pullConflicts = result.pulls.filter(row => row.conflict === 'conflicts');
  const worktreeConflicts = result.worktrees.filter(row => row.conflict === 'conflicts');
  if (pullConflicts.length > 0 || worktreeConflicts.length > 0) {
    const parts = pullConflicts.map(row => `open pull request #${row.id}${fileCount(row.conflictFiles)}`);
    if (worktreeConflicts.length > 0) {
      const files = worktreeConflicts.every(row => row.conflictFiles !== null)
        ? fileCount(worktreeConflicts.reduce((total, row) => total + row.conflictFiles, 0)) : '';
      parts.push(`${worktreeConflicts.length} other local ${plural(worktreeConflicts.length, 'worktree', 'worktrees')}${files}`);
    }
    return denyOutput(`ATC found merge conflicts between these changes and ${joinParts(parts)}. `
      + 'Coordinate with the other contributor, or rebase onto their change, before opening this pull request. `atc overlap` shows the details.');
  }
  const sentences = [];
  if (result.pulls.length > 0 || result.worktrees.length > 0) {
    const shared = [];
    if (result.pulls.length > 0) shared.push(`open pull ${plural(result.pulls.length, 'request', 'requests')} ${issueList(result.pulls.map(row => row.id))}`);
    if (result.worktrees.length > 0) shared.push(`${result.worktrees.length} other local ${plural(result.worktrees.length, 'worktree', 'worktrees')}`);
    const untested = [...result.pulls, ...result.worktrees].filter(row => row.conflict === 'unknown').length;
    sentences.push(`ATC: these changes share files with ${joinParts(shared)}.`,
      untested > 0 ? `ATC could not test ${untested} of them for merge conflicts.` : 'ATC found no merge conflict.',
      'Mentioning the overlap in the pull request description helps reviewers.');
  }
  if (!result.complete) sentences.push('ATC coverage was incomplete, so other overlapping work may exist.');
  return sentences.length > 0 ? contextOutput('PreToolUse', sentences.join(' ')) : null;
}

function fileCount(amount) {
  return amount === null ? '' : ` (${amount} conflicting ${plural(amount, 'file', 'files')})`;
}

function joinParts(parts) {
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
