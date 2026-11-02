// Reviewer tests for lib/money.js, lib/migrate.js and lib/labels.js (SPEC 3, 4, 5.1 to 5.3, 11).
// Every expected number here is worked out by hand from the spec, not read back from the code.
// Safe to spend follows the pay period (SPEC 5.3 updated): pool = income - spending - billsTotal - olderTotal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthTotals, nextPay, payPeriod, safeToSpend } from '../lib/money.js';
import { migrate, defaults } from '../lib/migrate.js';
import { label, noteFor, txName } from '../lib/labels.js';
import { clone, getMonth, addDays, monthOf } from '../lib/core.js';
import sample, { expect } from './fixtures/sample-nov.js';
import period3, { expect as P3 } from './fixtures/sample-period3.js';

// His time zone (Montreal). Canada falls back on Nov 1 2026 and springs forward on Mar 14 2027.
// node --test runs each file in its own process, so this does not leak into other test files.
process.env.TZ = 'America/Toronto';

const ZONES = ['UTC', 'America/Toronto', 'America/St_Johns', 'America/Vancouver', 'Europe/London', 'Australia/Lord_Howe', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
function inZones(fn) {
  const was = process.env.TZ;
  try { for (const z of ZONES) { process.env.TZ = z; fn(z); } } finally { process.env.TZ = was; }
}

const pay = (id, date, amt = 1300) => ({ id, date, amt, hours: null, note: '' });
const withPays = (state, dates, amt = 1300) => { for (const d of dates) getMonth(state, monthOf(d)).pays.push(pay('p' + d, d, amt)); return state; };
const tick = (state, billId, date, bucket = monthOf(date)) => { getMonth(state, bucket).paid[billId + '@' + date] = true; return state; };
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
// Day number that does not depend on the time zone, to check date maths independently of lib/core.js.
const dayNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const ids = list => list.map(b => [b.billId, b.date]);

/* ---------- 5.3 acceptance, in every zone ---------- */

test('the three acceptance checks give the same numbers in every time zone', () => {
  inZones(z => {
    for (const s of [clone(sample), migrate(sample)]) {
      // 1. Nov 14: (1300 - 647 - 163.96) / 6 = 81.50 -> 81
      const r = safeToSpend(s, expect.today);
      assert.deepEqual([r.perDay, r.pool, r.days], [81, 489.04, 6], z);
      assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-19' }, z);
      assert.deepEqual(r.nextPay, { date: expect.nextPay, estimate: true, lastPay: '2026-11-06' }, z);
      assert.deepEqual([r.parts.income, r.parts.spending, r.parts.billsTotal, r.parts.olderTotal], [1300, 647, 163.96, 0], z);
      assert.deepEqual(ids(r.parts.billsInPeriod), [['b-spot', '2026-11-06'], ['b-gym', '2026-11-12'], ['b-netflix', '2026-11-16'], ['b-phone', '2026-11-18']], z);

      // 2. Same day, $1,200 spent since Nov 6: 1300 - 1200 - 163.96 = -63.96 -> 0
      const over = clone(s);
      getMonth(over, '2026-11').tx.push({ id: 'x', date: '2026-11-14', item: 'i-groc', amt: 553, note: '' });
      const r2 = safeToSpend(over, expect.today);
      assert.deepEqual([r2.perDay, r2.pool, r2.days, r2.parts.spending], [0, -63.96, 6, 1200], z);
    }
    // 3. Nov 30 and Dec 1: 1300 - 300 - 803.10 = 196.90; / 4 = 49.22 -> 49; / 3 = 65.63 -> 65
    for (const s of [clone(period3), migrate(period3)]) {
      for (const [day, perDay, days] of [['2026-11-30', 49, 4], ['2026-12-01', 65, 3]]) {
        const r = safeToSpend(s, day);
        assert.deepEqual([r.perDay, r.pool, r.days], [perDay, 196.90, days], `${z} ${day}`);
        assert.deepEqual([r.perDay, r.pool, r.days], [P3.perDay[day], P3.pool, P3.days[day]], `${z} ${day}`);
        assert.deepEqual(r.period, P3.period, `${z} ${day}`);
        assert.deepEqual(r.nextPay, P3.nextPay, `${z} ${day}`);
        assert.equal(r.parts.billsTotal, 803.10, `${z} ${day}`);
        assert.deepEqual(r.parts.billsInPeriod.map(b => b.date), ['2026-11-22', '2026-11-26', '2026-12-01', '2026-12-01', '2026-12-03'], `${z} ${day}`);
      }
    }
  });
});

/* ---------- 5.2 next pay and pay period across daylight saving ---------- */

test('estimated next pay is the last pay plus a multiple of 14 days, always within the next 14 days', () => {
  const s = { bills: [], months: { '2026-09': { pays: [pay('p', '2026-09-04')] } } };
  inZones(z => {
    for (let today = '2026-09-04'; today < '2029-12-31'; today = addDays(today, 3)) {
      const np = nextPay(s, today);
      const gap = dayNum(np.date) - dayNum('2026-09-04');
      const ahead = dayNum(np.date) - dayNum(today);
      assert.ok(gap > 0 && gap % 14 === 0, `${z} ${today} -> ${np.date}`);
      assert.ok(ahead >= 1 && ahead <= 14, `${z} ${today} -> ${np.date}`);
      assert.equal(np.estimate, true);
      assert.equal(np.lastPay, '2026-09-04');
      const p = payPeriod(s, today);
      assert.equal(p.days, ahead, `${z} ${today}`);
      // the period starts on the last paycheque (the only one) and ends the day before next pay
      assert.deepEqual([p.start, dayNum(p.end)], ['2026-09-04', dayNum(np.date) - 1], `${z} ${today}`);
    }
  });
});


// Small state: rent on the 1st, a biweekly gym every 14 days from Oct 8 2026 (Oct 22, Nov 5, Nov 19, ... Mar 11, Mar 25).
const mini = () => migrate({
  bills: [
    { id: 'rent', name: 'Rent', amt: 500, freq: 'monthly', day: 1, note: '' },
    { id: 'gym', name: 'Gym', amt: 20, freq: 'biweekly', anchor: '2026-10-08', note: '' },
  ],
  months: {},
});

test('pay period across the fall time change (Nov 1 2026)', () => {
  const s = mini();
  withPays(s, ['2026-10-23']);
  tick(s, 'rent', '2026-10-01'); tick(s, 'gym', '2026-10-08'); tick(s, 'gym', '2026-10-22');
  getMonth(s, '2026-10').tx.push({ id: 't', date: '2026-10-25', item: 'x', amt: 40, note: 'Costco' });
  const r = safeToSpend(s, '2026-10-30');
  assert.deepEqual(r.nextPay, { date: '2026-11-06', estimate: true, lastPay: '2026-10-23' });
  assert.deepEqual(r.period, { start: '2026-10-23', end: '2026-11-05' });
  assert.equal(r.days, 7);
  assert.equal(r.parts.income, 1300);
  assert.equal(r.parts.spending, 40);
  assert.deepEqual(r.parts.billsInPeriod.map(b => [b.billId, b.date, b.amt, b.paid]), [['rent', '2026-11-01', 500, false], ['gym', '2026-11-05', 20, false]]);
  // Oct 22 (ticked) and everything before Oct 23, the first paycheque, are not owed by this page.
  assert.deepEqual(r.parts.olderUnpaid, []);
  assert.equal(r.pool, 740); // 1300 - 40 - 520
  assert.equal(r.perDay, 105); // 740 / 7 = 105.71
  // Nov 1 (the 1st, and the day the clocks change) moves nothing.
  const nov1 = safeToSpend(s, '2026-11-01');
  assert.deepEqual([nov1.pool, nov1.days, nov1.perDay], [740, 5, 148]);
});

test('pay period across the spring time change (Mar 14 2027)', () => {
  const s = mini();
  withPays(s, ['2027-03-05']);
  tick(s, 'rent', '2027-03-01');
  const r = safeToSpend(s, '2027-03-12');
  assert.deepEqual(r.nextPay, { date: '2027-03-19', estimate: true, lastPay: '2027-03-05' });
  assert.deepEqual(r.period, { start: '2027-03-05', end: '2027-03-18' });
  assert.equal(r.days, 7);
  assert.deepEqual(ids(r.parts.billsInPeriod), [['gym', '2027-03-11']]);
  assert.equal(r.pool, 1280); // 1300 - 20 (the Mar 1 rent is before the period and before the first paycheque)
  assert.equal(r.perDay, 182); // 1280 / 7 = 182.86
  // the day before pay, after the change: one day left, same pool
  const last = safeToSpend(s, '2027-03-18');
  assert.deepEqual([last.days, last.pool, last.perDay], [1, 1280, 1280]);
});

test('two logged future pays: the earliest is next, whatever the order they were saved in, and neither is income yet', () => {
  const s = { bills: [], months: { '2026-11': { pays: [pay('a', '2026-11-06'), pay('c', '2026-11-19', 1250), pay('b', '2026-11-18', 1200)] } } };
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.nextPay, { date: '2026-11-18', estimate: false, lastPay: '2026-11-06' });
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-17' });
  assert.equal(r.parts.income, 1300);
  assert.deepEqual(r.parts.pays.map(p => p.id), ['a']);
  assert.equal(r.days, 4);
  assert.equal(r.pool, 1300);
  assert.equal(r.perDay, 325);
});

test('pays with no usable date are not pay dates, and lastPay is the latest one even when saved out of order', () => {
  const s = { bills: [], months: {
    '2026-10': { pays: [pay('b', '2026-10-23'), pay('a', '2026-10-09'), { id: 'x', amt: 5, date: '' }] },
    '2026-11': { pays: [{ id: 'y', amt: 5, date: 'Nov 6' }] },
  } };
  assert.deepEqual(nextPay(s, '2026-10-30'), { date: '2026-11-06', estimate: true, lastPay: '2026-10-23' });
});

/* ---------- 5.3 safe to spend: rules and invariants ---------- */

// Sample plus a pay every 14 days from Nov 20, so every day from Nov 2026 to Apr 2027 has a pay period.
// Nov 20, Dec 4, Dec 18, Jan 1, Jan 15, Jan 29, Feb 12, Feb 26, Mar 12, Mar 26, Apr 9, Apr 23, May 7, May 21.
function yearOfPays() {
  const s = migrate(sample);
  const dates = [];
  for (let d = '2026-11-20'; d < '2027-06-01'; d = addDays(d, 14)) dates.push(d);
  return withPays(s, dates);
}

test('within one pay period the pool only moves when money comes in: the 1st of a month alone never changes it', () => {
  const s = yearOfPays();
  let firsts = 0, days = 0;
  for (let today = '2026-11-02'; today < '2027-05-01'; today = addDays(today, 1)) {
    const prev = safeToSpend(s, addDays(today, -1)), r = safeToSpend(s, today);
    if (r.period.start !== prev.period.start) continue; // payday: a new period
    assert.equal(r.pool, prev.pool, today);
    assert.deepEqual(r.parts, prev.parts, today);
    assert.equal(r.days, prev.days - 1, today);
    days++;
    if (today.endsWith('-01')) firsts++;
  }
  // Dec 1, Feb 1, Mar 1, Apr 1 (Jan 1 is a payday)
  assert.equal(firsts, 4);
  assert.ok(days > 150);
});

test('ticking a bill of the pay period never changes the pool or perDay (the money is counted once, paid or not)', () => {
  const s = yearOfPays();
  let checked = 0;
  for (let today = '2026-11-01'; today < '2027-05-01'; today = addDays(today, 2)) {
    const r = safeToSpend(s, today);
    for (const b of r.parts.billsInPeriod.filter(x => !x.paid)) {
      const r2 = safeToSpend(tick(clone(s), b.billId, b.date), today);
      assert.equal(r2.pool, r.pool, `${today} tick ${b.billId}@${b.date}`);
      assert.equal(r2.perDay, r.perDay, `${today} tick ${b.billId}@${b.date}`);
      assert.equal(r2.parts.billsTotal, r.parts.billsTotal);
      assert.equal(r2.parts.billsInPeriod.find(x => x.billId === b.billId && x.date === b.date).paid, true);
      checked++;
    }
  }
  assert.ok(checked > 300, String(checked));
});

test('ticking an older unpaid bill takes exactly its amount off what is owed', () => {
  const s = yearOfPays();
  let checked = 0;
  for (let today = '2026-11-20'; today < '2027-05-01'; today = addDays(today, 3)) {
    const r = safeToSpend(s, today);
    for (const b of r.parts.olderUnpaid) {
      assert.ok(b.date < r.period.start && b.date >= addDays(r.period.start, -62) && b.date >= '2026-10-09', `${today} ${b.billId}@${b.date}`);
      const r2 = safeToSpend(tick(clone(s), b.billId, b.date), today);
      assert.equal(Math.round((r2.pool - r.pool) * 100), Math.round(b.amt * 100), `${today} tick ${b.billId}@${b.date}`);
      assert.ok(!r2.parts.olderUnpaid.some(x => x.billId === b.billId && x.date === b.date));
      checked++;
    }
  }
  assert.ok(checked > 100, String(checked));
});

test('an expense lowers the pool by exactly its amount, a refund raises it, Visa and chequing alike', () => {
  const s = yearOfPays();
  for (let today = '2026-11-01'; today < '2027-05-01'; today = addDays(today, 5)) {
    const base = safeToSpend(s, today).pool;
    const t = clone(s);
    getMonth(t, monthOf(today)).tx.push(
      { id: 'v', date: today, item: 'i-eat', amt: 50, note: 'Resto', account: 'visa' },
      { id: 'c', date: today, item: 'i-gas', amt: 30.07, note: 'Esso', account: 'chequing' },
      { id: 'r', date: today, item: 'i-groc', amt: -10.02, note: 'Costco refund', account: 'visa' },
    );
    const r = safeToSpend(t, today);
    assert.equal(Math.round((base - r.pool) * 100), 7005, today); // 50 + 30.07 - 10.02
  }
});

test('a purchase counts in the period of its date, whichever month it is saved in or falls in', () => {
  // Period Nov 20 to Dec 3 (sample + Nov 20 pay). Purchases on Nov 19, Nov 20, Dec 1, Dec 3 and Dec 4.
  const s = withPays(migrate(sample), ['2026-11-20']);
  for (const [id, date, amt] of [['a', '2026-11-19', 1], ['b', '2026-11-20', 2], ['c', '2026-12-01', 4], ['d', '2026-12-03', 8], ['e', '2026-12-04', 16]]) {
    getMonth(s, monthOf(date)).tx.push({ id, date, item: 'i-groc', amt, note: '' });
  }
  // today Nov 22, before the December ones: they still count (planned, future dated): 2 + 4 + 8 = 14
  assert.equal(safeToSpend(s, '2026-11-22').parts.spending, 14);
  assert.equal(safeToSpend(s, '2026-12-02').parts.spending, 14);
  // Nov 19 is the last day of the period before (Nov 6 to Nov 19): 647 + 1
  assert.equal(safeToSpend(s, '2026-11-19').parts.spending, 648);
});

test('the pool is exact to the cent and perDay is floored on whole cents (no float drift)', () => {
  // 8.29 - 0.29 is 7.999999999999999 in plain floats; the pool must be 8 and perDay 8, not 7.
  const s = { bills: [], months: { '2026-11': { pays: [pay('p', '2026-11-06', 8.29)], tx: [{ id: 't', date: '2026-11-07', item: 'x', amt: 0.29, note: '' }] } } };
  const r = safeToSpend(s, '2026-11-19');
  assert.equal(r.days, 1);
  assert.equal(r.pool, 8);
  assert.equal(r.perDay, 8);
  // ten 0.10 expenses are exactly 1.00
  const t = { bills: [], months: { '2026-11': { pays: [pay('p', '2026-11-06', 100)], tx: Array.from({ length: 10 }, (_, i) => ({ id: 'x' + i, date: '2026-11-07', item: 'x', amt: 0.1, note: '' })) } } };
  const r2 = safeToSpend(t, '2026-11-14');
  assert.equal(r2.parts.spending, 1);
  assert.equal(r2.pool, 99);
  assert.equal(r2.perDay, 16); // 99 / 6 = 16.5, floored
});

test('perDay is floored, never rounded up, and never negative', () => {
  const at = (amt, today) => safeToSpend({ bills: [], months: { '2026-11': { pays: [pay('p', '2026-11-06', amt)] } } }, today);
  assert.equal(at(13.99, '2026-11-19').perDay, 13); // 1 day
  assert.equal(at(41.99, '2026-11-17').perDay, 13); // 3 days, 13.996
  assert.equal(at(0.99, '2026-11-19').perDay, 0);
  assert.equal(at(0, '2026-11-19').perDay, 0);
  assert.equal(at(0.01, '2026-11-19').pool, 0.01);
  assert.equal(at(-50, '2026-11-19').perDay, 0); // a negative pay (a correction) still never gives a negative day
  const s = yearOfPays();
  getMonth(s, '2026-12').tx.push({ id: 'big', date: '2026-12-05', item: 'i-groc', amt: 5000, note: '' });
  for (let today = '2026-11-01'; today < '2027-05-01'; today = addDays(today, 1)) {
    const r = safeToSpend(s, today);
    assert.ok(Number.isInteger(r.perDay) && r.perDay >= 0, today);
    if (r.pool <= 0) assert.equal(r.perDay, 0, today);
  }
});

test('year boundary: a Jan 1 bill is in the period when pay is Jan 2, and its tick only counts in the 2027-01 month', () => {
  const s = migrate({ bills: [{ id: 'rent', name: 'Rent', amt: 500, freq: 'monthly', day: 1, note: '' }], months: {} });
  withPays(s, ['2026-12-19']);
  tick(s, 'rent', '2026-12-01');
  const r = safeToSpend(s, '2026-12-30');
  assert.deepEqual(r.nextPay, { date: '2027-01-02', estimate: true, lastPay: '2026-12-19' });
  assert.deepEqual(r.period, { start: '2026-12-19', end: '2027-01-01' });
  assert.equal(r.days, 3);
  assert.deepEqual(r.parts.billsInPeriod, [{ billId: 'rent', name: 'Rent', date: '2027-01-01', amt: 500, paid: false }]);
  assert.deepEqual(r.parts.olderUnpaid, []); // Dec 1 is before the first paycheque (and ticked anyway)
  assert.equal(r.pool, 800); // 1300 - 500
  assert.equal(r.perDay, 266); // 800 / 3 = 266.67
  // a tick saved in the wrong month does not count (spec: check paid in the occurrence's own month)
  const wrong = tick(clone(s), 'rent', '2027-01-01', '2026-12');
  assert.equal(safeToSpend(wrong, '2026-12-30').parts.billsInPeriod[0].paid, false);
  // ticked in its own month: paid, and the pool stays the same
  const right = tick(clone(s), 'rent', '2027-01-01');
  const r2 = safeToSpend(right, '2026-12-30');
  assert.equal(r2.parts.billsInPeriod[0].paid, true);
  assert.equal(r2.pool, 800);
});

test('a bill on the 31st is due on the last day of short months, including Feb 29 in a leap year', () => {
  const end = { id: 'end', name: 'End of month', amt: 10, freq: 'monthly', day: 31, note: '' };
  const s1 = withPays(migrate({ bills: [end], months: {} }), ['2027-02-19']);
  const r1 = safeToSpend(s1, '2027-02-27');
  assert.equal(r1.nextPay.date, '2027-03-05');
  assert.equal(r1.days, 6);
  assert.deepEqual(r1.parts.billsInPeriod.map(b => b.date), ['2027-02-28']);
  assert.equal(r1.perDay, 215); // (1300 - 10) / 6
  const s2 = withPays(migrate({ bills: [end], months: {} }), ['2028-02-18']);
  const r2 = safeToSpend(s2, '2028-02-27');
  assert.equal(r2.nextPay.date, '2028-03-03');
  assert.equal(r2.days, 5);
  assert.deepEqual(r2.parts.billsInPeriod.map(b => b.date), ['2028-02-29']);
  assert.equal(r2.perDay, 258); // 1290 / 5
});

test('a biweekly bill twice in one long pay period that crosses into December', () => {
  const s = withPays(migrate(sample), ['2026-12-11']); // a logged future pay: it wins over the Nov 20 estimate
  const r = safeToSpend(s, '2026-11-25');
  assert.deepEqual(r.nextPay, { date: '2026-12-11', estimate: false, lastPay: '2026-11-06' });
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-12-10' });
  assert.equal(r.days, 16);
  assert.deepEqual(r.parts.billsInPeriod.filter(b => b.billId === 'b-gym').map(b => b.date), ['2026-11-12', '2026-11-26', '2026-12-10']);
  assert.equal(r.parts.billsInPeriod.length, 12);
  // 163.96 (Nov 6 to 19) + Internet 89.43 + Gym 31.58 + Rent 587.50 + Parking 90 + iCloud 4.59 + Claude 100
  // + Spotify 14.44 + Gym 31.58 = 163.96 + 949.12 = 1113.08
  assert.equal(r.parts.billsTotal, 1113.08);
  assert.equal(r.parts.income, 1300);
  assert.equal(r.parts.spending, 647);
  assert.equal(r.pool, -460.08); // 1300 - 647 - 1113.08
  assert.equal(r.perDay, 0);
});

test('a bill with no date that was ticked counts as paid in the month, and never in safe to spend', () => {
  const s = tick(migrate(sample), 'b-manga', '2026-11-??', '2026-11');
  assert.equal(monthTotals(s, '2026-11').paid, 833.75); // 828.11 + 5.64
  const r = safeToSpend(s, '2026-11-14');
  assert.equal(r.pool, 489.04);
  assert.ok(![...r.parts.billsInPeriod, ...r.parts.olderUnpaid].some(b => b.billId === 'b-manga'));
});

test('income counts every pay from the period start, even when the period began last month', () => {
  // Paid Oct 30; today Nov 2. The old month rule saw $0 here; the period rule sees the Oct 30 pay.
  const s = { bills: [], months: { '2026-10': { pays: [pay('p', '2026-10-30')] } } };
  const r = safeToSpend(s, '2026-11-02');
  assert.deepEqual(r.nextPay, { date: '2026-11-13', estimate: true, lastPay: '2026-10-30' });
  assert.deepEqual(r.period, { start: '2026-10-30', end: '2026-11-12' });
  assert.equal(r.days, 11);
  assert.equal(r.parts.income, 1300);
  assert.equal(r.pool, 1300);
  assert.equal(r.perDay, 118); // 1300 / 11 = 118.18
});

test('sparse v1 months (no paid, no moves, tx without src, fp or merchant) work raw and migrated', () => {
  const doc = { bills: clone(sample.bills), budget: clone(sample.budget), months: {
    '2026-10': { pays: [pay('p', '2026-10-23')] },
    '2026-11': { tx: [{ id: 't', date: '2026-11-02', item: 'i-groc', amt: 10, note: '' }] },
  } };
  for (const s of [doc, migrate(doc)]) {
    const r = safeToSpend(s, '2026-11-03');
    assert.deepEqual(r.nextPay, { date: '2026-11-06', estimate: true, lastPay: '2026-10-23' });
    assert.deepEqual(r.period, { start: '2026-10-23', end: '2026-11-05' });
    assert.equal(r.days, 3);
    assert.equal(r.parts.income, 1300);
    assert.equal(r.parts.spending, 10);
    // Gym 31.58 (Oct 29) + Rent 587.50 + Parking 90 (Nov 1) + iCloud 4.59 (Nov 3) + Claude Max 100 (Nov 4) = 813.67
    assert.deepEqual(r.parts.billsInPeriod.map(b => b.billId), ['b-gym', 'b-rent', 'b-park', 'b-icloud', 'b-claude']);
    assert.equal(r.parts.billsTotal, 813.67);
    assert.deepEqual(r.parts.olderUnpaid, []); // nothing before Oct 23, the only paycheque
    assert.equal(r.pool, 476.33); // 1300 - 10 - 813.67
    assert.equal(r.perDay, 158); // 476.33 / 3 = 158.78
    assert.deepEqual(monthTotals(s, '2026-11'), { earned: 0, billsTotal: 1072.70, paid: 0, spent: 10, left: -1082.70 });
  }
});

test('monthTotals: refunds lower spent, string amounts count, left ignores what is ticked', () => {
  const s = migrate(sample);
  s.months['2026-11'].tx.push(
    { id: 'r', date: '2026-11-13', item: 'i-groc', amt: -20, note: 'Refund' },
    { id: 's', date: '2026-11-13', item: 'i-groc', amt: '5.55', note: '' },
  );
  const t = monthTotals(s, '2026-11');
  assert.equal(t.spent, 632.55); // 647 - 20 + 5.55
  assert.equal(t.left, -405.25); // 1300 - 1072.70 - 632.55
  assert.equal(t.paid, 828.11);
});

test('nothing reads or writes outside: every money function works on a deep frozen state', () => {
  const s = deepFreeze(withPays(clone(sample), ['2026-11-20']));
  const before = JSON.stringify(s);
  for (const today of ['2026-10-08', '2026-11-01', '2026-11-14', '2026-11-28', '2026-12-31', '2027-03-20']) {
    assert.doesNotThrow(() => { monthTotals(s, monthOf(today)); nextPay(s, today); payPeriod(s, today); safeToSpend(s, today); }, today);
  }
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.months['2027-03'], undefined);
});

/* ---------- 3. migrate ---------- */

test('migrate fills null like ?? does, and keeps falsy values that are set', () => {
  const out = migrate({
    settings: { payPlan: 1300, visaDueDay: null, chequing: { bal: 0, asOf: null } },
    merchantMap: null, note: null,
    months: { '2026-11': {
      paid: null, pays: null, moves: null,
      tx: [
        { id: 'a', date: '2026-11-02', item: 'i', amt: 2.5, note: 'Tim Hortons', src: null, merchant: null, fp: null, account: null },
        { id: 'b', date: '2026-11-03', item: 'i', amt: 10, note: 'Costco', merchant: '' },
      ],
    }, '2026-12': { tx: null } },
  });
  assert.equal(out.settings.visaDueDay, null);
  assert.deepEqual(out.settings.chequing, { bal: 0, asOf: null });
  assert.deepEqual(out.merchantMap, {});
  assert.equal(out.note, '');
  const m = out.months['2026-11'];
  assert.deepEqual([m.paid, m.pays, m.moves], [{}, [], []]);
  assert.deepEqual(out.months['2026-12'].tx, []);
  assert.deepEqual(m.tx[0], { id: 'a', date: '2026-11-02', item: 'i', amt: 2.5, note: 'Tim Hortons', src: 'manual', merchant: 'Tim Hortons', fp: '250|tim hortons', account: null });
  // merchant '' is set, so it stays '' (it is not replaced by the note)
  assert.equal(m.tx[1].merchant, '');
  assert.equal(m.tx[1].fp, '1000|');
});

test('migrate: a refund fingerprint uses the absolute amount and the amount stays negative', () => {
  const out = migrate({ months: { '2026-11': { tx: [{ id: 'r', date: '2026-11-05', item: 'i', amt: -20, note: 'Costco' }] } } });
  assert.equal(out.months['2026-11'].tx[0].fp, '2000|costco');
  assert.equal(out.months['2026-11'].tx[0].amt, -20);
});

test('migrate keeps unknown values of every kind exactly, including null, false, 0 and empty strings', () => {
  const doc = clone(sample);
  doc.extraList = [1, null, { a: false }];
  doc.settings.chequing = { bal: 420, asOf: '2026-11-10', src: 'b' };
  doc.bills[1].count = 0;
  doc.budget[1].items[0].hidden = false;
  doc.accounts[0].memo = '';
  doc.goals[0].links = [];
  const nov = doc.months['2026-11'];
  nov.memo = '';
  nov.paid['b-spot@2026-11-06'] = 'yes';
  nov.tx[0].meta = { a: { b: [1, { c: null }] } };
  nov.tx[0].extra = null;
  nov.pays[0].bonus = 0;
  nov.moves = [{ id: 'm', date: '2026-11-10', from: 'a', to: 'b', amt: 5, why: null }];
  const out = migrate(doc);
  for (const [path, get] of Object.entries({
    extraList: d => d.extraList, chequing: d => d.settings.chequing, billCount: d => d.bills[1].count,
    hidden: d => d.budget[1].items[0].hidden, memo: d => d.accounts[0].memo, links: d => d.goals[0].links,
    monthMemo: d => d.months['2026-11'].memo, paidValue: d => d.months['2026-11'].paid['b-spot@2026-11-06'],
    meta: d => d.months['2026-11'].tx[0].meta, extra: d => d.months['2026-11'].tx[0].extra,
    bonus: d => d.months['2026-11'].pays[0].bonus, move: d => d.months['2026-11'].moves[0],
  })) assert.deepEqual(get(out), get(doc), path);
  assert.ok('extra' in out.months['2026-11'].tx[0]);
});

test('migrate output survives a save and reload unchanged (no undefined values, stable through JSON)', () => {
  for (const d of [sample, defaults(), {}, { version: 7, months: { '2026-11': { tx: [{ id: 't', amt: 1 }] } } }]) {
    const out = migrate(d);
    const reloaded = JSON.parse(JSON.stringify(out));
    assert.deepEqual(reloaded, out);
    assert.deepEqual(migrate(reloaded), out);
  }
});

test('migrate works on a deep frozen doc and returns something that can be edited', () => {
  const doc = deepFreeze(clone(sample));
  const out = migrate(doc);
  assert.doesNotThrow(() => { out.months['2026-11'].tx.push({ id: 'n' }); out.settings.payPlan = 1; getMonth(out, '2027-01'); });
});

test('a newer version keeps its number and still gets every default', () => {
  const out = migrate({ version: 7, months: { '2026-11': { tx: [{ id: 't', amt: 3, note: 'Nuage' }] } } });
  assert.equal(out.version, 7);
  assert.deepEqual(out.settings, { payPlan: 1300, visaDueDay: null, chequing: { bal: null, asOf: null } });
  assert.deepEqual(out.merchantMap, {});
  assert.equal(out.note, '');
  assert.deepEqual(out.months['2026-11'].tx[0], { id: 't', amt: 3, note: 'Nuage', src: 'manual', merchant: 'Nuage', account: null, fp: '300|nuage' });
});

test('a fresh install (defaults) gives sensible money numbers and asks for a pay', () => {
  const d = defaults();
  assert.deepEqual(monthTotals(d, '2026-11'), { earned: 0, billsTotal: 1072.70, paid: 0, spent: 0, left: -1072.70 });
  assert.equal(nextPay(d, '2026-11-14'), null);
  assert.equal(payPeriod(d, '2026-11-14'), null);
  assert.deepEqual(safeToSpend(d, '2026-11-14'), { missing: 'pay' });
});

/* ---------- 4. labels ---------- */

test('restore labels use his local day and time, not UTC', () => {
  // 20:20 UTC is 3:20 p.m. in Montreal in November (UTC-5) and 4:20 p.m. in October (UTC-4)
  assert.equal(label('restoreVersion', { savedAt: '2026-11-14T20:20:00.000Z' }), 'Restored the version from Nov 14, 3:20 p.m.');
  assert.equal(label('restoreVersion', { savedAt: '2026-10-14T20:20:00.000Z' }), 'Restored the version from Oct 14, 4:20 p.m.');
  // after midnight UTC it is still the evening before in Montreal
  assert.equal(label('restoreVersion', { savedAt: '2026-11-15T03:30:00.000Z' }), 'Restored the version from Nov 14, 10:30 p.m.');
  assert.equal(label('restoreBackup', { savedAt: '2026-11-01T02:00:00.000Z' }), 'Restored backup from Oct 31');
  // a plain date is never shifted by the time zone
  inZones(z => assert.equal(label('restoreBackup', { date: '2026-11-01' }), 'Restored backup from Nov 1', z));
});

test('no label has a dash; a minus sign only appears right before an amount', () => {
  const at = '2026-11-14T20:20:00.000Z';
  const details = [{}, { name: 'Costco', amt: -20.5 }, { name: 'Costco', amt: 182.4 }, { amt: -0.01 }, { name: 'X', limit: 0 },
    { name: 'X', limit: -5 }, { name: 'X', bal: -640 }, { name: 'X', add: -50 }, { day: 22 }, { day: 0 }, { bal: null }, { savedAt: at },
    { date: '2026-11-01' }, { expenses: 4, pays: 1, bills: 2 }, { amt: 40, from: 'Volleyball', to: 'Groceries' }, { label: 'Deleted Costco $182.40' }];
  const kinds = ['addTx', 'editTx', 'deleteTx', 'tickBill', 'untickBill', 'addBill', 'editBill', 'deleteBill', 'addItem', 'editItem', 'deleteItem',
    'limit', 'addGroup', 'editGroup', 'deleteGroup', 'addPay', 'editPay', 'deletePay', 'account', 'jar', 'payPlan', 'import', 'move', 'raise',
    'restoreBackup', 'restoreVersion', 'undo', 'visaDue', 'chequing', 'somethingElse'];
  for (const k of kinds) for (const d of details) {
    const s = label(k, d);
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 0, k);
    assert.doesNotMatch(s, /[‐-―]| - /, `${k}: ${s}`);
    assert.doesNotMatch(s, /-(?!\$)/, `${k}: ${s}`);
    assert.match(s, /^[A-Z]/, `sentence case ${k}: ${s}`);
  }
});

test('labels for every spec table example', () => {
  assert.equal(label('addTx', { name: 'Costco', amt: 182.40 }), 'Added Costco $182.40');
  assert.equal(label('tickBill', { name: 'Netflix', onTime: true }), 'Ticked Netflix paid on time');
  assert.equal(label('addBill', { name: 'Spotify' }), 'Added bill Spotify');
  assert.equal(label('limit', { name: 'Groceries', limit: 480 }), 'Changed Groceries limit to $480');
  assert.equal(label('addPay', { amt: 1300 }), 'Logged pay $1,300');
  assert.equal(label('account', { name: 'Chequing', bal: 420 }), 'Updated Chequing to $420');
  assert.equal(label('jar', { name: 'Hiver 2027 cushion', add: 200 }), 'Added $200 to Hiver 2027 cushion');
  assert.equal(label('payPlan', { amt: 1300 }), 'Planned pay set to $1,300');
  assert.equal(label('import', { expenses: 4, pays: 1 }), 'Imported 4 expenses and 1 pay');
  assert.equal(label('move', { amt: 40, from: 'Volleyball', to: 'Groceries' }), 'Moved $40 Volleyball → Groceries');
  assert.equal(label('raise', { name: 'Groceries', newLimit: 480 }), 'Raised Groceries limit to $480');
  assert.equal(label('restoreBackup', { date: '2026-11-01' }), 'Restored backup from Nov 1');
  assert.equal(label('undo', { label: 'Deleted Costco $182.40' }), 'Undid "Deleted Costco $182.40"');
  assert.equal(label('visaDue', { day: 22 }), 'Visa due day set to the 22nd');
  assert.equal(label('chequing', { bal: 420 }), 'Chequing balance set to $420');
});

test('labels: float noise never reaches the text, and an import result from applyImport works as is', () => {
  assert.equal(label('addTx', { name: 'Costco', amt: 0.1 + 0.2 }), 'Added Costco $0.30');
  assert.equal(label('jar', { name: 'Hiver 2027 cushion', add: 0.1 + 0.2 }), 'Added $0.30 to Hiver 2027 cushion');
  assert.equal(label('addPay', { amt: 1299.999 }), 'Logged pay $1,300');
  assert.equal(label('import', { expenses: 4, pays: 0, bills: 2, total: 158.27 }), 'Imported 4 expenses and ticked 2 bills paid');
});

test('undo takes the action object the sync engine records', () => {
  const action = { id: 'a1', label: 'Ticked Netflix paid', ops: [], before: {}, after: {} };
  assert.equal(label('undo', action), 'Undid "Ticked Netflix paid"');
  assert.equal(noteFor([label('addTx', { name: 'Costco', amt: 182.4 }), label('tickBill', { name: 'Netflix', onTime: true }), label('addPay', { amt: 1300 })]),
    'Added Costco $182.40 and 2 more changes');
});

test('txName on raw v1 tx from his data shape', () => {
  const nov = sample.months['2026-11'];
  assert.equal(txName(sample, nov.tx[0]), 'Costco');
  assert.equal(txName(sample, nov.tx[4]), 'Dates with Kylie'); // no note
  assert.equal(label('deleteTx', { state: sample, tx: nov.tx[4] }), 'Deleted Dates with Kylie $120');
});


/* ---------- cross module (lib/core.js, not owned here) ---------- */

// lib/core.js billOccurrences steps a biweekly bill in calendar days, so the fall and spring clock changes can never
// drop an occurrence on the 1st or the last day of a month.
test('a biweekly bill on Nov 1 2026, right after the fall time change, is in the period', () => {
  // Every 14 days from Oct 18: Oct 4, Oct 18, Nov 1, Nov 15, Nov 29. Paycheques Oct 9 and Oct 23.
  const s = withPays(migrate({ bills: [{ id: 'bw', name: 'Biweekly', amt: 25, freq: 'biweekly', anchor: '2026-10-18', note: '' }], months: {} }), ['2026-10-09', '2026-10-23']);
  const r = safeToSpend(s, '2026-10-30');
  assert.deepEqual(r.parts.billsInPeriod.map(b => b.date), ['2026-11-01']);
  assert.deepEqual(r.parts.olderUnpaid.map(b => b.date), ['2026-10-18']); // Oct 4 is before the first paycheque
  assert.equal(r.pool, 1250); // 1300 - 25 - 25
  assert.equal(monthTotals(s, '2026-11').billsTotal, 75); // Nov 1, 15, 29
});

/* ---------- SPEC 11: pay kinds ---------- */

const interac = (id, date, amt) => ({ id, date, amt, hours: null, note: 'Interac transfer from Sam', kind: 'income' });

test('an Interac pay (kind income) on Nov 10 does not move the Nov 20 estimate, but it still counts as income', () => {
  for (const [name, s] of [['v1', clone(sample)], ['migrated', migrate(sample)]]) {
    getMonth(s, '2026-11').pays.push(interac('p-sam', '2026-11-10', 50));
    assert.deepEqual(nextPay(s, '2026-11-14'), { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' }, name);
    assert.deepEqual(payPeriod(s, '2026-11-14').start, '2026-11-06', name);
    assert.equal(payPeriod(s, '2026-11-14').days, 6, name);
    const r = safeToSpend(s, '2026-11-14');
    assert.deepEqual(r.nextPay, { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' }, name);
    assert.equal(r.days, 6, name);
    assert.equal(r.parts.income, 1350, name); // 1300 paycheque + 50 Interac
    assert.deepEqual(r.parts.pays.map(p => [p.id, p.amt, p.note]), [['p-nov6', 1300, ''], ['p-sam', 50, 'Interac transfer from Sam']], name);
    assert.equal(r.pool, 539.04, name);      // 1350 - 647 - 163.96
    assert.equal(r.perDay, 89, name);        // 539.04 / 6 = 89.84
    assert.equal(monthTotals(s, '2026-11').earned, 1350, name);
  }
});

test('pay kinds: kind pay and no kind are paycheques; Interac alone never gives a payday', () => {
  const bobino = migrate(sample);
  getMonth(bobino, '2026-11').pays.push({ id: 'p-bob', date: '2026-11-10', amt: 1300, hours: null, note: 'Bobino pay', kind: 'pay' });
  assert.deepEqual(nextPay(bobino, '2026-11-14'), { date: '2026-11-24', estimate: true, lastPay: '2026-11-10' });
  // A Bobino paycheque starts a period: Nov 10 to Nov 23.
  assert.deepEqual(safeToSpend(bobino, '2026-11-14').period, { start: '2026-11-10', end: '2026-11-23' });

  // A future dated Interac is not the next pay either, and only counts from its date.
  const future = migrate(sample);
  getMonth(future, '2026-11').pays.push(interac('p-fut', '2026-11-16', 80));
  assert.deepEqual(nextPay(future, '2026-11-14'), { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' });
  assert.equal(safeToSpend(future, '2026-11-14').parts.income, 1300); // not received yet
  assert.equal(safeToSpend(future, '2026-11-16').parts.income, 1380);
  assert.deepEqual(safeToSpend(future, '2026-11-16').period, { start: '2026-11-06', end: '2026-11-19' });

  // Only Interac money ever logged: no payday is invented.
  const only = { bills: [], months: { '2026-11': { pays: [interac('p-a', '2026-11-03', 40)], tx: [], paid: {} } } };
  assert.equal(nextPay(only, '2026-11-14'), null);
  assert.equal(payPeriod(only, '2026-11-14'), null);
  assert.deepEqual(safeToSpend(only, '2026-11-14'), { missing: 'pay' });
  assert.equal(monthTotals(only, '2026-11').earned, 40);
});

test('a bill ticked ahead of its date stays in the period as paid; the old month fields are gone', () => {
  const s = withPays(migrate(sample), ['2026-11-20']);
  const plain = safeToSpend(s, '2026-11-28');
  tick(s, 'b-rent', '2026-12-01');
  tick(s, 'b-icloud', '2026-12-03');
  tick(s, 'b-claude', '2026-12-04'); // pay day: next period, so not listed here
  const r = safeToSpend(s, '2026-11-28');
  assert.equal(r.nextPay.date, '2026-12-04');
  assert.deepEqual(r.parts.billsInPeriod.filter(b => b.paid).map(b => [b.billId, b.date]), [['b-rent', '2026-12-01'], ['b-icloud', '2026-12-03']]);
  assert.ok(!r.parts.billsInPeriod.some(b => b.billId === 'b-claude'));
  // 1300 - 0 - 803.10 - 117.94 = 378.96, ticked early or not; 6 days -> 63
  assert.equal(r.pool, 378.96);
  assert.equal(r.pool, plain.pool);
  assert.equal(r.perDay, 63);
  assert.deepEqual(Object.keys(r).sort(), ['days', 'nextPay', 'parts', 'perDay', 'period', 'pool']);
  assert.deepEqual(Object.keys(r.parts).sort(), ['billsInPeriod', 'billsTotal', 'income', 'olderTotal', 'olderUnpaid', 'pays', 'spending']);
});
