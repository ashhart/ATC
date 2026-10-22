import { createStyle } from '../../src/cli/terminalText.js';

const agentColors = { ada: '36', bo: '33', cy: '32', dee: '35', mae: '2' };

export function createNarrator({ fast = false, write, color = false }) {
  const style = createStyle(color);
  const pause = () => fast ? Promise.resolve() : new Promise(done => setTimeout(done, 350));
  const tag = name => {
    const label = name.padEnd(4);
    return color ? `\u001b[${agentColors[name] || '1'}m${label}\u001b[0m` : label;
  };
  return {
    style,
    color,
    async heading(text) {
      write(`\n${style.bold(text)}\n`);
      await pause();
    },
    async say(name, text) {
      write(`${tag(name)} ${text}\n`);
      await pause();
    },
    async note(text) {
      write(`${text}\n`);
      await pause();
    },
    async block(text) {
      for (const line of text.split('\n')) write(`       ${line}\n`);
      await pause();
    }
  };
}
