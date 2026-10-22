import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { markRefreshing, readSummary, refreshDue } from './boardSummary.js';
import { cliPath, createCliRunner } from './cliRunner.js';
import { readGitContext } from './gitContext.js';

const refreshScript = fileURLToPath(new URL('./refreshBoard.js', import.meta.url));

export function hookDeps(env = process.env) {
  return { gitContext: cwd => readGitContext(cwd), run: createCliRunner({ env }), dataDir: env.CLAUDE_PLUGIN_DATA,
    readSummary, refreshDue, startRefresh: (root, file) => startRefresh(root, file, env), now: Date.now, cliPath };
}

function startRefresh(root, file, env) {
  if (!markRefreshing(file)) return false;
  try {
    const child = spawn(process.execPath, [refreshScript, root, file], { cwd: root, detached: true, stdio: 'ignore',
      env: { ...env, ATC_READ_ONLY: '1', NO_COLOR: '1' } });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
