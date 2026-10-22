export const byId = id => document.getElementById(id);
export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}
export function age(time) {
  if (!time) return 'No check-in';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
export const phaseLabel = phase => ({ working: 'In flight', reviewing: 'In review', blocked: 'Needs a hand', idle: 'No check-in' })[phase] || 'No check-in';
export const phaseIcon = phase => ({ working: '↗', reviewing: '◉', blocked: '◇', idle: '◷' })[phase] || '◷';
export function toast(message) {
  const node = byId('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(node.dismiss);
  node.dismiss = setTimeout(() => { node.hidden = true; }, 3000);
}
export async function copyCommand(command) {
  try { await navigator.clipboard.writeText(command); toast('Command copied to clipboard'); }
  catch { toast('Select the command to copy it'); }
}
export function commandBox(command) {
  const box = element('div', 'command-box');
  const code = element('code', '', command);
  const copy = element('button', '', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', () => copyCommand(command));
  box.append(code, copy);
  return box;
}
export function freshAgents(flight) {
  return flight.agents.filter(agent => Date.parse(agent.expiresAt) > Date.now());
}
