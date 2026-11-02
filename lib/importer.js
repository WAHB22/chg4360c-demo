// Import review (spec 6.6): turn rows from screenshots and statements into review rows with a status,
// a category, duplicate checks and bill matches, then apply the ticked ones. Pure ES module.
// Works on v1 data too: a saved tx without merchant/fp/src falls back to its note.

import { cents, daysBetween, findItem, findItemByName, fmtShort, getMonth, isBillPaid, isISODate, monthOf, round2, shortDate, sum, uid } from './core.js';
import { classifyMerchant, fingerprint, normalizeMerchant, prettyMerchant, similarMerchant } from './merchants.js';

const CATEGORY_KINDS = new Set(['expense', 'refund']); // rows that need a category
const PAY_KINDS = new Set(['pay', 'income']);          // rows that go to Paycheques
const DUP_DAYS = 3;

const within = (a, b) => isISODate(a) && isISODate(b) && Math.abs(daysBetween(a, b)) <= DUP_DAYS;
const gapOf = (a, b) => Math.abs(daysBetween(a, b));
const dirOf = r => (r?.direction === 'in' ? 'in' : 'out');
// A refund is saved as a negative expense, so it is compared with negative tx amounts.
const signedCents = r => (r.kind === 'refund' ? -1 : 1) * cents(Math.abs(Number(r.amount) || 0));
const findBill = (state, id) => ((state && state.bills) || []).find(b => b.id === id) || null;
const monthsOf = state => Object.values((state && state.months) || {}).filter(m => m && typeof m === 'object');

// Name shown for a saved expense: its note, else the merchant it was read as, else its category, else 'Other'.
function txName(state, tx) {
  const note = String(tx.note ?? '').trim();
  if (note) return note;
  if (tx.merchant) return prettyMerchant(tx.merchant);
  return findItem(state, tx.item)?.name || 'Other';
}

// The "Dates with Kylie" switch shown on Activities rows.
function altFor(state, itemId) {
  if (itemId == null) return null;
  const act = findItemByName(state, 'Activities'), kylie = findItemByName(state, 'Dates with Kylie');
  return act && kylie && itemId === act.id ? kylie.id : null;
}

// Merchant text is data and can hold a spaced hyphen ('Point of Sale - Interac ...'); UI text never shows one.
const noDash = s => String(s ?? '').replace(/\s+[-–—]+\s+/g, ' ').replace(/[–—]/g, ' ').replace(/\s+/g, ' ').trim();

// The note for Interac money in (SPEC 6.4 rule 3): 'Interac transfer', plus ' from <sender>' when the sender is
// visible. Never 'e-Transfer': notes are shown in the UI, and the UI never shows a hyphen. lib/merchants.js
// interacNote still words it 'Interac e-Transfer ...', so the note is reworded here, where it is written.
// Any other note is returned as is (trimmed).
const INTERAC_NOTE = /^interac\s+e\s*[-‐‑–—]?\s*transfers?(?=\s|$)/i;
export const incomeNote = note => String(note ?? '').trim().replace(INTERAC_NOTE, 'Interac transfer');

function dupText(d) {
  const when = isISODate(d.date) ? ' on ' + shortDate(d.date) : '';
  return `Possible duplicate of ${noDash(d.merchant)} ${fmtShort(Math.abs(Number(d.amt) || 0))}${when}`;
}

function statusOf(state, row) {
  if (row.kind === 'notspending') return { status: 'notspending', ticked: false, statusText: 'Not spending' };
  if (row.dup) return { status: 'dup', ticked: false, statusText: dupText(row.dup) };
  switch (row.kind) {
    case 'pay': return { status: 'pay', ticked: true, statusText: 'Goes to Paycheques' };
    case 'income': return { status: 'income', ticked: true, statusText: 'Income' };
    case 'bill': {
      const bill = findBill(state, row.billMatch?.billId);
      return { status: 'bill', ticked: true, statusText: `Ticks ${bill ? noDash(bill.name) : 'the bill'} paid` };
    }
    case 'refund': return { status: 'refund', ticked: true, statusText: 'Refund' };
    default: return { status: 'new', ticked: true, statusText: '' };
  }
}

/*
 Duplicate check (spec 6.6). Same amount in cents, similar merchant, dates within 3 days, against:
 (a) saved tx in any month, for expense and refund rows;
 (b) saved pays, amount only, for pay and income rows;
 (c) the bill occurrence already ticked paid, for bill rows;
 (d) earlier review rows from a different file (same direction; pay and income compare by amount only).
 Saved records are checked first; the closest date wins.
 `taken` (optional, a Set of 'tx:<id>', 'pay:<id>', 'row:<key>') holds records already matched by another row
 of the review: one saved coffee can only explain one of two identical coffees on a statement.
*/
const dupId = d => d.type + ':' + d.id;

export function findDuplicate(state, row, earlierRowsFromOtherFiles = [], taken = null) {
  if (!row) return null;
  const r = { ...row, direction: dirOf(row), norm: row.norm ?? normalizeMerchant(row.merchant) };
  if (r.kind === undefined) Object.assign(r, classifyMerchant(state, row));
  if (r.kind === 'notspending') return null;
  const isPay = PAY_KINDS.has(r.kind);
  const free = (type, id) => !taken || id == null || !taken.has(type + ':' + id);

  let best = null, bestGap = Infinity;
  const consider = (date, hit) => { const g = gapOf(r.date, date); if (g < bestGap) { best = hit; bestGap = g; } };

  if (r.kind === 'bill') {
    const bm = r.billMatch, bill = bm && findBill(state, bm.billId);
    if (bill && isBillPaid(state, bill, bm.date)) {
      return { type: 'bill', id: bill.id, date: bm.date, merchant: bill.name, amt: bill.amt, src: null };
    }
  } else if (isPay) {
    for (const m of monthsOf(state)) for (const p of m.pays || []) {
      if (p && free('pay', p.id) && cents(p.amt) === cents(r.amount) && within(p.date, r.date)) {
        consider(p.date, { type: 'pay', id: p.id, date: p.date, merchant: incomeNote(p.note) || 'Bobino pay', amt: p.amt, src: null });
      }
    }
  } else {
    const want = signedCents(r);
    for (const m of monthsOf(state)) for (const tx of m.tx || []) {
      if (!tx || !free('tx', tx.id) || cents(tx.amt) !== want || !within(tx.date, r.date)) continue;
      if (!similarMerchant(r.norm, normalizeMerchant(tx.merchant || tx.note || ''))) continue;
      consider(tx.date, { type: 'tx', id: tx.id, date: tx.date, merchant: txName(state, tx), amt: tx.amt, src: tx.src || 'manual' });
    }
  }
  if (best) return best;

  for (const o of earlierRowsFromOtherFiles || []) {
    if (!o || o.kind === 'notspending' || (r.fileId != null && o.fileId === r.fileId) || !free('row', o.key)) continue;
    if (dirOf(o) !== r.direction || !within(o.date, r.date)) continue;
    if (cents(Math.abs(Number(o.amount) || 0)) !== cents(Math.abs(Number(r.amount) || 0))) continue;
    if (isPay !== PAY_KINDS.has(o.kind)) continue;
    if (!isPay && !similarMerchant(r.norm, o.norm ?? normalizeMerchant(o.merchant))) continue;
    consider(o.date, { type: 'row', id: o.key, date: o.date, merchant: prettyMerchant(o.merchant), amt: o.amount, src: o.src });
  }
  return best;
}

// batches: [{fileId, name, src: 'screenshot'|'statement', rows}]. Rows keep their order; nothing is dropped.
// opts.today is accepted for the UI's convenience; no rule depends on it.
export function buildReview(state, batches, opts = {}) {
  const out = [];
  const taken = new Set(); // each saved record or earlier row explains at most one row
  const take = d => { if (d && d.type !== 'bill' && d.id != null) taken.add(dupId(d)); };
  (batches || []).forEach((batch, bi) => {
    const fileId = batch.fileId ?? 'file' + bi;
    (batch.rows || []).forEach((src, ri) => {
      const c = classifyMerchant(state, src);
      const row = {
        key: `f${bi}r${ri}`,
        fileId,
        src: batch.src || 'screenshot',
        date: src.date,
        time: src.time ?? null,
        merchant: src.merchant ?? '',
        norm: normalizeMerchant(src.merchant),
        amount: round2(Math.abs(Number(src.amount) || 0)),
        direction: dirOf(src),
        account: src.account ?? null,
        raw: src.raw ?? '',
        kind: c.kind,
        itemId: c.itemId,
        catSource: c.catSource,
        billMatch: c.billMatch,
        note: c.kind === 'income' ? incomeNote(c.note) : c.note,
        altItemId: altFor(state, c.itemId),
        remember: false,
        dup: null,
        ticked: false,
        status: '',
        statusText: '',
      };
      row.dup = findDuplicate(state, row, out.filter(o => o.fileId !== fileId), taken);
      take(row.dup);
      Object.assign(row, statusOf(state, row));
      out.push(row);
    });
  });
  return out;
}

// Every remembered pick in the rows: normalized merchant -> itemId (a later pick wins).
export function memoryOf(reviewRows) {
  const memory = {};
  for (const r of reviewRows || []) if (r && r.remember && r.norm && r.itemId != null) memory[r.norm] = r.itemId;
  return memory;
}

// The array is returned as is, with `memory` and `rows` attached (not enumerable),
// so both `rows = setCategory(...)` and `const { rows, memory } = setCategory(...)` work.
function withMemory(rows) {
  Object.defineProperty(rows, 'memory', { value: memoryOf(rows), enumerable: false, configurable: true });
  Object.defineProperty(rows, 'rows', { value: rows, enumerable: false, configurable: true });
  return rows;
}

// A copy of rows[j] with this category. A row of another kind (a bill, a pay) becomes an expense
// (money out) or a refund (money in); its duplicate check is redone as such.
function withCategory(state, rows, j, itemId, catSource, more) {
  const r = rows[j];
  const next = { ...r, itemId, catSource, ...more };
  if (!CATEGORY_KINDS.has(r.kind)) {
    next.kind = dirOf(r) === 'in' ? 'refund' : 'expense';
    next.billMatch = null;
    next.note = prettyMerchant(r.merchant);
    // Records already matched by the other rows stay theirs.
    const taken = new Set(rows.filter((o, k) => k !== j && o && o.dup && o.dup.type !== 'bill').map(o => dupId(o.dup)));
    next.dup = findDuplicate(state, next, rows.slice(0, j).filter(o => o.fileId !== r.fileId), taken);
    Object.assign(next, statusOf(state, next));
  }
  if (!('altItemId' in (more || {}))) next.altItemId = altFor(state, itemId);
  return next;
}

/*
 Picks a category for one row and returns new rows (the old array and rows are not changed).
 The pick is remembered for that merchant and also fills other rows with the same merchant that have
 no category from memory or a rule (rows he picked himself are left alone).
 The Activities / Dates with Kylie switch (itemId === row.altItemId) only changes that row, is not
 remembered, and can be tapped again to switch back.
 itemId null clears the row's category.
*/
export function setCategory(state, reviewRows, key, itemId) {
  const rows = [...(reviewRows || [])];
  const i = rows.findIndex(r => r && r.key === key);
  if (i < 0) return withMemory(rows);
  const row = rows[i];
  // Visa payments and own account transfers are never spending: a category pick cannot turn one into a refund.
  if (row.kind === 'notspending') return withMemory(rows);

  if (itemId == null) {
    if (CATEGORY_KINDS.has(row.kind)) rows[i] = { ...row, itemId: null, catSource: null, altItemId: null, remember: false };
    return withMemory(rows);
  }

  if (row.altItemId != null && itemId === row.altItemId) {
    rows[i] = withCategory(state, rows, i, itemId, 'user', { altItemId: row.itemId, remember: false });
    return withMemory(rows);
  }

  const remember = !!row.norm;
  rows[i] = withCategory(state, rows, i, itemId, 'user', { remember });
  if (remember) {
    rows.forEach((r, j) => {
      if (j === i || !r || r.norm !== row.norm) return;
      if (CATEGORY_KINDS.has(r.kind) && r.catSource == null) rows[j] = withCategory(state, rows, j, itemId, null, { remember: false });
      else if (r.remember) rows[j] = { ...r, remember: false }; // the latest pick is the one remembered
    });
  }
  return withMemory(rows);
}

/*
 Applies the ticked rows to state (mutates it):
 expense/refund -> tx in the month of its date (a refund is negative); pay/income -> pays;
 bill -> paid[key] = true in the month of the occurrence. Not spending rows are never applied.
 A ticked row whose date is not a real 'YYYY-MM-DD' (isISODate, strict: '2026-02-30' fails) is left out and
 counted in `skipped`, so nothing is ever saved into a wrong month; it never needs a category either.
 Then merges memory (default: the picks in the rows) into state.merchantMap.
 Throws, before changing anything, when a ticked expense or refund that would be applied has no category.

 Pays get one extra field, `kind` (the data contract allows extra fields; other builds keep them untouched):
   kind: 'pay'    a Bobino paycheque (the payroll rule),
   kind: 'income' other money in (Interac transfers, credits, anything that is not a paycheque).
 The payday estimate (next pay, pay period) must step only from paycheques, so it ignores kind 'income'.
 A pay with no kind (logged by hand, or saved before this field) is read as a paycheque.
*/
export function applyImport(state, reviewRows, memory) {
  const chosen = (reviewRows || []).filter(r => r && r.ticked && r.kind !== 'notspending');
  const ticked = chosen.filter(r => isISODate(r.date));
  const skipped = chosen.length - ticked.length;
  const missing = ticked.filter(r => CATEGORY_KINDS.has(r.kind) && !(r.itemId != null && findItem(state, r.itemId))).length;
  if (missing) {
    const err = new Error(missing === 1 ? '1 row needs a category' : `${missing} rows need a category`);
    err.count = missing;
    throw err;
  }

  const added = [];
  let pays = 0, bills = 0;
  for (const r of ticked) {
    const amount = round2(Math.abs(Number(r.amount) || 0));
    if (CATEGORY_KINDS.has(r.kind)) {
      const tx = {
        id: uid(),
        date: r.date,
        item: r.itemId,
        amt: r.kind === 'refund' ? -amount : amount,
        note: prettyMerchant(r.merchant),
        src: r.src || 'screenshot',
        fp: fingerprint(amount, r.merchant),
        merchant: r.merchant ?? '',
        account: r.account ?? null,
      };
      getMonth(state, monthOf(r.date)).tx.push(tx);
      added.push(tx);
    } else if (PAY_KINDS.has(r.kind)) {
      const note = r.kind === 'pay' ? 'Bobino pay' : incomeNote(r.note || classifyMerchant(state, r).note);
      getMonth(state, monthOf(r.date)).pays.push({ id: uid(), date: r.date, amt: amount, hours: null, note, kind: r.kind });
      pays++;
    } else if (r.kind === 'bill' && r.billMatch) {
      const m = getMonth(state, monthOf(r.billMatch.date));
      if (!m.paid[r.billMatch.key]) { m.paid[r.billMatch.key] = true; bills++; }
    }
  }

  const picks = memory ?? reviewRows?.memory ?? memoryOf(reviewRows);
  const entries = Object.entries(picks || {}).filter(([norm, id]) => norm && id != null && findItem(state, id));
  if (entries.length) {
    if (!state.merchantMap || typeof state.merchantMap !== 'object') state.merchantMap = {};
    for (const [norm, id] of entries) state.merchantMap[norm] = id;
  }

  return { expenses: added.length, pays, bills, total: sum(added, t => t.amt), skipped };
}
