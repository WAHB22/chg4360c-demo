import test from 'node:test';
import assert from 'node:assert/strict';
import { monthTotals, nextPay, payPeriod, safeToSpend } from '../lib/money.js';
import { migrate } from '../lib/migrate.js';
import { clone, round2, sum, getMonth } from '../lib/core.js';
import sample, { expect } from './fixtures/sample-nov.js';

const pay = (id, date, amt = 1300) => ({ id, date, amt, hours: null, note: '' });
const addPay = (state, p) => { getMonth(state, p.date.slice(0, 7)).pays.push(p); return state; };
const dueTotal = r => sum(r.parts.billsDue, b => b.amt);

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

test('payPeriod runs from today to the day before next pay', () => {
  assert.deepEqual(payPeriod(sample, '2026-11-14'), {
    start: '2026-11-14', end: '2026-11-19', days: 6,
    nextPay: { date: '2026-11-20', estimate: true, lastPay: '2026-11-06' },
  });
  const p = payPeriod(sample, '2026-11-19');
  assert.equal(p.days, 1);
  assert.equal(p.end, '2026-11-19');
  const dec = payPeriod(addPay(clone(sample), pay('p', '2026-11-20')), '2026-11-28');
  assert.equal(dec.end, '2026-12-03');
  assert.equal(dec.days, 6);
});

/* ---------- 5.3 safe to spend ---------- */

test('acceptance: Nov 14 sample', () => {
  for (const [name, s] of variants()) {
    const before = clone(s);
    const r = safeToSpend(s, expect.today);
    assert.deepEqual(s, before, `${name}: state not changed`);
    assert.equal(r.perDay, expect.perDay, name);
    assert.equal(r.days, expect.days, name);
    assert.deepEqual(r.nextPay, { date: expect.nextPay, estimate: true, lastPay: '2026-11-06' }, name);
    assert.equal(r.parts.income, 1300, name);
    assert.equal(r.parts.spending, expect.spentNov, name);
    assert.equal(r.parts.billsPaid, expect.billsPaidNov, name);
    assert.deepEqual(r.parts.billsDue, [
      { billId: 'b-netflix', name: 'Netflix', date: '2026-11-16', amt: 27.11 },
      { billId: 'b-phone', name: 'Phone + Crave/Disney (Bell)', date: '2026-11-18', amt: 90.83 },
    ], name);
    assert.equal(dueTotal(r), expect.billsDueBeforeNov20, name);
    assert.equal(r.pool, -293.05, name);
  }
});

test('acceptance: second pay on Nov 20, today Nov 20', () => {
  const a = expect.afterSecondPay;
  for (const [name, base] of variants()) {
    const s = addPay(base, pay('p-nov20', '2026-11-20'));
    const r = safeToSpend(s, a.today);
    assert.equal(r.parts.income, 2600, name);
    assert.deepEqual(r.parts.billsDue.map(b => [b.name, b.date, b.amt]), [
      ['Netflix', '2026-11-16', 27.11],
      ['Phone + Crave/Disney (Bell)', '2026-11-18', 90.83],
      ['Internet (Bell)', '2026-11-22', 89.43],
      ['Gym (ABC)', '2026-11-26', 31.58],
      ['Rent (my half)', '2026-12-01', 587.50],
      ['Parking (my half)', '2026-12-01', 90],
      ['iCloud', '2026-12-03', 4.59],
    ], name);
    assert.equal(dueTotal(r), a.billsDue, name);
    assert.equal(r.pool, a.pool, name);
    assert.equal(r.days, a.days, name);
    assert.deepEqual(r.nextPay, { date: a.nextPay, estimate: true, lastPay: '2026-11-20' }, name);
    assert.equal(r.perDay, a.perDay, name);
  }
});

test('no pays at all asks for a pay', () => {
  const s = clone(sample);
  s.months['2026-10'].pays = [];
  s.months['2026-11'].pays = [];
  assert.deepEqual(safeToSpend(s, '2026-11-14'), { missing: 'pay' });
  assert.deepEqual(safeToSpend({ bills: [], months: {} }, '2026-11-14'), { missing: 'pay' });
});

test('month boundary: the pay period crosses into December', () => {
  const s = addPay(migrate(sample), pay('p-nov20', '2026-11-20'));
  const r = safeToSpend(s, '2026-11-28');
  assert.deepEqual(r.nextPay, { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' });
  assert.equal(r.days, 6);
  assert.equal(r.parts.income, 2600);
  assert.equal(r.parts.spending, 647);
  assert.equal(r.parts.billsPaid, 828.11);
  assert.deepEqual(r.parts.billsDue.map(b => b.date), ['2026-11-16', '2026-11-18', '2026-11-22', '2026-11-26', '2026-12-01', '2026-12-01', '2026-12-03']);
  assert.equal(dueTotal(r), 921.04);
  assert.equal(r.pool, 203.85);
  assert.equal(r.perDay, 33); // 203.85 / 6 = 33.97
  // the Dec 4 Claude Max charge is on pay day, so it is not due in this period
  assert.ok(!r.parts.billsDue.some(b => b.billId === 'b-claude'));
});

test('a bill already ticked in the next month is not in billsDue', () => {
  const s = addPay(migrate(sample), pay('p-nov20', '2026-11-20'));
  getMonth(s, '2026-12').paid['b-rent@2026-12-01'] = true;
  const r = safeToSpend(s, '2026-11-28');
  assert.ok(!r.parts.billsDue.some(b => b.billId === 'b-rent'));
  assert.equal(dueTotal(r), 333.54);
  // it was paid early, so the money is gone: it counts as paid and the pool does not grow
  assert.equal(r.parts.billsPaid, 1415.61);
  assert.equal(r.pool, 203.85);
  assert.equal(r.perDay, 33);
});

test('the year boundary: pay period runs to Jan 1', () => {
  const s = migrate(sample);
  ['2026-11-20', '2026-12-04', '2026-12-18'].forEach((d, i) => addPay(s, pay('p' + i, d)));
  getMonth(s, '2026-12').tx.push({ id: 'd1', date: '2026-12-10', item: 'i-groc', amt: 100, note: 'Costco' });
  const r = safeToSpend(s, '2026-12-28');
  assert.deepEqual(r.nextPay, { date: '2027-01-01', estimate: true, lastPay: '2026-12-18' });
  assert.equal(r.days, 4);
  assert.equal(r.parts.income, 2600);
  assert.equal(r.parts.spending, 100);
  assert.equal(r.parts.billsPaid, 0);
  assert.equal(r.parts.billsDue.length, 10);
  assert.equal(dueTotal(r), 1067.06);
  assert.ok(r.parts.billsDue.every(b => b.date < '2027-01-01'));
  assert.equal(r.pool, 1432.94);
  assert.equal(r.perDay, 358);
});

test('a future dated logged pay is the next pay and not income before its date', () => {
  const s = addPay(migrate(sample), pay('p-fut', '2026-11-19', 1250));
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.nextPay, { date: '2026-11-19', estimate: false, lastPay: '2026-11-06' });
  assert.equal(r.days, 5);
  assert.equal(r.parts.income, 1300);
  assert.deepEqual(r.parts.billsDue.map(b => b.billId), ['b-netflix', 'b-phone']);
  assert.equal(r.pool, -293.05);
  // on its date it counts
  const on = safeToSpend(s, '2026-11-19');
  assert.equal(on.parts.income, 2550);
  assert.deepEqual(on.nextPay, { date: '2026-12-03', estimate: true, lastPay: '2026-11-19' });
});

test('bills with no date are left out of billsDue', () => {
  const s = migrate(sample);
  s.bills.push({ id: 'b-bw', name: 'No anchor', amt: 12, freq: 'biweekly', anchor: null, note: '' });
  addPay(s, pay('p-nov20', '2026-11-20'));
  for (const today of ['2026-11-14', '2026-11-20', '2026-11-28']) {
    const r = safeToSpend(s, today);
    assert.ok(!r.parts.billsDue.some(b => b.billId === 'b-manga' || b.billId === 'b-bw'), today);
    assert.ok(r.parts.billsDue.every(b => !b.date.includes('?')), today);
  }
});

test('an unpaid bill earlier in the month is still due', () => {
  const s = migrate(sample);
  delete s.months['2026-11'].paid['b-icloud@2026-11-03'];
  const r = safeToSpend(s, '2026-11-14');
  assert.deepEqual(r.parts.billsDue.map(b => b.billId), ['b-icloud', 'b-netflix', 'b-phone']);
  assert.equal(r.parts.billsPaid, 823.52);
  assert.equal(r.pool, -293.05);
});

test('perDay is never negative and is whole dollars', () => {
  const r = safeToSpend(sample, '2026-11-14');
  assert.ok(r.pool < 0);
  assert.equal(r.perDay, 0);
  const big = clone(sample);
  big.months['2026-11'].tx.push({ id: 'huge', date: '2026-11-13', item: 'i-groc', amt: 99999, note: '' });
  assert.equal(safeToSpend(big, '2026-11-14').perDay, 0);
  // exact division stays exact
  const tiny = { bills: [], months: { '2026-11': { pays: [pay('p', '2026-11-20', 28)] } } };
  const t = safeToSpend(tiny, '2026-11-20');
  assert.equal(t.days, 14);
  assert.equal(t.pool, 28);
  assert.equal(t.perDay, 2);
  for (const today of ['2026-11-01', '2026-11-14', '2026-11-20', '2026-11-30', '2026-12-15']) {
    const x = safeToSpend(sample, today);
    assert.ok(Number.isInteger(x.perDay) && x.perDay >= 0, today);
  }
});
