#!/usr/bin/env node
import { createFraming, parseLine } from './framing.js';
import { handleMessage, rpcCodes, rpcError } from './protocol.js';

let queue = Promise.resolve();

function send(response) {
  if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function answer(line) {
  const parsed = parseLine(line);
  if (!parsed.ok) return send(rpcError(null, rpcCodes.parse, 'Parse error.'));
  try {
    send(await handleMessage(parsed.message));
  } catch {
    send(rpcError(null, rpcCodes.internal, 'Internal error.'));
  }
}

const framing = createFraming({
  onLine: line => { queue = queue.then(() => answer(line)); },
  onOversize: () => { queue = queue.then(() => send(rpcError(null, rpcCodes.parse, 'Message too large.'))); }
});

process.stdout.on('error', () => process.exit(0));
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => framing.push(chunk));
process.stdin.on('end', () => {
  framing.end();
  queue = queue.then(() => { process.exitCode = 0; });
});
