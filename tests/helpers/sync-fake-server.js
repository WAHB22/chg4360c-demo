// Test helpers for the sync engine: an in memory server that follows SPEC 8.3 for GET and PUT,
// fake timers, a localStorage stand in, and the simple migrate / noteFor / defaults stand ins.
// Nothing here talks to the network.

const MB = 1024 * 1024;
const PREFIX = 'finance-preview/';
const copy = v => JSON.parse(JSON.stringify(v));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createFakeServer({ key = 'k', start = Date.UTC(2026, 10, 14, 15, 0, 0) } = {}) {
  const versions = []; // [{pathname, ts, doc}], oldest first
  const log = [];      // every request: {method, url, key, body, status}
  let mode = 'online'; // 'online' | 'offline' (fetch rejects) | 'error' (500)
  let gate = null;     // while set, requests wait here until released
  let tick = 0;
  const nextTime = () => start + (++tick) * 1000; // every save gets a new, later savedAt

  function newest() { return versions[versions.length - 1] || null; }
  function write(doc) {
    const ts = nextTime();
    const pathname = `${PREFIX}data-${ts}-${String(tick).padStart(6, '0')}.json`;
    versions.push({ pathname, ts, doc: copy(doc) });
    while (versions.length > 10) versions.shift(); // prune(10)
    return pathname;
  }
  const reply = (status, json) => ({ status, json });

  function handle(method, url, headers, raw) {
    if (headers.get('x-app-key') !== server.key) return reply(401, { error: 'This device is not set up' });
    if (method === 'GET') {
      if (url.searchParams.get('history') === '1') {
        const list = versions.slice().reverse().slice(0, 10);
        return reply(200, { versions: list.map(v => ({ id: v.pathname, savedAt: v.doc.savedAt, note: v.doc.note })) });
      }
      const version = url.searchParams.get('version');
      if (version !== null) {
        if (!version.startsWith(PREFIX + 'data-')) return reply(400, { error: 'Unknown version' });
        const v = versions.find(x => x.pathname === version);
        return v ? reply(200, copy(v.doc)) : reply(404, { error: 'Unknown version' });
      }
      const top = newest();
      return reply(200, top ? copy(top.doc) : { empty: true });
    }
    if (method === 'PUT') {
      if (typeof raw === 'string' && new TextEncoder().encode(raw).length > MB) return reply(400, { error: 'Too large' });
      let body;
      try { body = typeof raw === 'string' ? JSON.parse(raw) : copy(raw); } catch { return reply(400, { error: 'Invalid data' }); }
      if (!isObj(body) || !Array.isArray(body.bills)) return reply(400, { error: 'Invalid data' });
      if (server.onPut) server.onPut(body); // lets a test simulate another device saving first
      const base = body.baseSavedAt ?? body.savedAt ?? null;
      const top = newest();
      if (top && top.doc.savedAt !== base) return reply(409, { error: 'conflict', latest: copy(top.doc) });
      delete body.baseSavedAt;
      body.savedAt = new Date(nextTime()).toISOString();
      body.note = String(body.note || 'Saved').slice(0, 200);
      write(body);
      return reply(200, { ok: true, savedAt: body.savedAt });
    }
    return reply(405, { error: 'Method not allowed' });
  }

  async function fetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const entry = { method, url: String(url), key: headers.get('x-app-key'), body: undefined, status: null };
    try { entry.body = init.body ? JSON.parse(init.body) : undefined; } catch { entry.body = init.body; }
    log.push(entry);
    while (gate) await gate.promise;
    if (mode === 'offline') { entry.status = 0; throw new TypeError('fetch failed'); }
    const out = mode === 'error'
      ? reply(500, { error: 'Server error' })
      : handle(method, new URL(String(url), 'http://localhost'), headers, init.body);
    entry.status = out.status;
    return new Response(JSON.stringify(out.json), {
      status: out.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  }

  const server = {
    key,
    onPut: null,
    fetch,
    log,
    puts: () => log.filter(r => r.method === 'PUT'),
    setMode(m) { mode = m; },
    // Holds every request until the returned function is called; held requests then run in arrival order.
    hold() {
      let release;
      const promise = new Promise(r => { release = r; });
      gate = { promise };
      return () => { gate = null; release(); };
    },
    // Writes a version directly (as if another device saved it). Gives it a new savedAt unless one is passed.
    seed(doc, { keepSavedAt = false } = {}) {
      const d = copy(doc);
      if (!keepSavedAt || !d.savedAt) d.savedAt = new Date(nextTime()).toISOString();
      write(d);
      return d.savedAt;
    },
    latest: () => (newest() ? copy(newest().doc) : null),
    versions: () => versions.map(v => ({ pathname: v.pathname, doc: copy(v.doc) })),
  };
  return server;
}

// setTimer / clearTimer that only fire when the test calls tick().
export function fakeTimers() {
  let t = 0, seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + Math.max(0, ms || 0) }); return id; },
    clearTimer: id => { timers.delete(id); },
    // Delays (from now) of the timers still waiting, soonest first.
    waiting: () => [...timers.values()].map(x => x.at - t).sort((a, b) => a - b),
    tick(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

// localStorage compatible: getItem / setItem / removeItem.
export function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    has: k => m.has(k),
    json: k => (m.has(k) ? JSON.parse(m.get(k)) : null),
  };
}

// Stand ins for lib/migrate.js and lib/labels.js, so these tests do not depend on them.
export const migrate = d => ({ ...structuredClone(d), version: 2 });
export const noteFor = l => l.join(' and ') || 'Saved';
export const defaults = () => ({ version: 2, bills: [], budget: [], accounts: [], goals: [], months: {}, settings: {} });
