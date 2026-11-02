// Chequing balance forecast (docs/SPEC.md 5.5). Pure ES module: no DOM, no Node APIs. Reads state, never changes it.
// The caller passes the next pay (lib/money.js nextPay) in opts, so this module does not depend on money.js.
// All maths runs in whole cents; balances come back rounded to cents.

import {
  addDays, addMonths, billOccurrencesBetween, cents, daysInMonth, fmtShort, isISODate, joinAnd,
  maxISO, minISO, monthEnd, monthOf, pad, peekMonth, savingsAccount, shortDate, todayISO, visaAccount,
} from './core.js';

const WINDOW_DAYS = 30;
const neg = c => (c ? -c : 0); // no -0 in the output

// 'Phone + Crave/Disney (Bell)' -> 'Phone + Crave', 'Rent (my half)' -> 'Rent'. Used in the lowest point note.
export function shortBillName(name) {
  const full = String(name ?? '').trim();
  const s = full.replace(/\s*\([^)]*\)/g, '').split('/')[0].trim();
  return s || full;
}

const monthsOf = state => Object.keys(state?.months || {});
const allTx = state => monthsOf(state).flatMap(k => peekMonth(state, k).tx).filter(t => t && isISODate(t.date));
const allPays = state => monthsOf(state).flatMap(k => peekMonth(state, k).pays).filter(p => p && isISODate(p.date));
const onVisa = t => t.account === 'visa';
// Category name without core's allItems, which throws on a group with no items list.
const itemName = (state, id) => (state.budget || []).flatMap(g => g?.items || []).find(i => i && i.id === id)?.name;
const txLabel = (state, t) => t.note || itemName(state, t.item) || 'Other';

// Visa account balance plus Visa purchases dated after its asOf (just the balance when it has no asOf).
export function visaOwing(state) {
  const visa = visaAccount(state);
  if (!visa) return 0;
  let c = cents(visa.bal);
  if (isISODate(visa.asOf)) for (const t of allTx(state)) if (onVisa(t) && t.date > visa.asOf) c += cents(t.amt);
  return c / 100;
}

// First date in [from, to] whose day is the due day (clamped to the month length).
function visaDueDate(dueDay, from, to) {
  for (let k = monthOf(from); k <= monthOf(to); k = addMonths(k, 1)) {
    const d = k + '-' + pad(Math.min(dueDay, daysInMonth(k)));
    if (d >= from && d <= to) return d;
  }
  return null;
}

const validDueDay = v => v != null && v !== '' && Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 31;

// Non Visa spending dated today−29 .. today, divided by 30, in cents (rounded). Never negative.
function dailySpendCents(state, today) {
  const first = addDays(today, -(WINDOW_DAYS - 1));
  const c = allTx(state).filter(t => !onVisa(t) && t.date >= first && t.date <= today).reduce((s, t) => s + cents(t.amt), 0);
  return Math.max(0, Math.round(c / WINDOW_DAYS));
}

function lowestNote(state, date) {
  const namesOn = d => [...new Set((state.bills || []).filter(b => billOccurrencesBetween(b, d, d).length).map(b => shortBillName(b.name)))];
  const on = namesOn(date);
  if (on.length) return 'the day of ' + joinAnd(on);
  const before = namesOn(addDays(date, -1));
  return before.length ? 'the day after ' + joinAnd(before) : '';
}

function negativeText(state, firstDate, need) {
  const sav = savingsAccount(state);
  const has = sav && sav.bal != null && sav.bal !== '' ? Number(sav.bal) : null;
  const when = shortDate(firstDate);
  if (!(has > 0)) return `Short ${fmtShort(need)} on ${when}`;
  return `Move ${fmtShort(Math.min(has, need))} from savings before ${when}`;
}

export function forecast(state, today = todayISO(), opts = {}) {
  const chq = state?.settings?.chequing;
  if (!chq || chq.bal == null || chq.bal === '' || !Number.isFinite(Number(chq.bal))) return { missing: 'chequing' };

  const np = opts?.nextPay && isISODate(opts.nextPay.date) ? opts.nextPay : null;
  const end = np ? maxISO(np.date, monthEnd(monthOf(today))) : monthEnd(monthOf(today));
  // The entered balance already includes its asOf day. A missing (or future) asOf counts as today.
  const asOf = isISODate(chq.asOf) ? minISO(chq.asOf, today) : today;
  const from = addDays(asOf, 1);
  const startC = cents(chq.bal);
  const dailyC = dailySpendCents(state, today);

  // Every event from the day after asOf to the end: {date, type, label, amt (signed cents), estimate}
  const events = [];
  const push = (date, type, label, amtC, estimate = false) => events.push({ date, type, label, amtC, estimate });

  const pays = allPays(state).filter(p => p.date >= from && p.date <= end);
  // A logged pay with no note is a Bobino paycheque, the same name the page shows for it.
  for (const p of pays) push(p.date, 'pay', p.note || 'Bobino pay', cents(p.amt));
  const planC = cents(state.settings?.payPlan);
  if (np && planC > 0) {
    // Only a logged paycheque replaces the estimate on its day. Money in with kind 'income' (an Interac
    // e-Transfer, see lib/importer.js) is added above but is not a paycheque, the same rule lib/money.js nextPay uses.
    const logged = new Set(pays.filter(p => p.kind !== 'income').map(p => p.date));
    for (let d = np.date; d <= end; d = addDays(d, 14)) {
      if (d >= from && d > today && !logged.has(d)) push(d, 'pay', 'Pay estimate', planC, true);
    }
  }

  for (const b of state.bills || []) {
    for (const d of billOccurrencesBetween(b, from, end)) push(d, 'bill', b.name, neg(cents(b.amt)));
  }

  const owing = visaOwing(state);
  const dueDay = state.settings?.visaDueDay;
  let visaMarker = null;
  if (validDueDay(dueDay)) {
    // Searched from the day after the balance date, like every other event: a due date between asOf and
    // today has come out of chequing after the balance was entered, so it is in today's point.
    const d = visaDueDate(Number(dueDay), from, end);
    if (d && owing > 0) push(d, 'visa', 'Visa payment', neg(cents(owing)));
    else if (owing > 0) {
      // The next due date falls after the range: shown as a marker, not taken out.
      const next = visaDueDate(Number(dueDay), addDays(end, 1), addDays(end, 62));
      if (next) visaMarker = { amt: owing, text: `Visa payment of ${fmtShort(owing)} is due ${shortDate(next)}, after this forecast.` };
    }
  } else if (owing > 0) {
    visaMarker = { amt: owing, text: `Visa owing ${fmtShort(owing)}. Set its due date to include it.` };
  }

  for (const t of allTx(state)) {
    if (!onVisa(t) && t.date >= from && t.date <= today) push(t.date, 'spend', txLabel(state, t), neg(cents(t.amt)));
  }
  // No spending in the last 30 days: no $0 estimate events (nothing is estimated, so nothing is labelled estimate).
  if (dailyC > 0) for (let d = maxISO(from, addDays(today, 1)); d <= end; d = addDays(d, 1)) push(d, 'spend', 'Spending estimate', neg(dailyC), true);

  // Stable sort keeps pays, bills, Visa, spending in that order inside a day.
  events.sort((a, b) => a.date.localeCompare(b.date));

  // One point per day from today. Today's point also carries everything between asOf and today.
  const points = [];
  let balC = startC, i = 0;
  for (let d = today; d <= end; d = addDays(d, 1)) {
    const evs = [];
    while (i < events.length && events[i].date <= d) evs.push(events[i++]);
    balC += evs.reduce((s, e) => s + e.amtC, 0);
    points.push({
      date: d,
      bal: balC / 100,
      estimate: evs.some(e => e.estimate),
      events: evs.map(e => ({ date: e.date, type: e.type, label: e.label, amt: e.amtC / 100, estimate: e.estimate })),
    });
  }

  let low = points[0];
  for (const p of points) if (p.bal < low.bal) low = p;
  const lowest = { date: low.date, bal: low.bal, note: lowestNote(state, low.date) };

  let negative = null;
  const firstNeg = points.find(p => p.bal < 0);
  if (firstNeg) {
    const need = Math.ceil(-cents(low.bal) / 1000) * 10; // whole dollars, rounded up to the next $10
    negative = { firstDate: firstNeg.date, need, text: negativeText(state, firstNeg.date, need) };
  }

  return { start: { date: asOf, bal: startC / 100 }, end, dailySpend: dailyC / 100, points, lowest, negative, visaMarker };
}
