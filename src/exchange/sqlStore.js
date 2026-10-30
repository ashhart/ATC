import { createExchangeOperations } from './operations.js';
import { validateState } from './stateSchema.js';
import { exact, isKey, isOrigin, isRepository, iso, maximumEvidence, requireValue } from './values.js';

export function createExchangeSqlStore({ storage, repository, origin, now = Date.now }) {
  requireValue(isRepository(repository) && isOrigin(origin));
  repository = repository.toLowerCase();
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS exchangeRecords (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (kind, id))');
  sql.exec('CREATE TABLE IF NOT EXISTS exchangeEvidence (id TEXT PRIMARY KEY, bytes BLOB NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS exchangeRate (minute INTEGER PRIMARY KEY, count INTEGER NOT NULL)');
  const kinds = ['sessions', 'requests', 'evidence'];
  const config = JSON.stringify({ version: 1, repository, origin });
  sql.exec('INSERT OR IGNORE INTO exchangeRecords (kind, id, payload) VALUES (?, ?, ?)', 'config', 'v1', config);
  function records() {
    const rows = sql.exec('SELECT kind, id, payload FROM exchangeRecords LIMIT 5502').toArray();
    requireValue(rows.length <= 5501 && rows.every(row => typeof row.payload === 'string' && row.payload.length <= 65536), 'storage', 503);
    return rows;
  }
  function read() {
    const state = { version: 1, repository, origin, sessions: [], requests: [], evidence: [] };
    let configured = false;
    for (const row of records()) {
      if (row.kind === 'config') {
        requireValue(row.id === 'v1' && row.payload === config && !configured, 'storage', 503);
        configured = true;
      } else {
        requireValue(kinds.includes(row.kind), 'storage', 503);
        const value = JSON.parse(row.payload);
        requireValue(value && row.id === (row.kind === 'sessions' ? value.hash : value.id), 'storage', 503);
        state[row.kind].push(value);
      }
    }
    requireValue(configured, 'storage', 503);
    return validateState(state);
  }
  function save(state) {
    validateState(state);
    requireValue(state.repository === repository && state.origin === origin, 'storage', 503);
    const old = new Map(records().map(row => [`${row.kind}/${row.id}`, row.payload]));
    const kept = new Set(['config/v1']);
    for (const kind of kinds) for (const item of state[kind]) {
      const id = kind === 'sessions' ? item.hash : item.id;
      const payload = JSON.stringify(item);
      requireValue(payload.length <= 65536, 'storage', 503);
      kept.add(`${kind}/${id}`);
      if (old.get(`${kind}/${id}`) !== payload) sql.exec('INSERT OR REPLACE INTO exchangeRecords (kind, id, payload) VALUES (?, ?, ?)', kind, id, payload);
    }
    for (const key of old.keys()) if (!kept.has(key)) {
      const [kind, id] = key.split('/');
      sql.exec('DELETE FROM exchangeRecords WHERE kind = ? AND id = ?', kind, id);
    }
  }
  const operations = createExchangeOperations({ read, save, now,
    putBytes(id, bytes) {
      requireValue(isKey(id) && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximumEvidence);
      sql.exec('INSERT OR REPLACE INTO exchangeEvidence (id, bytes) VALUES (?, ?)', id, new Uint8Array(bytes));
    },
    readBytes(id) {
      requireValue(isKey(id));
      const rows = sql.exec('SELECT bytes FROM exchangeEvidence WHERE id = ?', id).toArray();
      requireValue(rows.length === 1 && (rows[0].bytes instanceof ArrayBuffer || ArrayBuffer.isView(rows[0].bytes)), 'storage', 503);
      const bytes = Buffer.from(rows[0].bytes);
      requireValue(bytes.length <= maximumEvidence, 'storage', 503);
      return bytes;
    }
  });
  const transactional = {};
  for (const [key, fn] of Object.entries(operations)) transactional[key] = (...args) => storage.transactionSync(() => fn(...args));
  return {
    ...transactional,
    sweep() {
      return storage.transactionSync(() => {
        const state = read();
        const time = iso(now());
        const live = new Set(state.evidence.filter(x => x.expiresAt > time).map(x => x.id));
        for (const row of sql.exec('SELECT id FROM exchangeEvidence LIMIT 4001').toArray()) {
          requireValue(isKey(row.id), 'storage', 503);
          if (!live.has(row.id)) sql.exec('DELETE FROM exchangeEvidence WHERE id = ?', row.id);
        }
        state.sessions = state.sessions.filter(x => x.expiresAt > time);
        save(state);
      });
    },
    nextExpiry() {
      const state = read();
      const future = [...state.sessions, ...state.evidence].map(x => Date.parse(x.expiresAt)).filter(x => x > now());
      return future.length ? Math.min(...future) : null;
    },
    rateLimit() {
      storage.transactionSync(() => {
        const minute = Math.floor(now() / 60000);
        sql.exec('DELETE FROM exchangeRate WHERE minute <> ?', minute);
        const row = sql.exec('SELECT count FROM exchangeRate WHERE minute = ?', minute).toArray()[0];
        const count = row?.count ?? 0;
        requireValue(Number.isInteger(count) && count >= 0 && count < 120, 'capacity', 429);
        sql.exec('INSERT OR REPLACE INTO exchangeRate (minute, count) VALUES (?, ?)', minute, count + 1);
      });
    }
  };
}
