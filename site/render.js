import { byId, element, age, phaseLabel, phaseIcon, freshAgents } from './dom.js';
import { renderRadar } from './radar.js';

export function render(feed, state, inspect, showOffer) {
  feed = { ...feed, flights: feed.flights.map(flight => {
    const fresh = freshAgents(flight);
    const phase = ['working', 'reviewing', 'blocked'].find(value => fresh.some(agent => agent.state === value)) || 'idle';
    return { ...flight, phase };
  }) };
  const flights = feed.flights.filter(flight => (state.filter === 'all' || flight.phase === state.filter)
    && (!state.search || String(flight.issue).includes(state.search.replace('#', '').trim())));
  byId('demoNotice').hidden = feed.source !== 'demo';
  byId('workspaceName').textContent = feed.source === 'demo' ? 'Demo workspace' : 'Connected repository';
  const stale = Date.now() - Date.parse(feed.observedAt) > 90000;
  const connection = stale ? 'stale' : feed.connection;
  byId('connection').className = `connection ${connection}`;
  byId('connectionLabel').textContent = feed.source === 'demo' ? 'Demo feed' : ({ live: 'Feed connected', refreshing: 'Refreshing', stale: 'Feed is stale', error: 'Connection unavailable' })[connection];
  byId('airspaceBadge').textContent = feed.source === 'demo' ? 'Demo traffic' : connection === 'live' ? 'Live feed' : 'Last snapshot';
  byId('feedClock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(Date.now()) + ' UTC';
  byId('updatedLabel').textContent = `Updated ${age(feed.observedAt)}`;
  const active = feed.flights.flatMap(freshAgents).filter(agent => ['working', 'reviewing'].includes(agent.state));
  byId('metricAgents').textContent = active.length;
  byId('metricFlight').textContent = feed.flights.filter(flight => flight.phase === 'working' && freshAgents(flight).length).length;
  byId('metricReview').textContent = feed.flights.filter(flight => flight.phase === 'reviewing' && freshAgents(flight).length).length;
  byId('metricOverlap').textContent = feed.summary.overlaps;
  byId('overlapDetail').textContent = feed.summary.overlaps ? 'worth coordinating' : feed.complete ? 'airspace looks clear' : 'coverage incomplete';
  byId('navFlights').textContent = feed.flights.length;
  byId('navOffers').textContent = feed.offers.length;
  byId('offerCount').textContent = feed.offers.length;
  byId('flightCount').textContent = feed.flights.length;
  const warning = byId('feedWarning');
  warning.hidden = feed.complete && connection === 'live';
  warning.textContent = connection === 'error' ? 'The live feed is unavailable. Check your local GitHub connection and refresh.'
    : connection === 'stale' ? 'This snapshot is getting old. Active counts only include unexpired check-ins.'
      : !feed.complete ? 'Coverage is incomplete. Check the issue with ATC before starting work.' : 'Fetching a fresh snapshot…';
  renderRadar(byId('radar'), flights, inspect, { live: !stale && feed.connection === 'live' });
  renderFlights(flights, inspect);
  renderOffers(feed, showOffer, inspect);
  renderActivity(feed.recent);
  byId('tableCount').textContent = `${flights.length} of ${feed.flights.length} flights`;
  byId('overviewPanel').hidden = state.view === 'flights' || state.view === 'activity';
  byId('flightPanel').hidden = state.view === 'collaboration' || state.view === 'activity';
  byId('activityPanel').hidden = state.view === 'flights' || state.view === 'collaboration';
  byId('overviewPanel').classList.toggle('collaboration-view', state.view === 'collaboration');
}

function renderFlights(flights, inspect) {
  const container = byId('flightRows');
  const focused = document.activeElement?.dataset?.issue;
  container.replaceChildren();
  if (!flights.length) { container.append(element('div', 'empty-state', 'No matching flights. Try another filter or issue number.')); return; }
  for (const flight of flights) {
    const row = element('button', 'flight-row');
    row.dataset.issue = String(flight.issue);
    row.setAttribute('aria-label', `Inspect issue ${flight.issue}, ${phaseLabel(flight.phase)}`);
    const issue = element('span', 'issue-name');
    const label = element('span', '', `Issue #${flight.issue}`);
    label.append(element('span', 'flight-id', flight.pullRequests.length ? `PR #${flight.pullRequests[0]}` : 'Issue flight'));
    issue.append(element('span', 'issue-symbol', phaseIcon(flight.phase)), label);
    const agents = element('span', 'agent-stack');
    const dots = element('span', 'agent-dots');
    const active = freshAgents(flight);
    for (const agent of active.slice(0, 3)) dots.append(element('span', 'agent-dot', String(agent.ref).padStart(2, '0')));
    agents.append(dots, element('span', '', `${active.length} here`));
    const areas = element('span', 'scopes');
    for (const area of flight.areas.slice(0, 2)) areas.append(element('span', 'scope-chip', `Area ${String(area).padStart(2, '0')}`));
    if (!flight.areas.length) areas.append(element('span', 'scope-chip', 'Whole issue'));
    row.append(issue, agents, areas, element('span', 'last-seen', age(flight.lastActivity)),
      element('span', `state-badge ${flight.phase}`, phaseLabel(flight.phase)), element('span', 'row-arrow', '›'));
    row.addEventListener('click', () => inspect(flight));
    container.append(row);
  }
  if (focused) container.querySelector(`[data-issue="${Number(focused)}"]`)?.focus({ preventScroll: true });
}

function renderOffers(feed, showOffer, inspect) {
  const list = byId('coordinationList');
  list.replaceChildren();
  for (const offer of feed.offers.slice(0, 2)) {
    const card = element('article', 'offer-card');
    const top = element('div', 'offer-top');
    top.append(element('span', 'offer-symbol', '⇄'), element('span', 'offer-tag', 'An offer to collaborate'));
    const names = { pair: 'Pair up', split: 'Share the scope', review: 'A fresh pair of eyes', takeover: 'A proposed handoff' };
    card.append(top, element('h3', '', `${names[offer.kind]} on #${offer.issue}`),
      element('p', '', offer.kind === 'review' ? 'Review has been offered for this work.' : 'A contributor has offered to help move this issue forward.'));
    const button = element('button', '', 'Inspect offer ↗');
    button.addEventListener('click', () => showOffer(offer));
    card.append(button); list.append(card);
  }
  if (feed.overlaps.length) {
    const overlap = feed.overlaps[0];
    const card = element('article', 'offer-card warning');
    const top = element('div', 'offer-top');
    top.append(element('span', 'offer-symbol', '◇'), element('span', 'offer-tag amber', 'Shared paths'));
    card.append(top, element('h3', '', `PR #${overlap.pullRequests[0]} meets #${overlap.pullRequests[1]}`),
      element('p', '', `${overlap.sharedFiles} shared ${overlap.sharedFiles === 1 ? 'file' : 'files'} to check before a merge.`));
    const button = element('button', '', 'View related flight ↗');
    const related = feed.flights.find(flight => flight.pullRequests.some(pull => overlap.pullRequests.includes(pull)));
    button.disabled = !related;
    button.addEventListener('click', () => related && inspect(related));
    card.append(button); list.append(card);
  }
  if (!list.children.length) list.append(element('div', 'empty-state', 'No pending offers or shared paths in this snapshot.'));
}

function renderActivity(recent) {
  const list = byId('activityList');
  list.replaceChildren();
  const labels = { started: 'Flight checked in', checkIn: 'Heartbeat received', review: 'Review in progress', offer: 'Help offered', landed: 'Flight signed off' };
  for (const event of [...recent].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 3)) {
    const row = element('div', 'activity-item');
    const detail = element('div');
    detail.append(element('strong', '', `${labels[event.kind]} on #${event.issue}`), element('p', '', `${event.agents} ${event.agents === 1 ? 'agent' : 'agents'} · ${age(event.time)}`));
    row.append(element('span', 'activity-icon', event.kind === 'offer' ? '⇄' : '↗'), detail); list.append(row);
  }
  if (!list.children.length) list.append(element('div', 'empty-state', 'New check-ins will appear here.'));
}
