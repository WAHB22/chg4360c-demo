// End to end: the real sync engine (lib/sync.js with the real migrate, defaults and noteFor) against the real
// api/data.js handler, through tests/helpers/api-harness.js, on the in memory blob fake. VERCEL_ENV is preview.
// One test per "done when" item of the brief. Synthetic fixtures only; nothing here touches the network.

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { canonical, clone, findItem } from '../lib/core.js';
import { migrate } from '../lib/migrate.js';
import { label } from '../lib/labels.js';
import { monthTotals } from '../lib/money.js';
import { buildReview, applyImport } from '../lib/importer.js';
import { STATUS_TEXT } from '../lib/sync.js';
import { memoryStorage } from './helpers/sync-fake-server.js';
import { createWorld, settle, KEY, PUB, PRIV } from './helpers/integration-world.js';
import sample from './fixtures/sample-nov.js';
import oct31, { expect as oct31Expect } from './fixtures/oct31.js';

const BOOK = ['savedAt', 'note'];
const SYNCED = 'Synced 3:20 p.m.';
const DASH = /[‐‑‒–—―]|\s-\s/;
const METRO = { id: 't-metro', date: '2026-11-13', item: 'i-groc', amt: 12, note: 'Metro', src: 'manual', fp: '1200|metro', merchant: 'Metro', account: null };

const netflix = s => s.bills.find(b => b.id === 'b-netflix');
const cushion = s => s.goals.find(g => g.id === 'j-h27');
const nov = s => s.months['2026-11'];
const same = (a, b) => canonical(a, BOOK) === canonical(b, BOOK);

/* ---------- one world per test; every save it wrote is kept for the last test ---------- */
let world = null;
const allSaves = [];
function open(opts) {
  finish();
  world = createWorld(opts);
  return world;
}
function finish() {
  if (!world) return;
  allSaves.push(...world.written());
  world.close();
  world = null;
}
afterEach(finish);

// Every leaf of a doc as [path, value]; arrays also give their length, so a lost or extra element shows.
function leaves(v, path = [], out = []) {
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (Array.isArray(v)) out.push([[...path, 'length'], v.length]);
    if (!keys.length) out.push([path, v]);
    for (const k of keys) leaves(v[k], [...path, k], out);
  } else {
    out.push([path, v]);
  }
  return out;
}
const at = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o);

function assertKeepsEveryField(original, doc, skip = ['version']) {
  const list = leaves(original).filter(([p]) => !skip.includes(p[0]));
  assert.ok(list.length > 100, 'the fixture has enough fields to mean something');
  for (const [p, value] of list) assert.deepEqual(at(doc, p), value, 'field ' + p.join('.'));
}

// Problems with a save note; an empty list means it reads well.
function noteProblems(note) {
  if (typeof note !== 'string') return ['not a string'];
  const out = [];
  if (!note.trim()) out.push('empty');
  if (note !== note.trim()) out.push('spaces at an end');
  if (note.length > 200) out.push('over 200 characters');
  if (DASH.test(note)) out.push('has a dash');
  if (/\s{2,}/.test(note)) out.push('double space');
  if (!/^[A-Z]/.test(note)) out.push('does not start with a capital letter');
  if (/\b(undefined|null|NaN)\b|\[object/.test(note)) out.push('leaks a code value');
  if (/(\band|,)$/.test(note)) out.push('ends in the middle');
  return out;
}

// The Oct 31 screenshot rows through the import review and applyImport, as one action (Stage 1).
function importOct31(dev) {
  const rows = buildReview(dev.engine.state, [{ fileId: 'shot-oct31', name: 'oct31.png', src: 'screenshot', rows: oct31.rows }], { today: '2026-11-01' });
  const text = label('import', applyImport(clone(dev.engine.state), rows)); // the button text, from a dry run
  let result = null;
  const action = dev.engine.act(text, d => { result = applyImport(d, rows); });
  return { rows, text, result, action };
}

async function pushNow(...devices) {
  devices.forEach(d => d.timers.tick(700));
  await settle(...devices);
}

/* ---------- 1. a version 1 save opens ---------- */

test('1. a version 1 save opens as version 2 with every original field and value intact', async () => {
  const w = open();
  const v1 = clone(sample);
  const pathname = w.seedVersion(v1);
  const bytes = w.blob.text(w.cfg.primary.token, pathname);

  const A = w.device('phone');
  const r = await A.engine.load();
  assert.equal(r.status, 'ok');
  const s = A.engine.state;
  assert.equal(s.version, 2);
  assertKeepsEveryField(v1, s);
  assert.deepEqual(A.states, [s], 'the page got the opened state once');
  assert.equal(A.engine.status.text, STATUS_TEXT.ok);

  // New fields got their defaults; nothing else moved.
  assert.equal(s.settings.visaDueDay, null);
  assert.deepEqual(s.settings.chequing, { bal: null, asOf: null });
  assert.deepEqual(s.merchantMap, {});
  assert.deepEqual(s.months['2026-10'].moves, []);
  assert.deepEqual(nov(s).moves, []);
  assert.deepEqual(
    nov(s).tx.map(t => [t.src, t.merchant, t.account, t.fp]).slice(0, 5),
    [['manual', 'Costco', null, '18240|costco'], ['manual', 'Pet Valu', null, '2800|pet valu'], ['manual', 'Petro-Canada', null, '5800|petro canada'],
      ['manual', 'Koichi Ramen', null, '6480|koichi ramen'], ['manual', '', null, '12000|']],
  );
  assert.deepEqual(monthTotals(s, '2026-11'), monthTotals(v1, '2026-11'));
  assert.equal(monthTotals(s, '2026-11').spent, 647);

  // Opening never writes back: the old save is byte for byte as it was.
  assert.equal(w.puts().length, 0);
  assert.equal(w.blob.text(w.cfg.primary.token, pathname), bytes);
  assert.equal(A.storage.json('finance-cache').version, 2);

  // The first save after it is a version 2 doc that still holds every v1 field; the v1 save stays in history.
  A.engine.act(label('tickBill', { name: 'Netflix', date: '2026-11-16', today: '2026-11-14' }), d => { nov(d).paid['b-netflix@2026-11-16'] = true; });
  await pushNow(A);
  const saved = w.newest();
  assert.equal(saved.version, 2);
  assertKeepsEveryField(v1, saved, ['version', 'savedAt']);
  assert.notEqual(saved.savedAt, v1.savedAt);
  assert.equal(nov(saved).paid['b-netflix@2026-11-16'], true);
  assert.equal(saved.note, 'Ticked Netflix paid on time');
  assert.equal(w.stored().at(-1).pathname, pathname);
  assert.equal(w.blob.text(w.cfg.primary.token, pathname), bytes);
});

/* ---------- 2. unknown fields from another build survive ---------- */

// A v2 save from build B carrying fields this build does not know, at every level.
function buildBDoc() {
  const d = migrate(clone(sample));
  d.foo = { nested: [1, { a: 2 }], flag: true };
  d.buildB = { schema: 'b1' };
  d.settings.theme = 'dark';
  d.settings.chequing.source = 'build B';
  d.bills[0].autopay = true;
  d.budget[0].color = '#22aa77';
  d.budget[0].items[0].icon = 'cart';
  d.accounts[0].institution = 'CIBC';
  d.accounts[2].asOf = '2026-11-10';
  d.goals[1].deadline = '2027-01-05';
  d.merchantMap = { costco: 'i-groc' };
  d.months['2026-10'].extra = 'october note';
  nov(d).extra = { pinned: ['i-groc'], seenAt: '2026-11-13' };
  nov(d).tx[0].tags = ['bulk', 'monthly'];
  nov(d).tx[0].receipt = { pages: 2 };
  nov(d).pays[0].employer = 'Bobino';
  nov(d).moves.push({ id: 'mv-b', date: '2026-11-03', from: 'i-volley', to: 'i-groc', amt: 10, reason: 'build B move' });
  d.note = 'Saved by build B';
  return d;
}
const UNKNOWN = [
  ['foo'], ['buildB'], ['settings', 'theme'], ['settings', 'chequing', 'source'], ['bills', 0, 'autopay'], ['budget', 0, 'color'],
  ['budget', 0, 'items', 0, 'icon'], ['accounts', 0, 'institution'], ['accounts', 2, 'asOf'], ['goals', 1, 'deadline'],
  ['months', '2026-10', 'extra'], ['months', '2026-11', 'extra'], ['months', '2026-11', 'tx', 0, 'tags'],
  ['months', '2026-11', 'tx', 0, 'receipt'], ['months', '2026-11', 'pays', 0, 'employer'], ['months', '2026-11', 'moves', 0, 'reason'],
];

// Four ordinary edits, two of them on records that carry unknown fields.
const EDITS = [
  [label('editTx', { name: 'Costco', amt: 185 }), d => { nov(d).tx[0].amt = 185; nov(d).tx[0].fp = '18500|costco'; }],
  [label('payPlan', { amt: 1250 }), d => { d.settings.payPlan = 1250; }],
  [label('addTx', { name: 'Metro', amt: 12 }), d => { nov(d).tx.push(clone(METRO)); }],
  [label('tickBill', { name: 'Netflix', date: '2026-11-16', today: '2026-11-14' }), d => { nov(d).paid['b-netflix@2026-11-16'] = true; }],
];

test('2. a v2 save with unknown fields from another build opens, and they are still there after an edit and save', async () => {
  const w = open();
  const doc = buildBDoc();
  w.seedVersion(doc);
  const A = w.device('phone');
  await A.engine.load();
  assert.equal(canonical(A.engine.state), canonical(doc), 'opened exactly as saved, unknown fields included');

  for (const [text, fn] of EDITS) A.engine.act(text, fn);
  await pushNow(A);
  assert.deepEqual(w.puts().map(p => p.status), [200]);

  const expected = clone(doc);
  EDITS.forEach(([, fn]) => fn(expected));
  const saved = w.newest();
  assert.equal(canonical(saved, BOOK), canonical(expected, BOOK));
  for (const p of UNKNOWN) assert.deepEqual(at(saved, p), at(doc, p), 'unknown field ' + p.join('.'));
  assert.equal(nov(saved).tx[0].amt, 185);
  assert.equal(saved.note, 'Changed Costco $185 and 3 more changes');
  assert.equal(canonical(A.engine.state, BOOK), canonical(saved, BOOK));
});

test('2. unknown fields survive a 409 replay, and build B\'s own changes to them are kept too', async () => {
  const w = open();
  const doc = buildBDoc();
  w.seedVersion(doc);
  const A = w.device('phone');
  await A.engine.load();
  for (const [text, fn] of EDITS) A.engine.act(text, fn);

  // Build B saves first, changing only its own fields (one of them on the expense this device edits).
  const other = await w.latest();
  other.foo.nested.push(3);
  other.settings.theme = 'light';
  nov(other).tx[0].tags.push('checked');
  nov(other).extra.seenAt = '2026-11-14';
  other.note = 'Saved by build B';
  assert.equal((await w.save(other)).status, 200);

  await pushNow(A);
  assert.deepEqual(w.puts().map(p => p.status), [409, 200]);
  const saved = w.newest();
  assert.deepEqual(saved.foo, { nested: [1, { a: 2 }, 3], flag: true });
  assert.equal(saved.settings.theme, 'light');
  assert.deepEqual(nov(saved).tx[0].tags, ['bulk', 'monthly', 'checked']);
  assert.equal(nov(saved).tx[0].amt, 185);
  assert.deepEqual(nov(saved).extra, { pinned: ['i-groc'], seenAt: '2026-11-14' });
  assert.equal(saved.settings.payPlan, 1250);
  assert.ok(nov(saved).tx.some(t => t.id === METRO.id));
  const changedByB = new Set(['foo', 'settings.theme', 'months.2026-11.tx.0.tags', 'months.2026-11.extra']);
  for (const p of UNKNOWN.filter(p => !changedByB.has(p.join('.')))) {
    assert.deepEqual(at(saved, p), at(doc, p), 'unknown field ' + p.join('.'));
  }
});

test('2. a save from a newer build (version 3) keeps its version number through an edit and save', async () => {
  const w = open();
  const doc = { ...buildBDoc(), version: 3 };
  w.seedVersion(doc);
  const A = w.device('phone');
  await A.engine.load();
  assert.equal(A.engine.state.version, 3);
  A.engine.act(label('payPlan', { amt: 1250 }), d => { d.settings.payPlan = 1250; });
  await pushNow(A);
  assert.equal(w.newest().version, 3);
  assert.equal(w.newest().foo.flag, true);
});

/* ---------- 3. two devices saving at once ---------- */

// Two devices open the same save, each makes a change, and both debounce timers end in the same tick,
// so the two PUTs reach api/data.js at the same moment.
async function race(changeA, changeB) {
  const w = open();
  const seedPath = w.seedVersion(clone(sample));
  const A = w.device('phone'), B = w.device('laptop');
  await A.engine.load();
  await B.engine.load();
  A.engine.act(...changeA);
  B.engine.act(...changeB);
  A.timers.tick(700);
  B.timers.tick(700);
  await settle(A, B);
  return { w, A, B, seedPath };
}
const NETFLIX_UP = [label('editBill', { name: 'Netflix' }), d => { netflix(d).amt = 29.99; }];
const ADD_METRO = [label('addTx', { name: 'Metro', amt: 12 }), d => { nov(d).tx.push(clone(METRO)); }];

test('3. two devices push different changes at the same moment: the newest save holds both, nothing lost', async () => {
  const { w, A, B, seedPath } = await race(NETFLIX_UP, ADD_METRO);
  const versions = w.stored();
  assert.equal(versions.length, 3, 'one save per device, no extra writes');
  const top = versions[0].doc;
  assert.equal(netflix(top).amt, 29.99);
  assert.deepEqual(nov(top).tx.filter(t => t.id === METRO.id), [METRO]);
  assert.equal(versions[2].pathname, seedPath);

  // Exactly the base plus the two changes, nothing else touched.
  const expected = migrate(clone(sample));
  NETFLIX_UP[1](expected);
  ADD_METRO[1](expected);
  assert.equal(canonical(top, BOOK), canonical(expected, BOOK));

  // Both devices settle synced, with nothing left to send, and agree with the server after a refresh.
  for (const d of [A, B]) {
    assert.deepEqual(d.engine.pending, []);
    assert.equal(d.storage.has('finance-pending'), false);
    assert.equal(d.engine.status.text, SYNCED);
    await d.engine.refresh();
    assert.equal(canonical(d.engine.state), canonical(top));
  }
  const statuses = w.puts().map(p => p.status);
  assert.equal(statuses.filter(s => s === 200).length, 2, String(statuses));
  assert.ok(statuses.every(s => s === 200 || s === 409), String(statuses));
  for (const r of w.log) assert.equal(r.key, KEY);
});

// SPEC 7.2 and the brief: "proves one 409 and no lost change". api/data.js waits for a held lock, so the loser's
// single 409 already carries the winner's save.
test('3. two devices push at the same moment: exactly one PUT gets a 409', async () => {
  const { w } = await race(NETFLIX_UP, ADD_METRO);
  const puts = w.puts().map(p => `${p.who} ${p.status}${p.status === 409 && p.json.latest.savedAt === p.body.baseSavedAt ? ' (latest was still the old save)' : ''}`);
  assert.equal(w.puts().filter(p => p.status === 409).length, 1, 'PUTs in order: ' + puts.join(', '));
});

test('3. two devices change the same field at the same moment: the last writer wins, no crash', async () => {
  const values = { phone: 29.99, laptop: 31.5 };
  const { w, A, B } = await race(
    [label('editBill', { name: 'Netflix' }), d => { netflix(d).amt = values.phone; }],
    [label('editBill', { name: 'Netflix' }), d => { netflix(d).amt = values.laptop; }],
  );
  const oks = w.puts().filter(p => p.status === 200);
  assert.equal(oks.length, 2);
  const last = oks.at(-1).who, first = oks[0].who;
  assert.notEqual(last, first);
  const versions = w.stored();
  assert.equal(netflix(versions[0].doc).amt, values[last], 'the newest save has the last writer\'s value');
  assert.equal(netflix(versions[1].doc).amt, values[first], 'the first writer\'s save is still in history');
  // Only that one field differs from the base.
  const expected = migrate(clone(sample));
  netflix(expected).amt = values[last];
  assert.equal(canonical(versions[0].doc, BOOK), canonical(expected, BOOK));
  for (const d of [A, B]) {
    assert.equal(d.engine.status.code, 'synced');
    assert.deepEqual(d.engine.pending, []);
    await d.engine.refresh();
    assert.equal(netflix(d.engine.state).amt, values[last]);
  }
});

/* ---------- 4. offline save, reload, then sync ---------- */

const ADD_JAR = [label('jar', { name: 'Hiver 2027 cushion', add: 200 }), d => { cushion(d).saved += 200; }];

async function offlineThenReload(w) {
  const storage = memoryStorage({ 'finance-key': KEY });
  const network = { online: true };
  const phone = w.device('phone', { storage, network });
  await phone.engine.load();
  const savedBefore = w.written().length;

  network.online = false;
  phone.engine.act(...ADD_METRO);
  phone.engine.act(...ADD_JAR);
  phone.timers.tick(700);
  await phone.engine.idle();
  assert.equal(phone.engine.status.text, STATUS_TEXT.retry);
  assert.deepEqual(w.puts('phone').map(p => p.status), [0], 'the PUT never reached the server');
  assert.equal(w.written().length, savedBefore);
  assert.deepEqual(storage.json('finance-pending').map(a => a.label), [ADD_METRO[0], ADD_JAR[0]]);
  phone.engine.stop(); // the page closes

  // Page reload while still offline: the same browser storage, a new engine.
  const reloaded = w.device('phone after reload', { storage, network });
  const r = await reloaded.engine.load();
  assert.equal(r.status, 'offline');
  assert.equal(reloaded.engine.status.text, STATUS_TEXT.offline);
  assert.deepEqual(nov(r.state).tx.filter(t => t.id === METRO.id), [METRO]);
  assert.equal(cushion(r.state).saved, 200);
  assert.equal(reloaded.states.at(-1), r.state, 'the page shows this device copy');
  assert.deepEqual(reloaded.engine.pending.map(a => a.label), [ADD_METRO[0], ADD_JAR[0]]);
  return { reloaded, storage, network };
}

test('4. offline: two actions survive a reload while still offline, then reach the server with a note naming them', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const { reloaded, storage, network } = await offlineThenReload(w);

  network.online = true;
  reloaded.timers.tick(5000); // the retry
  await settle(reloaded);
  assert.deepEqual(w.puts('phone after reload').map(p => p.status), [200]);
  const saved = w.newest();
  assert.deepEqual(nov(saved).tx.filter(t => t.id === METRO.id), [METRO]);
  assert.equal(cushion(saved).saved, 200);
  assert.equal(saved.note, 'Added Metro $12 and Added $200 to Hiver 2027 cushion');
  assert.equal(canonical(reloaded.engine.state), canonical(saved));
  assert.equal(storage.has('finance-pending'), false);
  assert.equal(reloaded.engine.status.text, SYNCED);
});

test('4. offline: when another device saved meanwhile, both its change and the offline ones are kept', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const laptop = w.device('laptop');
  await laptop.engine.load();
  const { reloaded, network } = await offlineThenReload(w);

  laptop.engine.act(label('tickBill', { name: 'Netflix', date: '2026-11-16', today: '2026-11-14' }), d => { nov(d).paid['b-netflix@2026-11-16'] = true; });
  await pushNow(laptop);

  network.online = true;
  reloaded.timers.tick(5000);
  await settle(reloaded);
  assert.deepEqual(w.puts('phone after reload').map(p => p.status), [409, 200]);
  const saved = w.newest();
  assert.equal(nov(saved).paid['b-netflix@2026-11-16'], true);
  assert.deepEqual(nov(saved).tx.filter(t => t.id === METRO.id), [METRO]);
  assert.equal(cushion(saved).saved, 200);
  assert.equal(saved.note, 'Added Metro $12 and Added $200 to Hiver 2027 cushion');
});

/* ---------- 5. a preview save never touches finance/ ---------- */

const writesTo = (calls, prefix) => calls.filter(c => (c.fn === 'put' || c.fn === 'del') && (c.pathnames || [c.pathname]).some(p => p.startsWith(prefix)));

function seedLive(w) {
  // Live saves in the private store, and older public (legacy) ones named the way the old page's uploads were.
  const live = { ...clone(sample), note: 'Ticked Gym (ABC) paid' };
  const older = { ...clone(sample), savedAt: '2026-11-10T12:00:00.000Z', note: 'Planned pay set to $1,250' };
  older.settings.payPlan = 1250;
  w.seedVersion(older, { token: PRIV, prefix: 'finance/' });
  w.seedVersion(live, { token: PRIV, prefix: 'finance/' });
  for (let i = 0; i < 3; i++) {
    const legacy = { ...clone(sample), savedAt: new Date(Date.UTC(2026, 9, 20 + i, 12)).toISOString(), note: 'Saved' };
    w.seedVersion(legacy, { token: PUB, prefix: 'finance/', suffix: `Rnd${i}Xy7Qz` });
  }
  return live;
}
const liveSnapshot = w => [PRIV, PUB].map(t => w.blob.snapshot(t, 'finance/'));

test('5. a preview run never touches finance/: every live blob stays byte for byte the same', async () => {
  const w = open({ env: { PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV, BLOB_READ_WRITE_TOKEN: PUB }, stores: { [PRIV]: 'private', [PUB]: 'public' } });
  assert.equal(w.cfg.prefix, 'finance-preview/');
  const live = seedLive(w);
  const before = liveSnapshot(w);
  assert.deepEqual(before.map(s => s.length), [2, 3]);

  // The first GET makes the preview copy of the newest live save.
  const A = w.device('phone'), B = w.device('laptop');
  await A.engine.load();
  await B.engine.load();
  const [copy] = w.stored();
  assert.equal(copy.doc.note, 'Preview copy of live data');
  assert.equal(canonical(copy.doc, ['note']), canonical(live, ['note']));
  assert.equal(canonical(A.engine.state, BOOK), canonical(migrate(live), BOOK));

  // Ordinary use: a race, an import and its undo, a restore and its undo, and enough saves to prune.
  A.engine.act(...NETFLIX_UP);
  B.engine.act(...ADD_METRO);
  await pushNow(A, B);
  await A.engine.refresh();
  const imp = importOct31(A);
  await pushNow(A);
  A.engine.undo(imp.action);
  await pushNow(A);
  const hist = await A.engine.history();
  const restored = A.engine.restore(await A.engine.fetchVersion(hist.at(-1).id), label('restoreVersion', { savedAt: hist.at(-1).savedAt }));
  await pushNow(A);
  A.engine.undo(restored);
  await pushNow(A);
  for (let i = 1; i <= 12; i++) {
    A.engine.act(label('payPlan', { amt: 1300 + i }), d => { d.settings.payPlan = 1300 + i; });
    await pushNow(A);
  }
  await B.engine.refresh();
  assert.equal(B.engine.state.settings.payPlan, 1312);
  assert.ok(writesTo(w.blob.calls, 'finance-preview/data-').some(c => c.fn === 'del'), 'old preview versions were pruned');
  assert.equal(w.stored().length, 10);

  // Nothing under finance/ was written, overwritten or deleted, in either store; nothing went to the legacy store.
  assert.deepEqual(liveSnapshot(w), before);
  assert.deepEqual(writesTo(w.blob.calls, 'finance/'), []);
  const writes = w.blob.calls.filter(c => c.fn === 'put' || c.fn === 'del');
  assert.ok(writes.length > 30);
  for (const c of writes) {
    assert.equal(c.token, PRIV);
    for (const p of c.pathnames || [c.pathname]) assert.ok(p.startsWith('finance-preview/'), p);
  }
});

test('5. with VERCEL_ENV unset or development the saves also stay out of finance/', async () => {
  for (const env of [undefined, 'development']) {
    const w = open({ env: { VERCEL_ENV: env, PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV, BLOB_READ_WRITE_TOKEN: PUB }, stores: { [PRIV]: 'private', [PUB]: 'public' } });
    assert.equal(w.cfg.prefix, 'finance-preview/');
    seedLive(w);
    const before = liveSnapshot(w);
    const A = w.device('phone');
    await A.engine.load();
    A.engine.act(...ADD_METRO);
    await pushNow(A);
    assert.ok(nov(w.newest()).tx.some(t => t.id === METRO.id));
    assert.deepEqual(liveSnapshot(w), before);
    assert.deepEqual(writesTo(w.blob.calls, 'finance/'), []);
    finish();
  }
});

/* ---------- 6. undo of a 4 row import ---------- */

function assertImported(state, result, text) {
  assert.equal(text, 'Imported 4 expenses');
  assert.equal(result.expenses, 4);
  assert.equal(result.total, 158.27);
  const added = state.months['2026-10'].tx;
  assert.deepEqual(added.map(t => t.merchant), oct31Expect.ticked);
  assert.deepEqual(added.map(t => findItem(state, t.item).name), oct31Expect.ticked.map(m => oct31Expect.categories[m]));
  assert.deepEqual(added.map(t => t.account), ['visa', 'visa', 'visa', 'visa']);
}

test('6. undo of a 4 row import restores the exact previous data, on this device and on the server', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const A = w.device('phone');
  await A.engine.load();
  const before = A.engine.state;

  const imp = importOct31(A);
  assert.equal(imp.rows.length, oct31Expect.shown);
  assert.equal(imp.rows.filter(r => r.status === 'notspending' && !r.ticked).length, oct31Expect.notSpending);
  assertImported(A.engine.state, imp.result, imp.text);

  const undo = A.engine.undo(imp.action);
  assert.equal(undo.label, 'Undid "Imported 4 expenses"');
  assert.equal(canonical(A.engine.state, BOOK), canonical(before, BOOK));
  assert.equal(canonical(A.engine.state), canonical(before), 'exact, bookkeeping included, before any save');

  await pushNow(A);
  assert.deepEqual(w.puts().map(p => p.status), [200]);
  assert.ok(same(w.newest(), before));
  assert.equal(w.newest().note, 'Imported 4 expenses and Undid "Imported 4 expenses"');
});

test('6. undo of an import that was already saved puts the server back to the previous data', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const A = w.device('phone');
  await A.engine.load();
  const before = A.engine.state;

  const imp = importOct31(A);
  await pushNow(A);
  assertImported(w.newest(), imp.result, imp.text);
  assert.equal(w.newest().note, 'Imported 4 expenses');

  A.engine.undo(imp.action);
  assert.ok(same(A.engine.state, before));
  await pushNow(A);
  assert.ok(same(w.newest(), before));
  assert.equal(w.newest().note, 'Undid "Imported 4 expenses"');
  assert.deepEqual(w.stored().map(v => v.doc.note), ['Undid "Imported 4 expenses"', 'Imported 4 expenses', undefined]);
});

test('6. undo of a saved import after another device saved takes out only the 4 rows', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const A = w.device('phone'), B = w.device('laptop');
  await A.engine.load();
  const before = A.engine.state;
  const imp = importOct31(A);
  await pushNow(A);

  await B.engine.load();
  B.engine.act(label('tickBill', { name: 'Netflix', date: '2026-11-16', today: '2026-11-14' }), d => { nov(d).paid['b-netflix@2026-11-16'] = true; });
  await pushNow(B);
  await A.engine.refresh(); // A now shows the laptop's tick, so the undo only reverts its own paths
  assert.equal(nov(A.engine.state).paid['b-netflix@2026-11-16'], true);

  A.engine.undo(imp.action);
  await pushNow(A);
  const expected = clone(before);
  nov(expected).paid['b-netflix@2026-11-16'] = true;
  assert.ok(same(w.newest(), expected));
  assert.ok(same(A.engine.state, expected));
});

/* ---------- 7. restoring an older version ---------- */

test('7. restoring an older version keeps the current one in history, and undoing the restore brings it back', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const A = w.device('phone');
  await A.engine.load();
  for (const change of [NETFLIX_UP, [label('payPlan', { amt: 1250 }), d => { d.settings.payPlan = 1250; }], ADD_METRO]) {
    A.engine.act(...change);
    await pushNow(A);
  }
  const hist = await A.engine.history();
  assert.deepEqual(hist.map(v => v.note), ['Added Metro $12', 'Planned pay set to $1,250', 'Changed bill Netflix', '']);
  const current = clone(A.engine.state);
  const currentId = hist[0].id;
  assert.equal(hist[0].savedAt, current.savedAt);

  // GET ?version= for the Netflix save, then restore it as one action.
  const older = hist[2];
  const doc = await A.engine.fetchVersion(older.id);
  assert.ok(w.log.some(r => r.url === '/api/data?version=' + encodeURIComponent(older.id) && r.status === 200));
  assert.equal(netflix(doc).amt, 29.99);
  assert.equal(doc.settings.payPlan, 1300);
  const text = label('restoreVersion', { savedAt: older.savedAt });
  assert.match(text, /^Restored the version from [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [ap]\.m\.$/);
  const restore = A.engine.restore(doc, text);
  assert.ok(same(A.engine.state, migrate(doc)));
  await pushNow(A);
  assert.deepEqual(w.puts().map(p => p.status), [200, 200, 200, 200], 'the restore saved at once, no conflict');
  assert.ok(same(w.newest(), doc));

  const after = await A.engine.history();
  assert.equal(after[0].note, text);
  assert.equal(after[1].id, currentId, 'the version that was current is kept, right below the restore');
  assert.equal(after[1].note, 'Added Metro $12');
  assert.ok(same(await A.engine.fetchVersion(currentId), current));

  const undo = A.engine.undo(restore);
  assert.equal(undo.label, `Undid "${text}"`);
  assert.ok(same(A.engine.state, current));
  await pushNow(A);
  assert.ok(same(w.newest(), current));
  assert.equal(w.newest().note, `Undid "${text}"`);
  assert.deepEqual((await A.engine.history()).map(v => v.note).slice(0, 3), [`Undid "${text}"`, text, 'Added Metro $12']);
});

/* ---------- 8. every save carries a note that reads well ---------- */

test('8. every save carries a top level note that reads well', async () => {
  const w = open();
  w.seedVersion(clone(sample));
  const A = w.device('phone');
  await A.engine.load();
  const groceries = d => d.budget[0].items.find(i => i.id === 'i-groc');

  const imp = importOct31(A);
  await pushNow(A);
  A.engine.act(label('tickBill', { name: 'Netflix', date: '2026-11-16', today: '2026-11-14' }), d => { nov(d).paid['b-netflix@2026-11-16'] = true; });
  await pushNow(A);
  A.engine.act(...ADD_METRO);
  A.engine.act(label('addPay', { amt: 1300 }), d => { nov(d).pays.push({ id: 'p-nov20', date: '2026-11-20', amt: 1300, hours: null, note: '' }); });
  await pushNow(A);
  A.engine.act(...NETFLIX_UP);
  A.engine.act(label('limit', { name: 'Groceries', limit: 480 }), d => { groceries(d).limit = 480; });
  A.engine.act(...ADD_JAR);
  await pushNow(A);
  A.engine.undo(imp.action);
  await pushNow(A);
  const ticked = (await A.engine.history()).find(v => v.note === 'Ticked Netflix paid on time');
  const restoreText = label('restoreVersion', { savedAt: ticked.savedAt });
  A.engine.restore(await A.engine.fetchVersion(ticked.id), restoreText);
  await pushNow(A);

  const expected = [
    restoreText,
    'Undid "Imported 4 expenses"',
    'Changed bill Netflix and 2 more changes',
    'Added Metro $12 and Logged pay $1,300',
    'Ticked Netflix paid on time',
    'Imported 4 expenses',
  ];
  const hist = await A.engine.history();
  assert.deepEqual(hist.map(v => v.note).slice(0, expected.length), expected);
  // The note is a top level field of the stored doc, the same text the PUT sent.
  const docs = w.stored().slice(0, expected.length).map(v => v.doc);
  assert.deepEqual(docs.map(d => d.note), expected);
  assert.deepEqual(w.puts().map(p => p.body.note), [...expected].reverse());
  for (const note of expected) assert.deepEqual(noteProblems(note), [], note);
});

test('8. every save written in this file had a top level note that reads well', t => {
  if (!allSaves.length) return t.skip('needs the other tests of this file to run first');
  assert.ok(allSaves.length >= 40, `only ${allSaves.length} saves seen`);
  const bad = allSaves
    .map(s => ({ pathname: s.pathname, note: s.doc.note, problems: noteProblems(s.doc.note) }))
    .filter(s => s.problems.length);
  assert.deepEqual(bad, []);
  assert.ok(allSaves.every(s => s.pathname.startsWith('finance-preview/')), 'no save outside the preview prefix');
});
