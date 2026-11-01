// Extra checks for lib/sync.js and lib/diff.js: spec requirements and edge cases on top of sync.test.js and diff.test.js.
// The first group runs the engine against the real api/data.js handler (SPEC 7.2: the fake fetch is built from
// api/data.js) with the in memory blob fake, and the real migrate and noteFor. No network, no real key.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSync, STATUS_TEXT } from '../lib/sync.js';
import { diff, applyOps } from '../lib/diff.js';
import { canonical, clone } from '../lib/core.js';
import { migrate as realMigrate, defaults as realDefaults } from '../lib/migrate.js';
import { noteFor as realNoteFor } from '../lib/labels.js';
import handler from '../api/data.js';
import { setBlobApi } from '../api/_store.js';
import { createFakeBlob } from './helpers/api-fake-blob.js';
import { makeFetch, useEnv } from './helpers/api-harness.js';
import sample from './fixtures/sample-nov.js';
import { createFakeServer, fakeTimers, memoryStorage, migrate, noteFor, defaults } from './helpers/sync-fake-server.js';

const NOW = new Date(2026, 10, 14, 15, 20);
const BOOK = ['savedAt', 'note'];
const METRO = { id: 't-metro', date: '2026-11-13', item: 'i-groc', amt: 12, note: 'Metro' };
// The same expense the way the page writes it in v2 (the real migrate leaves it as it is).
const METRO2 = { ...METRO, src: 'manual', fp: '1200|metro', merchant: 'Metro', account: null };
const netflix = s => s.bills.find(b => b.id === 'b-netflix');
const cushion = s => s.goals.find(g => g.id === 'j-h27');
const DASH = /[‐‑‒–—―]| - /;

/* ---------- the real api/data.js behind fetch ---------- */
const KEY = 'sync-extra-key';
const PUB = 'vercel_blob_rw_syncextra_fakesecret';
let cleanup = null;
afterEach(() => { if (cleanup) cleanup(); cleanup = null; });

function realServer() {
  const blob = createFakeBlob({ stores: { [PUB]: 'public' } });
  setBlobApi(blob.api);
  const restore = useEnv({ APP_KEY: KEY, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined });
  cleanup = () => { restore(); setBlobApi(); };
  const serve = makeFetch({ '/api/data': handler });
  const log = [];
  let mode = 'online';
  const fetch = async (url, init = {}) => {
    const entry = { method: init.method || 'GET', url: String(url), key: new Headers(init.headers || {}).get('x-app-key'), status: null };
    entry.body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    log.push(entry);
    if (mode === 'offline') { entry.status = 0; throw new TypeError('fetch failed'); }
    const res = await serve(url, init);
    entry.status = res.status;
    return res;
  };
  // Another device (or build B) saving straight through the API.
  const save = async doc => (await serve('/api/data', { method: 'PUT', headers: { 'x-app-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(doc) })).json();
  const latest = async () => (await serve('/api/data', { headers: { 'x-app-key': KEY } })).json();
  return { fetch, log, save, latest, puts: () => log.filter(x => x.method === 'PUT'), setMode: m => { mode = m; } };
}

function device(server, { storage, timers = fakeTimers(), real = true } = {}) {
  storage ||= memoryStorage({ 'finance-key': KEY });
  const states = [], statuses = [];
  const engine = createSync({
    fetch: server.fetch, storage, now: () => NOW,
    onState: s => states.push(s), onStatus: (text, code) => statuses.push({ text, code }),
    migrate: real ? realMigrate : migrate, noteFor: real ? realNoteFor : noteFor, defaults: real ? realDefaults : defaults,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  return { engine, storage, timers, states, statuses };
}

async function seededReal() {
  const server = realServer();
  const r = await server.save({ ...clone(sample), savedAt: null });
  assert.equal(r.ok, true);
  return server;
}

test('real api: two devices act on the same base, the second save gets one 409 and no change is lost', async () => {
  const server = await seededReal();
  const A = device(server), B = device(server);
  await A.engine.load();
  await B.engine.load();
  A.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  B.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO2); });
  await A.engine.push();
  await B.engine.push();
  assert.deepEqual(server.puts().map(p => p.status), [200, 409, 200]);
  const latest = await server.latest();
  assert.equal(netflix(latest).amt, 29.99);
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.equal(latest.note, 'Added Metro $12');
  assert.equal(canonical(B.engine.state), canonical(latest));
  assert.equal(canonical(B.states.at(-1), BOOK), canonical(latest, BOOK)); // the merged copy reached the page
});

test('real api: two devices saving at the very same moment both land, nothing lost', async () => {
  const server = await seededReal();
  const A = device(server), B = device(server);
  await A.engine.load();
  await B.engine.load();
  A.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  B.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO2); });
  await Promise.all([A.engine.push(), B.engine.push()]);
  await Promise.all([A.engine.idle(), B.engine.idle()]);

  // The real handler's lock can answer the loser with a 409 whose latest is still the old copy,
  // which costs one extra round; it must stay within the 3 attempts and end saved.
  const statuses = server.puts().map(p => p.status);
  assert.equal(statuses.filter(s => s === 200).length, 2, String(statuses));
  assert.ok(statuses.filter(s => s === 409).length <= 2, String(statuses));
  const latest = await server.latest();
  assert.equal(netflix(latest).amt, 29.99);
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.equal(latest.version, 2);
  // The device that lost the race shows the merged copy; after a refresh both do. Nothing is left to send.
  assert.ok([A, B].some(d => canonical(d.engine.state) === canonical(latest)));
  await A.engine.refresh();
  await B.engine.refresh();
  assert.equal(canonical(A.engine.state), canonical(latest));
  assert.equal(canonical(B.engine.state), canonical(latest));
  assert.deepEqual(A.engine.pending, []);
  assert.deepEqual(B.engine.pending, []);
  for (const x of server.log) assert.equal(x.key, KEY);
});

test('real api: an offline change survives a reload and merges with another device save', async () => {
  const server = await seededReal();
  const storage = memoryStorage({ 'finance-key': KEY });
  const one = device(server, { storage });
  await one.engine.load();
  server.setMode('offline');
  one.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO2); });
  one.timers.tick(700);
  await one.engine.idle();
  assert.equal(one.engine.status.text, STATUS_TEXT.retry);
  one.engine.stop();
  server.setMode('online');

  const doc = await server.latest();
  cushion(doc).saved = 200;
  assert.equal((await server.save(doc)).ok, true); // another device saves meanwhile

  const two = device(server, { storage });
  const r = await two.engine.load();
  assert.equal(r.status, 'ok');
  await two.engine.idle();
  const latest = await server.latest();
  assert.equal(cushion(latest).saved, 200);
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.equal(latest.note, 'Added Metro $12');
  assert.equal(storage.has('finance-pending'), false);
  assert.equal(canonical(two.engine.state), canonical(latest));
});

test('real api: restoring an old backup saves at once, without a conflict loop', async () => {
  const server = await seededReal();
  const A = device(server);
  await A.engine.load();
  const backup = clone(sample);
  backup.savedAt = '2026-10-01T12:00:00.000Z';
  backup.note = 'Very old save';
  backup.settings.payPlan = 1250;
  A.engine.restore(backup, 'Restored backup from Oct 1');
  A.timers.tick(700);
  await A.engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [200]); // the first try, no 409
  const latest = await server.latest();
  assert.equal(latest.settings.payPlan, 1250);
  assert.equal(latest.note, 'Restored backup from Oct 1');
  assert.notEqual(latest.savedAt, backup.savedAt);
  assert.equal(A.engine.status.text, 'Synced 3:20 p.m.');
});

test('real api: v1 data loads migrated, a month without moves takes a move, unknown fields survive a 409 replay', async () => {
  const server = realServer();
  const v1 = clone(sample);
  v1.buildB = { theme: 'dark', list: [1, 2, 3] };          // build B's own top level field
  v1.bills[0].buildBTag = 'keep';                            // and one inside an element
  assert.equal((await server.save({ ...v1, savedAt: null })).ok, true);
  const A = device(server);
  const r = await A.engine.load();
  assert.equal(r.state.version, 2);
  assert.deepEqual(r.state.months['2026-10'].moves, []);
  assert.equal(r.state.months['2026-11'].tx[0].src, 'manual');
  assert.equal(r.state.months['2026-11'].tx[0].fp, '18240|costco');
  A.engine.act('Moved $40 Volleyball → Groceries', d => {
    d.months['2026-11'].moves.push({ id: 'mv1', date: '2026-11-14', from: 'i-volley', to: 'i-groc', amt: 40 });
  });
  // Build B saves first, adding to its own field and changing a bill.
  const other = await server.latest();
  other.buildB.list.push(4);
  other.buildB.added = true;
  netflix(other).note = 'from build B';
  assert.equal((await server.save(other)).ok, true);

  await A.engine.push();
  assert.deepEqual(server.puts().map(p => p.status), [409, 200]);
  const latest = await server.latest();
  assert.deepEqual(latest.buildB, { theme: 'dark', list: [1, 2, 3, 4], added: true });
  assert.equal(latest.bills[0].buildBTag, 'keep');
  assert.equal(netflix(latest).note, 'from build B');
  assert.deepEqual(latest.months['2026-11'].moves.map(m => m.id), ['mv1']);
  assert.equal(latest.note, 'Moved $40 Volleyball → Groceries');
});

/* ---------- the in memory server from the builder's helper ---------- */
function fakeDevice({ server, storage, timers = fakeTimers(), getKey, onState } = {}) {
  storage ||= memoryStorage({ 'finance-key': 'k' });
  const states = [], statuses = [];
  const engine = createSync({
    fetch: server.fetch, storage, getKey, now: () => NOW,
    onState: onState || (s => states.push(s)), onStatus: (text, code) => statuses.push({ text, code }),
    migrate, noteFor, defaults, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  return { engine, server, storage, timers, states, statuses };
}
function seeded() {
  const server = createFakeServer();
  server.seed(sample, { keepSavedAt: true });
  return server;
}

test('load with pending actions and an empty server pushes this device copy once and clears pending', async () => {
  const storage = memoryStorage({ 'finance-key': 'k' });
  const offline = createFakeServer();
  offline.setMode('offline');
  const one = fakeDevice({ server: offline, storage });
  await one.engine.load();
  one.engine.act('Added Metro $12', d => { d.months['2026-11'] = { paid: {}, tx: [METRO], pays: [], moves: [] }; });
  one.engine.stop();

  const server = createFakeServer(); // the server is empty (a new store)
  const two = fakeDevice({ server, storage });
  const r = await two.engine.load();
  assert.equal(r.status, 'empty');
  await two.engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [200]);
  const latest = server.latest();
  assert.deepEqual(latest.months['2026-11'].tx.map(t => t.id), [METRO.id]); // the change is in it exactly once
  assert.equal(latest.note, 'Added Metro $12');
  assert.deepEqual(two.engine.pending, []);
  assert.equal(storage.has('finance-pending'), false);
});

test('undo of an action read back from storage after a reload reverts only its own paths', async () => {
  const server = seeded();
  const storage = memoryStorage({ 'finance-key': 'k' });
  const one = fakeDevice({ server, storage });
  await one.engine.load();
  server.setMode('offline');
  one.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  one.engine.stop();
  server.setMode('online');
  const other = server.latest();
  cushion(other).saved = 75;
  server.seed(other);

  const two = fakeDevice({ server, storage });
  two.server.setMode('offline'); // reload while offline: the pending action comes from storage only
  await two.engine.load();
  const [stored] = two.engine.pending;
  assert.equal(stored.label, 'Changed bill Netflix');
  assert.equal(stored.before, undefined);
  const u = two.engine.undo(stored);
  assert.equal(u.label, 'Undid "Changed bill Netflix"');
  assert.equal(netflix(two.engine.state).amt, 27.11);
  server.setMode('online');
  await two.engine.push();
  const latest = server.latest();
  assert.equal(netflix(latest).amt, 27.11);
  assert.equal(cushion(latest).saved, 75);
});

test('the PUT body is the state plus baseSavedAt; baseSavedAt never reaches the state or the cache', async () => {
  const { engine, server, storage, timers } = fakeDevice({ server: seeded() });
  await engine.load();
  const base = engine.state.savedAt;
  engine.act('Ticked Netflix paid', d => { d.months['2026-11'].paid['b-netflix@2026-11-16'] = true; });
  const sent = { ...engine.state };
  timers.tick(700);
  await engine.idle();
  const [put] = server.puts();
  assert.deepEqual(Object.keys(put.body).sort(), [...new Set([...Object.keys(sent), 'baseSavedAt', 'note', 'savedAt'])].sort());
  assert.equal(put.body.savedAt, base);
  assert.equal(put.body.baseSavedAt, base);
  assert.equal(canonical(put.body, [...BOOK, 'baseSavedAt']), canonical(sent, BOOK));
  assert.equal('baseSavedAt' in engine.state, false);
  assert.equal('baseSavedAt' in storage.json('finance-cache'), false);
  assert.equal(server.latest().baseSavedAt, undefined);
});

test('an action made during a PUT that gets a 409 is replayed and sent in the next PUT', async () => {
  const server = seeded();
  const { engine, timers } = fakeDevice({ server });
  await engine.load();
  const other = server.latest();
  cushion(other).saved = 90;
  server.seed(other); // another device saved: our next PUT gets a 409
  engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  const release = server.hold();
  timers.tick(700);
  engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  release();
  await engine.idle();
  const puts = server.puts();
  assert.deepEqual(puts.map(p => p.status), [409, 200]);
  assert.equal(puts[1].body.note, 'Changed bill Netflix and Added Metro $12');
  const latest = server.latest();
  assert.equal(cushion(latest).saved, 90);
  assert.equal(netflix(latest).amt, 29.99);
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.deepEqual(engine.pending, []);
  timers.tick(700); // the second action's own wait ends: nothing left to send
  await engine.idle();
  assert.equal(server.puts().length, 2);
});

test('a 409 without latest falls back to a GET and still merges', async () => {
  const server = seeded();
  const fetch = async (url, init) => {
    const res = await server.fetch(url, init);
    return res.status === 409 ? new Response(JSON.stringify({ error: 'conflict', latest: null }), { status: 409 }) : res;
  };
  const { engine } = fakeDevice({ server: { ...server, fetch } });
  await engine.load();
  const other = server.latest();
  cushion(other).saved = 90;
  server.seed(other);
  engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  await engine.push();
  assert.deepEqual(server.log.map(x => [x.method, x.status]), [['GET', 200], ['PUT', 409], ['GET', 200], ['PUT', 200]]);
  assert.equal(cushion(server.latest()).saved, 90);
  assert.equal(netflix(server.latest()).amt, 29.99);
});

test('a 401 on refresh or on history hides the data', async () => {
  const server = seeded();
  const A = fakeDevice({ server });
  await A.engine.load();
  server.key = 'rotated';
  const r = await A.engine.refresh();
  assert.equal(r.state, null);
  assert.equal(r.status, 'not-set-up');
  assert.equal(A.engine.state, null);
  assert.equal(A.statuses.at(-1).code, 'not-set-up');

  server.key = 'k';
  const B = fakeDevice({ server });
  await B.engine.load();
  server.key = 'rotated';
  assert.equal(await B.engine.history(), null);
  assert.equal(B.engine.state, null);
});

test('after an empty server is filled by another device, nothing stale is saved over it', async () => {
  const server = createFakeServer();
  let failPuts = true;
  const fetch = (url, init = {}) => (failPuts && init.method === 'PUT' ? Promise.reject(new TypeError('fetch failed')) : server.fetch(url, init));
  const { engine, timers } = fakeDevice({ server: { ...server, fetch } });
  assert.equal((await engine.load()).status, 'empty');
  await engine.idle();
  assert.deepEqual(timers.waiting(), [5000]); // our first save failed, a retry is waiting
  failPuts = false;
  server.seed(migrate(sample)); // the other device saves real data first
  const r = await engine.refresh();
  assert.equal(r.changed, true);
  timers.tick(5000);
  await engine.idle();
  assert.equal(server.puts().length, 0, 'no save without a change: it would add an empty "Saved" version');
  assert.equal(server.versions().length, 1);
});

test('a second load forgets that the server was empty', async () => {
  const server = createFakeServer();
  let failPuts = true;
  const fetch = (url, init = {}) => (failPuts && init.method === 'PUT' ? Promise.reject(new TypeError('fetch failed')) : server.fetch(url, init));
  const { engine } = fakeDevice({ server: { ...server, fetch } });
  await engine.load();
  await engine.idle();
  failPuts = false;
  server.seed(migrate(sample));
  assert.equal((await engine.load()).status, 'ok');
  await engine.push(); // the page asks for a save when it hides
  assert.equal(server.puts().length, 0);
});

test('an act that changes nothing is not saved, even when the state holds NaN', async () => {
  const { engine, timers } = fakeDevice({ server: seeded() });
  await engine.load();
  engine.act('Planned pay set to $0', d => { d.settings.payPlan = NaN; }); // a bad number typed in the form
  assert.equal(engine.pending.length, 1);
  const a = engine.act('Nothing', () => {});
  assert.deepEqual(a.ops, []);
  assert.equal(engine.pending.length, 1);
  assert.deepEqual(diff({ x: NaN, l: [NaN] }, { x: NaN, l: [NaN] }), []);
  timers.tick(700);
  await engine.idle();
});

test('a refresh that reaches the server clears the offline status', async () => {
  const server = seeded();
  const storage = memoryStorage({ 'finance-key': 'k', 'finance-cache': JSON.stringify(migrate(sample)) });
  server.setMode('offline');
  const { engine } = fakeDevice({ server, storage });
  assert.equal((await engine.load()).status, 'offline');
  assert.equal(engine.status.text, "Offline, showing this device's copy");
  server.setMode('online');
  const r = await engine.refresh(); // same savedAt: nothing to replace, but the server answered
  assert.equal(r.changed, false);
  assert.equal(engine.status.code, 'ok');
  assert.equal(engine.status.text, 'Synced');
});

test('a render error in onState does not stop the change from syncing', async () => {
  let broken = false;
  const server = seeded();
  const { engine, timers } = fakeDevice({ server, onState: () => { if (broken) throw new Error('render failed'); } });
  await engine.load();
  broken = true;
  assert.throws(() => engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; }), /render failed/);
  broken = false;
  assert.equal(engine.pending.length, 1);
  assert.equal(engine.status.text, 'Saving…');
  timers.tick(700);
  await engine.idle();
  assert.equal(netflix(server.latest()).amt, 29.99);
  assert.deepEqual(engine.pending, []);
});

test('a device key that cannot be read counts as not set up', async () => {
  const server = seeded();
  const { engine, states } = fakeDevice({ server, getKey: () => { throw new Error('SecurityError: storage is blocked'); } });
  const r = await engine.load();
  assert.deepEqual(r, { state: null, status: 'not-set-up' });
  assert.deepEqual(states, []);
  assert.equal(server.log.length, 0);
});

test('a retry after a network error uses the newest copy when another device saved meanwhile', async () => {
  const server = seeded();
  const { engine, timers } = fakeDevice({ server });
  await engine.load();
  server.setMode('offline');
  engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  timers.tick(700);
  await engine.idle();
  server.setMode('online');
  const other = server.latest();
  netflix(other).amt = 31;
  server.seed(other);
  timers.tick(5000);
  await engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [0, 409, 200]);
  const latest = server.latest();
  assert.equal(netflix(latest).amt, 31);
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.equal(canonical(engine.state), canonical(latest));
});

test('undo after a 409 merged a remote change keeps the remote change', async () => {
  const server = seeded();
  const { engine } = fakeDevice({ server });
  await engine.load();
  const a = engine.act('Deleted Costco $182.40', d => { d.months['2026-11'].tx.splice(0, 1); });
  const other = server.latest();
  other.months['2026-11'].tx.push({ ...METRO, id: 't-remote' });
  server.seed(other);
  await engine.push(); // 409, replayed, saved
  engine.undo(a);
  const ids = engine.state.months['2026-11'].tx.map(t => t.id);
  assert.equal(ids[0], 't1'); // back at its old index
  assert.ok(ids.includes('t-remote'));
  await engine.push();
  assert.deepEqual(server.latest().months['2026-11'].tx.map(t => t.id), ids);
});

test('every status text shown in a full session is plain, with no dashes', async () => {
  const server = seeded();
  const all = [];
  const { engine, timers, statuses } = fakeDevice({ server });
  await engine.load();
  engine.act('A', d => { netflix(d).amt = 1; });
  server.setMode('error'); timers.tick(700); await engine.idle();
  server.setMode('offline'); timers.tick(5000); await engine.idle();
  server.setMode('online');
  server.onPut = () => { const d = server.latest(); cushion(d).saved += 1; server.seed(d); };
  timers.tick(5000); await engine.idle();
  server.onPut = null;
  timers.tick(5000); await engine.idle();
  server.key = 'other';
  engine.act('B', d => { netflix(d).amt = 2; });
  timers.tick(700); await engine.idle();
  all.push(...statuses.map(s => s.text));
  const codes = new Set(statuses.map(s => s.code));
  for (const c of ['ok', 'saving', 'retry', 'conflict', 'synced', 'not-set-up']) assert.ok(codes.has(c), c);
  for (const t of all) assert.doesNotMatch(t, DASH, t);
});

/* ---------- diff edge cases ---------- */
test('applyOps never changes the ops it is given, in either direction', () => {
  const a = clone(sample), b = clone(sample);
  b.bills.reverse();
  b.bills.splice(2, 1);
  b.months['2026-11'].tx.push(METRO);
  b.settings.visaDueDay = 22;
  const ops = diff(a, b);
  const frozen = JSON.stringify(ops);
  applyOps(clone(a), ops, 'forward');
  applyOps(clone(b), ops, 'backward');
  applyOps(clone(b), ops, 'forward'); // a replay on the result
  assert.equal(JSON.stringify(ops), frozen);
});

test('a backward pass recreates a month list removed elsewhere only as far as it needs', () => {
  const a = migrate(sample);
  const b = clone(a); b.months['2026-11'].tx.splice(3, 1);
  const ops = diff(a, b);
  const elsewhere = clone(b); delete elsewhere.months['2026-11'];
  const out = applyOps(elsewhere, ops, 'backward');
  assert.deepEqual(out.months['2026-11'].tx.map(t => t.id), ['t4']); // the undone delete is not lost
});

/* ---------- a container created on two devices (the first change in a new month) ---------- */
const dec = (d, fill) => { d.months['2026-12'] ||= { paid: {}, tx: [], pays: [], moves: [] }; fill(d.months['2026-12']); };
const DEC_TX = { id: 't-dec', date: '2026-12-01', item: 'i-coffee', amt: 6.58, note: 'Nuage Cafe' };

test('two devices that each make the first change of a new month both keep their change', async () => {
  const server = seeded();
  const A = fakeDevice({ server }), B = fakeDevice({ server });
  await A.engine.load();
  await B.engine.load();
  A.engine.act('Ticked Rent (my half) paid', d => dec(d, m => { m.paid['b-rent@2026-12-01'] = true; }));
  B.engine.act('Added Nuage Cafe $6.58', d => dec(d, m => { m.tx.push(DEC_TX); }));
  await A.engine.push();
  await B.engine.push();
  assert.deepEqual(server.puts().map(p => p.status), [200, 409, 200]);
  const m = server.latest().months['2026-12'];
  assert.equal(m.paid['b-rent@2026-12-01'], true, 'the tick from the first device is kept');
  assert.deepEqual(m.tx.map(t => t.id), ['t-dec']);
  assert.deepEqual(m.pays, []);
  assert.deepEqual(m.moves, []);
});

test('undo of the first change in a month keeps what another device added to that month since', async () => {
  const server = seeded();
  const A = fakeDevice({ server }), B = fakeDevice({ server });
  await A.engine.load();
  const a = A.engine.act('Added Nuage Cafe $6.58', d => dec(d, m => { m.tx.push(DEC_TX); }));
  await A.engine.push();
  await B.engine.load();
  B.engine.act('Logged pay $1,300', d => { d.months['2026-12'].pays.push({ id: 'p-dec4', date: '2026-12-04', amt: 1300, hours: null, note: '' }); });
  await B.engine.push();
  await A.engine.refresh();
  A.engine.undo(a);
  const m = A.engine.state.months['2026-12'];
  assert.ok(m, 'the month stays: it holds the other device pay');
  assert.deepEqual(m.tx, []);
  assert.deepEqual(m.pays.map(p => p.id), ['p-dec4']);
  assert.deepEqual(Object.keys(m).sort(), ['moves', 'paid', 'pays', 'tx']); // the month keeps its v2 shape
  await A.engine.push();
  assert.equal(canonical(server.latest().months['2026-12']), canonical(m));
});

test('diff: a container added on both sides merges, and taking one side out leaves the other', () => {
  const a = { months: {} };
  const mine = { months: { '2026-12': { paid: { 'b-rent@2026-12-01': true }, tx: [{ id: 't1', amt: 5 }], pays: [], moves: [] } } };
  const theirs = { months: { '2026-12': { paid: {}, tx: [{ id: 't2', amt: 7 }], pays: [{ id: 'p1', amt: 1300 }], moves: [], extra: 'b' } } };
  const ops = diff(a, mine);
  const merged = applyOps(clone(theirs), ops, 'forward');
  assert.deepEqual(merged.months['2026-12'], {
    paid: { 'b-rent@2026-12-01': true }, tx: [{ id: 't1', amt: 5 }, { id: 't2', amt: 7 }], pays: [{ id: 'p1', amt: 1300 }], moves: [], extra: 'b',
  });
  // Undo on top: only my part goes, the month and its lists stay.
  const back = applyOps(clone(merged), ops, 'backward');
  assert.deepEqual(back, { months: { '2026-12': { paid: {}, tx: [{ id: 't2', amt: 7 }], pays: [{ id: 'p1', amt: 1300 }], moves: [], extra: 'b' } } });
  // On its own base the round trip is still exact.
  assert.equal(canonical(applyOps(clone(mine), ops, 'backward')), canonical(a));
  assert.equal(canonical(applyOps(clone(a), ops, 'forward')), canonical(mine));
  // Replaying the same creation twice changes nothing.
  assert.equal(canonical(applyOps(clone(merged), ops, 'forward')), canonical(merged));
  // A plain value or plain array it added goes away entirely; only objects and id lists stay as empty ones.
  const withTags = diff({ m: {} }, { m: { x: { tags: ['a'], n: 1, tx: [{ id: 't1' }] } } });
  const kept = applyOps({ m: { x: { tx: [{ id: 't1' }, { id: 't2' }], tags: ['a'], n: 1 } } }, withTags, 'backward');
  assert.deepEqual(kept, { m: { x: { tx: [{ id: 't2' }] } } });
});

test('diff: merging into and taking out of an existing container never changes or shares the ops', () => {
  const a = { months: {} };
  const mine = { months: { '2026-12': { paid: { k: true }, tx: [{ id: 't1', amt: 5, tags: ['x'] }], pays: [], moves: [] } } };
  const theirs = { months: { '2026-12': { paid: {}, tx: [{ id: 't1', amt: 9 }, { id: 't2', amt: 7 }], pays: [], moves: [] } } };
  const ops = diff(a, mine);
  const frozen = JSON.stringify(ops);
  const merged = applyOps(clone(theirs), ops, 'forward');
  assert.deepEqual(merged.months['2026-12'].tx, [{ id: 't1', amt: 5, tags: ['x'] }, { id: 't2', amt: 7 }]);
  merged.months['2026-12'].tx[0].tags.push('scribble');
  merged.months['2026-12'].paid.k = 'scribble';
  applyOps(merged, ops, 'backward');
  assert.equal(JSON.stringify(ops), frozen);
});

test('real api: an empty store gets this device defaults once, then a version from history restores as one undoable action', async () => {
  const server = realServer();
  const A = device(server);
  const r = await A.engine.load();
  assert.equal(r.status, 'empty');
  await A.engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [200]);
  assert.equal((await server.latest()).note, 'Saved');
  const rent = A.engine.state.bills[0];
  A.engine.act('Changed bill Rent (my half)', d => { d.bills[0].amt = 600; });
  await A.engine.push();
  A.engine.act('Planned pay set to $1,250', d => { d.settings.payPlan = 1250; });
  await A.engine.push();

  const versions = await A.engine.history();
  assert.deepEqual(versions.map(v => v.note), ['Planned pay set to $1,250', 'Changed bill Rent (my half)', 'Saved']);
  const old = await A.engine.fetchVersion(versions[2].id);
  const action = A.engine.restore(old, 'Restored the version from Nov 14, 3:20 p.m.');
  assert.equal(A.engine.state.bills[0].amt, rent.amt);
  assert.equal(A.engine.state.settings.payPlan, 1300);
  await A.engine.push();
  assert.deepEqual(server.puts().map(p => p.status), [200, 200, 200, 200]); // no 409 from the old savedAt
  A.engine.undo(action);
  await A.engine.push();
  const latest = await server.latest();
  assert.equal(latest.bills[0].amt, 600);
  assert.equal(latest.settings.payPlan, 1250);
  assert.equal(latest.note, 'Undid "Restored the version from Nov 14, 3:20 p.m."');
});
