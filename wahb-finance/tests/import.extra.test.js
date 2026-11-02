// Extra import tests from the adversarial review (spec section 6). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyMerchant, matchBill } from '../lib/merchants.js';
import { parseCSV } from '../lib/csv.js';
import { buildReview, setCategory, applyImport, findDuplicate } from '../lib/importer.js';
import { canonical, clone, isISODate, peekMonth } from '../lib/core.js';
import oct31 from './fixtures/oct31.js';
import { freshState, row, batch, itemName, addTx, hasDash } from './helpers/import-helpers.js';

const review = (state, ...batches) => buildReview(state, batches, { today: '2026-11-14' });
const cheq = (merchant, amount, more = {}) => row(merchant, amount, { account: 'chequing', ...more });
const kinds = rows => rows.map(r => [r.status, r.ticked]);

/* ---------- bill matching must not swallow ordinary spending ---------- */

test('CIBC chequing boilerplate never ticks the Internet (Bell) bill by name', () => {
  const s = freshState();
  // 'Internet' is a token of the bill name 'Internet (Bell)' and of every CIBC online banking line.
  const etr = classifyMerchant(s, cheq('Internet Banking E-TRANSFER 105372806372 Kylie', 90));
  assert.equal(etr.kind, 'expense');
  assert.equal(etr.billMatch, null);
  const hydro = classifyMerchant(s, cheq('Internet Banking INTERNET BILL PAY 000000156789 HYDRO QUEBEC', 88));
  assert.equal(hydro.kind, 'expense');
  // The Bell keyword on the same kind of line still finds the bill.
  const bell = classifyMerchant(s, cheq('Internet Banking INTERNET BILL PAY 000000156789 BELL CANADA', 89.43, { date: '2026-11-21' }));
  assert.equal(bell.kind, 'bill');
  assert.equal(bell.billMatch.key, 'b-net@2026-11-22');
});

test('a Taco Bell meal near a Bell bill amount stays Eating out', () => {
  const s = freshState();
  const c = classifyMerchant(s, row('TACO BELL #123', 90, { date: '2026-11-20' }));
  assert.equal(c.kind, 'expense');
  assert.equal(itemName(s, c.itemId), 'Eating out');
  assert.equal(matchBill(s, row('TACO BELL #123', 90.83)), null);
});

test('filler words in bill names do not match: Half Price is not Parking (my half)', () => {
  const s = freshState();
  assert.equal(classifyMerchant(s, row('HALF PRICE BOOKS', 90)).kind, 'expense');
  assert.equal(classifyMerchant(s, row('HALF PRICE BOOKS', 587.50)).kind, 'expense');
  // A real name token still works within 5%.
  assert.equal(matchBill(s, row('PARKING MONTREAL', 90, { date: '2026-11-02' })).key, 'b-park@2026-11-01');
});

test('a bill keyword counts even far from the bill amount (spec 6.5), with the difference reported', () => {
  const s = freshState();
  const m = matchBill(s, row('NETFLIX.COM', 30.99, { date: '2026-11-16' }));
  assert.equal(m.billId, 'b-netflix');
  assert.ok(m.diffPct > 5);
  // A name token alone needs 5% or less.
  s.bills.push({ id: 'b-vid', name: 'Videotron', amt: 45, freq: 'monthly', day: 10, note: '' });
  assert.equal(matchBill(s, row('VIDEOTRON', 60, { date: '2026-11-10' })), null);
});

/* ---------- pay rule ---------- */

test('a Bobino Bagel refund is not a paycheque', () => {
  const s = freshState();
  const c = classifyMerchant(s, row('BOBINO BAGEL', 12, { direction: 'in', account: 'visa' }));
  assert.equal(c.kind, 'refund');
  assert.equal(itemName(s, c.itemId), 'Eating out');
  assert.equal(classifyMerchant(s, cheq('BOBINO PAYROLL', 1300, { direction: 'in' })).kind, 'pay');
  assert.equal(classifyMerchant(s, cheq('Electronic Funds Transfer PAY BOBINO INC', 1300, { direction: 'in' })).kind, 'pay');
});

test('merchant memory never turns a paycheque or a Visa payment into spending', () => {
  const s = freshState();
  s.merchantMap = { 'bobino payroll': 'i-groc', payment: 'i-groc', 'e transfer received kylie': 'i-groc' };
  assert.equal(classifyMerchant(s, cheq('BOBINO PAYROLL', 1300, { direction: 'in' })).kind, 'pay');
  assert.equal(classifyMerchant(s, row('Payment', 100, { direction: 'in' })).kind, 'notspending');
  assert.equal(classifyMerchant(s, cheq('E-TRANSFER RECEIVED Kylie', 40, { direction: 'in' })).kind, 'income');
});

/* ---------- duplicates are matched one to one ---------- */

test('one saved purchase explains only one of two identical statement lines', () => {
  const state = freshState();
  addTx(state, { id: 'n1', date: '2026-11-20', item: 'i-coffee', amt: 6.58, note: 'Nuage Cafe', src: 'screenshot', account: 'visa' });
  const rows = review(state, batch('stmt', [
    row('NUAGE CAFE MONTREAL QC', 6.58, { date: '2026-11-20' }),
    row('NUAGE CAFE MONTREAL QC', 6.58, { date: '2026-11-20' }),
  ], 'statement'));
  assert.deepEqual(kinds(rows), [['dup', false], ['new', true]]);
  assert.equal(rows[0].dup.id, 'n1');
  assert.equal(rows[1].dup, null);
});

test('one screenshot row explains only one of two statement rows', () => {
  const state = freshState();
  const rows = review(state,
    batch('shot', [row('Nuage Cafe', 6.58, { date: '2026-11-20' })]),
    batch('stmt', [row('NUAGE CAFE', 6.58, { date: '2026-11-20' }), row('NUAGE CAFE', 6.58, { date: '2026-11-20' })], 'statement'));
  assert.deepEqual(kinds(rows), [['new', true], ['dup', false], ['new', true]]);
  assert.equal(rows[1].dup.id, rows[0].key);

  // Two and two: both statement rows are flagged, each against its own screenshot row.
  const two = review(state,
    batch('shot', [row('Nuage Cafe', 6.58, { date: '2026-11-20' }), row('Nuage Cafe', 6.58, { date: '2026-11-20' })]),
    batch('stmt', [row('NUAGE CAFE', 6.58, { date: '2026-11-20' }), row('NUAGE CAFE', 6.58, { date: '2026-11-20' })], 'statement'));
  assert.deepEqual(kinds(two), [['new', true], ['new', true], ['dup', false], ['dup', false]]);
  assert.deepEqual(two.slice(2).map(r => r.dup.id), [two[0].key, two[1].key]);
});

test('one saved pay explains only one of two deposits in the same file', () => {
  const state = freshState(); // pay $1,300 logged Nov 6
  const rows = review(state, batch('stmt', [
    cheq('DIRECT DEPOSIT', 1300, { direction: 'in', date: '2026-11-06' }),
    cheq('BOBINO PAYROLL', 1300, { direction: 'in', date: '2026-11-07' }),
  ], 'statement'));
  assert.deepEqual(kinds(rows), [['dup', false], ['pay', true]]);
  assert.equal(rows[0].dup.id, 'p-nov6');
});

test('Oct 31 applied, then the same rows from a screenshot and a statement: all 8 expenses are flagged', () => {
  const state = freshState();
  applyImport(state, review(state, batch('shot1', oct31.rows)));
  const rows = review(state, batch('shot2', oct31.rows), batch('stmt', oct31.rows, 'statement'));
  const expenses = rows.filter(r => r.kind === 'expense');
  assert.equal(expenses.length, 8);
  assert.ok(expenses.every(r => r.status === 'dup' && r.ticked === false));
  assert.deepEqual(expenses.slice(0, 4).map(r => r.dup.type), ['tx', 'tx', 'tx', 'tx']);
  assert.deepEqual(expenses.slice(4).map(r => r.dup.type), ['row', 'row', 'row', 'row']);
  assert.deepEqual(applyImport(state, rows), { expenses: 0, pays: 0, bills: 0, total: 0, skipped: 0 });
});

test('a bill charged in a screenshot and on the statement ticks the bill once', () => {
  const state = freshState();
  const rows = review(state,
    batch('shot', [row('Netflix', 27.11, { date: '2026-11-16' })]),
    batch('stmt', [row('NETFLIX.COM', 27.11, { date: '2026-11-16' })], 'statement'));
  assert.deepEqual(kinds(rows), [['bill', true], ['dup', false]]);
  assert.equal(rows[1].dup.type, 'row');
  assert.deepEqual(applyImport(state, rows), { expenses: 0, pays: 0, bills: 1, total: 0, skipped: 0 });
  assert.equal(state.months['2026-11'].paid['b-netflix@2026-11-16'], true);
});

test('a refund is never a duplicate of a purchase of the same amount', () => {
  const state = freshState(); // Costco $182.40 bought Nov 2
  const r = review(state, batch('stmt', [row('COSTCO WHOLESALE W1234', 182.40, { date: '2026-11-03', direction: 'in' })], 'statement'))[0];
  assert.equal(r.kind, 'refund');
  assert.equal(r.dup, null);
  assert.equal(r.status, 'refund');
});

/* ---------- dates: year end and daylight saving ---------- */

test('the 3 day window crosses the year end', () => {
  const state = freshState();
  addTx(state, { id: 'y1', date: '2026-12-30', item: 'i-groc', amt: 50, note: 'Maxi' });
  const at = date => review(state, batch('x', [row('MAXI & CIE', 50, { date })]))[0].status;
  assert.equal(at('2027-01-02'), 'dup');
  assert.equal(at('2027-01-03'), 'new');
});

test('a bill charged on Dec 31 ticks the January occurrence in the January month', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [row('SPOTIFY P1A2B3', 14.44, { date: '2026-12-31' })], 'statement'));
  assert.equal(rows[0].billMatch.key, 'b-spot@2027-01-06');
  applyImport(state, rows);
  assert.deepEqual(state.months['2027-01'].paid, { 'b-spot@2027-01-06': true });
  assert.equal(peekMonth(state, '2026-12').paid['b-spot@2026-12-06'], undefined);
});

test('the duplicate window and bill occurrences hold across daylight saving changes (Toronto)', () => {
  const lib = new URL('../lib/', import.meta.url).href;
  const code = `
    const { buildReview } = await import('${lib}importer.js');
    const { matchBill } = await import('${lib}merchants.js');
    const items = [{ id: 'g', name: 'G', items: [{ id: 'i-groc', name: 'Groceries', limit: 0 }] }];
    const state = { budget: items, months: {
      '2026-10': { tx: [{ id: 'd1', date: '2026-10-30', item: 'i-groc', amt: 50, note: 'Maxi' }] },
      '2026-03': { tx: [{ id: 'd2', date: '2026-03-06', item: 'i-groc', amt: 50, note: 'Maxi' }] } },
      bills: [{ id: 'gym', name: 'Gym (ABC)', amt: 31.58, freq: 'biweekly', anchor: '2026-09-03' }] };
    const r = date => ({ date, time: null, merchant: 'MAXI', amount: 50, direction: 'out', account: 'visa', raw: '' });
    const rows = buildReview(state, [{ fileId: 'x', src: 'statement', rows: [r('2026-11-02'), r('2026-11-03'), r('2026-03-09'), r('2026-03-10')] }]);
    const gym = matchBill(state, { date: '2026-11-13', merchant: 'ABC 3843-AF', amount: 31.58, direction: 'out' });
    console.log(JSON.stringify({ s: rows.map(x => x.status), gym: gym.key }));`;
  for (const TZ of ['America/Toronto', 'Australia/Lord_Howe']) {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { s: ['dup', 'new', 'dup', 'new'], gym: 'gym@2026-11-12' }, TZ);
  }
});

/* ---------- category picks ---------- */

test('a category pick on a Visa payment changes nothing and is not remembered', () => {
  const state = freshState();
  const rows = review(state, batch('shot', oct31.rows));
  const pay = rows.find(r => r.merchant === 'Payment');
  const next = setCategory(state, rows, pay.key, 'i-groc');
  assert.deepEqual(next.find(r => r.key === pay.key), pay);
  assert.deepEqual(next.memory, {});
  const res = applyImport(state, next);
  assert.equal(res.total, 158.27); // the 4 purchases only, no Groceries refund of $100
  assert.equal(state.merchantMap, undefined);
});

test('a category pick on a pay row is his override: it becomes a refund in that category', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [cheq('GST CREDIT CANADA', 80, { direction: 'in', date: '2026-11-20' })], 'statement'));
  assert.equal(rows[0].kind, 'income');
  const next = setCategory(state, rows, rows[0].key, 'i-errors');
  assert.deepEqual([next[0].kind, next[0].status, next[0].ticked, next[0].itemId], ['refund', 'refund', true, 'i-errors']);
  assert.deepEqual(applyImport(state, next), { expenses: 1, pays: 0, bills: 0, total: -80, skipped: 0 });
});

test('setCategory never changes the rows it was given', () => {
  const state = freshState();
  const rows = review(state, batch('a', [row('BOUTIQUE XYZ', 25), row('APPLE.COM/BILL', 129.99, { date: '2026-11-03' })]),
    batch('b', [row('BOUTIQUE XYZ', 25, { date: '2026-11-15' })]));
  const frozen = canonical(rows);
  setCategory(state, rows, rows[0].key, 'i-cloth');
  setCategory(state, rows, rows[1].key, 'i-toys');
  setCategory(state, rows, rows[0].key, null);
  assert.equal(canonical(rows), frozen);
});

/* ---------- applying ---------- */

test('applyImport money: refunds are negative, the total is exact in cents', () => {
  const state = freshState();
  let rows = review(state, batch('stmt', [
    row('NUAGE CAFE', 0.1, { date: '2026-12-01' }),
    row('NUAGE CAFE', 0.2, { date: '2026-12-01' }),
    row('COSTCO WHOLESALE', 182.40, { date: '2026-12-02' }),
    row('COSTCO WHOLESALE', 25.05, { date: '2026-12-03', direction: 'in' }),
    row('BOUTIQUE XYZ', 19.99, { date: '2026-12-04', direction: 'in' }), // a Visa credit, needs a category
  ], 'statement'));
  assert.equal(rows[4].kind, 'refund');
  assert.throws(() => applyImport(state, rows), err => err.count === 1);
  rows = setCategory(state, rows, rows[4].key, 'i-cloth');
  const res = applyImport(state, rows);
  assert.deepEqual(res, { expenses: 5, pays: 0, bills: 0, total: 137.66, skipped: 0 });
  assert.deepEqual(state.months['2026-12'].tx.map(t => t.amt), [0.1, 0.2, 182.4, -25.05, -19.99]);
});

test('applyImport writes exactly the spec fields for a tx, and for a pay the spec fields plus kind', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [
    row('SQ *NUAGE CAFE #12 MONTREAL QC', 6.58, { date: '2026-11-25' }),
    cheq('INTERAC E-TRANSFER FROM KYLIE', 40, { direction: 'in', date: '2026-11-25' }),
  ], 'statement'));
  applyImport(state, rows);
  const tx = state.months['2026-11'].tx.at(-1);
  assert.deepEqual(Object.keys(tx).sort(), ['account', 'amt', 'date', 'fp', 'id', 'item', 'merchant', 'note', 'src']);
  assert.deepEqual({ ...tx, id: 'x' }, {
    id: 'x', date: '2026-11-25', item: 'i-coffee', amt: 6.58, note: 'Nuage Cafe', src: 'statement',
    fp: '658|nuage cafe', merchant: 'SQ *NUAGE CAFE #12 MONTREAL QC', account: 'visa',
  });
  const pay = state.months['2026-11'].pays.at(-1);
  assert.deepEqual({ ...pay, id: 'x' }, { id: 'x', date: '2026-11-25', amt: 40, hours: null, note: 'Interac transfer from Kylie', kind: 'income' });
});

test('applyImport refuses a ticked row whose category was deleted, before changing anything', () => {
  const state = freshState();
  const rows = review(state, batch('a', [row('NUAGE CAFE', 6.58), row('BELL CANADA', 90.83, { date: '2026-11-18' })]));
  state.budget[0].items = state.budget[0].items.filter(i => i.id !== 'i-coffee');
  const before = canonical(state);
  assert.throws(() => applyImport(state, rows), { message: '1 row needs a category' });
  assert.equal(canonical(state), before);
});

test('v1 shapes: months with missing lists, tx with no merchant, src or fp, and unknown fields kept', () => {
  const sample = freshState();
  const state = {
    budget: sample.budget,
    bills: sample.bills,
    months: {
      '2026-10': null,
      '2026-11': { tx: [{ id: 'a', date: '2026-11-13', item: 'i-groc', amt: 182.40, keepMe: 1 }], fromB: { x: 1 } },
      '2026-09': { pays: [{ id: 'p', date: '2026-09-30', amt: 1300 }] },
    },
    buildB: { keep: true },
  };
  const rows = review(state, batch('stmt', [
    row('COSTCO', 182.40, { date: '2026-11-14' }),
    row('NUAGE CAFE', 6.58, { date: '2026-11-14' }),
    cheq('PAYROLL', 1300, { direction: 'in', date: '2026-10-02' }),
    row('NETFLIX.COM', 27.11, { date: '2026-11-16' }),
  ], 'statement'));
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.dup && r.dup.id]), [
    ['expense', 'dup', 'a'], ['expense', 'new', null], ['pay', 'dup', 'p'], ['bill', 'bill', null],
  ]);
  const res = applyImport(state, rows);
  assert.deepEqual(res, { expenses: 1, pays: 0, bills: 1, total: 6.58, skipped: 0 });
  assert.deepEqual(state.buildB, { keep: true });
  assert.deepEqual(state.months['2026-11'].fromB, { x: 1 });
  assert.equal(state.months['2026-11'].tx[0].keepMe, 1);
  assert.equal(state.months['2026-10'], null);
  assert.equal(state.months['2026-11'].paid['b-netflix@2026-11-16'], true);
});

test('findDuplicate does not change the row it is given', () => {
  const state = freshState();
  const r = row('COSTCO WHOLESALE W1234', 182.40, { date: '2026-11-03' });
  const copy = clone(r);
  assert.equal(findDuplicate(state, r).id, 't1');
  assert.deepEqual(r, copy);
});

/* ---------- status and UI text ---------- */

test('status, ticked and statusText agree on a mixed review, and no UI text has a dash', () => {
  const state = freshState();
  addTx(state, {
    id: 'c1', date: '2026-11-10', item: 'i-coffee', amt: 4.25, src: 'statement', account: 'chequing',
    note: 'Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS',
    merchant: 'Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1',
  });
  state.bills.push({ id: 'b-dash', name: 'Hydro - Quebec', amt: 61.20, freq: 'monthly', day: 12, note: '' });
  const rows = review(state,
    batch('shot', oct31.rows),
    batch('cheq', [
      cheq('Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1', 4.25, { date: '2026-11-10' }),
      cheq('BOBINO PAYROLL', 1300, { direction: 'in', date: '2026-11-20' }),
      cheq('E-TRANSFER RECEIVED Kylie', 40, { direction: 'in', date: '2026-11-21' }),
      cheq('HYDRO QUEBEC', 61.20, { date: '2026-11-12' }),
      row('COSTCO WHOLESALE W1234', 25, { direction: 'in', date: '2026-11-22' }),
    ], 'statement'));
  const tickedBy = { new: true, pay: true, income: true, bill: true, refund: true, dup: false, notspending: false };
  for (const r of rows) {
    assert.equal(r.ticked, tickedBy[r.status], `${r.merchant} ${r.status}`);
    assert.equal(hasDash(r.statusText), false, r.statusText);
  }
  const tim = rows.find(r => r.merchant.startsWith('Point of Sale'));
  assert.equal(tim.statusText, 'Possible duplicate of Point of Sale Interac RETAIL PURCHASE 000001234567 TIM HORTONS $4.25 on Nov 10');
  assert.equal(rows.find(r => r.merchant === 'HYDRO QUEBEC').statusText, 'Ticks Hydro Quebec paid');
});

/* ---------- CSV ---------- */

test('CSV dates are always valid YYYY-MM-DD: leap days checked, odd years refused', () => {
  const { rows, skipped } = parseCSV([
    '2028-02-29,LEAP,1.00,',
    '02/29/2028,LEAP US,1.00,',
    '2026-02-29,NOT LEAP,1.00,',
    '0999-01-01,OLD,1.00,',
    '12/31/2026,YEAR END,1.00,',
  ].join('\n'));
  assert.deepEqual(rows.map(r => r.date), ['2028-02-29', '2028-02-29', '2026-12-31']);
  assert.ok(rows.every(r => isISODate(r.date)));
  assert.deepEqual(skipped, [{ line: 3, reason: 'The date is not valid' }, { line: 4, reason: 'The date is not valid' }]);
});

test('CSV quoted fields: doubled quotes at the end and quoted amounts', () => {
  const { rows, skipped } = parseCSV('"2026-11-03","SAQ ""EXPRESS""","45.10","","4500********1234"');
  assert.deepEqual(skipped, []);
  assert.deepEqual([rows[0].merchant, rows[0].amount, rows[0].direction, rows[0].account], ['SAQ "EXPRESS"', 45.1, 'out', 'visa']);
});

test('CSV amounts are exact cents', () => {
  const amounts = parseCSV(['0.1', '0.2', '182.40', '1,234.56', '89.43'].map(a => `2026-11-01,A,"${a}",`).join('\n')).rows.map(r => r.amount);
  assert.deepEqual(amounts, [0.1, 0.2, 182.4, 1234.56, 89.43]);
});

/* ---------- dates that are not real dates ---------- */

test('applyImport leaves out and counts ticked rows whose date is not a real date', () => {
  const state = freshState();
  const rows = review(state, batch('shot', [
    row('NUAGE CAFE', 6.58, { date: '2026-11-20' }),
    row('NUAGE CAFE', 4.10, { date: '2026-02-30' }),
    row('TIM HORTONS', 3.45, { date: '2026-13-01' }),
    row('TIM HORTONS', 2.15, { date: '2026-11-5' }),
    row('BOUTIQUE XYZ', 25, { date: '' }), // no category either: it is left out, so it does not block the import
    cheq('BOBINO PAYROLL', 1300, { direction: 'in', date: '2026-11-31' }),
    cheq('E-TRANSFER RECEIVED Kylie', 40, { direction: 'in', date: null }),
    row('Payment', 100, { date: 'Nov 31', direction: 'in' }), // not spending: never applied, never counted
  ]));
  assert.ok(rows.slice(0, 7).every(r => r.ticked), 'all ticked in the review');
  const before = clone(state);
  const res = applyImport(state, rows);
  assert.deepEqual(res, { expenses: 1, pays: 0, bills: 0, total: 6.58, skipped: 6 });
  assert.deepEqual(Object.keys(state.months).sort(), ['2026-10', '2026-11'], 'no month made from a bad date');
  assert.deepEqual(state.months['2026-11'].pays, before.months['2026-11'].pays);
  const added = state.months['2026-11'].tx.slice(before.months['2026-11'].tx.length);
  assert.deepEqual(added.map(t => [t.date, t.amt]), [['2026-11-20', 6.58]]);
  for (const m of Object.values(state.months)) for (const t of [...m.tx, ...m.pays]) assert.ok(isISODate(t.date), t.date);
  // A ticked row with a real date and no category still blocks the import.
  const blocked = review(freshState(), batch('shot', [row('BOUTIQUE XYZ', 25, { date: '2026-11-20' }), row('BOUTIQUE XYZ', 25, { date: '2026-11-31' })]));
  assert.throws(() => applyImport(freshState(), blocked), { message: '1 row needs a category' });
});

/* ---------- pays say whether they are a paycheque ---------- */

test('imported pays carry kind: pay for a Bobino paycheque, income for any other money in', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [
    cheq('BOBINO PAYROLL', 1300, { direction: 'in', date: '2026-11-20' }),
    cheq('E-TRANSFER RECEIVED Kylie', 40, { direction: 'in', date: '2026-11-21' }),
    cheq('Internet Banking E-TRANSFER 105372806372 Kylie', 25, { direction: 'in', date: '2026-11-22' }),
    cheq('GST CREDIT CANADA', 80, { direction: 'in', date: '2026-11-23' }),
    cheq('Electronic Funds Transfer PAY BOBINO INC', 1300, { direction: 'in', date: '2026-12-04' }),
  ], 'statement'));
  assert.deepEqual(rows.map(r => r.kind), ['pay', 'income', 'income', 'income', 'pay']);
  assert.equal(applyImport(state, rows).pays, 5);
  const pays = [...state.months['2026-11'].pays, ...state.months['2026-12'].pays];
  assert.deepEqual(pays.map(p => [p.date, p.amt, p.note, p.kind]), [
    ['2026-11-06', 1300, '', undefined], // logged by hand before: left exactly as it was
    ['2026-11-20', 1300, 'Bobino pay', 'pay'],
    ['2026-11-21', 40, 'Interac transfer from Kylie', 'income'],
    ['2026-11-22', 25, 'Interac transfer from Kylie', 'income'],
    ['2026-11-23', 80, 'Gst Credit Canada', 'income'],
    ['2026-12-04', 1300, 'Bobino pay', 'pay'],
  ]);
  assert.equal('kind' in pays[0], false);
});

/* ---------- a CIBC chequing statement end to end ---------- */

test('a CIBC chequing statement: notes without bank text, refunds stay refunds, transfers stay not spending', () => {
  const state = freshState();
  state.months['2026-11'].paid = {};
  const csv = [
    '2026-11-24,Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1,4.25,',
    '2026-11-24,Point of Sale - Visa Debit RETAIL PURCHASE 000007654321 SQ *NUAGE CAFE,6.58,',
    '2026-11-25,Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESAL,,20.00',
    '2026-11-25,Point of Sale - Interac RETAIL REFUND 000001234567 BOUTIQUE XYZ,,15.00',
    '2026-11-26,Internet Banking INTERNET BILL PAY 000000156789 CIBC VISA,500.00,',
    '2026-11-26,Internet Banking INTERNET TRANSFER 000000123456,200.00,',
    '2026-11-27,Internet Banking E-TRANSFER 105372806372 Kylie,,40.00',
    '2026-11-18,Electronic Funds Transfer PREAUTHORIZED DEBIT BELL CANADA,90.83,',
  ].join('\r\n');
  const parsed = parseCSV(csv);
  assert.deepEqual(parsed.skipped, []);
  assert.ok(parsed.rows.every(r => r.account === 'chequing'));
  let rows = review(state, batch('cheq.csv', parsed.rows, 'statement'));
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.ticked]), [
    ['expense', 'new', true], ['expense', 'new', true], ['refund', 'refund', true], ['refund', 'refund', true],
    ['notspending', 'notspending', false], ['notspending', 'notspending', false], ['income', 'income', true], ['bill', 'bill', true],
  ]);
  assert.deepEqual(rows.map(r => r.note), ['Tim Hortons', 'Nuage Cafe', 'Costco Wholesal', 'Boutique Xyz', 'Cibc Visa',
    'Internet Transfer 000000123456', 'Interac transfer from Kylie', 'Bell Canada']);
  assert.equal(rows[7].statusText, 'Ticks Phone + Crave/Disney (Bell) paid');
  for (const r of rows) assert.equal(hasDash(r.note) || hasDash(r.statusText), false, r.merchant);

  rows = setCategory(state, rows, rows[3].key, 'i-cloth');
  const res = applyImport(state, rows);
  assert.deepEqual(res, { expenses: 4, pays: 1, bills: 1, total: -24.17, skipped: 0 });
  const tx = state.months['2026-11'].tx.slice(-4);
  assert.deepEqual(tx.map(t => [t.note, t.amt, t.item, t.fp, t.account]), [
    ['Tim Hortons', 4.25, 'i-coffee', '425|tim hortons', 'chequing'],
    ['Nuage Cafe', 6.58, 'i-coffee', '658|nuage cafe', 'chequing'],
    ['Costco Wholesal', -20, 'i-groc', '2000|costco wholesal', 'chequing'],
    ['Boutique Xyz', -15, 'i-cloth', '1500|boutique xyz', 'chequing'],
  ]);
  assert.equal(tx[0].merchant, 'Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1', 'the raw text is kept as read');
  assert.deepEqual(state.months['2026-11'].pays.at(-1).kind, 'income');
  assert.equal(state.months['2026-11'].paid['b-phone@2026-11-18'], true);
  assert.deepEqual(state.merchantMap, { 'boutique xyz': 'i-cloth' });

  // The same statement again: the purchases and refunds are duplicates of what was just saved.
  const again = review(state, batch('cheq2.csv', parseCSV(csv).rows, 'statement'));
  assert.deepEqual(again.slice(0, 4).map(r => r.status), ['dup', 'dup', 'dup', 'dup']);
  assert.equal(again[0].statusText, 'Possible duplicate of Tim Hortons $4.25 on Nov 24');
});
