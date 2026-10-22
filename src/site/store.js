import { ensure } from '../core/failure.js';
import { isRepository } from '../core/values.js';
import { collectTraffic } from './collector.js';
import { demoFeed, emptyFeed } from './demo.js';
import { refreshFeed, validateFeed } from './schema.js';

export function createFeedStore({ repository, collect = collectTraffic, now = Date.now } = {}) {
  ensure(repository === undefined || isRepository(repository), 'Invalid repository.');
  let selected = repository;
  let feed = selected ? emptyFeed(now()) : demoFeed(now());
  let revision = 0;
  let tick = 0;
  let closed = false;
  let pending = null;
  let controller = null;
  let failures = 0;
  let nextRetry = 0;
  const listeners = new Set();

  function getFeed() {
    feed = refreshFeed(feed, now());
    return structuredClone(feed);
  }
  function publish(value) {
    if (closed) return;
    feed = validateFeed(value, now());
    for (const listener of listeners) listener(getFeed());
  }
  function refresh() {
    if (closed) return Promise.resolve(getFeed());
    if (pending) return pending;
    if (!selected) {
      tick += 1;
      publish(demoFeed(now(), tick));
      return Promise.resolve(getFeed());
    }
    if (now() < nextRetry) return Promise.resolve(getFeed());
    const current = revision;
    const repositoryName = selected;
    controller = new AbortController();
    publish({ ...getFeed(), connection: 'refreshing' });
    const signal = controller.signal;
    pending = Promise.resolve().then(() => {
      ensure(!signal.aborted, 'Traffic unavailable.');
      return collect(repositoryName, { signal, now });
    }).then(value => {
      if (!closed && current === revision) {
        validateFeed(value, now());
        ensure(value.source === 'github', 'Traffic unavailable.');
        publish(refreshFeed(value, now()));
        failures = 0;
        nextRetry = 0;
      }
    }).catch(() => {
      if (!closed && current === revision) {
        failures += 1;
        nextRetry = now() + Math.min(300000, 60000 * 2 ** Math.min(failures - 1, 3));
        publish({ ...getFeed(), complete: false, connection: 'error' });
      }
    }).finally(() => {
      if (current === revision) { pending = null; controller = null; }
    }).then(getFeed);
    return pending;
  }
  function connect(repositoryName) {
    ensure(isRepository(repositoryName), 'Invalid repository.');
    if (selected === repositoryName) { void refresh(); return getFeed(); }
    failures = 0;
    nextRetry = 0;
    revision += 1;
    controller?.abort();
    pending = null;
    selected = repositoryName;
    publish(emptyFeed(now()));
    void refresh();
    return getFeed();
  }
  function demo() {
    revision += 1;
    controller?.abort();
    pending = null;
    selected = undefined;
    failures = 0;
    nextRetry = 0;
    tick = 0;
    publish(demoFeed(now()));
    return getFeed();
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function close() {
    closed = true;
    revision += 1;
    controller?.abort();
    listeners.clear();
  }
  return { getFeed, refresh, connect, demo, subscribe, close };
}
