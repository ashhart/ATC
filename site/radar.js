import { element, freshAgents, age } from './dom.js';

const phases = ['working', 'reviewing', 'blocked', 'idle'];
const labels = { working: 'Working', reviewing: 'In review', blocked: 'Needs help', idle: 'No signal' };
const svgNamespace = 'http://www.w3.org/2000/svg';
function shape(tag, attributes) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}
function flightSymbol() {
  const svg = shape('svg', { viewBox: '0 0 24 24', class: 'scope-symbol', 'aria-hidden': 'true' });
  svg.append(shape('path', { d: 'M20 3 13.5 21l-3-7.5L3 10.5 20 3Z' }));
  return svg;
}
function background() {
  const scene = element('div', 'scope-scene');
  const rings = element('div', 'scope-rings');
  for (let index = 1; index <= 4; index++) rings.append(element('i', `scope-ring ring-${index}`));
  const sweep = element('div', 'scope-sweep');
  sweep.style.animationDelay = `${-(Date.now() / 1000 % 22)}s`;
  rings.append(sweep, element('span', 'scope-crosshair'));
  scene.append(rings, element('div', 'scope-horizon'));
  scene.setAttribute('aria-hidden', 'true');
  return scene;
}
function track(flight, inspect) {
  const button = element('button', `scope-flight ${flight.phase}`);
  button.dataset.scopeIssue = String(flight.issue);
  button.setAttribute('aria-label', `Inspect issue ${flight.issue}`);
  const agents = freshAgents(flight);
  const lastSeen = agents.map(agent => agent.lastSeen).sort().at(-1) || flight.lastActivity;
  button.title = `Issue ${flight.issue} · ${labels[flight.phase]} · ${age(lastSeen)}`;
  const tail = element('span', 'scope-tail');
  tail.setAttribute('aria-hidden', 'true');
  const beacon = element('span', 'scope-beacon');
  beacon.append(element('i', 'scope-halo'), flightSymbol());
  const text = element('span', 'scope-callout');
  const identity = element('span', 'scope-identity');
  identity.append(element('strong', '', `#${flight.issue}`), element('span', 'scope-state-dot'));
  const metadata = element('span', 'scope-metadata');
  metadata.append(element('span', 'scope-agent-count', `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`));
  for (let index = 0; index < Math.min(agents.length, 4); index++) metadata.append(element('i', 'scope-agent-pip'));
  text.append(identity, element('span', 'scope-phase', labels[flight.phase]), metadata);
  button.append(tail, beacon, text);
  button.addEventListener('click', () => inspect(flight));
  return button;
}

export function renderRadar(container, flights, inspect, options = {}) {
  const focused = document.activeElement?.dataset?.scopeIssue;
  container.replaceChildren();
  container.classList.add('traffic-scope');
  container.classList.toggle('is-scanning', Boolean(options.live));
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Issue activity map');
  container.append(background());
  const top = element('div', 'scope-topline');
  const heading = element('span', 'scope-track-count');
  heading.append(element('i', 'scope-signal'), element('strong', '', flights.length), element('span', '', 'tracked issues'));
  top.append(heading, element('span', 'scope-window', 'Check-in window 5m'));
  container.append(top);
  if (!flights.length) {
    const empty = element('div', 'scope-empty');
    empty.append(flightSymbol(), element('strong', '', 'Quiet airspace'), element('span', '', 'No flights match this view.'));
    container.append(empty);
    return;
  }
  const shown = [...flights].sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase) || a.issue - b.issue).slice(0, 8);
  const field = element('div', 'scope-field');
  for (const flight of shown) field.append(track(flight, inspect));
  container.append(field);
  const bottom = element('div', 'scope-statusbar');
  for (const phase of phases) {
    const count = flights.filter(flight => flight.phase === phase).length;
    if (!count && container.clientWidth < 440) continue;
    const status = element('span', `scope-status ${phase}`);
    status.append(element('i'), element('span', '', labels[phase]), element('strong', '', count));
    bottom.append(status);
  }
  container.append(bottom);
  if (shown.length < flights.length) container.append(element('span', 'scope-overflow', `Showing ${shown.length} of ${flights.length}; all flights below`));
  if (focused) container.querySelector(`[data-scope-issue="${Number(focused)}"]`)?.focus({ preventScroll: true });
}
