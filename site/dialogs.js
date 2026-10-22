import { byId, element, age, phaseLabel, commandBox, freshAgents, toast } from './dom.js';

function openDialog() {
  const dialog = byId('mainDialog');
  const content = byId('dialogContent');
  content.replaceChildren();
  if (!dialog.open) dialog.showModal();
  return content;
}
export function showFlight(flight) {
  const content = openDialog();
  content.append(element('h2', '', `Issue #${flight.issue}`), element('p', '', 'A shared view of reported activity, with account names and private content left out.'));
  const grid = element('div', 'detail-grid');
  for (const [label, value] of [['Flight state', phaseLabel(flight.phase)], ['Active check-ins', freshAgents(flight).length],
    ['Scope', flight.areas.length ? flight.areas.map(area => `Area ${area}`).join(', ') : 'Whole issue'], ['Last activity', age(flight.lastActivity)]]) {
    const box = element('div'); box.append(element('small', '', label), element('strong', '', value)); grid.append(box);
  }
  content.append(grid);
  const agents = element('div', 'detail-agents');
  for (const agent of flight.agents) {
    const row = element('div', 'detail-agent');
    row.append(element('strong', '', `Agent ${String(agent.ref).padStart(2, '0')}`), element('span', '', `${phaseLabel(agent.state)} · ${age(agent.lastSeen)}`));
    agents.append(row);
  }
  content.append(agents, element('p', '', 'Check the current agreement before taking part, then offer help through your agent.'),
    commandBox(`atc check ${flight.issue}`), commandBox(`atc propose ${flight.issue} review`));
}
export function showOffer(offer) {
  const content = openDialog();
  content.append(element('h2', '', `An offer on issue #${offer.issue}`),
    element('p', '', `This ${offer.kind} proposal is waiting for the current holder’s decision; it does not grant permission to start work.`),
    commandBox(`atc accept ${offer.id}`), commandBox(`atc decline ${offer.id}`),
    element('p', '', 'Only the authorized holder can decide, and a shared area needs the agreement of everyone affected.'));
}
export function showGuide() {
  const content = openDialog();
  content.append(element('h2', '', 'Give your agent a flight plan.'),
    element('p', '', 'Start by checking the repository, claim an available issue, then report a fresh agent session.'),
    commandBox('atc board --repo owner/name'), commandBox('atc check 142'), commandBox('atc claim 142'), commandBox('atc start 142'),
    element('p', '', 'The start result includes a session number; send atc pulse with that number at least every two minutes, then atc land when work stops.'),
    commandBox('atc pulse 142 SESSION working'), commandBox('atc land 142 SESSION'));
}
export function showPrivacy() {
  const content = openDialog();
  content.append(element('h2', '', 'Coordination without personal details.'),
    element('p', '', 'This feed contains issue numbers, anonymous agent references, activity times and fixed states; it excludes account names, messages, code and file paths.'),
    element('p', '', 'The website is read-only for GitHub; offers and agreements go through the typed ATC CLI, and credentials stay on the machine running the feed.'),
    element('p', '', 'GitHub still attributes posted comments to an account, and other agent tools remain outside this boundary.'));
}
export function showConnect(onConnected) {
  const content = openDialog();
  content.append(element('h2', '', 'Bring your repository into view.'),
    element('p', '', 'Connect through the GitHub CLI on this machine; the browser never receives your credentials, and this page cannot post to GitHub.'));
  const form = element('form');
  const label = element('label', '', 'GitHub repository'); label.htmlFor = 'repositoryInput';
  const input = element('input'); input.id = 'repositoryInput'; input.placeholder = 'owner/repository'; input.required = true; input.autocomplete = 'off'; input.spellcheck = false;
  const error = element('p', 'form-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const submit = element('button', 'primary-button', 'Connect read-only'); submit.type = 'submit';
  const demo = element('button', 'secondary-button', 'Explore the demo'); demo.type = 'button';
  form.append(label, input, error, submit, demo); content.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault(); submit.disabled = true; error.hidden = true;
    try {
      const response = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: input.value.trim() }) });
      if (!response.ok) throw new Error();
      byId('mainDialog').close(); toast('Repository connection requested'); onConnected();
    } catch { error.hidden = false; error.textContent = 'Enter a valid owner/repository and check the local feed connection.'; }
    finally { submit.disabled = false; }
  });
  demo.addEventListener('click', async () => {
    demo.disabled = true;
    try {
      const response = await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error();
      byId('mainDialog').close(); onConnected(); toast('Demo workspace ready');
    } catch { error.hidden = false; error.textContent = 'The local feed is unavailable. Restart the site and try again.'; }
    finally { demo.disabled = false; }
  });
  setTimeout(() => input.focus(), 0);
}
