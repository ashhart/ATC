import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNarrator } from './narrator.js';
import { runWithAtc } from './withAtc.js';
import { runWithoutAtc } from './withoutAtc.js';

export async function runDemo({ fast = false, write = text => process.stdout.write(text), color = false, temporary = os.tmpdir() } = {}) {
  const say = createNarrator({ fast, write, color });
  const root = fs.mkdtempSync(path.join(temporary, 'atc-demo-'));
  try {
    const first = path.join(root, 'without');
    const second = path.join(root, 'with');
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    const without = await runWithoutAtc(first, say);
    await say.note(`Result: ${score(without)}`);
    const withAtc = await runWithAtc(second, say);
    await say.note(`Result: ${score(withAtc)}, 1 conflict caught before the PR`);
    await say.heading('Scoreboard');
    await say.note(`without ATC  ${score(without)}`);
    await say.note(`with ATC     ${score(withAtc)}`);
    return { without, with: withAtc };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function score({ merged, wasted, conflicts }) {
  return `merged ${merged}  wasted ${wasted}  conflicts ${conflicts}`;
}
