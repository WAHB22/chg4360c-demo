// End to end world for tests/integration.test.js: the real lib/sync.js engine (with the real migrate, defaults
// and noteFor) talking to the real api/data.js handler in process, on the in memory blob fake.
// No network, no real token, no real data. One world at a time: it sets process.env and the blob api globally.

import { createSync } from '../../lib/sync.js';
import { migrate, defaults } from '../../lib/migrate.js';
import { noteFor } from '../../lib/labels.js';
import handler from '../../api/data.js';
import { setBlobApi, storeConfig } from '../../api/_store.js';
import { createFakeBlob } from './api-fake-blob.js';
import { makeFetch, useEnv } from './api-harness.js';
import { fakeTimers, memoryStorage } from './sync-fake-server.js';

export const KEY = 'integration-device-key';
export const PUB = 'vercel_blob_rw_integrationpub_fakesecret';
export const PRIV = 'vercel_blob_rw_integrationpriv_fakesecret';
export const NOW = new Date(2026, 10, 14, 15, 20); // 3:20 p.m. local time, for the 'Synced 3:20 p.m.' status

const isVersionPath = p => /data-[^/]*\.json$/.test(p);
const tsOf = p => Number((/data-(\d+)/.exec(p) || [])[1]) || 0;

export function createWorld({ env = {}, stores = { [PUB]: 'public' } } = {}) {
  const blob = createFakeBlob({ stores });
  setBlobApi(blob.api);
  const restoreEnv = useEnv({
    APP_KEY: KEY, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined, ...env,
  });
  const cfg = storeConfig();
  const serve = makeFetch({ '/api/data': handler });
  const log = []; // every request a device made: {who, method, url, key, body, status, json}

  // A page on one device. Devices made with the same storage and network are the same browser after a reload.
  function device(name, { storage = memoryStorage({ 'finance-key': KEY }), network = { online: true } } = {}) {
    const timers = fakeTimers();
    const states = [], statuses = [];
    const fetch = async (url, init = {}) => {
      const entry = {
        who: name, method: String(init.method || 'GET').toUpperCase(), url: String(url),
        key: new Headers(init.headers || {}).get('x-app-key'),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, status: null, json: null,
      };
      log.push(entry);
      if (!network.online) { entry.status = 0; throw new TypeError('fetch failed'); }
      const res = await serve(url, init);
      entry.status = res.status;
      try { entry.json = await res.clone().json(); } catch { /* not JSON */ }
      return res;
    };
    const engine = createSync({
      fetch, storage, now: () => NOW,
      onState: s => states.push(s), onStatus: (text, code) => statuses.push({ text, code }),
      migrate, noteFor, defaults,
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    return { name, engine, storage, network, timers, states, statuses };
  }

  // Another device or build B saving straight through the API (doc.savedAt is its base).
  async function save(doc) {
    const res = await serve('/api/data', { method: 'PUT', headers: { 'x-app-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(doc) });
    return { status: res.status, json: await res.json() };
  }
  async function latest() {
    return (await serve('/api/data', { headers: { 'x-app-key': KEY } })).json();
  }

  // A version written the way an older page did, straight into the store (no API call, no log entry).
  function seedVersion(doc, { token = cfg.primary.token, prefix = cfg.prefix, ts, suffix = 'seed00' } = {}) {
    const at = ts ?? (Date.parse(doc.savedAt) || Date.now());
    const pathname = `${prefix}data-${at}-${suffix}.json`;
    blob.seed(token, pathname, JSON.stringify(doc), { uploadedAt: at });
    return pathname;
  }

  // The saved versions under this run's prefix, read from the store itself, newest first.
  function stored() {
    return blob.pathnames(cfg.primary.token, cfg.prefix + 'data-')
      .filter(isVersionPath)
      .sort((a, b) => tsOf(b) - tsOf(a) || b.localeCompare(a))
      .map(pathname => ({ pathname, doc: blob.json(cfg.primary.token, pathname) }));
  }
  const newest = () => (stored()[0] || {}).doc || null;

  // Every version ever written during this world (pruned ones included), oldest first.
  function written() {
    return blob.calls
      .filter(c => c.fn === 'put' && isVersionPath(c.pathname))
      .map(c => ({ pathname: c.pathname, token: c.token, doc: JSON.parse(c.text) }));
  }

  const puts = who => log.filter(r => r.method === 'PUT' && (!who || r.who === who));

  function close() {
    restoreEnv();
    setBlobApi();
  }

  return { blob, cfg, log, device, save, latest, seedVersion, stored, newest, written, puts, close };
}

// Waits until no device has anything left to send, firing the debounce and retry timers between rounds.
export async function settle(...devices) {
  for (let round = 0; round < 20; round++) {
    await Promise.all(devices.map(d => d.engine.idle()));
    if (devices.every(d => d.engine.pending.length === 0)) return;
    devices.forEach(d => d.timers.tick(5000));
  }
  throw new Error('The devices never finished saving');
}
