import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReview, setCategory, applyImport, findDuplicate, memoryOf } from '../lib/importer.js';
import { parseCSV } from '../lib/csv.js';
import { canonical, clone, peekMonth } from '../lib/core.js';
import oct31, { expect as oct31Expect } from './fixtures/oct31.js';
import { visa, chequing } from './fixtures/statement-sample.js';
import { freshState, row, batch, itemName, addTx, hasDash } from './helpers/import-helpers.js';

const review = (state, ...batches) => buildReview(state, batches, { today: '2026-11-14' });
const one = (state, r, src = 'statement') => review(state, batch('f1', [r], src))[0];

/* ---------- Stage 1 acceptance: CIBC Visa notifications, Oct 31 2026 ---------- */

test('Oct 31 acceptance: 6 rows, 4 ticked expenses, both Payments not spending', () => {
  const state = freshState();
  const rows = review(state, batch('shot1', oct31.rows));

  assert.equal(rows.length, oct31Expect.shown);
  const ticked = rows.filter(r => r.ticked);
  assert.deepEqual(ticked.map(r => r.merchant), oct31Expect.ticked);
  assert.ok(ticked.every(r => r.kind === 'expense' && r.status === 'new' && r.catSource === 'rule'));
  for (const r of ticked) assert.equal(itemName(state, r.itemId), oct31Expect.categories[r.merchant], r.merchant);

  const payments = rows.filter(r => r.merchant === 'Payment');
  assert.equal(payments.length, oct31Expect.notSpending);
  assert.ok(payments.every(r => r.status === 'notspending' && r.ticked === false && r.statusText === 'Not spending'));
  assert.deepEqual(payments.map(r => r.time), ['13:02', null]); // the one with its time cut off is still there

  // Activities rows offer the one tap switch to Dates with Kylie.
  const act = rows.filter(r => itemName(state, r.itemId) === 'Activities');
  assert.equal(act.length, 2);
  assert.ok(act.every(r => r.altItemId === 'i-kylie'));
  assert.ok(rows.filter(r => itemName(state, r.itemId) !== 'Activities').every(r => r.altItemId === null));

  // Every review row carries the documented fields.
  for (const k of ['key', 'fileId', 'src', 'date', 'time', 'merchant', 'norm', 'amount', 'direction', 'account', 'raw',
    'kind', 'itemId', 'catSource', 'billMatch', 'dup', 'ticked', 'status', 'statusText']) {
    assert.ok(rows.every(r => k in r), k);
  }
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length);
});

test('Oct 31 acceptance: apply, then importing the same rows again flags all 4 expenses', () => {
  const state = freshState();
  const first = review(state, batch('shot1', oct31.rows));
  const res = applyImport(state, first);
  assert.deepEqual(res, { expenses: 4, pays: 0, bills: 0, total: 158.27, skipped: 0 });

  const oct = peekMonth(state, '2026-10');
  assert.equal(oct.tx.length, 4);
  assert.deepEqual(oct.tx.map(t => [t.note, t.amt, t.item, t.src, t.account, t.merchant, t.fp]), [
    ['Nuage Cafe', 6.58, 'i-coffee', 'screenshot', 'visa', 'Nuage Cafe', '658|nuage cafe'],
    ['Sammi & Soupe Dumpling', 100.63, 'i-eat', 'screenshot', 'visa', 'Sammi & Soupe Dumpling', '10063|sammi soupe dumpling'],
    ['EPLV Billetterie Bio', 38, 'i-act', 'screenshot', 'visa', 'EPLV Billetterie Bio', '3800|eplv billetterie bio'],
    ['Espace Vego Biodome', 13.06, 'i-act', 'screenshot', 'visa', 'Espace Vego Biodome', '1306|espace vego biodome'],
  ]);
  assert.ok(oct.tx.every(t => t.date === '2026-10-31' && typeof t.id === 'string' && t.id));
  assert.equal(oct.pays.length, 2); // the two October pays from the fixture, untouched

  const again = review(state, batch('shot2', oct31.rows));
  assert.equal(again.length, 6);
  const expenses = again.filter(r => r.kind === 'expense');
  assert.equal(expenses.length, 4);
  assert.ok(expenses.every(r => r.status === 'dup' && r.ticked === false && r.dup.type === 'tx'));
  assert.equal(expenses[0].statusText, 'Possible duplicate of Nuage Cafe $6.58 on Oct 31');
  assert.equal(expenses[2].statusText, 'Possible duplicate of EPLV Billetterie Bio $38 on Oct 31');
  assert.ok(again.filter(r => r.merchant === 'Payment').every(r => r.status === 'notspending' && r.dup === null));

  // Ticking nothing changes nothing.
  const before = canonical(state);
  assert.deepEqual(applyImport(state, again), { expenses: 0, pays: 0, bills: 0, total: 0, skipped: 0 });
  assert.equal(canonical(state), before);
});

/* ---------- duplicates ---------- */

test('a manual entry and the statement line for the same purchase are duplicates', () => {
  const state = freshState();
  // t1 in the sample is a v1 manual tx: Costco $182.40 on Nov 2, no merchant field.
  const r = one(state, row('COSTCO WHOLESALE W1234', 182.40, { date: '2026-11-03' }));
  assert.equal(r.status, 'dup');
  assert.equal(r.ticked, false);
  assert.deepEqual(r.dup, { type: 'tx', id: 't1', date: '2026-11-02', merchant: 'Costco', amt: 182.40, src: 'manual' });
  assert.equal(r.statusText, 'Possible duplicate of Costco $182.40 on Nov 2');

  // Same with v2 fields filled in (src manual, merchant from the note).
  const v2 = freshState();
  v2.months['2026-11'].tx = [];
  addTx(v2, { id: 'm1', date: '2026-11-02', item: 'i-groc', amt: 182.40, note: 'Costco', src: 'manual' });
  assert.equal(findDuplicate(v2, { ...row('COSTCO WHOLESALE W1234', 182.40, { date: '2026-11-03' }), kind: 'expense' }, []).id, 'm1');
});

test('a saved statement tx is matched by its merchant, and a different store is not a duplicate', () => {
  const state = freshState();
  addTx(state, { id: 's1', date: '2026-11-20', item: 'i-groc', amt: 54.10, note: 'Maxi', merchant: 'MAXI & CIE #8812', src: 'statement', account: 'visa' });
  assert.equal(one(state, row('MAXI & CIE #8812 LAVAL QC', 54.10, { date: '2026-11-21' })).dup.id, 's1');
  assert.equal(one(state, row('PROVIGO', 54.10, { date: '2026-11-21' })).dup, null);
  assert.equal(one(state, row('MAXI & CIE', 54.11, { date: '2026-11-21' })).dup, null);
});

test('a saved tx with no merchant or note matches on amount and dates alone', () => {
  const state = freshState();
  // t5: Dates with Kylie $120 on Nov 8, no note.
  const r = one(state, row('RESTAURANT LE BONHEUR', 120, { date: '2026-11-09' }));
  assert.equal(r.dup.id, 't5');
  assert.equal(r.statusText, 'Possible duplicate of Dates with Kylie $120 on Nov 8');
});

test('the 3 day window: 3 days is a duplicate, 4 days is not', () => {
  const state = freshState(); // Costco $182.40 saved on Nov 2
  const at = date => one(state, row('COSTCO WHOLESALE', 182.40, { date })).status;
  assert.equal(at('2026-11-05'), 'dup');
  assert.equal(at('2026-11-06'), 'new');
  assert.equal(at('2026-10-30'), 'dup');
  assert.equal(at('2026-10-29'), 'new');

  // The same window between files in one review.
  const s = freshState();
  const pair = date => review(s, batch('a', [row('NUAGE CAFE', 6.58, { date: '2026-11-20' })]), batch('b', [row('Nuage Cafe', 6.58, { date })]))[1].status;
  assert.equal(pair('2026-11-23'), 'dup');
  assert.equal(pair('2026-11-24'), 'new');
});

test('the same purchase in a screenshot and a statement in one review: the later one is flagged', () => {
  const state = freshState();
  const rows = review(state,
    batch('shot', [row('Nuage Cafe', 6.58, { date: '2026-11-20', time: '09:41' })], 'screenshot'),
    batch('stmt', [row('NUAGE CAFE MONTREAL QC', 6.58, { date: '2026-11-21' })], 'statement'));
  assert.equal(rows[0].status, 'new');
  assert.equal(rows[0].ticked, true);
  assert.equal(rows[1].status, 'dup');
  assert.equal(rows[1].ticked, false);
  assert.deepEqual(rows[1].dup, { type: 'row', id: rows[0].key, date: '2026-11-20', merchant: 'Nuage Cafe', amt: 6.58, src: 'screenshot' });
  assert.equal(rows[1].statusText, 'Possible duplicate of Nuage Cafe $6.58 on Nov 20');
});

test('two identical rows from the same file are both kept', () => {
  const state = freshState();
  const same = row('Nuage Cafe', 6.58, { date: '2026-11-20' });
  const rows = review(state, batch('shot', [same, { ...same }]));
  assert.deepEqual(rows.map(r => [r.status, r.ticked, r.dup]), [['new', true, null], ['new', true, null]]);
  assert.equal(applyImport(state, rows).expenses, 2);
});

test('pay rows are checked against saved pays by amount and dates only', () => {
  const state = freshState(); // pay $1,300 logged Nov 6
  const r = one(state, row('DIRECT DEPOSIT', 1300, { date: '2026-11-07', direction: 'in', account: 'chequing' }));
  assert.equal(r.kind, 'pay');
  assert.equal(r.status, 'dup');
  assert.deepEqual(r.dup, { type: 'pay', id: 'p-nov6', date: '2026-11-06', merchant: 'Bobino pay', amt: 1300, src: null });
  const later = one(state, row('BOBINO PAYROLL', 1300, { date: '2026-11-20', direction: 'in', account: 'chequing' }));
  assert.equal(later.status, 'pay');
  assert.equal(later.ticked, true);
  assert.equal(later.statusText, 'Goes to Paycheques');
  // A pay never matches an expense of the same amount.
  assert.equal(one(state, row('COSTCO', 1300, { date: '2026-11-06' })).dup, null);
});

test('findDuplicate classifies a plain reader row itself', () => {
  const state = freshState();
  const d = findDuplicate(state, row('COSTCO WHOLESALE W1234', 182.40, { date: '2026-11-02' }));
  assert.equal(d.id, 't1');
  assert.equal(findDuplicate(state, row('Payment', 182.40, { date: '2026-11-02', direction: 'in' })), null);
});

/* ---------- bills ---------- */

test('a statement line matching a bill within 5% ticks that bill for its month', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [
    row('NETFLIX.COM', 27.11, { date: '2026-11-15' }),
    row('BELL CANADA', 90.83, { date: '2026-11-18', account: 'chequing' }),
    row('BELL CANADA', 89.43, { date: '2026-11-21', account: 'chequing' }),
  ], 'statement'));
  assert.deepEqual(rows.map(r => [r.status, r.ticked, r.statusText]), [
    ['bill', true, 'Ticks Netflix paid'],
    ['bill', true, 'Ticks Phone + Crave/Disney (Bell) paid'],
    ['bill', true, 'Ticks Internet (Bell) paid'],
  ]);
  assert.equal(rows[0].billMatch.key, 'b-netflix@2026-11-16');

  const res = applyImport(state, rows);
  assert.deepEqual(res, { expenses: 0, pays: 0, bills: 3, total: 0, skipped: 0 });
  const paid = state.months['2026-11'].paid;
  assert.equal(paid['b-netflix@2026-11-16'], true);
  assert.equal(paid['b-phone@2026-11-18'], true);
  assert.equal(paid['b-net@2026-11-22'], true);
  assert.equal(state.months['2026-11'].tx.length, 8); // no expense added for a bill
});

test('a bill charged at the end of the month ticks the occurrence in the next month', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [row('SPOTIFY P1A2B3', 14.44, { date: '2026-11-30' })]));
  applyImport(state, rows);
  assert.equal(state.months['2026-12'].paid['b-spot@2026-12-06'], true);
  assert.equal(state.months['2026-11'].paid['b-spot@2026-11-06'], true); // already there in the sample
});

test('a bill row whose occurrence is already ticked is a duplicate', () => {
  const state = freshState(); // Spotify Nov 6 and Gym Nov 12 are ticked in the sample
  const rows = review(state, batch('stmt', [
    row('SPOTIFY P1A2B3', 14.44, { date: '2026-11-06' }),
    row('ABC 3843-AF', 31.58, { date: '2026-11-13' }),
    row('ABC 3843-AF', 31.58, { date: '2026-11-25' }),
  ]));
  assert.equal(rows[0].status, 'dup');
  assert.deepEqual(rows[0].dup, { type: 'bill', id: 'b-spot', date: '2026-11-06', merchant: 'Spotify', amt: 14.44, src: null });
  assert.equal(rows[0].statusText, 'Possible duplicate of Spotify $14.44 on Nov 6');
  assert.equal(rows[1].status, 'dup');
  assert.equal(rows[1].dup.date, '2026-11-12');
  assert.equal(rows[2].status, 'bill'); // Nov 26 is not ticked yet
  assert.equal(rows[2].billMatch.key, 'b-gym@2026-11-26');
});

test('Claude Max at a different price still ticks the bill, with the difference on the row', () => {
  const state = freshState();
  state.months['2026-11'].paid = {};
  const r = one(state, row('ANTHROPIC', 139.84, { date: '2026-11-04' }));
  assert.equal(r.status, 'bill');
  assert.equal(r.statusText, 'Ticks Claude Max paid');
  assert.equal(r.billMatch.diffPct, 39.84);
  assert.equal(r.billMatch.billAmt, 100);
});

/* ---------- categories ---------- */

test('applyImport throws when a ticked expense has no category, and changes nothing', () => {
  const state = freshState();
  const rows = review(state, batch('shot', [row('BOUTIQUE XYZ', 25), row('NUAGE CAFE', 6.58), row('AMZN MKTP', 40)]));
  assert.equal(rows[0].itemId, null);
  assert.equal(rows[0].status, 'new');
  const before = canonical(state);
  assert.throws(() => applyImport(state, rows), err => err.message === '2 rows need a category' && err.count === 2);
  assert.equal(canonical(state), before);

  // Unticked rows without a category are fine.
  const unticked = rows.map(r => (r.itemId ? r : { ...r, ticked: false }));
  assert.equal(applyImport(state, unticked).expenses, 1);
  const single = review(freshState(), batch('shot', [row('BOUTIQUE XYZ', 25)]));
  assert.throws(() => applyImport(freshState(), single), { message: '1 row needs a category' });
});

test('setCategory fills the row, remembers the merchant and fills same merchant rows without a category', () => {
  const state = freshState();
  const rows = review(state,
    batch('a', [row('BOUTIQUE XYZ', 25, { date: '2026-11-20' }), row('NUAGE CAFE', 6.58)]),
    batch('b', [row('BOUTIQUE XYZ #12', 30, { date: '2026-11-21' }), row('BOUTIQUE ABC', 10)]));
  const frozen = JSON.stringify(rows);

  const next = setCategory(state, rows, rows[0].key, 'i-cloth');
  assert.equal(JSON.stringify(rows), frozen, 'the old rows are not changed');
  assert.notEqual(next, rows);
  assert.equal(next[0].itemId, 'i-cloth');
  assert.equal(next[0].catSource, 'user');
  assert.equal(next[2].itemId, 'i-cloth', 'same normalized merchant in another file');
  assert.equal(next[1].itemId, 'i-coffee', 'a rule category is left alone');
  assert.equal(next[3].itemId, null, 'a different merchant is left alone');
  assert.deepEqual(next.memory, { 'boutique xyz': 'i-cloth' });
  assert.equal(next.rows, next);
  assert.deepEqual(memoryOf(next), next.memory);
  assert.equal(Object.keys(next).length, 4, 'memory and rows are not enumerable');

  // A row he picked himself is not overwritten by a later pick on its twin; the latest pick is remembered.
  const picked = setCategory(state, next, next[2].key, 'i-errors');
  assert.equal(picked[2].itemId, 'i-errors');
  assert.equal(picked[0].itemId, 'i-cloth');
  assert.deepEqual(picked.memory, { 'boutique xyz': 'i-errors' });

  const withAbc = setCategory(state, picked, picked[3].key, 'i-toys');
  const res = applyImport(state, withAbc, withAbc.memory);
  assert.equal(res.expenses, 4);
  assert.equal(res.total, 71.58);
  assert.deepEqual(state.merchantMap, { 'boutique xyz': 'i-errors', 'boutique abc': 'i-toys' });

  // Next time the merchant comes back already categorized from memory.
  const later = review(state, batch('c', [row('BOUTIQUE XYZ', 12, { date: '2026-12-02' })]))[0];
  assert.equal(later.itemId, 'i-errors');
  assert.equal(later.catSource, 'memory');
});

test('applyImport takes the memory from the rows when none is passed', () => {
  const state = freshState();
  const rows = setCategory(state, review(state, batch('a', [row('BOUTIQUE XYZ', 25)])), 'f0r0', 'i-cloth');
  applyImport(state, [...rows]); // a plain copy of the array still carries the picks on its rows
  assert.deepEqual(state.merchantMap, { 'boutique xyz': 'i-cloth' });
});

test('the Dates with Kylie switch changes only that row and is not remembered', () => {
  const state = freshState();
  const rows = review(state, batch('shot1', oct31.rows));
  const eplv = rows[3];
  const switched = setCategory(state, rows, eplv.key, eplv.altItemId);
  assert.equal(switched[3].itemId, 'i-kylie');
  assert.equal(switched[3].altItemId, 'i-act', 'one more tap switches back');
  assert.equal(switched[4].itemId, 'i-act', 'the other Activities row stays');
  assert.deepEqual(switched.memory, {});
  const back = setCategory(state, switched, eplv.key, switched[3].altItemId);
  assert.equal(back[3].itemId, 'i-act');
  assert.equal(back[3].altItemId, 'i-kylie');

  applyImport(state, switched);
  assert.equal(state.months['2026-10'].tx.find(t => t.note === 'EPLV Billetterie Bio').item, 'i-kylie');
  assert.equal(state.merchantMap, undefined, 'nothing to remember, the v1 doc gets no new field');
});

test('picking a category on a bill row turns it into an expense', () => {
  const state = freshState();
  state.months['2026-11'].paid = {};
  const rows = review(state, batch('stmt', [row('APPLE.COM/BILL', 129.99, { date: '2026-11-03' })]));
  assert.equal(rows[0].kind, 'bill');
  const next = setCategory(state, rows, rows[0].key, 'i-toys');
  assert.deepEqual([next[0].kind, next[0].status, next[0].ticked, next[0].billMatch, next[0].statusText], ['expense', 'new', true, null, '']);
  const res = applyImport(state, next);
  assert.deepEqual(res, { expenses: 1, pays: 0, bills: 0, total: 129.99, skipped: 0 });
  assert.deepEqual(state.months['2026-11'].paid, {});
});

test('clearing a category', () => {
  const state = freshState();
  const rows = review(state, batch('a', [row('NUAGE CAFE', 6.58)]));
  const cleared = setCategory(state, rows, rows[0].key, null);
  assert.equal(cleared[0].itemId, null);
  assert.equal(cleared[0].catSource, null);
  assert.equal(setCategory(state, rows, 'nope', 'i-toys')[0], rows[0]);
});

/* ---------- pays, income, refunds ---------- */

test('pays, Interac income and Visa refunds are applied with the right notes and signs', () => {
  const state = freshState();
  const rows = review(state, batch('stmt', [
    row('BOBINO PAYROLL', 1300, { date: '2026-11-20', direction: 'in', account: 'chequing' }),
    row('E-TRANSFER RECEIVED Kylie', 40, { date: '2026-11-21', direction: 'in', account: 'chequing' }),
    row('COSTCO WHOLESALE W1234', 25, { date: '2026-11-22', direction: 'in', account: 'visa' }),
    row('PAYMENT THANK YOU/PAIEMENT MERCI', 500, { date: '2026-11-22', direction: 'in', account: 'visa' }),
  ], 'statement'));
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.ticked, r.statusText]), [
    ['pay', 'pay', true, 'Goes to Paycheques'],
    ['income', 'income', true, 'Income'],
    ['refund', 'refund', true, 'Refund'],
    ['notspending', 'notspending', false, 'Not spending'],
  ]);
  // Even ticked by hand, a Visa payment is never applied.
  rows[3] = { ...rows[3], ticked: true };

  const res = applyImport(state, rows);
  assert.deepEqual(res, { expenses: 1, pays: 2, bills: 0, total: -25, skipped: 0 });
  const nov = state.months['2026-11'];
  assert.deepEqual(nov.pays.slice(1).map(p => [p.date, p.amt, p.hours, p.note, p.kind]), [
    ['2026-11-20', 1300, null, 'Bobino pay', 'pay'],
    ['2026-11-21', 40, null, 'Interac transfer from Kylie', 'income'],
  ]);
  const refund = nov.tx.at(-1);
  assert.deepEqual([refund.amt, refund.item, refund.src, refund.fp, refund.account], [-25, 'i-groc', 'statement', '2500|costco wholesale w1234', 'visa']);

  // The refund is found again as a duplicate of the negative tx, not of a purchase.
  const again = one(state, row('COSTCO WHOLESALE W1234', 25, { date: '2026-11-22', direction: 'in', account: 'visa' }));
  assert.equal(again.dup.amt, -25);
  assert.equal(again.statusText, 'Possible duplicate of Costco Wholesale W1234 $25 on Nov 22');
});

/* ---------- CSV to review ---------- */

test('CSV statements go through the same review', () => {
  const state = freshState();
  state.months['2026-11'].paid = {};
  const rows = review(state,
    batch('visa.csv', parseCSV(visa).rows, 'statement'),
    batch('cheq.csv', parseCSV(chequing).rows, 'statement'));
  const by = m => rows.filter(r => r.merchant === m).map(r => r.status);
  assert.deepEqual(by('COSTCO WHOLESALE W1234 MONTREAL, QC'), ['dup']); // the manual Costco entry of Nov 2
  assert.deepEqual(by('TIM HORTONS #2231'), ['new']);
  assert.deepEqual(by('PAYMENT THANK YOU/PAIEMENT MERCI'), ['notspending']);
  assert.deepEqual(by('BOB "THE" DUMPLING, BAR'), ['new']);
  assert.deepEqual(by('NETFLIX.COM'), ['bill']);
  assert.deepEqual(by('COSTCO WHOLESALE W1234'), ['refund']);
  assert.deepEqual(by('BOBINO PAYROLL'), ['dup']); // the Nov 6 pay is already logged
  assert.deepEqual(by('INTERNET TRANSFER 000000123456'), ['notspending']);
  assert.deepEqual(by('E-TRANSFER RECEIVED Kylie'), ['income']);
  assert.deepEqual(by('BELL CANADA'), ['bill', 'bill']);
  assert.deepEqual(rows.filter(r => r.merchant === 'BELL CANADA').map(r => r.billMatch.billId), ['b-net', 'b-phone']);
  assert.ok(rows.every(r => r.src === 'statement'));
  for (const r of rows) assert.equal(hasDash(r.statusText), false, r.statusText);
});

test('buildReview does not change state', () => {
  const state = freshState();
  const before = canonical(state);
  review(state, batch('shot1', oct31.rows), batch('visa.csv', parseCSV(visa).rows, 'statement'));
  assert.equal(canonical(state), before);
  assert.deepEqual(clone(state), freshState());
});
