const inputLimit = 1024 * 1024;

export function contextOutput(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

export function denyOutput(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

export function readHookInput(stream = process.stdin, timeoutMs = 5000) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeAllListeners('data');
      resolve(value);
    };
    const timer = setTimeout(() => { finish(null); stream.pause?.(); }, timeoutMs);
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > inputLimit) { finish(null); stream.destroy?.(); return; }
      chunks.push(Buffer.from(chunk));
    });
    stream.on('error', () => finish(null));
    stream.on('end', () => {
      try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(null); }
    });
  });
}

export async function runHook(handler, deps, { stdin = process.stdin, stdout = process.stdout } = {}) {
  let output = null;
  try {
    const input = await readHookInput(stdin);
    output = input === null ? null : handler(input, deps);
  } catch {
    output = null;
  }
  if (output) stdout.write(`${JSON.stringify(output)}\n`);
  return output;
}
