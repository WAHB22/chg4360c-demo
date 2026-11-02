// Lasting unit tests for the findings of the review (security, money, data). Expected values by hand.
// Run: node --test tests/review-fixes.test.js
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import dataHandler from '../api/data.js';
import { setBlobApi } from '../api/_store.js';
import { forecast } from '../lib/forecast.js';
import { coverSuggestion, applyCover, bars, raiseSuggestion, applyRaise, totalLimits, effectiveLimit } from '../lib/budget.js';
import { migrate } from '../lib/migrate.js';
import { interacNote, classifyMerchant } from '../lib/merchants.js';
import { createSync } from '../lib/sync.js';
import { clone, getMonth } from '../lib/core.js';
import fsample from './fixtures/forecast-sample.js';
import nov from './fixtures/sample-nov.js';
import { createFakeBlob } from './helpers/api-fake-blob.js';
import { callApi, useEnv } from './helpers/api-harness.js';
import { createFakeServer, fakeTimers, memoryStorage, noteFor, defaults } from './helpers/sync-fake-server.js';

const NP = { date: '2026-11-20', estimate: true };
const NOV = '2026-11';

/* ---------- security: APP_KEY_A never opens production, and nothing works without APP_KEY ---------- */

const PUB = 'vercel_blob_rw_reviewfixpub_fakesecret';
const LIVE = { version: 2, bills: [{ id: 'b1', name: 'Rent', amt: 587.5 }], accounts: [{ id: 'a', name: 'Chequing', bal: 420 }], savedAt: '2026-11-14T15:00:00.000Z', note: 'live' };
let cleanup = null;
afterEach(() => { if (cleanup) cleanup(); cleanup = null; });
function apiWorld(env) {
  const fake = createFakeBlob({ stores: { [PUB]: 'public' } });
  setBlobApi(fake.api);
  const restore = useEnv({ APP_KEY: undefined, APP_KEY_A: undefined, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined, ...env });
  cleanup = () => { restore(); setBlobApi(); };
  fake.seed(PUB, 'finance/data-1793600000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json', JSON.stringify(LIVE));
  return fake;
}
const getData = key => callApi(dataHandler, { method: 'GET', url: '/api/data', headers: key == null ? {} : { 'x-app-key': key } });

test('security: production with APP_KEY unset refuses everything, even the APP_KEY_A key (SPEC 8.1 fails closed)', async () => {
  apiWorld({ VERCEL_ENV: 'production', APP_KEY_A: 'build-a-preview-key' });
  const r = await getData('build-a-preview-key');
  assert.equal(r.status, 401, r.text.slice(0, 80));
  assert.deepEqual(r.json, { error: 'This device is not set up' });
});

test('security: the preview key APP_KEY_A never opens production data; APP_KEY still does', async () => {
  apiWorld({ VERCEL_ENV: 'production', APP_KEY: 'live-key', APP_KEY_A: 'build-a-preview-key' });
  assert.equal((await getData('build-a-preview-key')).status, 401);
  const ok = await getData('live-key');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.note, 'live');
});

test('security: on preview APP_KEY_A opens the preview copy (only next to APP_KEY)', async () => {
  apiWorld({ APP_KEY: 'b-key', APP_KEY_A: 'a-key' });
  const r = await getData('a-key');
  assert.equal(r.status, 200);
  assert.equal(r.json.note, 'Preview copy of live data');
  cleanup(); cleanup = null;
  apiWorld({ APP_KEY_A: 'a-key' });
  assert.equal((await getData('a-key')).status, 401, 'no APP_KEY: closed');
});

// git and Vercel semantics for a pattern with no slash: it matches the base name at any depth.
const globRe = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
const patterns = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.includes('/'));

test('security: the backup the page downloads (finance-backup-<date>.json) is ignored by git and by Vercel', () => {
  for (const f of ['.gitignore', '.vercelignore']) {
    for (const name of ['finance-backup-2026-11-02.json', 'backup-2026-11-02.json', 'finance-backup-2026-11-02 (1).json']) {
      assert.ok(patterns(f).some(p => globRe(p).test(name)), `${f} does not ignore ${name}`);
    }
  }
  // The page's own download name, as ui/app.js builds it.
  const app = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(app, /a\.download = 'finance-backup-' \+ todayISO\(\) \+ '\.json'/);
});

/* ---------- money: forecast ---------- */

test('forecast: a Visa payment due between the balance date and today is still taken out (in today\'s point)', () => {
  // Chequing 254 entered Nov 12, today Nov 14, Visa owing 753.69 due on the 13th.
  // By hand: today = 254 - 64.80 - 23.55 - 753.69 = -588.04; Nov 19 = -806.38; month end 151.73 (as with the 22nd).
  const s = migrate(fsample);
  s.settings.visaDueDay = 13;
  const r = forecast(s, '2026-11-14', { nextPay: NP });
  const visa = r.points.flatMap(p => p.events.map(e => ({ ...e, on: p.date }))).filter(e => e.type === 'visa');
  assert.deepEqual(visa.map(e => [e.on, e.date, e.amt]), [['2026-11-14', '2026-11-13', -753.69]]);
  assert.equal(r.points[0].bal, -588.04);
  assert.equal(r.points.find(p => p.date === '2026-11-19').bal, -806.38);
  assert.equal(r.points.at(-1).bal, 151.73);
  assert.equal(r.visaMarker, null);
  // The day after the due day moves nothing: the month end is the same with the 14th or the 15th.
  for (const day of [14, 15]) {
    s.settings.visaDueDay = day;
    assert.equal(forecast(s, '2026-11-14', { nextPay: NP }).points.at(-1).bal, 151.73, String(day));
  }
});

test('forecast: a due day whose date falls after the range gives a marker, and nothing is taken out', () => {
  const s = migrate(fsample);
  s.settings.chequing = { bal: 900, asOf: '2026-11-25' };
  s.settings.visaDueDay = 22;
  const r = forecast(s, '2026-11-25', { nextPay: { date: '2026-11-27', estimate: true } });
  assert.equal(r.end, '2026-11-30');
  assert.equal(r.points.flatMap(p => p.events).filter(e => e.type === 'visa').length, 0);
  assert.deepEqual(r.visaMarker, { amt: 753.69, text: 'Visa payment of $753.69 is due Dec 22, after this forecast.' });
  // A due day clamped to the month (the 31st in November is Nov 30) is inside the range: no marker.
  s.settings.visaDueDay = 31;
  const in30 = forecast(s, '2026-11-25', { nextPay: { date: '2026-11-27', estimate: true } });
  assert.deepEqual(in30.points.flatMap(p => p.events.filter(e => e.type === 'visa').map(() => p.date)), ['2026-11-30']);
  assert.equal(in30.visaMarker, null);
  // No due day at all: the old marker wording stays.
  s.settings.visaDueDay = null;
  assert.equal(forecast(s, '2026-11-25', { nextPay: null }).visaMarker.text, 'Visa owing $753.69. Set its due date to include it.');
});

test('forecast: a logged pay with no note reads "Bobino pay", as on the page', () => {
  const s = migrate(fsample);
  getMonth(s, NOV).pays.push({ id: 'p-20', date: '2026-11-20', amt: 1300, hours: null, note: '' });
  const r = forecast(s, '2026-11-14', { nextPay: { date: '2026-11-20', estimate: false } });
  const pays = r.points.find(p => p.date === '2026-11-20').events.filter(e => e.type === 'pay');
  assert.deepEqual(pays.map(e => [e.label, e.amt, e.estimate]), [['Bobino pay', 1300, false]]);
});

test('forecast: no spending in the last 30 days gives no $0 "Spending estimate" events', () => {
  const s = migrate(fsample);
  for (const m of Object.values(s.months)) m.tx = [];
  const r = forecast(s, '2026-11-14', { nextPay: NP });
  assert.equal(r.dailySpend, 0);
  const spend = r.points.flatMap(p => p.events).filter(e => e.type === 'spend');
  assert.deepEqual(spend, []);
  // Only the estimated pay makes a day an estimate now.
  assert.deepEqual(r.points.filter(p => p.estimate).map(p => p.date), ['2026-11-20']);
  for (const p of r.points) for (const e of p.events) if (e.estimate) assert.match(e.label, /estimate/);
});

/* ---------- money: Cover it and raise ---------- */

test('cover: a source with a refund gives at most its own limit and never ends below $0', () => {
  // Clothing limit 150 with a -40 refund; Groceries 560 of 400. Before the fix Cover took 152: Clothing -$2.
  const s = migrate(nov);
  s.months[NOV].tx.push({ id: 'r', date: '2026-11-10', item: 'i-cloth', amt: -40, note: 'Refund' });
  s.months[NOV].tx.push({ id: 'g', date: '2026-11-11', item: 'i-groc', amt: 281.35, note: 'Costco' });
  const total = totalLimits(s, NOV);
  const sug = coverSuggestion(s, NOV, 'i-groc');
  const cloth = sug.from.find(f => f.itemId === 'i-cloth');
  assert.ok(cloth && cloth.amt <= 150, JSON.stringify(sug.from));
  applyCover(s, NOV, sug, '2026-11-14');
  assert.equal(totalLimits(s, NOV), total);
  for (const i of bars(s, NOV).flatMap(g => g.items)) {
    if (i.baseLimit > 0) assert.ok(i.limit >= 0, `${i.name} limit ${i.limit}`);
    assert.ok(i.limit >= i.spent || i.baseLimit === 0, `${i.name} below spent`);
  }
  // A stale suggestion asking for more than the limit is clamped as well.
  const t = migrate(nov);
  t.months[NOV].tx.push({ id: 'r', date: '2026-11-10', item: 'i-cloth', amt: -40, note: 'Refund' });
  applyCover(t, NOV, { to: 'i-groc', from: [{ itemId: 'i-cloth', amt: 400 }] }, '2026-11-14');
  assert.equal(effectiveLimit(t, NOV, 'i-cloth'), 0);
});

// sample-nov plus a Groceries top up from Clothing in Sep ($40), Oct ($60) and Nov ($85).
function toppedUp() {
  const s = migrate(nov);
  const mv = (id, date, amt) => ({ id, date, from: 'i-cloth', to: 'i-groc', amt });
  getMonth(s, '2026-09').moves.push(mv('m9', '2026-09-20', 40));
  getMonth(s, '2026-10').moves.push(mv('m10', '2026-10-20', 60));
  getMonth(s, NOV).moves.push(mv('m11', '2026-11-10', 85));
  return s;
}

test('raise: "Make it $470" does not count the November top up twice (never $555)', () => {
  // 400 + (40 + 60 + 85) / 3 = 461.67 -> $470. The raise adds 70; Nov's $85 top up shrinks by 70 to $15.
  const s = toppedUp();
  const r = raiseSuggestion(s, NOV, 'i-groc');
  assert.equal(r.newLimit, 470);
  const before = { groc: effectiveLimit(s, NOV, 'i-groc'), cloth: effectiveLimit(s, NOV, 'i-cloth') };
  assert.deepEqual(before, { groc: 485, cloth: 65 });
  applyRaise(s, r);
  assert.equal(effectiveLimit(s, NOV, 'i-groc'), 485, 'Nov keeps the room he already had: $470 plus the $15 left of the top up');
  assert.equal(effectiveLimit(s, NOV, 'i-cloth'), 135, 'Clothing gets the $70 the raise now covers back');
  assert.deepEqual(s.months[NOV].moves.map(m => [m.id, m.amt]), [['m11', 15]]);
  assert.equal(effectiveLimit(s, '2026-12', 'i-groc'), 470);
  // The total of limits is the sum of the base limits: +70, the one change a raise makes.
  assert.equal(totalLimits(s, NOV), totalLimits(toppedUp(), NOV) + 70);
  // A top up smaller than the raise goes into it entirely: the month reads the new limit.
  const small = toppedUp();
  small.months[NOV].moves[0].amt = 20; // 400 + (40 + 60 + 20) / 3 = 440
  const rs = raiseSuggestion(small, NOV, 'i-groc');
  applyRaise(small, rs);
  assert.equal(rs.newLimit, 440);
  assert.equal(effectiveLimit(small, NOV, 'i-groc'), 440);
  assert.deepEqual(small.months[NOV].moves, []);
});

/* ---------- import wording ---------- */

test('merchants: interacNote says "Interac transfer" with no hyphen', () => {
  assert.equal(interacNote('VIREMENT INTERAC DE KYLIE SMITH'), 'Interac transfer from Kylie Smith');
  assert.equal(interacNote('INTERAC E-TRANSFER 000123456'), 'Interac transfer');
  const s = migrate(nov);
  const c = classifyMerchant(s, { date: '2026-11-13', time: null, merchant: 'E-TRANSFER RECEIVED Kylie', amount: 40, direction: 'in', account: 'chequing', raw: '' });
  assert.deepEqual([c.kind, c.note], ['income', 'Interac transfer from Kylie']);
});

/* ---------- sync: two tabs on one device, one localStorage ---------- */

function engineOn(server, storage, timers) {
  let t = Date.UTC(2026, 10, 14, 15, 0);
  return createSync({
    fetch: server.fetch, storage, now: () => (t += 1000),
    migrate: d => migrate(d), noteFor, defaults,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
}
const lunch = { id: 'tx-a', date: '2026-11-14', item: 'i-eat', amt: 8.1, note: 'Tab A lunch' };
const taxi = { id: 'tx-b', date: '2026-11-14', item: 'i-uber', amt: 8.2, note: 'Tab B taxi' };
const notesOf = doc => doc.months[NOV].tx.map(x => x.note);

test('sync: two tabs offline, one reloaded: neither change is lost, both reach the server once', async () => {
  const server = createFakeServer();
  server.seed(nov, { keepSavedAt: true });
  const storage = memoryStorage({ 'finance-key': 'k' });
  const timers = fakeTimers();
  const a = engineOn(server, storage, timers), b = engineOn(server, storage, timers);
  await a.load(); await b.load();
  server.setMode('offline');
  a.act('Added Tab A lunch $8.10', d => { getMonth(d, NOV).tx.push(lunch); });
  b.act('Added Tab B taxi $8.20', d => { getMonth(d, NOV).tx.push(taxi); });
  assert.deepEqual(storage.json('finance-pending').map(x => x.label), ['Added Tab A lunch $8.10', 'Added Tab B taxi $8.20']);
  assert.deepEqual(notesOf(storage.json('finance-cache')).slice(-2).sort(), ['Tab A lunch', 'Tab B taxi']);

  // Tab A is reloaded while still offline: it shows both changes.
  const a2 = engineOn(server, storage, timers);
  assert.equal((await a2.load()).status, 'offline');
  assert.ok(notesOf(a2.state).includes('Tab A lunch') && notesOf(a2.state).includes('Tab B taxi'));

  // Back online: the reloaded tab sends both, the other tab's own push changes nothing more.
  server.setMode('online');
  await a2.push(); await a2.idle();
  await b.push(); await b.idle();
  const saved = notesOf(server.latest());
  assert.equal(saved.filter(n => n === 'Tab A lunch').length, 1);
  assert.equal(saved.filter(n => n === 'Tab B taxi').length, 1);
  assert.equal(storage.has('finance-pending'), false, 'nothing left unsaved');
});

test('sync: a tab that saves its own change keeps the other tab\'s unsaved change in storage', async () => {
  const server = createFakeServer();
  server.seed(nov, { keepSavedAt: true });
  const storage = memoryStorage({ 'finance-key': 'k' });
  const timers = fakeTimers();
  const a = engineOn(server, storage, timers), b = engineOn(server, storage, timers);
  await a.load(); await b.load();
  server.setMode('offline');
  b.act('Added Tab B taxi $8.20', d => { getMonth(d, NOV).tx.push(taxi); });
  server.setMode('online');
  a.act('Added Tab A lunch $8.10', d => { getMonth(d, NOV).tx.push(lunch); });
  await a.push(); await a.idle();
  assert.deepEqual(storage.json('finance-pending').map(x => x.label), ['Added Tab B taxi $8.20']);
  assert.ok(notesOf(storage.json('finance-cache')).includes('Tab B taxi'), 'the cached copy still holds it');
});

/* ---------- sync: a key changed on the server leaves no readable copy ---------- */

test('sync: a 401 from the server with nothing unsaved removes the cached copy; unsaved changes keep it', async () => {
  const server = createFakeServer();
  server.seed(nov, { keepSavedAt: true });
  const timers = fakeTimers();

  const storage = memoryStorage({ 'finance-key': 'k' });
  const e = engineOn(server, storage, timers);
  await e.load();
  assert.ok(storage.has('finance-cache'));
  server.key = 'rotated';
  const r = await e.refresh();
  assert.equal(r.status, 'not-set-up');
  assert.equal(e.state, null);
  assert.equal(storage.has('finance-cache'), false);

  server.key = 'k';
  const kept = memoryStorage({ 'finance-key': 'k' });
  const f = engineOn(server, kept, timers);
  await f.load();
  server.setMode('offline');
  f.act('Added Tab A lunch $8.10', d => { getMonth(d, NOV).tx.push(lunch); });
  server.setMode('online');
  server.key = 'rotated';
  await f.refresh();
  assert.equal(f.state, null);
  assert.ok(kept.has('finance-cache') && kept.has('finance-pending'), 'nothing unsaved is thrown away');

  // No key on this device at all (the old page's cache is there): not set up, and the cache stays.
  const old = memoryStorage({ 'finance-cache': JSON.stringify(migrate(nov)) });
  const g = engineOn(server, old, timers);
  assert.equal((await g.load()).status, 'not-set-up');
  assert.ok(old.has('finance-cache'));
});

test('sync: stored actions carry the time they were made, oldest first', async () => {
  const server = createFakeServer();
  server.seed(nov, { keepSavedAt: true });
  const storage = memoryStorage({ 'finance-key': 'k' });
  const timers = fakeTimers();
  const a = engineOn(server, storage, timers), b = engineOn(server, storage, timers);
  await a.load(); await b.load();
  server.setMode('offline');
  b.act('Added Tab B taxi $8.20', d => { getMonth(d, NOV).tx.push(taxi); });
  a.act('Added Tab A lunch $8.10', d => { getMonth(d, NOV).tx.push(lunch); });
  const stored = storage.json('finance-pending');
  assert.ok(stored.every(x => typeof x.at === 'number'));
  assert.deepEqual([...stored].sort((x, y) => x.at - y.at).map(x => x.id), stored.map(x => x.id));
  assert.equal(clone(stored).length, 2);
});
