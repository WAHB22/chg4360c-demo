// Final recheck across the three fix sets: the save lock, the read counter, CIBC bank text, pay kinds and the
// acceptance numbers. Each test tries to break one fix from the outside. In memory fakes and synthetic data only.

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
import readHandler, { setAnthropicFactory } from '../api/read.js';
import { setBlobApi } from '../api/_store.js';
import { createFakeBlob } from './helpers/api-fake-blob.js';
import { callApi, useEnv } from './helpers/api-harness.js';
import { createWorld, settle } from './helpers/integration-world.js';
import { hasDash } from './helpers/import-helpers.js';
import { canonical, clone, findItem, getMonth, peekMonth } from '../lib/core.js';
import { migrate } from '../lib/migrate.js';
import { label } from '../lib/labels.js';
import { classifyMerchant, fingerprint, normalizeMerchant, prettyMerchant } from '../lib/merchants.js';
import { parseCSV } from '../lib/csv.js';
import { applyImport, buildReview, incomeNote, setCategory } from '../lib/importer.js';
import { monthTotals, nextPay, safeToSpend } from '../lib/money.js';
import { forecast } from '../lib/forecast.js';
import sample, { expect as NOV } from './fixtures/sample-nov.js';
import oct31, { expect as OCT } from './fixtures/oct31.js';

const KEY = 'device-key-for-recheck';
const PUB = 'vercel_blob_rw_recheckpub_fakesecret';
const PRIV = 'vercel_blob_rw_recheckpriv_fakesecret';
const HOST = 'wahb-finance.example';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex').toString('base64');
const LIMIT_MSG = 'You have used all 30 reads for today. They reset at midnight. CSV files still work.';
const BOOK = ['savedAt', 'note'];

let cleanup = null;
afterEach(() => { if (cleanup) cleanup(); cleanup = null; mock.timers.reset(); mock.restoreAll(); });

function apiSetup({ stores = { [PUB]: 'public' }, env = {}, latency, pageSize } = {}) {
  const fake = createFakeBlob({ stores, latency, pageSize });
  setBlobApi(fake.api);
  const claude = [];
  const reply = { type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ rows: oct31.rows }) }], stop_reason: 'end_turn' };
  setAnthropicFactory(() => ({ beta: { messages: { create: async p => { claude.push(p); return reply; } } } }));
  const restore = useEnv({
    APP_KEY: KEY, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined,
    ANTHROPIC_API_KEY: 'test-only-not-a-real-key', ...env,
  });
  cleanup = () => { restore(); setBlobApi(); setAnthropicFactory(); };
  return { fake, claude };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = max => () => Math.floor(Math.random() * (max + 1));
const auth = { 'x-app-key': KEY };
const get = (q = '') => callApi(dataHandler, { method: 'GET', url: '/api/data' + q, headers: auth });
const put = body => callApi(dataHandler, { method: 'PUT', url: '/api/data', headers: auth, body });
const doc = (extra = {}) => ({ version: 2, settings: { payPlan: 1300 }, bills: [], budget: [], accounts: [], goals: [], months: {}, ...extra });
const readHeaders = { ...auth, origin: `https://${HOST}`, 'x-forwarded-host': HOST, host: 'internal.host' };
const postRead = () => callApi(readHandler, {
  method: 'POST', url: '/api/read', headers: readHeaders, body: { name: 'n.png', type: 'image/png', data: PNG, uploadDate: '2026-11-14' },
});
const places = n => Array.from({ length: n }, (_, i) => `read-${String(i + 1).padStart(2, '0')}.json`);
const nov = s => s.months['2026-11'];

/* ---------- save lock: two devices racing ---------- */

test('recheck: two PUTs on the same base, 20 rounds with random latency: exactly one 409 each round, already holding the winner', { timeout: 60_000 }, async () => {
  const { fake } = apiSetup({ latency: jitter(20) });
  assert.equal((await put(doc({ savedAt: null, note: 'start' }))).status, 200);
  for (let round = 0; round < 20; round++) {
    const base = (await get()).json.savedAt;
    // A random head start of 0 to 3 ms for each side, so either one can win.
    const results = await Promise.all(['phone', 'laptop'].map(who => sleep(Math.floor(Math.random() * 4))
      .then(() => put(doc({ baseSavedAt: base, note: `${who} ${round}`, who })))));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409], `round ${round}`);
    const won = results.find(r => r.status === 200), lost = results.find(r => r.status === 409);
    assert.equal(lost.json.error, 'conflict');
    assert.equal(lost.json.latest.savedAt, won.json.savedAt, `round ${round}: the 409 carries the save that won`);
    assert.notEqual(lost.json.latest.savedAt, base);
    assert.equal(fake.text(PUB, 'finance-preview/lock.json'), null, `round ${round}: lock released`);
    // The loser replays on top of that latest: in on the first try.
    const replay = await put({ ...lost.json.latest, baseSavedAt: lost.json.latest.savedAt, note: `replay ${round}` });
    assert.equal(replay.status, 200, `round ${round}: replay`);
  }
  const history = (await get('?history=1')).json.versions;
  assert.equal(history.length, 10);
  assert.equal(history[0].note, 'replay 19');
  assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 10, 'pruned to 10');
});

test('recheck: two real sync engines act at the same moment, 20 rounds with random latency: one 409 per round, no change lost', { timeout: 90_000 }, async () => {
  const w = createWorld();
  try {
    w.seedVersion(clone(sample));
    w.blob.setLatency(jitter(15));
    const A = w.device('phone'), B = w.device('laptop');
    await A.engine.load();
    await B.engine.load();
    const tx = (who, round) => ({
      id: `t-${who}-${round}`, date: '2026-11-13', item: 'i-groc', amt: 10 + round, note: `${who} ${round}`,
      src: 'manual', fp: `${(10 + round) * 100}|${who} ${round}`, merchant: `${who} ${round}`, account: null,
    });
    for (let round = 0; round < 20; round++) {
      await A.engine.refresh();
      await B.engine.refresh();
      assert.equal(A.engine.state.savedAt, B.engine.state.savedAt, `round ${round}: both start from the same save`);
      const before = w.puts().length;
      for (const [d, who] of [[A, 'phone'], [B, 'laptop']]) {
        const t = tx(who, round);
        d.engine.act(label('addTx', { name: t.note, amt: t.amt }), s => { nov(s).tx.push(t); });
      }
      A.timers.tick(700);
      B.timers.tick(700);
      await settle(A, B);
      const puts = w.puts().slice(before);
      const seen = puts.map(p => `${p.who} ${p.status}`).join(', ');
      assert.equal(puts.filter(p => p.status === 409).length, 1, `round ${round}: ${seen}`);
      assert.equal(puts.filter(p => p.status === 200).length, 2, `round ${round}: ${seen}`);
      assert.equal(puts.length, 3, `round ${round}: ${seen}`);
    }
    const top = w.newest();
    const ids = nov(top).tx.map(t => t.id);
    for (let round = 0; round < 20; round++) {
      for (const who of ['phone', 'laptop']) assert.equal(ids.filter(id => id === `t-${who}-${round}`).length, 1, `${who} ${round} kept once`);
    }
    assert.equal(ids.length, sample.months['2026-11'].tx.length + 40);
    for (const d of [A, B]) {
      await d.engine.refresh();
      assert.deepEqual(d.engine.pending, []);
      assert.equal(canonical(d.engine.state, BOOK), canonical(top, BOOK), d.name);
    }
    assert.equal(w.blob.text(w.cfg.primary.token, w.cfg.prefix + 'lock.json'), null);
  } finally {
    w.close();
  }
});

/* ---------- read counter ---------- */

test('recheck: 35 reads at once with random latency let exactly 30 through, on three days and both stores', { timeout: 60_000 }, async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const days = [
    ['2026-11-14', '2026-11-14T15:00:00Z', { [PUB]: 'public' }, {}, PUB],
    ['2026-11-15', '2026-11-16T04:30:00Z', { [PUB]: 'public' }, {}, PUB], // 23:30 EST, still Nov 15 in Toronto
    ['2026-11-18', '2026-11-18T13:00:00Z', { [PUB]: 'public', [PRIV]: 'private' }, { PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV }, PRIV],
  ];
  let fake = null, claude = null;
  for (const [day, at, stores, env, token] of days) {
    if (!fake || token === PRIV) {
      if (cleanup) cleanup();
      ({ fake, claude } = apiSetup({ stores, env, latency: jitter(12) }));
    }
    mock.timers.setTime(Date.parse(at));
    const calledBefore = claude.length;
    const results = await Promise.all(Array.from({ length: 35 }, () => postRead()));
    const statuses = results.map(r => r.status);
    assert.equal(statuses.filter(s => s === 200).length, 30, `${day}: ${statuses}`);
    assert.equal(statuses.filter(s => s === 429).length, 5, `${day}: ${statuses}`);
    assert.ok(results.filter(r => r.status === 429).every(r => r.json.error === LIMIT_MSG));
    assert.equal(claude.length - calledBefore, 30, `${day}: Claude called once per counted read`);
    const folder = `finance-meta/reads/${day}/`;
    assert.deepEqual(fake.pathnames(token, folder).map(p => p.slice(folder.length)), places(30), `${day}: places 01 to 30, no gap, no extra`);
    // One more, alone, after the burst: still refused.
    assert.equal((await postRead()).status, 429);
  }
  // With a private store connected, Nov 18's reads all went there: that run's public store got none.
  assert.deepEqual(fake.pathnames(PUB, 'finance-meta/'), []);
});

test('recheck: the first read of a day cleans up folders before today minus 2 days, while 35 reads run at once', { timeout: 60_000 }, async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-18T13:00:00Z') });
  const { fake } = apiSetup({ latency: jitter(10) });
  for (const day of ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']) {
    for (const n of places(3)) fake.seed(PUB, `finance-meta/reads/${day}/${n}`, '{}');
  }
  fake.seed(PUB, 'finance-meta/other.json', '{}');
  const results = await Promise.all(Array.from({ length: 35 }, () => postRead()));
  assert.equal(results.filter(r => r.status === 200).length, 30);
  const daysLeft = [...new Set(fake.pathnames(PUB, 'finance-meta/reads/').map(p => p.split('/')[2]))];
  assert.deepEqual(daysLeft, ['2026-11-16', '2026-11-17', '2026-11-18']);
  assert.equal(fake.pathnames(PUB, 'finance-meta/reads/2026-11-18/').length, 30);
  assert.equal(fake.text(PUB, 'finance-meta/other.json'), '{}', 'nothing else under finance-meta is touched');
});

test('recheck: the read count follows list pagination (pages of 7): 30 pass, the 31st is refused', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, claude } = apiSetup({ pageSize: 7 });
  for (let i = 0; i < 30; i++) assert.equal((await postRead()).status, 200, `read ${i + 1}`);
  assert.equal((await postRead()).status, 429);
  assert.equal(claude.length, 30);
  assert.equal(fake.pathnames(PUB, 'finance-meta/reads/2026-11-14/').length, 30);
});

/* ---------- CIBC bank text variants ---------- */

const stateNov = () => migrate(clone(sample));
const decide = (state, merchant, direction = 'out', account = 'chequing', amount = 12.34, date = '2026-11-14') => {
  const c = classifyMerchant(state, { merchant, direction, account, amount, date });
  return { norm: normalizeMerchant(merchant), note: prettyMerchant(merchant), kind: c.kind, item: c.itemId ? findItem(state, c.itemId).name : null, bill: c.billMatch ? c.billMatch.billId : null, saved: c.note };
};

test('recheck: CIBC bank text variants (case, en and em dash, no dash, no spaces, Visa Debit, pre-authorized spellings)', () => {
  const s = stateNov();
  const cases = [
    ['POINT OF SALE - INTERAC RETAIL PURCHASE 000001234567 TIM HORTONS #1234', 'tim hortons', 'Tim Hortons', 'expense', 'Coffee and snacks'],
    ['Point of Sale – Interac RETAIL PURCHASE 000001234567 NUAGE CAFE MONTREAL QC', 'nuage cafe', 'Nuage Cafe', 'expense', 'Coffee and snacks'],
    ['Point of Sale—Interac RETAIL PURCHASE 000001234567 COSTCO WHOLESALE #503', 'costco wholesale', 'Costco Wholesale', 'expense', 'Groceries'],
    ['Point of Sale Interac RETAIL PURCHASE 000001234567 METRO PLUS', 'metro plus', 'Metro Plus', 'expense', 'Groceries'],
    ['Point of Sale-Interac RETAIL PURCHASE 000001234567 PET VALU', 'pet valu', 'Pet Valu', 'expense', 'Cat food'],
    ['point of sale - interac retail purchase 000001234567 koichi ramen', 'koichi ramen', 'Koichi Ramen', 'expense', 'Eating out'],
    ['Point of Sale - Interac RETAIL PURCHASE ************4567 SKIP THE DISHES', 'skip the dishes', 'Skip The Dishes', 'expense', 'Takeout and delivery'],
    ['Point of Sale - Interac RETAIL PURCHASE 000001234567 TACO BELL #123', 'taco bell', 'Taco Bell', 'expense', 'Eating out'],
    ['Point of Sale - Interac RETAIL PURCHASE 000001234567 LA BELLE PROVINCE', 'la belle province', 'La Belle Province', 'expense', null],
  ];
  for (const [line, norm, note, kind, item] of cases) {
    const d = decide(s, line, 'out', 'chequing', 90.83, '2026-11-18'); // the Phone (Bell) amount and day: still no bill
    assert.deepEqual([d.norm, d.note, d.kind, d.item, d.bill], [norm, note, kind, item, null], line);
    assert.equal(d.saved, note, line);
    assert.ok(!hasDash(d.note), line);
  }
  // A bare brand word after bank text never ticks a bill, even at that bill's exact amount.
  assert.equal(decide(s, 'Point of Sale - Interac RETAIL PURCHASE 000001234567 APPLE STORE R123', 'out', 'chequing', 4.59, '2026-11-03').kind, 'expense');
  assert.equal(decide(s, 'Point of Sale - Interac RETAIL PURCHASE 000001234567 ST CLAUDE PHARMACIE', 'out', 'chequing', 100, '2026-11-04').kind, 'expense');

  const bills = [
    ['Point of Sale - Visa Debit VISA DEBIT PURCHASE 000001234567 NETFLIX.COM', 'b-netflix', 27.11, '2026-11-16'],
    ['Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE 000001234567 SPOTIFY P1A2B3', 'b-spot', 14.44, '2026-11-06'],
    ['Electronic Funds Transfer PREAUTHORIZED DEBIT BELL CANADA', 'b-phone', 90.83, '2026-11-18'],
    ['Electronic Funds Transfer PREAUTHORIZED DEBIT BELL CANADA', 'b-net', 89.43, '2026-11-22'],
    ['Electronic Funds Transfer PRE-AUTHORIZED DEBIT ABC FITNESS', 'b-gym', 31.58, '2026-11-12'],
    ['Electronic Funds Transfer PREAUTHORISED DEBIT 000000123456 NETFLIX', 'b-netflix', 27.11, '2026-11-16'],
    ['PREAUTHORIZED DEBIT APPLE.COM/BILL', 'b-icloud', 4.59, '2026-11-03'],
  ];
  for (const [line, billId, amt, date] of bills) {
    const d = decide(s, line, 'out', 'chequing', amt, date);
    assert.deepEqual([d.kind, d.bill], ['bill', billId], line);
  }

  // Money in: pay, Interac income, refunds. A refund code never becomes income or pay.
  assert.deepEqual(Object.values(decide(s, 'Electronic Funds Transfer PAY BOBINO INC', 'in')).slice(2, 4), ['pay', null]);
  assert.equal(decide(s, 'Electronic Funds Transfer PAY BOBINO INC', 'in').saved, 'Bobino pay');
  const kylie = decide(s, 'Internet Banking E-TRANSFER 105372806372 Kylie', 'in');
  assert.equal(kylie.kind, 'income');
  // The note shown in the review and saved on the pay says 'Interac transfer', never 'e-Transfer' (no hyphen in the UI).
  const [kylieRow] = buildReview(s, [{ fileId: 'k', src: 'statement', rows: [{ date: '2026-11-14', time: null,
    merchant: 'Internet Banking E-TRANSFER 105372806372 Kylie', amount: 12.34, direction: 'in', account: 'chequing', raw: 'x' }] }]);
  assert.equal(kylieRow.note, 'Interac transfer from Kylie');
  assert.deepEqual([decide(s, 'Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESALE', 'in').kind,
    decide(s, 'Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESALE', 'in').item], ['refund', 'Groceries']);
  assert.deepEqual([decide(s, 'Point of Sale - Visa Debit VISA DEBIT REFUND 000001234567 UNKNOWN SHOP', 'in').kind,
    decide(s, 'Point of Sale - Visa Debit VISA DEBIT REFUND 000001234567 UNKNOWN SHOP', 'in').item], ['refund', null]);
  assert.equal(decide(s, 'Point of Sale - Interac RETAIL REFUND 000001234567 BOBINO PAYROLL', 'in').kind, 'refund');
  assert.equal(decide(s, 'Point of Sale - Interac RETAIL REFUND 000001234567 INTERAC E-TRANSFER', 'in').kind, 'refund');

  // Only bank text: the whole line stays, so the merchant is never empty and the note has no dash.
  const bare = decide(s, 'Point of Sale - Interac RETAIL PURCHASE 000001234567');
  assert.ok(bare.norm.length > 0 && bare.note.length > 0 && !hasDash(bare.note));
});

test('recheck: Payment, PAYMENT THANK YOU/PAIEMENT MERCI, Visa bill pay and own transfers are never spending', () => {
  const s = stateNov();
  const lines = [
    ['Payment', 'in', 'visa'], ['PAYMENT', 'in', 'visa'], ['Paiement', 'in', 'visa'], ['Payment', 'in', null],
    ['PAYMENT THANK YOU/PAIEMENT MERCI', 'in', 'visa'], ['PAYMENT THANK YOU/PAIEMENT MERCI', 'in', 'chequing'],
    ['PAYMENT - THANK YOU', 'in', 'visa'], ['PAIEMENT - MERCI', 'in', 'visa'],
    ['Internet Banking INTERNET BILL PAY 000000156789 CIBC VISA', 'out', 'chequing'],
    ['INTERNET BILL PAY 000000156789 CIBC VISA', 'out', 'chequing'],
    ['Internet Banking INTERNET TRANSFER 000000123456', 'out', 'chequing'],
    ['Internet Banking INTERNET TRANSFER 000000123456', 'in', 'chequing'],
  ];
  for (const [m, dir, acct] of lines) assert.equal(decide(s, m, dir, acct).kind, 'notspending', `${m} ${dir} ${acct}`);

  // Through the CSV parser, the review and applyImport: nothing is added for them, real purchases still are.
  const visaCsv = [
    '2026-11-03,"PAYMENT THANK YOU/PAIEMENT MERCI",,500.00,4500********1234',
    '2026-11-04,PAYMENT,,100.00,4500********1234,',
    '2026-11-05,NUAGE CAFE MONTREAL QC,6.58,,4500********1234',
  ].join('\n');
  const chqCsv = [
    '2026-11-06,Internet Banking INTERNET BILL PAY 000000156789 CIBC VISA,600.00,',
    '2026-11-07,Internet Banking INTERNET TRANSFER 000000123456,200.00,',
    '2026-11-08,Internet Banking INTERNET TRANSFER 000000123456,,150.00',
    '2026-11-09,Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1,4.25,',
  ].join('\n');
  const v = parseCSV(visaCsv), c = parseCSV(chqCsv);
  assert.deepEqual([v.skipped, c.skipped], [[], []]);
  assert.deepEqual(v.rows.map(r => r.account), ['visa', 'visa', 'visa']);
  assert.deepEqual(c.rows.map(r => r.account), ['chequing', 'chequing', 'chequing', 'chequing']);
  const rows = buildReview(s, [{ fileId: 'v', src: 'statement', rows: v.rows }, { fileId: 'c', src: 'statement', rows: c.rows }], { today: '2026-11-14' });
  assert.deepEqual(rows.map(r => [r.status, r.ticked]), [
    ['notspending', false], ['notspending', false], ['new', true],
    ['notspending', false], ['notspending', false], ['notspending', false], ['new', true],
  ]);
  const before = monthTotals(s, '2026-11');
  const paysBefore = peekMonth(s, '2026-11').pays.length;
  // Ticking a not spending row by hand still never applies it.
  const res = applyImport(s, rows.map(r => ({ ...r, ticked: true })));
  assert.deepEqual(res, { expenses: 2, pays: 0, bills: 0, total: 10.83, skipped: 0 });
  assert.equal(monthTotals(s, '2026-11').spent, before.spent + 10.83);
  assert.equal(peekMonth(s, '2026-11').pays.length, paysBefore);
  assert.deepEqual(peekMonth(s, '2026-11').tx.slice(-2).map(t => [t.note, t.fp, t.account]),
    [['Nuage Cafe', '658|nuage cafe', 'visa'], ['Tim Hortons', '425|tim hortons', 'chequing']]);
});

/* ---------- normalizeMerchant change: fingerprints, duplicates and memory ---------- */

test('recheck: a CIBC chequing line matches a saved tx with the plain name (duplicate), and a pick made on it is remembered for screenshots', () => {
  const s = stateNov();
  // Tim Hortons $23.55 on Nov 10 is in the sample (a v1 tx: note only). The chequing line for it is a duplicate.
  const line = parseCSV('2026-11-11,Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1,23.55,').rows;
  const [dup] = buildReview(s, [{ fileId: 'c', src: 'statement', rows: line }]);
  assert.equal(dup.status, 'dup');
  assert.equal(dup.dup.id, 't7');
  assert.equal(dup.statusText, 'Possible duplicate of Tim Hortons $23.55 on Nov 10');
  assert.equal(fingerprint(23.55, line[0].merchant), fingerprint(23.55, 'Tim Hortons'));

  // A merchant with no rule: picked once on the chequing line, remembered under the stripped name.
  const pb = parseCSV('2026-11-12,Point of Sale - Interac RETAIL PURCHASE 000001234567 LA BELLE PROVINCE #12,18.40,').rows;
  let rows = buildReview(s, [{ fileId: 'c2', src: 'statement', rows: pb }]);
  assert.deepEqual([rows[0].kind, rows[0].itemId, rows[0].billMatch], ['expense', null, null]);
  rows = setCategory(s, rows, rows[0].key, 'i-eat');
  applyImport(s, rows);
  assert.equal(s.merchantMap['la belle province'], 'i-eat');
  assert.ok(!Object.keys(s.merchantMap).some(k => /point of sale|retail purchase|\d{6}/.test(k)), 'no bank text in memory keys');
  const later = buildReview(s, [{ fileId: 'shot', src: 'screenshot', rows: [{ date: '2026-11-20', time: '12:01', merchant: 'LA BELLE PROVINCE #12', amount: 9.1, direction: 'out', account: 'visa', raw: 'x' }] }]);
  assert.deepEqual([later[0].kind, later[0].itemId, later[0].catSource], ['expense', 'i-eat', 'memory']);
  // migrate keeps the saved fp as it is (fingerprints are never recomputed).
  const m = migrate(s);
  assert.deepEqual(peekMonth(m, '2026-11').tx.at(-1).fp, '1840|la belle province');
});

/* ---------- Stage 1 acceptance, Oct 31 ---------- */

test('recheck: Oct 31 acceptance is still exact on the v1 sample and on migrated data', () => {
  for (const [name, start] of [['v1', clone(sample)], ['v2', migrate(clone(sample))]]) {
    const s = clone(start);
    const rows = buildReview(s, [{ fileId: 'shot1', name: 'shot1', src: 'screenshot', rows: oct31.rows }], { today: '2026-11-14' });
    assert.equal(rows.length, OCT.shown, name);
    const ticked = rows.filter(r => r.ticked);
    assert.deepEqual(ticked.map(r => r.merchant), OCT.ticked, name);
    assert.ok(ticked.every(r => r.kind === 'expense' && r.status === 'new' && r.catSource === 'rule'), name);
    for (const r of ticked) assert.equal(findItem(s, r.itemId).name, OCT.categories[r.merchant], `${name} ${r.merchant}`);
    const payments = rows.filter(r => r.merchant === 'Payment');
    assert.equal(payments.length, OCT.notSpending, name);
    assert.ok(payments.every(r => r.status === 'notspending' && r.ticked === false && r.statusText === 'Not spending'), name);
    assert.deepEqual(payments.map(r => r.time), ['13:02', null], name);
    assert.ok(rows.every(r => r.billMatch === null), name);

    assert.deepEqual(applyImport(s, rows), { expenses: 4, pays: 0, bills: 0, total: 158.27, skipped: 0 }, name);
    assert.deepEqual(peekMonth(s, '2026-10').tx.map(t => [t.note, t.amt, t.item, t.fp]), [
      ['Nuage Cafe', 6.58, 'i-coffee', '658|nuage cafe'],
      ['Sammi & Soupe Dumpling', 100.63, 'i-eat', '10063|sammi soupe dumpling'],
      ['EPLV Billetterie Bio', 38, 'i-act', '3800|eplv billetterie bio'],
      ['Espace Vego Biodome', 13.06, 'i-act', '1306|espace vego biodome'],
    ], name);
    assert.equal(peekMonth(s, '2026-10').pays.length, 2, `${name}: the Payments added no pay`);

    const again = buildReview(s, [{ fileId: 'shot2', name: 'shot2', src: 'screenshot', rows: oct31.rows }], { today: '2026-11-14' });
    const expenses = again.filter(r => r.kind === 'expense');
    assert.equal(expenses.length, 4, name);
    assert.ok(expenses.every(r => r.status === 'dup' && !r.ticked), name);
    assert.ok(again.filter(r => r.merchant === 'Payment').every(r => r.status === 'notspending'), name);
  }
});

/* ---------- Stage 3 acceptance, Nov 14 and Nov 20, with imported pays ---------- */

const importCsv = (s, csv, today) => {
  const { rows, skipped } = parseCSV(csv);
  assert.deepEqual(skipped, []);
  return applyImport(s, buildReview(s, [{ fileId: csv, src: 'statement', rows }], { today }));
};

test('recheck: the Nov 14 and Nov 20 safe to spend acceptance is exact, by hand and with the second pay imported from a CIBC CSV', () => {
  // As specified (SPEC 5.3 check 1), on the v1 sample and on migrated data:
  // (1300 - 647 - 163.96 - 0) / 6 = 81.50 -> $81 today, payday in 6 days.
  for (const [name, s] of [['v1', clone(sample)], ['v2', migrate(clone(sample))]]) {
    const r = safeToSpend(s, NOV.today);
    assert.deepEqual([r.perDay, r.days, r.pool, r.parts.income, r.parts.spending, r.parts.billsTotal, r.parts.olderTotal],
      [81, 6, 489.04, 1300, 647, 163.96, 0], name);
    assert.deepEqual([r.perDay, r.days, r.pool], [NOV.perDay, NOV.days, NOV.pool], name);
    assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-19' }, name);
    assert.deepEqual(r.nextPay, { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' }, name);
    // The second pay by hand on Nov 20: period Nov 20 to Dec 3, 14 days.
    // 1300 - 0 - 803.10 (Internet, Gym, Rent, Parking, iCloud) - 117.94 (Netflix and Phone, still unpaid) = 378.96 -> 27
    const two = clone(s);
    two.months['2026-11'].pays.push({ id: 'p-nov20', date: '2026-11-20', amt: 1300, hours: null, note: '' });
    const a = safeToSpend(two, '2026-11-20');
    assert.deepEqual([a.perDay, a.days, a.pool, a.parts.income, a.parts.billsTotal, a.parts.olderTotal], [27, 14, 378.96, 1300, 803.10, 117.94], name);
    assert.deepEqual(a.nextPay, { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' }, name);
  }

  // The second pay arrives through a chequing CSV (Bobino payroll, kind 'pay'): the same numbers.
  const s = migrate(clone(sample));
  assert.equal(importCsv(s, '2026-11-20,Electronic Funds Transfer PAY BOBINO INC,,1300.00', '2026-11-20').pays, 1);
  assert.deepEqual(peekMonth(s, '2026-11').pays.at(-1), { ...peekMonth(s, '2026-11').pays.at(-1), date: '2026-11-20', amt: 1300, note: 'Bobino pay', kind: 'pay' });
  const a = safeToSpend(s, '2026-11-20');
  assert.deepEqual([a.perDay, a.days, a.pool, a.parts.income], [27, 14, 378.96, 1300]);
  assert.deepEqual(a.nextPay, { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' });
  assert.deepEqual(a.parts.billsInPeriod.map(b => b.name), ['Internet (Bell)', 'Gym (ABC)', 'Rent (my half)', 'Parking (my half)', 'iCloud']);
  assert.deepEqual(a.parts.olderUnpaid.map(b => b.name), ['Netflix', 'Phone + Crave/Disney (Bell)']);
  // The 1st of December alone changes nothing: same pool, one day less each day.
  const nov30 = safeToSpend(s, '2026-11-30'), dec1 = safeToSpend(s, '2026-12-01');
  assert.deepEqual([nov30.pool, nov30.days, nov30.perDay, dec1.pool, dec1.days, dec1.perDay], [378.96, 4, 94, 378.96, 3, 126]);
});

test('recheck: an Interac transfer imported from a CSV adds income but never moves the payday', () => {
  const s = migrate(clone(sample));
  assert.equal(importCsv(s, '2026-11-10,Internet Banking E-TRANSFER 105372806372 Kylie,,50.00', '2026-11-14').pays, 1);
  const pay = peekMonth(s, '2026-11').pays.at(-1);
  assert.deepEqual([pay.date, pay.amt, pay.note, pay.kind], ['2026-11-10', 50, 'Interac transfer from Kylie', 'income']);
  assert.ok(!hasDash(pay.note) && !pay.note.includes('-'), 'no hyphen in the note');
  // migrate keeps the kind field.
  assert.equal(peekMonth(migrate(s), '2026-11').pays.at(-1).kind, 'income');

  // Nov 14: 1300 + 50 = 1350 in; 1350 - 647 - 163.96 = 539.04; / 6 = 89.84 -> 89. The period still starts Nov 6.
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual([r.perDay, r.days, r.pool, r.parts.income], [89, 6, 539.04, 1350]);
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-19' });
  assert.deepEqual(r.nextPay, { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' });
  assert.equal(monthTotals(s, '2026-11').earned, 1350);

  // Then the paycheque on Nov 20, also from the CSV. The Nov 10 money belongs to the period before.
  importCsv(s, '2026-11-20,Electronic Funds Transfer PAY BOBINO INC,,1300.00', '2026-11-20');
  const a = safeToSpend(s, '2026-11-20');
  assert.deepEqual([a.perDay, a.days, a.pool, a.parts.income], [27, 14, 378.96, 1300]);
  assert.deepEqual(a.nextPay, { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' });

  // A refund on chequing is a negative expense, never a pay.
  const pays = peekMonth(s, '2026-11').pays.length;
  importCsv(s, '2026-11-12,Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESALE,,20.00', '2026-11-14');
  assert.equal(peekMonth(s, '2026-11').pays.length, pays);
  assert.deepEqual(peekMonth(s, '2026-11').tx.at(-1).amt, -20);
  assert.deepEqual(nextPay(s, '2026-11-14'), { date: '2026-11-20', estimate: false, lastPay: '2026-11-06' });
  // It is dated Nov 12, inside the Nov 6 period: 539.04 + 20 = 559.04 on Nov 14
  assert.equal(safeToSpend(s, '2026-11-14').pool, 559.04);
});

test('recheck: Interac notes read "Interac transfer" (plus "from <sender>" when visible) everywhere the import writes or shows them', () => {
  const s = migrate(clone(sample));
  const cheqIn = (merchant, amount, date) => ({ date, time: null, merchant, amount, direction: 'in', account: 'chequing', raw: merchant });
  const rows = buildReview(s, [{ fileId: 'c', src: 'statement', rows: [
    cheqIn('INTERAC E-TRANSFER 000123456', 15, '2026-11-11'),          // no sender visible
    cheqIn('VIREMENT INTERAC DE KYLIE SMITH', 30, '2026-11-12'),
    cheqIn('GST CREDIT CANADA', 80, '2026-11-13'),                     // other money in keeps its own note
  ] }]);
  assert.deepEqual(rows.map(r => [r.kind, r.note]), [['income', 'Interac transfer'], ['income', 'Interac transfer from Kylie Smith'], ['income', 'Gst Credit Canada']]);
  // A row from a review built before this change still saves the new wording.
  const old = { ...rows[0], key: 'old', note: 'Interac e-Transfer from Kylie' };
  applyImport(s, [...rows, old]);
  assert.deepEqual(peekMonth(s, '2026-11').pays.slice(-4).map(p => [p.note, p.kind]), [
    ['Interac transfer', 'income'], ['Interac transfer from Kylie Smith', 'income'], ['Gst Credit Canada', 'income'], ['Interac transfer from Kylie', 'income'],
  ]);
  // A pay saved earlier with the old wording is shown with the new one when a statement line repeats it.
  getMonth(s, '2026-11').pays.push({ id: 'p-old', date: '2026-11-21', amt: 40, hours: null, note: 'Interac e-Transfer from Kylie', kind: 'income' });
  const [dup] = buildReview(s, [{ fileId: 'd', src: 'statement', rows: [cheqIn('E-TRANSFER RECEIVED Kylie', 40, '2026-11-22')] }]);
  assert.equal(dup.status, 'dup');
  assert.equal(dup.statusText, 'Possible duplicate of Interac transfer from Kylie $40 on Nov 21');
  assert.equal(s.months['2026-11'].pays.at(-1).note, 'Interac e-Transfer from Kylie', 'saved data is never renamed');
  for (const t of [...rows.map(r => r.note), dup.statusText, ...peekMonth(s, '2026-11').pays.slice(-5, -1).map(p => p.note)]) {
    assert.ok(!/e-?transfer/i.test(t) && !hasDash(t), t);
  }
  assert.deepEqual(['Interac e-Transfer', 'INTERAC E-TRANSFER from Sam', 'Interactive Toys', '', null].map(incomeNote),
    ['Interac transfer', 'Interac transfer from Sam', 'Interactive Toys', '', '']);
});

/* ---------- forecast and pay kinds ---------- */

test('recheck: forecast keeps the estimated paycheque when money in that is not a paycheque lands on that day', () => {
  const s = migrate(clone(sample));
  s.settings.chequing = { bal: 420, asOf: '2026-11-14' };
  const run = state => forecast(state, '2026-11-14', { nextPay: nextPay(state, '2026-11-14') });
  const payEvents = (r, date) => r.points.find(p => p.date === date).events.filter(e => e.type === 'pay').map(e => [e.label, e.amt, e.estimate]);
  const base = run(s);
  assert.deepEqual(payEvents(base, '2026-11-20'), [['Pay estimate', 1300, true]]);

  // An Interac transfer (kind 'income') dated Nov 20: nextPay ignores it, so the forecast must too.
  const withIncome = clone(s);
  withIncome.months['2026-11'].pays.push({ id: 'p-int', date: '2026-11-20', amt: 50, hours: null, note: 'Interac transfer from Kylie', kind: 'income' });
  assert.deepEqual(nextPay(withIncome, '2026-11-14'), nextPay(s, '2026-11-14'));
  const r = run(withIncome);
  assert.deepEqual(payEvents(r, '2026-11-20'), [['Interac transfer from Kylie', 50, false], ['Pay estimate', 1300, true]]);
  assert.equal(r.points.at(-1).bal, Math.round((base.points.at(-1).bal + 50) * 100) / 100);

  // A real paycheque logged on that day (no kind, or kind 'pay') still replaces the estimate.
  for (const kind of [undefined, 'pay']) {
    const logged = clone(s);
    logged.months['2026-11'].pays.push({ id: 'p-20', date: '2026-11-20', amt: 1300, hours: null, note: '', ...(kind ? { kind } : {}) });
    const l = run(logged);
    assert.deepEqual(payEvents(l, '2026-11-20'), [['Pay', 1300, false]], String(kind));
    assert.equal(l.points.at(-1).bal, base.points.at(-1).bal, String(kind));
  }
});
