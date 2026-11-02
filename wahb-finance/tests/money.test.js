import test from 'node:test';
import assert from 'node:assert/strict';
import { monthTotals, nextPay, payPeriod, safeToSpend } from '../lib/money.js';
import { migrate } from '../lib/migrate.js';
import { clone, round2, sum, getMonth, addDays, monthOf, billOccurrencesBetween } from '../lib/core.js';
import sample, { expect } from './fixtures/sample-nov.js';
import period3, { expect as P3 } from './fixtures/sample-period3.js';

const pay = (id, date, amt = 1300) => ({ id, date, amt, hours: null, note: '' });
const income = (id, date, amt) => ({ id, date, amt, hours: null, note: 'Interac transfer from Sam', kind: 'income' });
const addPay = (state, p) => { getMonth(state, p.date.slice(0, 7)).pays.push(p); return state; };
const addTx = (state, id, date, amt, item = 'i-groc') => { getMonth(state, monthOf(date)).tx.push({ id, date, item, amt, note: '' }); return state; };
const tick = (state, billId, date) => { getMonth(state, monthOf(date)).paid[billId + '@' + date] = true; return state; };
const untick = (state, billId, date) => { delete getMonth(state, monthOf(date)).paid[billId + '@' + date]; return state; };
// Ticks every dated bill occurrence from Sep 1 2026 up to the day before `until`.
const tickAllBefore = (state, until) => {
  for (const b of state.bills) for (const d of billOccurrencesBetween(b, '2026-09-01', addDays(until, -1))) tick(state, b.id, d);
  return state;
};
const rows = list => list.map(b => [b.name, b.date, b.amt]);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// Both the raw v1 fixture and its migrated form must give the same numbers.
const variants = () => [['v1', clone(sample)], ['migrated', migrate(sample)]];

/* ---------- 5.1 month totals ---------- */

// The original page's render() maths, ported as is (floats), to check the meaning is kept.
function originalTotals(S, key) {
  const [y, mm] = key.split('-').map(Number), m0 = mm - 1, last = new Date(y, m0 + 1, 0).getDate();
  const pad = n => String(n).padStart(2, '0');
  const occ = b => {
    if (b.freq === 'biweekly' && b.anchor) {
      const out = [], a = new Date(b.anchor + 'T12:00:00'), start = new Date(y, m0, 1, 12), end = new Date(y, m0, last, 12), step = 14 * 864e5;
      const k = Math.floor((start - a) / step); let d = new Date(a.getTime() + k * step);
      while (d <= end) { if (d >= start) out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); d = new Date(d.getTime() + step); }
      return out;
    }
    if (!b.day) return [key + '-??'];
    return [key + '-' + pad(Math.min(b.day, last))];
  };
  const m = S.months[key] || { paid: {}, tx: [], pays: [] };
  const rows = []; S.bills.forEach(b => occ(b).forEach(date => rows.push({ b, key: b.id + '@' + date })));
  const billsTotal = rows.reduce((s, r) => s + r.b.amt, 0);
  const paid = rows.filter(r => m.paid[r.key]).reduce((s, r) => s + r.b.amt, 0);
  const spent = m.tx.reduce((s, t) => s + Number(t.amt), 0);
  const earned = m.pays.reduce((s, p) => s + Number(p.amt), 0);
  return { earned, billsTotal, paid, spent, left: earned - billsTotal - spent };
}

test('monthTotals for the November sample', () => {
  for (const [name, s] of variants()) {
    assert.deepEqual(monthTotals(s, '2026-11'), { earned: 1300, billsTotal: 1072.70, paid: 828.11, spent: 647, left: -419.70 }, name);
  }
  assert.equal(monthTotals(sample, '2026-11').spent, expect.spentNov);
  assert.equal(monthTotals(sample, '2026-11').paid, expect.billsPaidNov);
});

test('monthTotals matches the original page for many months', () => {
  const s = clone(sample);
  s.months['2026-11'].tx.push({ id: 'x1', date: '2026-11-13', item: 'i-groc', amt: 0.1, note: '' }, { id: 'x2', date: '2026-11-13', item: 'i-groc', amt: 0.2, note: '' });
  s.months['2027-02'] = { paid: { 'b-rent@2027-02-01': true }, tx: [{ id: 'y', date: '2027-02-03', item: 'i-gas', amt: '12.34', note: '' }], pays: [pay('p', '2027-02-05')] };
  s.bills.push({ id: 'b-31', name: 'Late month', amt: 10, freq: 'monthly', day: 31, note: '' });
  for (const key of ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']) {
    const ours = monthTotals(s, key), orig = originalTotals(s, key);
    for (const k of Object.keys(orig)) assert.equal(ours[k], round2(orig[k]), `${key} ${k}`);
  }
});

test('monthTotals counts bills with no date, and an empty month only has bills', () => {
  const t = monthTotals(sample, '2027-03');
  assert.equal(t.earned, 0);
  assert.equal(t.spent, 0);
  assert.equal(t.paid, 0);
  // March 2027: two gym dates (Mar 4, Mar 18) and Manga with no date are all counted
  assert.equal(t.billsTotal, 1072.70);
  assert.equal(t.left, -1072.70);
  assert.equal(sample.months['2027-03'], undefined, 'reading a month never creates it');
});

/* ---------- 5.2 next pay and pay period ---------- */

test('nextPay: last pay plus 14 days is an estimate', () => {
  assert.deepEqual(nextPay(sample, '2026-11-14'), { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' });
  // a pay dated today is the last pay, not the next one
  assert.deepEqual(nextPay(sample, '2026-11-06'), { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' });
  // steps by 14 until after today
  assert.deepEqual(nextPay(sample, '2026-11-20'), { date: '2026-12-04', estimate: true, lastPay: '2026-11-06' });
  assert.deepEqual(nextPay(sample, '2027-01-02'), { date: '2027-01-15', estimate: true, lastPay: '2026-11-06' });
});

test('nextPay: uses pays from every month', () => {
  const s = clone(sample);
  delete s.months['2026-11'];
  assert.deepEqual(nextPay(s, '2026-11-14'), { date: '2026-11-20', estimate: true, lastPay: '2026-10-23' });
});

test('nextPay: a future dated logged pay is the next pay and not an estimate', () => {
  const s = addPay(clone(sample), pay('p-fut', '2026-11-19', 1250));
  addPay(s, pay('p-later', '2026-12-03'));
  assert.deepEqual(nextPay(s, '2026-11-14'), { date: '2026-11-19', estimate: false, lastPay: '2026-11-06' });
  assert.deepEqual(nextPay(s, '2026-11-25'), { date: '2026-12-03', estimate: false, lastPay: '2026-11-19' });
  // only future pays: lastPay is null
  const only = { bills: [], months: { '2026-12': { pays: [pay('p', '2026-12-03')] } } };
  assert.deepEqual(nextPay(only, '2026-11-14'), { date: '2026-12-03', estimate: false, lastPay: null });
});

test('nextPay and payPeriod: no pays at all gives null', () => {
  const s = clone(sample);
  s.months['2026-10'].pays = [];
  s.months['2026-11'].pays = [];
  assert.equal(nextPay(s, '2026-11-14'), null);
  assert.equal(payPeriod(s, '2026-11-14'), null);
  assert.equal(nextPay({ bills: [] }, '2026-11-14'), null);
  assert.equal(nextPay({ months: { '2026-11': { pays: [{ id: 'x', amt: 5 }] } } }, '2026-11-14'), null, 'a pay with no date is not a date');
});

test('payPeriod runs from the last paycheque on or before today to the day before next pay', () => {
  // Nov 14: last paycheque Nov 6, next pay Nov 6 + 14 = Nov 20 (estimate). Days left: Nov 14 to 19 = 6.
  assert.deepEqual(payPeriod(sample, '2026-11-14'), {
    start: '2026-11-06', end: '2026-11-19', days: 6,
    nextPay: { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' },
  });
  // On payday the whole period is left: 14 days.
  assert.deepEqual(payPeriod(sample, '2026-11-06'), {
    start: '2026-11-06', end: '2026-11-19', days: 14,
    nextPay: { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' },
  });
  // The day before next pay: 1 day, same period.
  const last = payPeriod(sample, '2026-11-19');
  assert.deepEqual([last.start, last.end, last.days], ['2026-11-06', '2026-11-19', 1]);
  // A logged pay on Nov 20 starts the next period; on Nov 28 it runs Nov 20 to Dec 3 with 6 days left.
  const dec = payPeriod(addPay(clone(sample), pay('p', '2026-11-20')), '2026-11-28');
  assert.deepEqual([dec.start, dec.end, dec.days], ['2026-11-20', '2026-12-03', 6]);
  // The first of a month changes nothing: Nov 30 and Dec 1 are in the same period.
  const p3 = [payPeriod(period3, '2026-11-30'), payPeriod(period3, '2026-12-01')];
  assert.deepEqual(p3.map(p => [p.start, p.end, p.days]), [['2026-11-20', '2026-12-03', 4], ['2026-11-20', '2026-12-03', 3]]);
});

test('payPeriod: a payday not logged yet keeps the last logged paycheque as the start (never invents a pay)', () => {
  // Nov 20 with no Nov 20 pay logged: next is Nov 6 + 28 = Dec 4 (estimate), the period still starts Nov 6.
  assert.deepEqual(payPeriod(sample, '2026-11-20'), {
    start: '2026-11-06', end: '2026-12-03', days: 14,
    nextPay: { date: '2026-12-04', estimate: true, lastPay: '2026-11-06' },
  });
});

test('payPeriod: no paycheque on or before today gives null, even when a future one is logged', () => {
  const only = { bills: [], months: { '2026-12': { pays: [pay('p', '2026-12-03')] } } };
  assert.deepEqual(nextPay(only, '2026-11-14'), { date: '2026-12-03', estimate: false, lastPay: null });
  assert.equal(payPeriod(only, '2026-11-14'), null);
  // From that day on there is a period.
  assert.deepEqual(payPeriod(only, '2026-12-03'), {
    start: '2026-12-03', end: '2026-12-16', days: 14, nextPay: { date: '2026-12-17', estimate: true, lastPay: '2026-12-03' },
  });
  // Money in that is not a paycheque never makes a period.
  const interacOnly = { bills: [], months: { '2026-11': { pays: [income('i', '2026-11-03', 40)] } } };
  assert.equal(payPeriod(interacOnly, '2026-11-14'), null);
});

/* ---------- 5.3 safe to spend: the three acceptance checks ---------- */

test('acceptance 1: Nov 14, pay $1,300 on Nov 6, $647 spent since: $81 today, payday in 6 days', () => {
  // income   = 1300 (Nov 6)
  // spending = 182.40 + 28 + 58 + 64.80 + 120 + 96.25 + 23.55 + 74 = 647.00 (all dated Nov 6 to Nov 12)
  // bills Nov 6 to 19 = Spotify 14.44 (Nov 6) + Gym 31.58 (Nov 12) + Netflix 27.11 (Nov 16) + Phone + Crave 90.83 (Nov 18)
  //                   = 163.96, paid or not
  // older unpaid = 0 (every bill from Oct 9, the first paycheque, to Nov 5 is ticked)
  // pool = 1300 - 647 - 163.96 = 489.04; perDay = floor(489.04 / 6) = floor(81.506) = 81
  for (const [name, s] of variants()) {
    const before = clone(s);
    const r = safeToSpend(s, '2026-11-14');
    assert.deepEqual(s, before, `${name}: state not changed`);
    assert.deepEqual(r, {
      perDay: 81, pool: 489.04, days: 6,
      period: { start: '2026-11-06', end: '2026-11-19' },
      nextPay: { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' },
      parts: {
        pays: [{ id: 'p-nov6', date: '2026-11-06', amt: 1300, note: '' }],
        income: 1300,
        spending: 647,
        billsInPeriod: [
          { billId: 'b-spot', name: 'Spotify', date: '2026-11-06', amt: 14.44, paid: true },
          { billId: 'b-gym', name: 'Gym (ABC)', date: '2026-11-12', amt: 31.58, paid: true },
          { billId: 'b-netflix', name: 'Netflix', date: '2026-11-16', amt: 27.11, paid: false },
          { billId: 'b-phone', name: 'Phone + Crave/Disney (Bell)', date: '2026-11-18', amt: 90.83, paid: false },
        ],
        billsTotal: 163.96,
        olderUnpaid: [],
        olderTotal: 0,
      },
    }, name);
  }
  // The fixture's own hand numbers agree, and November's month totals are as before.
  const r = safeToSpend(sample, expect.today);
  assert.deepEqual([r.perDay, r.pool, r.days, r.period, r.parts.income, r.parts.spending, r.parts.billsTotal, r.parts.olderTotal],
    [expect.perDay, expect.pool, expect.days, expect.period, expect.income, expect.spending, expect.billsTotal, expect.olderTotal]);
  assert.equal(r.nextPay.date, expect.nextPay);
  assert.deepEqual(monthTotals(sample, '2026-11'), { earned: expect.earnedNov, billsTotal: 1072.70, paid: expect.billsPaidNov, spent: expect.spentNov, left: -419.70 });
});

test('acceptance 2: the same day with $1,200 spent since Nov 6: $0 today, payday in 6 days', () => {
  // spending = 647 + 553 = 1200; pool = 1300 - 1200 - 163.96 = -63.96; perDay = floor(max(0, -63.96) / 6) = 0
  for (const [name, s] of variants()) {
    addTx(s, 'x553', '2026-11-13', expect.overspent.extra);
    const r = safeToSpend(s, '2026-11-14');
    assert.equal(r.parts.spending, 1200, name);
    assert.equal(r.parts.billsTotal, 163.96, name);
    assert.equal(r.pool, -63.96, name);
    assert.equal(r.perDay, 0, name);
    assert.equal(r.days, 6, name);
    assert.deepEqual([r.pool, r.perDay], [expect.overspent.pool, expect.overspent.perDay], name);
  }
});

test('acceptance 3: pay on Nov 20, $300 spent since, nothing on Dec 1: pool 196.90 on both days, $49 on Nov 30, $65 on Dec 1', () => {
  // period Nov 20 to Dec 3 (next pay Nov 20 + 14 = Dec 4, an estimate)
  // income = 1300 (Nov 20); spending = 112.35 + 48.20 + 9.45 + 61.00 + 69.00 = 300.00
  // bills Nov 20 to Dec 3 = Internet 89.43 (Nov 22) + Gym 31.58 (Nov 26) + Rent 587.50 (Dec 1) + Parking 90 (Dec 1)
  //                       + iCloud 4.59 (Dec 3) = 803.10
  // older unpaid = 0 (all bills before Nov 20 ticked)
  // pool = 1300 - 300 - 803.10 = 196.90
  // Nov 30: 4 days -> floor(196.90 / 4) = floor(49.225) = 49;  Dec 1: 3 days -> floor(196.90 / 3) = floor(65.633) = 65
  for (const [name, s] of [['v2', clone(period3)], ['migrated', migrate(period3)]]) {
    const nov30 = safeToSpend(s, '2026-11-30'), dec1 = safeToSpend(s, '2026-12-01');
    for (const [r, day, perDay, days] of [[nov30, '2026-11-30', 49, 4], [dec1, '2026-12-01', 65, 3]]) {
      assert.equal(r.perDay, perDay, `${name} ${day}`);
      assert.equal(r.days, days, `${name} ${day}`);
      assert.equal(r.pool, 196.90, `${name} ${day}`);
      assert.deepEqual(r.period, { start: '2026-11-20', end: '2026-12-03' }, `${name} ${day}`);
      assert.deepEqual(r.nextPay, { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' }, `${name} ${day}`);
      assert.deepEqual(r.parts.pays, [{ id: 'p-nov20', date: '2026-11-20', amt: 1300, note: '' }], `${name} ${day}`);
      assert.equal(r.parts.income, 1300, `${name} ${day}`);
      assert.equal(r.parts.spending, 300, `${name} ${day}`);
      assert.deepEqual(r.parts.billsInPeriod.map(b => [b.name, b.date, b.amt, b.paid]), [
        ['Internet (Bell)', '2026-11-22', 89.43, true],
        ['Gym (ABC)', '2026-11-26', 31.58, false],
        ['Rent (my half)', '2026-12-01', 587.50, false],
        ['Parking (my half)', '2026-12-01', 90, false],
        ['iCloud', '2026-12-03', 4.59, false],
      ], `${name} ${day}`);
      assert.equal(r.parts.billsTotal, 803.10, `${name} ${day}`);
      assert.deepEqual([r.parts.olderUnpaid, r.parts.olderTotal], [[], 0], `${name} ${day}`);
      assert.deepEqual([r.perDay, r.days, r.pool, r.parts.income, r.parts.spending, r.parts.billsTotal, r.parts.olderTotal],
        [P3.perDay[day], P3.days[day], P3.pool, P3.income, P3.spending, P3.billsTotal, P3.olderTotal], `${name} ${day}`);
    }
    // Same money left on both days: only the number of days changed.
    assert.equal(dec1.pool, nov30.pool, name);
    assert.deepEqual(dec1.parts, nov30.parts, name);
  }
});

/* ---------- 5.3 safe to spend: rules ---------- */

test('the 1st of a month alone never changes the money left', () => {
  // Sample with a Nov 20 pay: the Nov 20 to Dec 3 period crosses Dec 1, where rent and parking fall.
  // income 1300; spending 0; bills Nov 20 to Dec 3 = 803.10; older unpaid Netflix 27.11 + Phone 90.83 = 117.94
  // pool = 1300 - 803.10 - 117.94 = 378.96 every day of the period
  const s = addPay(migrate(sample), pay('p-nov20', '2026-11-20'));
  const nov30 = safeToSpend(s, '2026-11-30'), dec1 = safeToSpend(s, '2026-12-01');
  assert.equal(nov30.pool, 378.96);
  assert.equal(dec1.pool, 378.96);
  assert.deepEqual(dec1.parts, nov30.parts);
  assert.equal(nov30.perDay, 94); // 378.96 / 4 = 94.74
  assert.equal(dec1.perDay, 126); // 378.96 / 3 = 126.32
  // Every day of the period has the same pool.
  for (let d = '2026-11-20'; d <= '2026-12-03'; d = addDays(d, 1)) assert.equal(safeToSpend(s, d).pool, 378.96, d);
});

test('second pay on Nov 20: older unpaid bills from the last period still count', () => {
  // today Nov 20, period Nov 20 to Dec 3, 14 days
  // income 1300; spending 0 (every sample purchase is before Nov 20)
  // bills in period 803.10; older unpaid (Oct 9 to Nov 19): Netflix 27.11 (Nov 16) + Phone + Crave 90.83 (Nov 18) = 117.94
  // pool = 1300 - 0 - 803.10 - 117.94 = 378.96; perDay = floor(378.96 / 14) = floor(27.07) = 27
  for (const [name, base] of variants()) {
    const s = addPay(base, pay('p-nov20', '2026-11-20'));
    const r = safeToSpend(s, '2026-11-20');
    assert.deepEqual(r.period, { start: '2026-11-20', end: '2026-12-03' }, name);
    assert.deepEqual(r.nextPay, { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' }, name);
    assert.equal(r.days, 14, name);
    assert.equal(r.parts.income, 1300, name);
    assert.equal(r.parts.spending, 0, name);
    assert.deepEqual(rows(r.parts.billsInPeriod), [
      ['Internet (Bell)', '2026-11-22', 89.43],
      ['Gym (ABC)', '2026-11-26', 31.58],
      ['Rent (my half)', '2026-12-01', 587.50],
      ['Parking (my half)', '2026-12-01', 90],
      ['iCloud', '2026-12-03', 4.59],
    ], name);
    assert.equal(r.parts.billsTotal, 803.10, name);
    assert.deepEqual(r.parts.olderUnpaid, [
      { billId: 'b-netflix', name: 'Netflix', date: '2026-11-16', amt: 27.11 },
      { billId: 'b-phone', name: 'Phone + Crave/Disney (Bell)', date: '2026-11-18', amt: 90.83 },
    ], name);
    assert.equal(r.parts.olderTotal, 117.94, name);
    assert.equal(r.pool, 378.96, name);
    assert.equal(r.perDay, 27, name);
  }
});

test('a payday not logged yet: the period runs on from the last paycheque, with no new income', () => {
  // Nov 20, no Nov 20 pay: period Nov 6 to Dec 3, 14 days left. income 1300; spending 647;
  // bills Nov 6 to Dec 3 = 163.96 + 803.10 = 967.06; pool = 1300 - 647 - 967.06 = -314.06; perDay 0
  const r = safeToSpend(sample, '2026-11-20');
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-12-03' });
  assert.equal(r.days, 14);
  assert.equal(r.parts.income, 1300);
  assert.equal(r.parts.spending, 647);
  assert.equal(r.parts.billsInPeriod.length, 9);
  assert.equal(r.parts.billsTotal, 967.06);
  assert.equal(r.pool, -314.06);
  assert.equal(r.perDay, 0);
});

test('older unpaid bills before the period start count', () => {
  // Untick Internet Oct 22: it is after Oct 9 (the first paycheque) and within 62 days of Nov 6.
  // pool = 489.04 - 89.43 = 399.61; perDay = floor(399.61 / 6) = floor(66.60) = 66
  const s = untick(migrate(sample), 'b-net', '2026-10-22');
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.parts.olderUnpaid, [{ billId: 'b-net', name: 'Internet (Bell)', date: '2026-10-22', amt: 89.43 }]);
  assert.equal(r.parts.olderTotal, 89.43);
  assert.equal(r.parts.billsTotal, 163.96);
  assert.equal(r.pool, 399.61);
  assert.equal(r.perDay, 66);
  // Ticking it paid takes it off again.
  assert.equal(safeToSpend(tick(s, 'b-net', '2026-10-22'), '2026-11-14').pool, 489.04);
  // An unpaid November bill before Nov 6 counts the same way (iCloud Nov 3): 489.04 - 4.59 = 484.45, perDay 80
  const ic = safeToSpend(untick(migrate(sample), 'b-icloud', '2026-11-03'), '2026-11-14');
  assert.deepEqual(ic.parts.olderUnpaid.map(b => [b.billId, b.date]), [['b-icloud', '2026-11-03']]);
  assert.deepEqual([ic.pool, ic.perDay], [484.45, 80]);
});

test('older unpaid bills: never before the first logged paycheque', () => {
  // First paycheque Oct 9. Untick Spotify Oct 6 (before it) and Gym Oct 15 (after it): only the gym counts.
  const s = migrate(sample);
  untick(s, 'b-spot', '2026-10-06'); untick(s, 'b-gym', '2026-10-15');
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.parts.olderUnpaid.map(b => [b.billId, b.date]), [['b-gym', '2026-10-15']]);
  assert.equal(r.pool, 457.46); // 489.04 - 31.58
  // On the first paycheque's own day it counts, the day before it does not.
  const m = { bills: [
    { id: 'on', name: 'On', amt: 10, freq: 'monthly', day: 9, note: '' },
    { id: 'before', name: 'Before', amt: 7, freq: 'monthly', day: 8, note: '' },
  ], months: {} };
  ['2026-10-09', '2026-10-23', '2026-11-06'].forEach((d, i) => addPay(m, pay('p' + i, d)));
  const r2 = safeToSpend(m, '2026-11-14');
  // period Nov 6 to Nov 19: Nov 8 and Nov 9 are in it; older: Oct 9 counts, Oct 8 does not
  assert.deepEqual(r2.parts.olderUnpaid.map(b => [b.billId, b.date]), [['on', '2026-10-09']]);
  assert.deepEqual(r2.parts.billsInPeriod.map(b => [b.billId, b.date]), [['before', '2026-11-08'], ['on', '2026-11-09']]);
  assert.equal(r2.pool, 1273); // 1300 - (7 + 10) - 10
  // Money in that is not a paycheque never reaches back further.
  addPay(m, income('i-sep', '2026-09-01', 25));
  assert.deepEqual(safeToSpend(m, '2026-11-14').parts.olderUnpaid.map(b => b.date), ['2026-10-09']);
});

test('older unpaid bills: not more than 62 days before the period start', () => {
  // First paycheque Jul 3, last Nov 6. 62 days before Nov 6 is Sep 5 (Sep 5 to Oct 5 is 30, to Nov 5 is 31, to Nov 6 is 1).
  const m = { bills: [
    { id: 'd5', name: 'Fifth', amt: 10, freq: 'monthly', day: 5, note: '' },
    { id: 'd4', name: 'Fourth', amt: 1, freq: 'monthly', day: 4, note: '' },
  ], months: {} };
  addPay(m, pay('jul', '2026-07-03')); addPay(m, pay('nov', '2026-11-06'));
  const r = safeToSpend(m, '2026-11-14');
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-19' });
  // the 5th: Sep 5 (62 days back) counts, Aug 5 does not; the 4th: Sep 4 (63 days back) does not
  assert.deepEqual(r.parts.olderUnpaid.map(b => [b.billId, b.date]), [
    ['d4', '2026-10-04'], ['d5', '2026-10-05'], ['d4', '2026-11-04'], ['d5', '2026-11-05'], ['d5', '2026-09-05'],
  ].sort((x, y) => x[1].localeCompare(y[1])));
  assert.equal(r.parts.olderTotal, 32); // 10 * 3 + 1 * 2
  assert.equal(r.pool, 1268); // 1300 - 32
  assert.equal(r.perDay, 211); // 1268 / 6 = 211.33
});

test('income pays inside the period add to income but never define the period', () => {
  const s = migrate(sample);
  addPay(s, income('i-10', '2026-11-10', 50)); // inside, before today
  addPay(s, income('i-17', '2026-11-17', 30)); // inside, after today
  addPay(s, income('i-20', '2026-11-20', 99)); // on the estimated payday, not a paycheque
  // Nov 14: income = 1300 + 50 = 1350; pool = 1350 - 647 - 163.96 = 539.04; perDay = floor(539.04 / 6) = 89
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-19' });
  assert.deepEqual(r.nextPay, { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' });
  assert.deepEqual(r.parts.pays, [
    { id: 'p-nov6', date: '2026-11-06', amt: 1300, note: '' },
    { id: 'i-10', date: '2026-11-10', amt: 50, note: 'Interac transfer from Sam' },
  ]);
  assert.equal(r.parts.income, 1350);
  assert.equal(r.pool, 539.04);
  assert.equal(r.perDay, 89);
  // Nov 17: the Nov 17 money is in: 1380; pool 569.04; 3 days -> floor(189.68) = 189
  const r17 = safeToSpend(s, '2026-11-17');
  assert.deepEqual([r17.parts.income, r17.pool, r17.days, r17.perDay], [1380, 569.04, 3, 189]);
  // Nov 20: still the Nov 6 period (the Nov 20 money is not a paycheque), now with 1479 in
  const r20 = safeToSpend(s, '2026-11-20');
  assert.deepEqual(r20.period, { start: '2026-11-06', end: '2026-12-03' });
  assert.equal(r20.parts.income, 1479);
});

test('future dated purchases inside the period count; purchases outside it do not', () => {
  const s = migrate(sample);
  addTx(s, 'f18', '2026-11-18', 40);  // inside, after today
  addTx(s, 'f19', '2026-11-19', 2.5); // the last day of the period
  addTx(s, 'f20', '2026-11-20', 99);  // next period
  addTx(s, 'b05', '2026-11-05', 7);   // before the period, same month
  // spending = 647 + 40 + 2.5 = 689.50; pool = 1300 - 689.50 - 163.96 = 446.54; perDay = floor(74.42) = 74
  const r = safeToSpend(s, '2026-11-14');
  assert.equal(r.parts.spending, 689.5);
  assert.equal(r.pool, 446.54);
  assert.equal(r.perDay, 74);
  // month totals still count the whole month, as before
  assert.equal(monthTotals(s, '2026-11').spent, 795.5); // 647 + 40 + 2.5 + 99 + 7
});

test('a period across the year boundary', () => {
  // Pays Nov 20, Dec 4 and Dec 18; every bill before Dec 18 ticked; $100 spent Dec 20.
  const s = migrate(sample);
  ['2026-11-20', '2026-12-04', '2026-12-18'].forEach((d, i) => addPay(s, pay('p' + i, d)));
  tickAllBefore(s, '2026-12-18');
  addTx(s, 'd20', '2026-12-20', 100);
  // Dec 28: period Dec 18 to Dec 31 (next pay Jan 1, an estimate), 4 days left
  // bills: Phone + Crave 90.83 (Dec 18) + Internet 89.43 (Dec 22) + Gym 31.58 (Dec 24) = 211.84; Jan 1 rent is on pay day
  // pool = 1300 - 100 - 211.84 = 988.16; perDay = floor(988.16 / 4) = 247
  const r = safeToSpend(s, '2026-12-28');
  assert.deepEqual(r.nextPay, { date: '2027-01-01', estimate: true, lastPay: '2026-12-18' });
  assert.deepEqual(r.period, { start: '2026-12-18', end: '2026-12-31' });
  assert.equal(r.days, 4);
  assert.equal(r.parts.income, 1300);
  assert.equal(r.parts.spending, 100);
  assert.deepEqual(r.parts.billsInPeriod.map(b => [b.billId, b.date]), [['b-phone', '2026-12-18'], ['b-net', '2026-12-22'], ['b-gym', '2026-12-24']]);
  assert.equal(r.parts.billsTotal, 211.84);
  assert.equal(r.parts.olderTotal, 0);
  assert.equal(r.pool, 988.16);
  assert.equal(r.perDay, 247);
});

test('a future dated logged pay is the next pay and not income before its date', () => {
  const s = addPay(migrate(sample), pay('p-fut', '2026-11-19', 1250));
  // Nov 14: next pay Nov 19 (logged), period Nov 6 to Nov 18, 5 days. income 1300; bills Nov 6 to 18 = 163.96
  // pool = 1300 - 647 - 163.96 = 489.04; perDay = floor(489.04 / 5) = 97
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.nextPay, { date: '2026-11-19', estimate: false, lastPay: '2026-11-06' });
  assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-18' });
  assert.deepEqual([r.days, r.parts.income, r.parts.billsTotal, r.pool, r.perDay], [5, 1300, 163.96, 489.04, 97]);
  // Nov 19: its own period, Nov 19 to Dec 2 (next Dec 3, an estimate), 14 days. income 1250; spending 0
  // bills: Internet 89.43 + Gym 31.58 + Rent 587.50 + Parking 90 = 798.51; older unpaid Netflix + Phone = 117.94
  // pool = 1250 - 798.51 - 117.94 = 333.55; perDay = floor(333.55 / 14) = 23
  const on = safeToSpend(s, '2026-11-19');
  assert.deepEqual(on.nextPay, { date: '2026-12-03', estimate: true, lastPay: '2026-11-19' });
  assert.deepEqual(on.period, { start: '2026-11-19', end: '2026-12-02' });
  assert.deepEqual([on.days, on.parts.income, on.parts.spending, on.parts.billsTotal, on.parts.olderTotal, on.pool, on.perDay],
    [14, 1250, 0, 798.51, 117.94, 333.55, 23]);
});

test('no paycheque on or before today asks for a pay', () => {
  const none = clone(sample);
  none.months['2026-10'].pays = [];
  none.months['2026-11'].pays = [];
  assert.deepEqual(safeToSpend(none, '2026-11-14'), { missing: 'pay' });
  assert.deepEqual(safeToSpend({ bills: [], months: {} }, '2026-11-14'), { missing: 'pay' });
  assert.deepEqual(safeToSpend({}, '2026-11-14'), { missing: 'pay' });
  // Only a future paycheque, or only money in that is not a paycheque: still asks.
  assert.deepEqual(safeToSpend(addPay(clone(none), pay('fut', '2026-11-20')), '2026-11-14'), { missing: 'pay' });
  assert.deepEqual(safeToSpend(addPay(clone(none), income('i', '2026-11-10', 500)), '2026-11-14'), { missing: 'pay' });
  // The sample before its first paycheque (Oct 9).
  assert.deepEqual(safeToSpend(sample, '2026-10-08'), { missing: 'pay' });
});

test('bills with no date are left out of the period and of older unpaid', () => {
  const s = migrate(sample);
  s.bills.push({ id: 'b-bw', name: 'No anchor', amt: 12, freq: 'biweekly', anchor: null, note: '' });
  addPay(s, pay('p-nov20', '2026-11-20'));
  for (const today of ['2026-11-14', '2026-11-20', '2026-11-28', '2026-12-02']) {
    const r = safeToSpend(s, today);
    const all = [...r.parts.billsInPeriod, ...r.parts.olderUnpaid];
    assert.ok(!all.some(b => b.billId === 'b-manga' || b.billId === 'b-bw'), today);
    assert.ok(all.every(b => !b.date.includes('?')), today);
  }
});

test('ticking a bill of the period never changes the pool', () => {
  const s = migrate(sample);
  const r = safeToSpend(s, '2026-11-14');
  const t = safeToSpend(tick(clone(s), 'b-netflix', '2026-11-16'), '2026-11-14');
  assert.equal(t.pool, r.pool);
  assert.equal(t.parts.billsInPeriod.find(b => b.billId === 'b-netflix').paid, true);
  // Unticking one does not either.
  assert.equal(safeToSpend(untick(clone(s), 'b-spot', '2026-11-06'), '2026-11-14').pool, r.pool);
  // A bill after the period (Internet Nov 22) belongs to the next one: ticking it early changes nothing here.
  assert.deepEqual(safeToSpend(tick(clone(s), 'b-net', '2026-11-22'), '2026-11-14'), r);
});

test('perDay is never negative and is whole dollars', () => {
  const big = addTx(clone(sample), 'huge', '2026-11-13', 99999);
  const b = safeToSpend(big, '2026-11-14');
  assert.ok(b.pool < 0);
  assert.equal(b.perDay, 0);
  // exact division stays exact: 28.00 over 14 days is 2
  const tiny = { bills: [], months: { '2026-11': { pays: [pay('p', '2026-11-20', 28)] } } };
  const t = safeToSpend(tiny, '2026-11-20');
  assert.deepEqual([t.days, t.pool, t.perDay], [14, 28, 2]);
  for (let today = '2026-10-09'; today <= '2027-01-31'; today = addDays(today, 1)) {
    for (const s of [sample, big]) {
      const x = safeToSpend(s, today);
      assert.ok(Number.isInteger(x.perDay) && x.perDay >= 0, today);
      assert.equal(x.perDay, Math.floor(Math.max(0, Math.round(x.pool * 100)) / (x.days * 100)), today);
    }
  }
});

test('nothing changes state: safe to spend works on a deep frozen state, and its result shares nothing with it', () => {
  const s = deepFreeze(addPay(migrate(sample), income('i-10', '2026-11-10', 50)));
  const before = JSON.stringify(s);
  for (const today of ['2026-10-08', '2026-11-01', '2026-11-14', '2026-11-30', '2026-12-01', '2027-03-20']) {
    assert.doesNotThrow(() => safeToSpend(s, today), today);
  }
  const r = safeToSpend(s, '2026-11-14');
  r.parts.pays[0].amt = 0; r.parts.pays[1].note = 'x'; r.parts.billsInPeriod[0].amt = 0;
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.months['2026-12'], undefined, 'reading a month never creates it');
});
