// Shared helpers. Pure ES module: no DOM, no Node APIs. Used by the page and by the API functions.
// Dates are local calendar dates as 'YYYY-MM-DD' strings. Months are 'YYYY-MM' keys.

export const pad = n => String(n).padStart(2, '0');
export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- dates ---------- */
export const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const todayISO = () => isoOf(new Date());
// Noon avoids daylight saving edge cases when adding days.
export const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); };
// Strict: '2026-02-30' and '2026-13-01' are rejected (they would roll over to another date).
export const isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(parseISO(s)) === s;
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
export const monthOf = iso => String(iso).slice(0, 7);
export const daysInMonth = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const monthStart = key => key + '-01';
export const monthEnd = key => key + '-' + pad(daysInMonth(key));
export const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1, 12); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
export const maxISO = (a, b) => (a > b ? a : b);
export const minISO = (a, b) => (a < b ? a : b);

/* ---------- money ---------- */
export const cents = n => Math.round(Number(n || 0) * 100);
export const round2 = n => Math.round(Number(n || 0) * 100) / 100;
// Exact sum through cents, so 0.1 + 0.2 style errors never reach the screen.
export const sum = (arr, f = x => x) => arr.reduce((s, x) => s + cents(f(x)), 0) / 100;
export const fmt = n => { n = Number(n) || 0; return (n < 0 ? '-' : '') + '$' + Math.abs(round2(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
export const fmt0 = n => { n = Number(n) || 0; return (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-CA', { maximumFractionDigits: 0 }); };
// "$1,300" when whole, "$6.58" otherwise.
export const fmtShort = n => (cents(n) % 100 === 0 ? fmt0(n) : fmt(n)); // NaN or missing shows $0
export const num = v => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

/* ---------- text ---------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const shortDate = iso => parseISO(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); // "Nov 14"
export const monthName = key => parseISO(key + '-01').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }); // "November 2026"
export const monthShort = key => parseISO(key + '-01').toLocaleDateString('en-CA', { month: 'short' }); // "Nov"
// "A", "A and B", "A, B and C"
export const joinAnd = list => list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];

/* ---------- state access ---------- */
const EMPTY_MONTH = Object.freeze({ paid: Object.freeze({}), tx: Object.freeze([]), pays: Object.freeze([]), moves: Object.freeze([]) });
// Read only: never creates a month. Missing arrays read as empty.
export function peekMonth(state, key) {
  const m = state && state.months && state.months[key];
  if (!m) return EMPTY_MONTH;
  return { paid: m.paid || {}, tx: m.tx || [], pays: m.pays || [], moves: m.moves || [] };
}
// For writes inside an action: creates the month and any missing list.
export function getMonth(state, key) {
  state.months ||= {};
  const m = (state.months[key] ||= {});
  m.paid ||= {}; m.tx ||= []; m.pays ||= []; m.moves ||= [];
  return m;
}
export const allItems = state => (state.budget || []).flatMap(g => (g.items || []).map(i => ({ ...i, group: g.name, groupId: g.id })));
export const findItem = (state, id) => allItems(state).find(i => i.id === id) || null;
export const findItemByName = (state, name) => {
  const n = String(name).toLowerCase();
  return allItems(state).find(i => i.name.toLowerCase() === n) || null;
};
export const findAccount = (state, kind, nameRe) => (state.accounts || []).find(a => a.kind === kind && nameRe.test(a.name)) || null;
export const chequingAccount = state => findAccount(state, 'asset', /chequ|check/i);
export const savingsAccount = state => findAccount(state, 'asset', /saving/i);
export const visaAccount = state => findAccount(state, 'debt', /visa|credit/i);

/* ---------- bills ---------- */
// Dates a bill falls on in one month. A monthly bill with no day gives ['YYYY-MM-??'] (shown as "no date set").
// Same rules as the original page: monthly day is clamped to the month length; biweekly steps 14 days from anchor.
export function billOccurrences(bill, monthKey) {
  const last = daysInMonth(monthKey);
  if (bill.freq === 'biweekly' && bill.anchor) {
    // Step in calendar days and compare date strings, so clock changes can never drop or shift a charge.
    const first = monthKey + '-01', lastDay = monthKey + '-' + pad(last), out = [];
    let d = addDays(bill.anchor, Math.floor(daysBetween(bill.anchor, first) / 14) * 14);
    while (d <= lastDay) { if (d >= first) out.push(d); d = addDays(d, 14); }
    return out;
  }
  if (!bill.day) return [monthKey + '-??'];
  return [monthKey + '-' + pad(Math.min(bill.day, last))];
}
// Dated occurrences with fromISO <= date <= toISO, across months. Bills with no date are left out.
export function billOccurrencesBetween(bill, fromISO, toISO) {
  const out = [];
  for (let k = monthOf(fromISO); k <= monthOf(toISO); k = addMonths(k, 1)) {
    for (const d of billOccurrences(bill, k)) if (!d.endsWith('??') && d >= fromISO && d <= toISO) out.push(d);
  }
  return out;
}
export const billKey = (bill, date) => bill.id + '@' + date;
export const isBillPaid = (state, bill, date) => !!peekMonth(state, monthOf(date)).paid[billKey(bill, date)];
// Every bill occurrence in a month, sorted by date: [{b, date, key, paid}]
export function billRows(state, monthKey) {
  const m = peekMonth(state, monthKey), rows = [];
  (state.bills || []).forEach(b => billOccurrences(b, monthKey).forEach(date => rows.push({ b, date, key: billKey(b, date), paid: !!m.paid[billKey(b, date)] })));
  return rows.sort((x, y) => x.date.localeCompare(y.date));
}

/* ---------- misc ---------- */
export const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
// JSON with sorted keys, for comparing two states regardless of key order.
// omitTop drops top level keys only (for example ['savedAt', 'note']); nested keys are always kept.
export function canonical(o, omitTop = []) {
  const skip = new Set(omitTop);
  const walk = v => Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.keys(v).sort().reduce((a, k) => (a[k] = walk(v[k]), a), {})
    : v;
  const top = o && typeof o === 'object' && !Array.isArray(o)
    ? Object.keys(o).filter(k => !skip.has(k)).reduce((a, k) => (a[k] = o[k], a), {})
    : o;
  return JSON.stringify(walk(top));
}
