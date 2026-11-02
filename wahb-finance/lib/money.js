// Month totals, next pay, pay period and safe to spend (docs/SPEC.md 5.1 to 5.3, and section 11).
// Pure ES module: no DOM, no Node APIs. Reads state, never changes it. All sums go through cents.
// Safe to spend follows the pay period, never the calendar month: the 1st of a month alone changes nothing.

import {
  sum, cents, peekMonth, billRows, billOccurrencesBetween, isBillPaid,
  addDays, daysBetween, isISODate, maxISO, todayISO,
} from './core.js';

// Same meaning as the original page's top cards.
export function monthTotals(state, monthKey) {
  const m = peekMonth(state, monthKey);
  const rows = billRows(state, monthKey); // includes bills with no date set, as the original did
  const earned = sum(m.pays, p => p.amt);
  const billsTotal = sum(rows, r => r.b.amt);
  const paid = sum(rows.filter(r => r.paid), r => r.b.amt);
  const spent = sum(m.tx, t => t.amt);
  const left = (cents(earned) - cents(billsTotal) - cents(spent)) / 100;
  return { earned, billsTotal, paid, spent, left };
}

// Every saved record of one list ('pays' or 'tx') across all months, skipping holes in old data.
const allOf = (state, list) => Object.values(state?.months || {})
  .flatMap(m => (m && Array.isArray(m[list]) ? m[list] : []))
  .filter(x => x && typeof x === 'object');

// A pay with kind 'income' (an Interac transfer or other money in, see lib/importer.js) is not a paycheque:
// it counts as income but never moves the payday. A pay with no kind (logged by hand, or saved before the
// field existed) or kind 'pay' is a paycheque.
const isPaycheque = p => p.kind !== 'income';

// Every paycheque date across all months, oldest first.
function payDates(state) {
  return allOf(state, 'pays').filter(isPaycheque).map(p => p.date).filter(isISODate).sort();
}

// {date, estimate, lastPay} or null when no paycheque was ever logged (never invent a date).
export function nextPay(state, today = todayISO()) {
  const dates = payDates(state);
  if (!dates.length) return null;
  const past = dates.filter(d => d <= today);
  const lastPay = past.length ? past[past.length - 1] : null;
  const future = dates.find(d => d > today);
  if (future) return { date: future, estimate: false, lastPay };
  // Every 14 days from the last pay, first date after today.
  const steps = Math.floor(daysBetween(lastPay, today) / 14) + 1;
  return { date: addDays(lastPay, 14 * steps), estimate: true, lastPay };
}

// From the last paycheque on or before today to the day before next pay. days counts today up to the
// day before next pay. null when no paycheque is dated on or before today (only future ones, or none).
export function payPeriod(state, today = todayISO()) {
  const np = nextPay(state, today);
  if (!np || !np.lastPay) return null;
  return { start: np.lastPay, end: addDays(np.date, -1), days: daysBetween(today, np.date), nextPay: np };
}

// How far back an unpaid bill from before the pay period still counts (SPEC 5.3).
const OLDER_DAYS = 62;

const billRow = (state, b, date) => ({ billId: b.id, name: b.name, date, amt: b.amt, paid: isBillPaid(state, b, date) });
// Dated occurrences of every bill from one day to another, oldest first, each with its own month's tick.
const occurrences = (state, from, to) => (from > to ? [] : (state?.bills || [])
  .flatMap(b => billOccurrencesBetween(b, from, to).map(date => billRow(state, b, date)))
  .sort((x, y) => x.date.localeCompare(y.date)));

/*
 safeToSpend(state, today) -> {perDay, pool, days, period:{start, end}, nextPay, parts:{
   pays:[{id,date,amt,note}], income, spending, billsInPeriod:[{billId,name,date,amt,paid}], billsTotal,
   olderUnpaid:[{billId,name,date,amt}], olderTotal }}
 or {missing:'pay'} when there is no pay period (no paycheque on or before today).
 pool = income - spending - billsTotal - olderTotal; perDay = floor(max(0, pool) / days), whole dollars.
*/
export function safeToSpend(state, today = todayISO()) {
  const period = payPeriod(state, today);
  if (!period) return { missing: 'pay' };
  const { start, end, days } = period;
  const inRange = (d, from, to) => isISODate(d) && d >= from && d <= to;

  // Money received since the period started: paycheques and kind 'income' alike. Not received yet: not counted.
  const pays = allOf(state, 'pays')
    .filter(p => inRange(p.date, start, today))
    .map(p => ({ id: p.id, date: p.date, amt: p.amt, note: p.note ?? '' }))
    .sort((x, y) => x.date.localeCompare(y.date));
  const income = sum(pays, p => p.amt);

  // Every purchase dated inside the period, Visa or chequing, future dated ones too (refunds are negative).
  const spending = sum(allOf(state, 'tx').filter(t => inRange(t.date, start, end)), t => t.amt);

  // Every dated bill of the period, paid or not: ticking a bill moves nothing, the money was set aside either way.
  const billsInPeriod = occurrences(state, start, end);
  const billsTotal = sum(billsInPeriod, b => b.amt);

  // Bills from before the period still unpaid, back to the first logged paycheque and at most 62 days.
  const from = maxISO(payDates(state)[0], addDays(start, -OLDER_DAYS));
  const olderUnpaid = occurrences(state, from, addDays(start, -1))
    .filter(b => !b.paid)
    .map(({ billId, name, date, amt }) => ({ billId, name, date, amt }));
  const olderTotal = sum(olderUnpaid, b => b.amt);

  const poolCents = cents(income) - cents(spending) - cents(billsTotal) - cents(olderTotal);
  // Whole dollars, floored, never negative. Integer maths so 28.00 / 14 is exactly 2.
  const perDay = Math.floor(Math.max(0, poolCents) / (days * 100));

  return {
    perDay, pool: poolCents / 100, days, period: { start, end }, nextPay: period.nextPay,
    parts: { pays, income, spending, billsInPeriod, billsTotal, olderUnpaid, olderTotal },
  };
}
