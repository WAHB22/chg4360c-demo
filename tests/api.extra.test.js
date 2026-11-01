// Reviewer tests for api/*: spec rules and edge cases the first pass did not cover.
// In memory blob fake and fake Claude only. The dev server test talks to 127.0.0.1 in a child process.

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dataHandler from '../api/data.js';
import readHandler, { cleanRows, torontoDay, validRow } from '../api/read.js';
import { setBlobApi, PREVIEW_NOTE } from '../api/_store.js';
import { sameOrigin } from '../api/_auth.js';
import { setAnthropicFactory } from '../api/read.js';
import { createFakeBlob } from './helpers/api-fake-blob.js';
import { callApi, makeReqRes, useEnv } from './helpers/api-harness.js';
import { rows as OCT31 } from './fixtures/oct31.js';
import SAMPLE_NOV from './fixtures/sample-nov.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'device-key-for-extra-tests';
const PUB = 'vercel_blob_rw_publicextra_fakesecret';
const PRIV = 'vercel_blob_rw_privateextra_fakesecret';
const HOST = 'wahb-finance.example';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex').toString('base64');

let cleanup = null;
afterEach(() => { if (cleanup) cleanup(); cleanup = null; mock.timers.reset(); mock.restoreAll(); });

function setup({ env = {}, stores = { [PUB]: 'public' }, reply } = {}) {
  const fake = createFakeBlob({ stores });
  setBlobApi(fake.api);
  const claude = [];
  setAnthropicFactory(() => ({
    beta: {
      messages: {
        create: async params => {
          claude.push(params);
          if (typeof reply === 'function') return reply(params);
          return reply || { type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ rows: OCT31 }) }], stop_reason: 'end_turn' };
        },
      },
    },
  }));
  const restore = useEnv({
    APP_KEY: KEY, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined,
    ANTHROPIC_API_KEY: 'test-only-not-a-real-key', ...env,
  });
  cleanup = () => { restore(); setBlobApi(); setAnthropicFactory(); };
  return { fake, claude };
}

const auth = { 'x-app-key': KEY };
const get = (q = '', headers = auth) => callApi(dataHandler, { method: 'GET', url: '/api/data' + q, headers });
const put = (body, headers = auth) => callApi(dataHandler, { method: 'PUT', url: '/api/data', headers, body });
const doc = (extra = {}) => ({ version: 2, settings: { payPlan: 1300 }, bills: [], budget: [], accounts: [], goals: [], months: {}, ...extra });
const readHeaders = (extra = {}) => ({ ...auth, origin: `https://${HOST}`, 'x-forwarded-host': HOST, host: 'internal.host', ...extra });
const post = (body, h = readHeaders()) => callApi(readHandler, { method: 'POST', url: '/api/read', headers: h, body });
const file = (extra = {}) => ({ name: 'n.png', type: 'image/png', data: PNG, uploadDate: '2026-10-31', ...extra });
const reply = rows => ({ type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ rows }) }], stop_reason: 'end_turn' });

function captureLogs() {
  const logs = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) mock.method(console, m, (...a) => logs.push(a.map(String).join(' ')));
  return logs;
}

/* ---------- api/data.js: versions and ordering ---------- */

test('a save always becomes the newest version, even after a version named by a clock that ran ahead', async () => {
  // Another function instance with a fast clock wrote the current newest version. Its pathname time is
  // two minutes ahead of this instance. The next save must still sort first, or GET hides it.
  const { fake } = setup();
  const ahead = Date.now() + 120_000;
  const first = doc({ note: 'from the fast instance', savedAt: new Date(Date.now() - 1000).toISOString() });
  fake.seed(PUB, `finance-preview/data-${ahead}-aaaaaa.json`, JSON.stringify(first));

  const saved = await put(doc({ baseSavedAt: first.savedAt, note: 'next save' }));
  assert.equal(saved.status, 200);
  const now = await get();
  assert.equal(now.json.note, 'next save', 'GET returns the save that was just acknowledged');
  assert.equal(now.json.savedAt, saved.json.savedAt);

  // The client continues from what it was told: no 409 against the older version.
  const again = await put(doc({ baseSavedAt: saved.json.savedAt, note: 'third' }));
  assert.equal(again.status, 200);
  assert.deepEqual((await get('?history=1')).json.versions.map(v => v.note), ['third', 'next save', 'from the fast instance']);
});

test('only data-*.json blobs are versions: other files under the prefix are never read as data or pruned', async () => {
  const { fake } = setup();
  fake.seed(PUB, 'finance-preview/data-notes.txt', 'not a save', { uploadedAt: Date.now() - 86_400_000 });
  let base = null;
  for (let i = 0; i < 11; i++) {
    const r = await put(doc({ baseSavedAt: base, note: `save ${i}` }));
    assert.equal(r.status, 200);
    base = r.json.savedAt;
  }
  assert.equal(fake.text(PUB, 'finance-preview/data-notes.txt'), 'not a save', 'not deleted by prune');
  const ids = (await get('?history=1')).json.versions.map(v => v.id);
  assert.equal(ids.length, 10);
  assert.ok(ids.every(id => id.endsWith('.json')));
});

test('history shows at most 10 versions, newest first, when more are stored', async () => {
  const { fake } = setup();
  const t0 = Date.UTC(2026, 10, 1);
  for (let i = 0; i < 12; i++) {
    const ts = t0 + i * 60_000;
    fake.seed(PUB, `finance-preview/data-${ts}-abc${String(i).padStart(3, '0')}.json`, JSON.stringify(doc({ note: `v${i}`, savedAt: new Date(ts).toISOString() })), { uploadedAt: ts });
  }
  const h = await get('?history=1');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.versions.map(v => v.note), ['v11', 'v10', 'v9', 'v8', 'v7', 'v6', 'v5', 'v4', 'v3', 'v2']);
  assert.deepEqual(h.json.versions[0], { id: `finance-preview/data-${t0 + 11 * 60_000}-abc011.json`, savedAt: new Date(t0 + 11 * 60_000).toISOString(), note: 'v11' });
  assert.equal((await get()).json.note, 'v11');
});

test('history reads its versions in parallel', async () => {
  const { fake } = setup();
  for (let i = 0; i < 10; i++) fake.seed(PUB, `finance-preview/data-${1_790_000_000_000 + i}-abcdef.json`, JSON.stringify(doc({ note: `v${i}` })));
  let inFlight = 0, most = 0;
  setBlobApi({
    ...fake.api,
    get: async (p, o) => {
      inFlight++; most = Math.max(most, inFlight);
      try { return await fake.api.get(p, o); } finally { inFlight--; }
    },
  });
  const h = await get('?history=1');
  assert.equal(h.json.versions.length, 10);
  assert.ok(most >= 10, `at most ${most} reads at once`);
});

test('history on an empty store is an empty list', async () => {
  setup();
  const h = await get('?history=1');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json, { versions: [] });
});

test('GET skips a damaged newest version and returns the one before it', async () => {
  const { fake } = setup();
  fake.seed(PUB, 'finance-preview/data-1790000000000-abcdef.json', JSON.stringify(doc({ note: 'good' })));
  fake.seed(PUB, 'finance-preview/data-1790000000001-abcdef.json', '{"bills":[ broken');
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.json.note, 'good');
});

test('a damaged stored version never puts its content in the server log', async () => {
  const { fake } = setup();
  const id = 'finance-preview/data-1790000000000-abcdef.json';
  // Node's JSON.parse error message quotes the text around the bad token: here the amount and the word.
  fake.seed(PUB, id, '{"bills":[],"rent":587.50,"x":SECRETRENT}');
  const logs = captureLogs();
  const r = await get('?version=' + encodeURIComponent(id));
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'Something went wrong on the server. Try again.' });
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => !l.includes('SECRETRENT') && !l.includes('87.50')), logs.join('\n'));
});

test('production: ?version= takes the names the old page wrote (Vercel random suffix), and history ids round trip', async () => {
  const { fake } = setup({ env: { VERCEL_ENV: 'production' } });
  const names = ['finance/data-1730000000000-k3J4h5G6f7D8s9A0qWeRtYuI.json', 'finance/data-1730000600000-Zx81Qw.json'];
  names.forEach((n, i) => fake.seed(PUB, n, JSON.stringify(doc({ note: `old ${i}`, savedAt: new Date(1730000000000 + i * 600000).toISOString() }))));
  const h = await get('?history=1');
  assert.deepEqual(h.json.versions.map(v => v.id), [...names].reverse());
  for (const v of h.json.versions) {
    const r = await get('?version=' + encodeURIComponent(v.id));
    assert.equal(r.status, 200, v.id);
    assert.equal(r.json.note, v.note);
  }
  assert.equal((await get('?version=' + encodeURIComponent('finance-preview/data-1730000000000-abcdef.json'))).status, 400);
});

test('the API stores and returns docs as sent: v1 shapes and unknown fields at every level survive', async () => {
  setup();
  const v1 = {
    settings: { payPlan: 1300, theme: 'dark' },
    bills: [{ id: 'b1', name: 'Rent', amt: 587.5, freq: 'monthly', day: 1, extraB: 'keep' }],
    budget: [{ id: 'g1', name: 'Food', items: [{ id: 'i1', name: 'Groceries', limit: 400, color: 'green' }] }],
    accounts: [{ id: 'a1', name: 'Chequing', bal: 420, goal: 400, kind: 'asset' }],
    goals: [{ id: 'j1', name: 'Jar', target: 100, saved: 0 }],
    months: { '2026-10': { paid: {}, tx: [{ id: 't1', date: '2026-10-02', item: 'i1', amt: 12.34, note: 'Costco' }], pays: [] } },
    buildB: { nested: { list: [1, 2, 3] } },
  };
  const sent = structuredClone(v1);
  const r = await put(sent);
  assert.equal(r.status, 200);
  const back = (await get()).json;
  assert.deepEqual(back, { ...v1, savedAt: r.json.savedAt, note: 'Saved' });
  assert.equal('version' in back, false, 'the server does not migrate');
  assert.equal('moves' in back.months['2026-10'], false);
});

test('production with an empty private store and no public saves: empty, and nothing is written to the public store', async () => {
  const { fake } = setup({ stores: { [PUB]: 'public', [PRIV]: 'private' }, env: { VERCEL_ENV: 'production', PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV } });
  assert.deepEqual((await get()).json, { empty: true });
  assert.equal(fake.calls.filter(c => c.token === PUB && (c.fn === 'put' || c.fn === 'del')).length, 0);
  assert.deepEqual(fake.pathnames(PRIV), []);
});

test('production move: an empty public blob is skipped, the other saves are copied byte for byte', async () => {
  const { fake } = setup({ stores: { [PUB]: 'public', [PRIV]: 'private' }, env: { VERCEL_ENV: 'production', PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV } });
  const good = JSON.stringify(doc({ note: 'live', savedAt: '2024-10-27T03:33:20.000Z' }), null, 2);
  fake.seed(PUB, 'finance/data-1730000000000-AAAAAA.json', good);
  fake.seed(PUB, 'finance/data-1730000600000-BBBBBB.json', '');
  const before = fake.snapshot(PUB);
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.json.note, 'live');
  assert.deepEqual(fake.pathnames(PRIV, 'finance/'), ['finance/data-1730000000000-AAAAAA.json']);
  assert.equal(fake.text(PRIV, 'finance/data-1730000000000-AAAAAA.json'), good);
  assert.deepEqual(fake.snapshot(PUB), before);
});

test('preview seeding skips a damaged newest live save and copies the next readable one', async () => {
  const { fake } = setup();
  fake.seed(PUB, 'finance/data-1730000000000-AAAAAA.json', JSON.stringify(doc({ note: 'live ok', savedAt: '2024-10-27T03:33:20.000Z' })));
  fake.seed(PUB, 'finance/data-1730000600000-BBBBBB.json', '{"bills": [ cut off');
  fake.seed(PUB, 'finance/data-1730000900000-CCCCCC.json', 'null');
  const before = fake.snapshot(PUB, 'finance/');
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.json.note, PREVIEW_NOTE);
  assert.equal(r.json.savedAt, '2024-10-27T03:33:20.000Z');
  assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 1);
  assert.deepEqual(fake.snapshot(PUB, 'finance/'), before);
});

test('401 comes before any storage call, for every method and a wrong key', async () => {
  const { fake } = setup();
  for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
    const r = await callApi(dataHandler, { method, url: '/api/data?history=1', headers: { 'x-app-key': 'not-it' }, body: method === 'PUT' ? doc() : undefined });
    assert.equal(r.status, 401);
    assert.equal(r.headers['cache-control'], 'private, no-store');
  }
  assert.equal(fake.calls.length, 0);
});

// What the lock blob looks like at the moment the handler writes its answer.
async function lockWhenAnswered(fake, method, body, url = '/api/data') {
  const { req, res } = makeReqRes({ method, url, headers: auth, body });
  let lock = 'not answered';
  const end = res.end.bind(res);
  res.end = data => { lock = fake.text(PUB, 'finance-preview/lock.json'); return end(data); };
  await dataHandler(req, res);
  return { status: res.statusCode, lock };
}

test('the save lock is released before the answer goes out, so the next save never meets it', async () => {
  const { fake } = setup();
  const ok = await lockWhenAnswered(fake, 'PUT', doc({ note: 'first' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.lock, null, '200 sent while the lock was still held');

  const stale = await lockWhenAnswered(fake, 'PUT', doc({ baseSavedAt: '2020-01-01T00:00:00.000Z' }));
  assert.equal(stale.status, 409);
  assert.equal(stale.lock, null, '409 sent while the lock was still held');
});

test('a 409 replay sent the moment the 409 arrives is accepted (two devices)', async () => {
  const { fake } = setup();
  const a = await put(doc({ note: 'start' }));
  const b = await put(doc({ baseSavedAt: a.json.savedAt, note: 'device A' }));
  // Device B still has the first save as its base. It replays on `latest` as soon as the 409 is written.
  const { req, res } = makeReqRes({ method: 'PUT', url: '/api/data', headers: auth, body: doc({ baseSavedAt: a.json.savedAt, note: 'device B' }) });
  let replay = null;
  const end = res.end.bind(res);
  res.end = data => {
    const latest = JSON.parse(data).latest;
    replay = put(doc({ ...latest, baseSavedAt: latest.savedAt, note: 'device B replayed' }));
    return end(data);
  };
  await dataHandler(req, res);
  assert.equal(res.statusCode, 409);
  const second = await replay;
  assert.equal(second.status, 200, JSON.stringify(second.json && second.json.error));
  assert.equal((await get()).json.note, 'device B replayed');
  assert.ok(b.status === 200 && fake.text(PUB, 'finance-preview/lock.json') === null);
});

test('a lock left behind by a crashed save does not stop GET from returning the data', async () => {
  const { fake } = setup();
  const a = await put(doc({ note: 'saved' }));
  fake.seed(PUB, 'finance-preview/lock.json', '{}', { uploadedAt: Date.now() });
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.json.savedAt, a.json.savedAt);
});

/* ---------- api/_auth.js ---------- */

test('sameOrigin: first x-forwarded-host wins, default ports are ignored, the host must match exactly', () => {
  assert.equal(sameOrigin({ headers: { origin: 'https://a.example:443', host: 'a.example' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://a.example', 'x-forwarded-host': 'a.example, proxy.internal', host: 'x' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://proxy.internal', 'x-forwarded-host': 'a.example, proxy.internal', host: 'x' } }), false);
  assert.equal(sameOrigin({ headers: { origin: 'https://A.Example', host: 'a.example' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://a.example.evil', host: 'a.example' } }), false);
  assert.equal(sameOrigin({ headers: { origin: 'https://a.example', 'x-forwarded-host': '', host: 'a.example' } }), true);
  assert.equal(sameOrigin({ headers: { origin: '', host: 'a.example' } }), false);
});

/* ---------- api/read.js ---------- */

// The counter is one blob per read under finance-meta/reads/<Toronto day>/ (spec section 11, Read limit counter).
const READS_DAY = 'finance-meta/reads/2026-11-14/';
const seedReads = (fake, n) => { for (let i = 0; i < n; i++) fake.seed(PUB, `${READS_DAY}other-device-${i}.json`, '{}'); };

test('the read is counted before Claude is called', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  let countSeen = null;
  const { fake } = setup({
    reply: () => {
      countSeen = fake.pathnames(PUB, READS_DAY);
      return reply(OCT31);
    },
  });
  assert.equal((await post(file())).status, 200);
  assert.deepEqual(countSeen, [READS_DAY + 'read-01.json']);
});

test('the 31st read is refused even when the day started with reads from another device', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, claude } = setup();
  seedReads(fake, 29);
  assert.equal((await post(file())).status, 200);
  const r = await post(file());
  assert.equal(r.status, 429);
  assert.deepEqual(r.json, { error: 'You have used all 30 reads for today. They reset at midnight. CSV files still work.' });
  assert.equal(claude.length, 1);
  assert.equal(fake.pathnames(PUB, READS_DAY).length, 30, 'the refused read writes nothing');
});

test('a read that loses 3 races for its place takes the next free one and is counted once', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, claude } = setup();
  for (const n of ['01', '02', '03']) fake.seed(PUB, `${READS_DAY}read-${n}.json`, '{}');
  // Between this read's list and each of its first 3 puts, another device takes that very place.
  let lose = 3;
  setBlobApi({
    ...fake.api,
    put: async (p, body, o) => {
      if (p.startsWith(READS_DAY) && lose > 0) { lose--; fake.seed(PUB, p, '{"at":"elsewhere"}'); }
      return fake.api.put(p, body, o);
    },
  });
  const r = await post(file());
  assert.equal(r.status, 200);
  assert.equal(claude.length, 1);
  const names = fake.pathnames(PUB, READS_DAY);
  assert.equal(names.length, 7, '3 before, 3 reads from elsewhere, plus this one');
  assert.notEqual(fake.json(PUB, READS_DAY + 'read-07.json').at, 'elsewhere');
});

test('torontoDay on the days the clocks change (Mar 8 and Nov 1 2026)', () => {
  // Nov 1 2026: 2 a.m. EDT becomes 1 a.m. EST.
  assert.equal(torontoDay(new Date('2026-11-01T03:59:00Z')), '2026-10-31'); // 23:59 EDT
  assert.equal(torontoDay(new Date('2026-11-01T04:00:00Z')), '2026-11-01'); // 00:00 EDT
  assert.equal(torontoDay(new Date('2026-11-02T04:59:00Z')), '2026-11-01'); // 23:59 EST
  assert.equal(torontoDay(new Date('2026-11-02T05:00:00Z')), '2026-11-02');
  // Mar 8 2026: 2 a.m. EST becomes 3 a.m. EDT.
  assert.equal(torontoDay(new Date('2026-03-08T04:59:00Z')), '2026-03-07'); // 23:59 EST
  assert.equal(torontoDay(new Date('2026-03-08T05:00:00Z')), '2026-03-08');
  assert.equal(torontoDay(new Date('2026-03-09T03:59:00Z')), '2026-03-08'); // 23:59 EDT
  assert.equal(torontoDay(new Date('2026-03-09T04:00:00Z')), '2026-03-09');
});

test('amounts are rounded to cents; a row that rounds to $0.00 is dropped', () => {
  const base = OCT31[0];
  assert.equal(validRow({ ...base, amount: 6.58 }).amount, 6.58);
  assert.equal(validRow({ ...base, amount: 100.63 }).amount, 100.63);
  assert.equal(validRow({ ...base, amount: 6.584999 }).amount, 6.58);
  assert.equal(validRow({ ...base, amount: 6.585001 }).amount, 6.59);
  assert.equal(validRow({ ...base, amount: 0.1 + 0.2 }).amount, 0.3);
  assert.equal(validRow({ ...base, amount: 0.004 }), null);
  assert.equal(validRow({ ...base, amount: 0.005 }).amount, 0.01);
  assert.deepEqual(cleanRows([{ ...base, amount: 0.001 }, base]), { rows: [base], dropped: 1 });
});

test('two identical rows in one file are both kept, in order', () => {
  const pay = OCT31[2];
  const out = cleanRows([pay, { ...pay }, OCT31[0]]);
  assert.equal(out.dropped, 0);
  assert.deepEqual(out.rows, [pay, pay, OCT31[0]]);
});

test('Cache-Control private, no-store on the 413, 422, 429, 500, 502 and 503 answers too', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const statuses = [];
  const check = r => { statuses.push(r.status); assert.equal(r.headers['cache-control'], 'private, no-store', String(r.status)); };

  let { fake } = setup();
  check(await post(file({ data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') })));
  seedReads(fake, 30);
  check(await post(file()));
  cleanup();

  ({ fake } = setup({ reply: { type: 'message', content: [], stop_reason: 'refusal' } }));
  check(await post(file()));
  cleanup();

  setup({ reply: () => { throw Object.assign(new Error('down'), { status: 500 }); } });
  captureLogs();
  check(await post(file()));
  cleanup();

  ({ fake } = setup());
  fake.failNext('list', new Error('blob is down'));
  check(await post(file()));
  cleanup();

  setup({ env: { ANTHROPIC_API_KEY: undefined } });
  check(await post(file()));
  cleanup = null;
  assert.deepEqual(statuses, [413, 429, 422, 502, 500, 503]);
});

/* ---------- scripts/dev-server.mjs ---------- */

// Starts the CLI in its own process (it rewrites env vars and installs fakes), on a free port of 127.0.0.1.
async function startCli(args) {
  const env = { ...process.env };
  for (const k of ['APP_KEY', 'VERCEL_ENV', 'BLOB_READ_WRITE_TOKEN', 'PRIVATE_BLOB_READ_WRITE_TOKEN', 'ANTHROPIC_API_KEY']) delete env[k];
  const child = spawn(process.execPath, ['scripts/dev-server.mjs', ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('dev server did not start: ' + out)), 10_000);
    child.stdout.on('data', c => {
      out += c;
      const m = /Dev server on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
    child.stderr.on('data', c => { out += c; });
    child.on('exit', code => { clearTimeout(timer); fail(new Error(`dev server exited ${code}: ${out}`)); });
  });
  return { url, stop: () => new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

test('dev server: key check, seeded sample, save, history, fake Claude, origin check and static guards', async () => {
  const dev = await startCli(['--port', '0', '--seed', 'tests/fixtures/sample-nov.js']);
  try {
    const key = { 'x-app-key': 'dev-key' };
    const none = await fetch(dev.url + '/api/data');
    assert.equal(none.status, 401);
    assert.equal(none.headers.get('cache-control'), 'private, no-store');

    const g = await fetch(dev.url + '/api/data', { headers: key });
    assert.equal(g.status, 200);
    const seeded = await g.json();
    assert.deepEqual(seeded, { ...SAMPLE_NOV, note: 'Sample data' });

    const p = await fetch(dev.url + '/api/data', {
      method: 'PUT', headers: { ...key, 'content-type': 'application/json' },
      body: JSON.stringify({ ...seeded, baseSavedAt: seeded.savedAt, note: 'Added Costco $182.40' }),
    });
    assert.equal(p.status, 200);
    const h = await (await fetch(dev.url + '/api/data?history=1', { headers: key })).json();
    assert.deepEqual(h.versions.map(v => v.note), ['Added Costco $182.40', 'Sample data']);
    assert.ok(h.versions.every(v => v.id.startsWith('finance-preview/')));

    const body = JSON.stringify(file({ uploadDate: '2026-10-31' }));
    const read = await fetch(dev.url + '/api/read', { method: 'POST', headers: { ...key, 'content-type': 'application/json', origin: dev.url }, body });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { rows: OCT31, dropped: 0 });
    const cross = await fetch(dev.url + '/api/read', { method: 'POST', headers: { ...key, 'content-type': 'application/json', origin: 'https://evil.example' }, body });
    assert.equal(cross.status, 403);

    for (const path of ['/api/_store', '/api/_auth', '/.git/config', '/%2e%2e/%2e%2e/etc/passwd', '/.env']) {
      assert.equal((await fetch(dev.url + path, { headers: key })).status, 404, path);
    }
    const page = await fetch(dev.url + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
  } finally {
    await dev.stop();
  }
});
