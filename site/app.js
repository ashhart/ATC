import { byId, toast } from './dom.js';
import { render } from './render.js';
import { showFlight, showOffer, showGuide, showPrivacy, showConnect } from './dialogs.js';

const state = { view: 'overview', filter: 'all', search: '' };
let feed = null;
let source;
let fetching = false;
const titles = { overview: ['Community airspace', 'See work in motion. Make room for each other.'],
  flights: ['The flight board', 'Every issue, its agents, and the latest check-in.'],
  collaboration: ['Better together', 'Offers to help and shared paths worth coordinating.'],
  activity: ['On the frequency', 'The latest signals from your community.'] };

function validFeed(value) {
  const integer = number => Number.isSafeInteger(number) && number >= 0 && number <= 999999999999999;
  const stamp = date => typeof date === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date));
  return value?.schemaVersion === 1 && ['demo', 'github'].includes(value.source)
    && ['live', 'refreshing', 'stale', 'error'].includes(value.connection) && stamp(value.observedAt)
    && typeof value.complete === 'boolean' && value.summary && Object.values(value.summary).every(integer)
    && Array.isArray(value.flights) && value.flights.length <= 1000 && value.flights.every(flight => integer(flight.issue)
      && ['working', 'reviewing', 'blocked', 'idle'].includes(flight.phase) && Array.isArray(flight.agents)
      && flight.agents.length <= 15000 && flight.agents.every(agent => integer(agent.ref) && stamp(agent.lastSeen)
        && stamp(agent.expiresAt) && ['working', 'reviewing', 'blocked', 'idle'].includes(agent.state))
      && Array.isArray(flight.areas) && flight.areas.every(integer) && Array.isArray(flight.pullRequests) && flight.pullRequests.every(integer)
      && (flight.lastActivity === null || stamp(flight.lastActivity)))
    && Array.isArray(value.offers) && value.offers.length <= 3000 && value.offers.every(offer => integer(offer.id)
      && integer(offer.issue) && ['pair', 'split', 'takeover', 'review'].includes(offer.kind))
    && Array.isArray(value.overlaps) && value.overlaps.length <= 20000 && value.overlaps.every(overlap => integer(overlap.sharedFiles)
      && Array.isArray(overlap.pullRequests) && overlap.pullRequests.length === 2 && overlap.pullRequests.every(integer))
    && Array.isArray(value.recent) && value.recent.length <= 20000 && value.recent.every(event => integer(event.id)
      && integer(event.issue) && integer(event.agents) && stamp(event.time) && ['started', 'checkIn', 'review', 'offer', 'landed'].includes(event.kind));
}
function acceptFeed(value) {
  if (!validFeed(value)) return false;
  feed = value;
  render(feed, state, showFlight, showOffer);
  return true;
}
function showUnavailable() {
  byId('connection').className = 'connection error';
  byId('connectionLabel').textContent = 'Connection unavailable';
  byId('feedWarning').hidden = false;
  byId('feedWarning').textContent = 'The feed is unavailable. Start the local ATC site, then refresh to reconnect.';
  if (!feed) byId('flightRows').textContent = 'No snapshot is available yet.';
}
async function refresh() {
  if (fetching) return;
  fetching = true;
  byId('refreshButton').disabled = true;
  try {
    const response = await fetch('/api/traffic', { cache: 'no-store', signal: AbortSignal.timeout(25000) });
    if (!response.ok || !acceptFeed(await response.json())) throw new Error();
  } catch { showUnavailable(); }
  finally { fetching = false; byId('refreshButton').disabled = false; }
}
function subscribe() {
  source?.close();
  source = new EventSource('/api/events');
  const receive = event => { try { if (!acceptFeed(JSON.parse(event.data))) showUnavailable(); } catch { showUnavailable(); } };
  source.addEventListener('traffic', receive);
  source.onmessage = receive;
  source.onerror = () => {
    if (feed) { feed = { ...feed, connection: 'stale' }; render(feed, state, showFlight, showOffer); }
    else showUnavailable();
  };
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  state.view = button.dataset.view;
  for (const item of document.querySelectorAll('[data-view]')) {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  byId('breadcrumbView').textContent = button.textContent.replace(/\d+/g, '').trim().replace(/^[^a-zA-Z]+/, '');
  byId('pageTitle').textContent = titles[state.view][0];
  byId('pageDescription').textContent = titles[state.view][1];
  if (feed) render(feed, state, showFlight, showOffer);
  window.scrollTo({ top: 0, behavior: 'instant' });
});
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  for (const item of document.querySelectorAll('[data-filter]')) {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  }
  if (feed) render(feed, state, showFlight, showOffer);
});
byId('issueSearch').addEventListener('input', event => { state.search = event.target.value; if (feed) render(feed, state, showFlight, showOffer); });
byId('refreshButton').addEventListener('click', async () => { await refresh(); if (feed) toast('Latest snapshot loaded'); });
for (const id of ['connectButton', 'workspaceButton', 'demoConnect']) byId(id).addEventListener('click', () => showConnect(refresh));
byId('guideButton').addEventListener('click', showGuide);
byId('privacyButton').addEventListener('click', showPrivacy);
byId('closeDialog').addEventListener('click', () => byId('mainDialog').close());
byId('mainDialog').addEventListener('click', event => { if (event.target === byId('mainDialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !byId('mainDialog').open) { event.preventDefault(); byId('issueSearch').focus(); } });
setInterval(() => { if (feed) render(feed, state, showFlight, showOffer); }, 15000);
let radarWidth = 0;
new ResizeObserver(entries => {
  const width = entries[0].contentRect.width;
  if (width > 0 && Math.abs(width - radarWidth) > 1) {
    radarWidth = width;
    if (feed) render(feed, state, showFlight, showOffer);
  }
}).observe(byId('radar'));
window.addEventListener('pagehide', () => source?.close());
refresh();
subscribe();
