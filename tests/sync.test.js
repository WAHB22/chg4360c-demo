import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync, STATUS_TEXT, syncedText } from '../lib/sync.js';
import { diff, applyOps } from '../lib/diff.js';
import { canonical, clone } from '../lib/core.js';
import sample from './fixtures/sample-nov.js';
import { createFakeServer, fakeTimers, memoryStorage, migrate, noteFor, defaults } from './helpers/sync-fake-server.js';

const NOW = new Date(2026, 10, 14, 15, 20); // 3:20 p.m. local time
const METRO = { id: 't-metro', date: '2026-11-13', item: 'i-groc', amt: 12, note: 'Metro' };
const BOOK = ['savedAt', 'note'];
const netflix = s => s.bills.find(b => b.id === 'b-netflix');
const cushion = s => s.goals.find(g => g.id === 'j-h27');

function setup({ server, storage, timers = fakeTimers(), noteFor: nf = noteFor, getKey } = {}) {
  server ||= createFakeServer();
  storage ||= memoryStorage({ 'finance-key': 'k' });
  const states = [], statuses = [];
  const engine = createSync({
    fetch: server.fetch, storage, getKey, now: () => NOW,
    onState: s => states.push(s), onStatus: (text, code) => statuses.push({ text, code }),
    migrate, noteFor: nf, defaults,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  return { engine, server, storage, timers, states, statuses };
}

function seededServer() {
  const server = createFakeServer();
  server.seed(sample, { keepSavedAt: true });
  return server;
}

async function loaded(opts = {}) {
  const ctx = setup({ ...opts, server: opts.server || seededServer() });
  await ctx.engine.load();
  return ctx;
}

/* ---------- load ---------- */
test('load from an empty server pushes the defaults', async () => {
  const { engine, server, states } = setup();
  const r = await engine.load();
  assert.equal(r.status, 'empty');
  assert.equal(canonical(r.state), canonical(migrate(defaults())));
  assert.equal(states.length, 1);
  await engine.idle();
  const puts = server.puts();
  assert.deepEqual(puts.map(p => p.status), [200]);
  assert.equal(puts[0].body.savedAt, null);
  assert.equal(puts[0].body.baseSavedAt, null);
  const saved = server.latest();
  assert.equal(canonical(saved, BOOK), canonical(defaults()));
  assert.equal(saved.note, 'Saved');
  assert.equal(engine.state.savedAt, saved.savedAt);
  assert.equal(engine.status.text, 'Synced 3:20 p.m.');
});

test('load from an empty server pushes this device copy when there is one', async () => {
  const cached = migrate(sample);
  const storage = memoryStorage({ 'finance-key': 'k', 'finance-cache': JSON.stringify(cached) });
  const { engine, server } = setup({ storage });
  const r = await engine.load();
  assert.equal(r.status, 'empty');
  assert.equal(canonical(r.state), canonical(cached));
  await engine.idle();
  assert.equal(canonical(server.latest(), BOOK), canonical(cached, BOOK));
});

test('load ok shows the server copy, migrated, and caches it', async () => {
  const storage = memoryStorage({ 'finance-key': 'k', 'finance-cache': JSON.stringify({ ...defaults(), bills: [{ id: 'old' }] }) });
  const { engine, server, states, statuses } = setup({ server: seededServer(), storage });
  const r = await engine.load();
  assert.equal(r.status, 'ok');
  assert.equal(r.state.version, 2);
  assert.equal(canonical(r.state), canonical(migrate(sample)));
  assert.equal(engine.state, r.state);
  assert.equal(canonical(storage.json('finance-cache')), canonical(r.state));
  assert.deepEqual(states, [r.state]);
  assert.deepEqual(statuses.at(-1), { text: 'Synced', code: 'ok' });
  assert.equal(server.puts().length, 0);
});

/* ---------- act and push ---------- */
test('an action saves to this device at once and pushes once, debounced 700 ms', async () => {
  const { engine, server, storage, timers, states } = await loaded();
  const a1 = engine.act('Ticked Netflix paid', d => { d.months['2026-11'].paid['b-netflix@2026-11-16'] = true; });
  assert.equal(a1.label, 'Ticked Netflix paid');
  assert.deepEqual(Object.keys(a1).sort(), ['after', 'at', 'before', 'id', 'label', 'ops']);
  assert.equal(storage.json('finance-cache').months['2026-11'].paid['b-netflix@2026-11-16'], true);
  assert.deepEqual(storage.json('finance-pending'), [{ id: a1.id, label: a1.label, ops: JSON.parse(JSON.stringify(a1.ops)) }]);
  assert.equal(engine.status.text, 'Saving…');
  assert.equal(states.at(-1), engine.state);
  assert.equal(server.puts().length, 0);
  assert.deepEqual(timers.waiting(), [700]);

  timers.tick(500);
  engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  assert.deepEqual(timers.waiting(), [700]); // the wait starts over
  timers.tick(699);
  assert.equal(server.puts().length, 0);
  timers.tick(1);
  await engine.idle();

  const puts = server.puts();
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.savedAt, sample.savedAt); // the base it started from
  assert.equal(puts[0].body.baseSavedAt, sample.savedAt);
  const latest = server.latest();
  assert.equal(latest.months['2026-11'].paid['b-netflix@2026-11-16'], true);
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.deepEqual(engine.pending, []);
  assert.equal(storage.has('finance-pending'), false);
  assert.equal(engine.state.savedAt, latest.savedAt);
  assert.equal(storage.json('finance-cache').savedAt, latest.savedAt);
  assert.equal(engine.status.text, 'Synced 3:20 p.m.');
  assert.deepEqual(timers.waiting(), []);
});

test('the save note is noteFor of the labels in that push', async () => {
  const calls = [];
  const spy = labels => { calls.push(labels); return noteFor(labels); };
  const { engine, server, timers } = await loaded({ noteFor: spy });
  engine.act('Added Costco $182.40', d => { d.months['2026-11'].tx.push({ ...METRO, id: 't-c' }); });
  engine.act('Ticked Netflix paid', d => { d.months['2026-11'].paid['b-netflix@2026-11-16'] = true; });
  engine.act('Planned pay set to $1,250', d => { d.settings.payPlan = 1250; });
  timers.tick(700);
  await engine.idle();
  assert.deepEqual(calls, [['Added Costco $182.40', 'Ticked Netflix paid', 'Planned pay set to $1,250']]);
  assert.equal(server.latest().note, 'Added Costco $182.40 and Ticked Netflix paid and Planned pay set to $1,250');
  assert.equal(server.puts()[0].body.note, server.latest().note);
});

test('actions made while a PUT is in flight stay pending and go in the next push', async () => {
  const { engine, server, timers } = await loaded();
  engine.act('First', d => { netflix(d).amt = 29.99; });
  const release = server.hold();
  timers.tick(700); // the PUT is now waiting on the server
  const second = engine.act('Second', d => { cushion(d).saved = 200; });
  release();
  await engine.idle();

  assert.deepEqual(engine.pending.map(a => a.id), [second.id]);
  let latest = server.latest();
  assert.equal(latest.note, 'First');
  assert.equal(netflix(latest).amt, 29.99);
  assert.equal(cushion(latest).saved, 0); // the in flight PUT did not carry the second action
  assert.equal(cushion(engine.state).saved, 200);
  assert.equal(engine.status.text, 'Saving…');
  assert.deepEqual(timers.waiting(), [700]); // the second action's own wait is still running

  timers.tick(700);
  await engine.idle();
  latest = server.latest();
  assert.equal(latest.note, 'Second');
  assert.equal(cushion(latest).saved, 200);
  assert.equal(netflix(latest).amt, 29.99);
  assert.deepEqual(engine.pending, []);
  assert.deepEqual(server.puts().map(p => p.status), [200, 200]);
});

test('when the next wait ends during the flight, the next push follows right after', async () => {
  const { engine, server, timers } = await loaded();
  engine.act('First', d => { netflix(d).amt = 29.99; });
  const release = server.hold();
  timers.tick(700);
  engine.act('Second', d => { cushion(d).saved = 200; });
  timers.tick(700); // push() is asked for while the first PUT is still out
  assert.equal(server.puts().length, 1);
  release();
  await engine.idle();
  assert.deepEqual(server.puts().map(p => [p.status, p.body.note]), [[200, 'First'], [200, 'Second']]);
  assert.deepEqual(engine.pending, []);
  assert.equal(canonical(engine.state), canonical(server.latest()));
});

/* ---------- conflicts ---------- */
test('two devices act on the same base at the same time: one 409 and no lost change', async () => {
  const server = seededServer();
  const A = await loaded({ server }), B = await loaded({ server });
  A.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  B.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  const release = server.hold();
  const both = Promise.all([A.engine.push(), B.engine.push()]);
  release();
  await both;

  assert.deepEqual(server.puts().map(p => p.status), [200, 409, 200]);
  const latest = server.latest();
  const expected = migrate(sample);
  netflix(expected).amt = 29.99;
  expected.months['2026-11'].tx.push(METRO);
  assert.equal(canonical(latest, BOOK), canonical(expected, BOOK));
  assert.equal(latest.note, 'Added Metro $12');
  assert.equal(canonical(B.engine.state), canonical(latest));
  assert.equal(canonical(B.states.at(-1), BOOK), canonical(expected, BOOK)); // the merged state reached the page
  assert.deepEqual(B.engine.pending, []);

  const r = await A.engine.refresh();
  assert.equal(r.changed, true);
  assert.equal(canonical(A.engine.state), canonical(latest));
});

test('a 409 replays every pending action on the newest copy, edits to the same bill included', async () => {
  const server = seededServer();
  const A = await loaded({ server }), B = await loaded({ server });
  A.engine.act('Renamed Netflix', d => { netflix(d).name = 'Netflix Premium'; });
  A.engine.act('Unticked Rent', d => { delete d.months['2026-11'].paid['b-rent@2026-11-01']; });
  await A.engine.push();
  B.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  B.engine.act('Deleted pay', d => { d.months['2026-10'].pays.shift(); });
  await B.engine.push();
  assert.deepEqual(server.puts().map(p => p.status), [200, 409, 200]);
  const latest = server.latest();
  assert.equal(netflix(latest).name, 'Netflix Premium');
  assert.equal(netflix(latest).amt, 29.99);
  assert.equal(latest.months['2026-11'].paid['b-rent@2026-11-01'], undefined);
  assert.deepEqual(latest.months['2026-10'].pays.map(p => p.id), ['p-oct23']);
  assert.equal(latest.note, 'Changed bill Netflix and Deleted pay');
});

test('three conflicts in a row: Could not sync, will retry, then it recovers', async () => {
  const { engine, server, timers } = await loaded();
  let other = 0;
  server.onPut = () => { // another device saves just before each of our PUTs
    const doc = server.latest();
    cushion(doc).saved = ++other * 10;
    server.seed(doc);
  };
  engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  timers.tick(700);
  await engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [409, 409, 409]);
  assert.equal(engine.status.text, 'Could not sync, will retry');
  assert.deepEqual(timers.waiting(), [5000]);
  assert.equal(cushion(engine.state).saved, 30); // already shows the newest copy
  assert.equal(netflix(engine.state).amt, 29.99);
  assert.equal(engine.pending.length, 1);

  server.onPut = null;
  timers.tick(5000);
  await engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [409, 409, 409, 200]);
  const latest = server.latest();
  assert.equal(netflix(latest).amt, 29.99);
  assert.equal(cushion(latest).saved, 30);
  assert.equal(engine.status.text, 'Synced 3:20 p.m.');
});

/* ---------- offline ---------- */
test('an offline action is kept on this device, survives a reload, then syncs', async () => {
  const server = seededServer();
  const storage = memoryStorage({ 'finance-key': 'k' });
  const one = await loaded({ server, storage });
  server.setMode('offline');
  const a = one.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  one.timers.tick(700);
  await one.engine.idle();
  assert.equal(one.engine.status.text, 'Not synced yet, saved on this device. Will retry.');
  assert.deepEqual(one.timers.waiting(), [5000]);
  assert.deepEqual(storage.json('finance-pending'), [{ id: a.id, label: 'Added Metro $12', ops: JSON.parse(JSON.stringify(a.ops)) }]);
  const cache = storage.json('finance-cache');
  assert.ok(cache.months['2026-11'].tx.some(t => t.id === METRO.id));
  one.engine.stop(); // the page is closed

  server.setMode('online');
  const two = setup({ server, storage });
  const r = await two.engine.load();
  assert.equal(r.status, 'ok');
  assert.equal(canonical(r.state), canonical(cache)); // remote savedAt equals the cached one: the result is the cache
  await two.engine.idle();
  const latest = server.latest();
  assert.ok(latest.months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.equal(latest.note, 'Added Metro $12');
  assert.deepEqual(two.engine.pending, []);
  assert.equal(storage.has('finance-pending'), false);
  assert.equal(two.engine.status.text, 'Synced 3:20 p.m.');
});

test('a reload while still offline shows this device copy, then syncs on the retry', async () => {
  const server = seededServer();
  const storage = memoryStorage({ 'finance-key': 'k' });
  const one = await loaded({ server, storage });
  server.setMode('offline');
  one.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  one.engine.stop();
  const cache = storage.json('finance-cache');

  const two = setup({ server, storage });
  const r = await two.engine.load();
  assert.equal(r.status, 'offline');
  assert.equal(canonical(r.state), canonical(cache));
  assert.equal(two.engine.status.text, "Offline, showing this device's copy");
  assert.deepEqual(two.timers.waiting(), [5000]);
  server.setMode('online');
  two.timers.tick(5000);
  await two.engine.idle();
  assert.ok(server.latest().months['2026-11'].tx.some(t => t.id === METRO.id));
  assert.deepEqual(two.engine.pending, []);
});

test('offline with no copy on this device starts from the defaults', async () => {
  const server = createFakeServer();
  server.setMode('offline');
  const { engine } = setup({ server });
  const r = await engine.load();
  assert.equal(r.status, 'offline');
  assert.equal(canonical(r.state), canonical(defaults()));
});

test('a reload after another device saved merges both changes', async () => {
  const server = seededServer();
  const storage = memoryStorage({ 'finance-key': 'k' });
  const one = await loaded({ server, storage });
  server.setMode('offline');
  one.engine.act('Added Metro $12', d => { d.months['2026-11'].tx.push(METRO); });
  one.engine.stop();
  server.setMode('online');
  const other = await loaded({ server });
  other.engine.act('Added $200 to Hiver 2027 cushion', d => { cushion(d).saved = 200; });
  await other.engine.push();

  const two = setup({ server, storage });
  const r = await two.engine.load();
  assert.equal(cushion(r.state).saved, 200);
  assert.ok(r.state.months['2026-11'].tx.some(t => t.id === METRO.id));
  await two.engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [200, 200]); // the other device, then the merge (the page closed before its own try)
  assert.equal(canonical(server.latest()), canonical(two.engine.state));
});

test('network errors and 5xx keep the change and retry after 5 s', async () => {
  const { engine, server, timers } = await loaded();
  server.setMode('error');
  engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  timers.tick(700);
  await engine.idle();
  assert.equal(engine.status.text, 'Not synced yet, saved on this device. Will retry.');
  assert.deepEqual(server.puts().map(p => p.status), [500]);
  timers.tick(4999);
  assert.equal(server.puts().length, 1);
  server.setMode('online');
  timers.tick(1);
  await engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [500, 200]);
  assert.equal(netflix(server.latest()).amt, 29.99);
  assert.equal(engine.status.text, 'Synced 3:20 p.m.');
});

/* ---------- undo and restore ---------- */
test('undo right after an action gives back the exact state', async () => {
  const { engine, server, timers } = await loaded();
  const before = engine.state;
  const beforeJSON = JSON.stringify(before);
  const a = engine.act('Unticked Rent', d => { delete d.months['2026-11'].paid['b-rent@2026-11-01']; });
  const u = engine.undo(a);
  assert.equal(JSON.stringify(engine.state), beforeJSON);
  assert.equal(canonical(engine.state), canonical(before));
  assert.equal(u.label, 'Undid "Unticked Rent"');
  // The backward ops alone put the key back last: same content, different key order. Undo is exact instead.
  const viaOps = applyOps(clone(a.after), a.ops, 'backward');
  assert.equal(canonical(viaOps), canonical(before));
  assert.notEqual(JSON.stringify(viaOps), beforeJSON);

  assert.deepEqual(engine.pending.map(p => p.label), ['Unticked Rent', 'Undid "Unticked Rent"']);
  timers.tick(700);
  await engine.idle();
  const latest = server.latest();
  assert.equal(canonical(latest, BOOK), canonical(before, BOOK));
  assert.equal(latest.note, 'Unticked Rent and Undid "Unticked Rent"');
});

test('undo after the save went through is still exact and keeps the new savedAt', async () => {
  const { engine, server, timers } = await loaded();
  const before = engine.state;
  const a = engine.act('Deleted Costco $182.40', d => { const m = d.months['2026-11']; m.tx = m.tx.filter(t => t.id !== 't1'); });
  timers.tick(700);
  await engine.idle();
  const saved = engine.state.savedAt;
  assert.notEqual(saved, before.savedAt);
  engine.undo(a);
  assert.equal(engine.state.savedAt, saved); // the sync base is never undone
  assert.equal(JSON.stringify({ ...engine.state, savedAt: before.savedAt, note: before.note }), JSON.stringify(before));
  timers.tick(700);
  await engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [200, 200]);
  assert.equal(server.latest().months['2026-11'].tx[0].id, 't1');
  assert.equal(canonical(server.latest(), BOOK), canonical(before, BOOK));
});

test('undo on top of a newer remote change only reverts its own paths', async () => {
  const server = seededServer();
  const A = await loaded({ server });
  const a = A.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  await A.engine.push();
  const B = await loaded({ server });
  B.engine.act('Added $200 to Hiver 2027 cushion', d => { cushion(d).saved = 200; });
  await B.engine.push();
  await A.engine.refresh();
  assert.equal(cushion(A.engine.state).saved, 200);

  const u = A.engine.undo(a);
  assert.equal(u.label, 'Undid "Changed bill Netflix"');
  assert.equal(netflix(A.engine.state).amt, 27.11);
  assert.equal(cushion(A.engine.state).saved, 200);
  await A.engine.push();
  const expected = migrate(sample);
  cushion(expected).saved = 200;
  assert.equal(canonical(server.latest(), BOOK), canonical(expected, BOOK));
  assert.deepEqual(server.puts().map(p => p.status), [200, 200, 200]);
});

test('undo with a newer local action only reverts its own paths', async () => {
  const { engine } = await loaded();
  const a = engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  engine.act('Added $200 to Hiver 2027 cushion', d => { cushion(d).saved = 200; });
  engine.undo(a);
  assert.equal(netflix(engine.state).amt, 27.11);
  assert.equal(cushion(engine.state).saved, 200);
  // Undo of the undo puts it back.
  const again = engine.undo(engine.pending.at(-1));
  assert.equal(again.label, 'Undid "Undid "Changed bill Netflix""');
  assert.equal(netflix(engine.state).amt, 29.99);
});

test('restore replaces the whole state as one undoable action', async () => {
  const { engine, server, timers } = await loaded();
  const before = engine.state;
  const backup = clone(sample);
  backup.savedAt = '2026-11-01T12:00:00.000Z'; // an old backup: its savedAt must not become the sync base
  backup.note = 'Old note';
  backup.settings.payPlan = 1250;
  backup.months['2026-11'].tx = backup.months['2026-11'].tx.slice(0, 2);
  delete backup.months['2026-10'];
  const a = engine.restore(backup, 'Restored backup from Nov 1');
  assert.equal(a.label, 'Restored backup from Nov 1');
  assert.equal(engine.pending.length, 1);
  assert.equal(canonical(engine.state, BOOK), canonical(migrate(backup), BOOK));
  assert.equal(engine.state.version, 2);
  assert.equal(engine.state.savedAt, before.savedAt);
  assert.deepEqual(a.ops, diff(before, engine.state));
  assert.equal(backup.version, 1); // the doc passed in is untouched

  timers.tick(700);
  await engine.idle();
  assert.deepEqual(server.puts().map(p => p.status), [200]);
  assert.equal(canonical(server.latest(), BOOK), canonical(migrate(backup), BOOK));
  assert.equal(server.latest().note, 'Restored backup from Nov 1');

  engine.undo(a);
  assert.equal(canonical(engine.state, BOOK), canonical(before, BOOK));
  assert.throws(() => engine.restore({ hello: 1 }), /not a finance backup/);
});

test('restore then undo before any save is exact', async () => {
  const { engine } = await loaded();
  const beforeJSON = JSON.stringify(engine.state);
  const a = engine.restore(migrate(defaults()), 'Restored backup from Nov 1');
  engine.undo(a);
  assert.equal(JSON.stringify(engine.state), beforeJSON);
});

/* ---------- device key ---------- */
test('401 gives not set up and never exposes the cached data', async () => {
  const server = seededServer();
  const storage = memoryStorage({
    'finance-key': 'old key',
    'finance-cache': JSON.stringify(migrate(sample)),
    'finance-pending': JSON.stringify([{ id: 'x', label: 'Added Metro $12', ops: [] }]),
  });
  const { engine, states, statuses, timers } = setup({ server, storage });
  const r = await engine.load();
  assert.deepEqual(r, { state: null, status: 'not-set-up' });
  assert.equal(engine.state, null);
  assert.deepEqual(states, []);
  assert.deepEqual(statuses, [{ text: 'This device is not set up', code: 'not-set-up' }]);
  assert.deepEqual(server.log.map(x => [x.method, x.key, x.status]), [['GET', 'old key', 401]]);
  assert.deepEqual(timers.waiting(), []);
  assert.throws(() => engine.act('x', () => {}), /Nothing is loaded/);
  assert.ok(storage.has('finance-cache') && storage.has('finance-pending')); // hidden, not thrown away

  // No key at all: not set up, without asking the server.
  const none = setup({ server, storage: memoryStorage({ 'finance-cache': JSON.stringify(migrate(sample)) }) });
  assert.deepEqual(await none.engine.load(), { state: null, status: 'not-set-up' });
  assert.deepEqual(none.states, []);
  assert.equal(server.log.length, 1);
});

test('401 on a save hides the data and stops retrying', async () => {
  const { engine, server, timers, storage } = await loaded();
  engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  server.key = 'rotated';
  timers.tick(700);
  await engine.idle();
  assert.equal(engine.state, null);
  assert.equal(engine.status.code, 'not-set-up');
  assert.deepEqual(timers.waiting(), []);
  assert.equal(storage.json('finance-pending').length, 1);
});

test('every request sends the x-app-key header', async () => {
  const server = seededServer();
  const A = await loaded({ server }), B = await loaded({ server });
  A.engine.act('A', d => { netflix(d).amt = 29.99; });
  B.engine.act('B', d => { cushion(d).saved = 5; });
  await A.engine.push();
  await B.engine.push(); // 409 then 200
  server.setMode('error');
  A.engine.act('C', d => { cushion(d).saved = 6; });
  await A.engine.push(); // 500, which is a 409 once the server is back
  server.setMode('online');
  A.timers.tick(5000);
  await A.engine.idle();
  await B.engine.refresh();
  const versions = await A.engine.history();
  await A.engine.fetchVersion(versions[0].id);
  assert.ok(server.log.length >= 10);
  assert.ok(server.log.some(x => x.status === 409) && server.log.some(x => x.status === 500));
  for (const x of server.log) {
    assert.equal(x.key, 'k', `${x.method} ${x.url}`);
    assert.match(x.url, /^\/api\/data(\?|$)/);
  }
  assert.ok(server.log.filter(x => x.method === 'PUT').every(x => x.body.baseSavedAt === x.body.savedAt));
});

/* ---------- refresh, history, edge cases ---------- */
test('refresh replaces the state only when nothing is pending and savedAt differs', async () => {
  const server = seededServer();
  const A = await loaded({ server }), B = await loaded({ server });
  B.engine.act('Added $200 to Hiver 2027 cushion', d => { cushion(d).saved = 200; });
  await B.engine.push();

  A.engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  let r = await A.engine.refresh();
  assert.equal(r.changed, false); // pending: keep this device's work, the push merges
  assert.equal(cushion(A.engine.state).saved, 0);
  await A.engine.push();
  assert.equal(cushion(A.engine.state).saved, 200);
  assert.equal(netflix(A.engine.state).amt, 29.99);

  B.engine.act('Took $50 from Hiver 2027 cushion', d => { cushion(d).saved = 150; });
  await B.engine.push(); // 409, merged, saved
  const count = A.states.length;
  r = await A.engine.refresh();
  assert.equal(r.changed, true);
  assert.equal(cushion(A.engine.state).saved, 150);
  assert.equal(A.states.length, count + 1);
  r = await A.engine.refresh();
  assert.equal(r.changed, false); // same savedAt: nothing to do
  assert.equal(A.states.length, count + 1);
});

test('history lists saved versions and fetchVersion reads one', async () => {
  const { engine, timers } = await loaded();
  engine.act('First', d => { netflix(d).amt = 29.99; });
  timers.tick(700);
  await engine.idle();
  engine.act('Second', d => { cushion(d).saved = 200; });
  timers.tick(700);
  await engine.idle();
  const versions = await engine.history();
  assert.deepEqual(versions.map(v => v.note), ['Second', 'First', undefined]);
  const doc = await engine.fetchVersion(versions[1].id);
  assert.equal(netflix(doc).amt, 29.99);
  assert.equal(cushion(doc).saved, 0);
  assert.equal(await engine.fetchVersion('finance/data-1.json'), null);
});

test('an action that changes nothing is not saved', async () => {
  const { engine, timers, states } = await loaded();
  const n = states.length;
  const a = engine.act('Nothing', d => { netflix(d).amt = 27.11; });
  assert.deepEqual(a.ops, []);
  assert.deepEqual(engine.pending, []);
  assert.deepEqual(timers.waiting(), []);
  assert.equal(states.length, n);
});

test('a mutate that throws leaves the state as it was', async () => {
  const { engine } = await loaded();
  const before = engine.state;
  assert.throws(() => engine.act('Broken', d => { d.bills = []; throw new Error('boom'); }), /boom/);
  assert.equal(engine.state, before);
  assert.deepEqual(engine.pending, []);
});

test('published states are never changed in place', async () => {
  const { engine, timers, states } = await loaded();
  const snapshots = () => states.map(s => JSON.stringify(s));
  const a = engine.act('Changed bill Netflix', d => { netflix(d).amt = 29.99; });
  const seen = snapshots();
  timers.tick(700);
  await engine.idle();
  engine.undo(a);
  assert.deepEqual(snapshots().slice(0, seen.length), seen);
  assert.equal(netflix(a.after).amt, 29.99);
  assert.equal(netflix(a.before).amt, 27.11);
});

test('status texts are plain, with no dashes', () => {
  assert.equal(syncedText(NOW), 'Synced 3:20 p.m.');
  assert.equal(syncedText(new Date(2026, 10, 14, 0, 5)), 'Synced 12:05 a.m.');
  assert.equal(syncedText(new Date(2026, 10, 14, 12, 0)), 'Synced 12:00 p.m.');
  for (const t of [...Object.values(STATUS_TEXT), syncedText(NOW)]) assert.doesNotMatch(t, /[‒–—―]| - /);
});

test('createSync needs migrate, noteFor and defaults', () => {
  assert.throws(() => createSync({ fetch() {}, storage: memoryStorage() }), /migrate, noteFor and defaults/);
});
