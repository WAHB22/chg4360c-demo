// Month totals, next pay, pay period and safe to spend (docs/SPEC.md 5.1 to 5.3).
// Pure ES module: no DOM, no Node APIs. Reads state, never changes it. All sums go through cents.

import {
  sum, cents, peekMonth, billRows, billOccurrencesBetween, isBillPaid,
  monthOf, monthStart, monthEnd, addDays, daysBetween, isISODate, todayISO,
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

// Every logged pay date across all months, oldest first.
function payDates(state) {
  return Object.values(state?.months || {})
    .flatMap(m => (m && Array.isArray(m.pays) ? m.pays : []))
    .map(p => p && p.date)
    .filter(isISODate)
    .sort();
}

// {date, estimate, lastPay} or null when no pay was ever logged (never invent a date).
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

// Today up to the day before next pay. days counts today.
export function payPeriod(state, today = todayISO()) {
  const np = nextPay(state, today);
  if (!np) return null;
  return { start: today, end: addDays(np.date, -1), days: daysBetween(today, np.date), nextPay: np };
}

// Dated occurrences of every bill between two days: [{b, date}]
const occurrences = (state, from, to) =>
  (state.bills || []).flatMap(b => billOccurrencesBetween(b, from, to).map(date => ({ b, date })));

export function safeToSpend(state, today = todayISO()) {
  const period = payPeriod(state, today);
  if (!period) return { missing: 'pay' };
  const M = monthOf(today);
  const m = peekMonth(state, M);

  // Money not received yet does not count.
  const income = sum(m.pays.filter(p => p && isISODate(p.date) && p.date <= today), p => p.amt);
  const spending = sum(m.tx, t => t.amt);

  // Ticked in M, plus next month bills inside this pay period that were ticked early:
  // that money already left, and they are no longer due, so they count as paid.
  const early = occurrences(state, addDays(monthEnd(M), 1), period.end).filter(o => isBillPaid(state, o.b, o.date));
  const billsPaid = sum([...billRows(state, M).filter(r => r.paid), ...early], r => r.b.amt);

  // Unpaid dated bills from the first of M up to the day before next pay (each checked in its own month).
  const billsDue = occurrences(state, monthStart(M), period.end)
    .filter(o => !isBillPaid(state, o.b, o.date))
    .map(o => ({ billId: o.b.id, name: o.b.name, date: o.date, amt: o.b.amt }))
    .sort((x, y) => x.date.localeCompare(y.date));

  const poolCents = cents(income) - cents(spending) - cents(billsPaid) - cents(sum(billsDue, x => x.amt));
  const days = period.days;
  // Whole dollars, floored, never negative. Integer maths so 28.00 / 14 is exactly 2.
  const perDay = Math.floor(Math.max(0, poolCents) / (days * 100));

  return { perDay, pool: poolCents / 100, days, nextPay: period.nextPay, parts: { income, spending, billsPaid, billsDue } };
}
