// Spending limits: spent per item, effective limits with moves, bars, Cover it and raise suggestions (docs/SPEC.md 5.4).
// Pure ES module: no DOM, no Node APIs. Every function only reads state, except applyCover and applyRaise,
// which change the draft they are given (call them inside app.act). All money maths runs in whole cents.

import { addMonths, cents, getMonth, peekMonth, todayISO, uid } from './core.js';

const MAX_SOURCES = 3;

/* ---------- internal, in cents ---------- */

// The stored item by id. Unlike core's allItems, a group with no items list does not throw.
function itemById(state, id) {
  for (const g of state?.budget || []) for (const i of g?.items || []) if (i && i.id === id) return i;
  return null;
}

// {itemId: cents spent}. Refunds are negative tx and lower the total.
function spentCents(state, monthKey) {
  const out = {};
  for (const t of peekMonth(state, monthKey).tx) if (t) out[t.item] = (out[t.item] || 0) + cents(t.amt);
  return out;
}

// {itemId: cents moved in minus cents moved out} for that month.
function moveCents(state, monthKey) {
  const out = {};
  for (const mv of peekMonth(state, monthKey).moves) {
    if (!mv || mv.from === mv.to) continue;
    const c = cents(mv.amt);
    if (mv.to != null) out[mv.to] = (out[mv.to] || 0) + c;
    if (mv.from != null) out[mv.from] = (out[mv.from] || 0) - c;
  }
  return out;
}

// Every item of the month in budget order: [{item, group, baseC, limitC, spentC}]
function rows(state, monthKey) {
  const spent = spentCents(state, monthKey), moved = moveCents(state, monthKey);
  return (state.budget || []).flatMap(g => (g.items || []).map(item => {
    const baseC = cents(item.limit);
    return { item, group: g, baseC, limitC: baseC + (moved[item.id] || 0), spentC: spent[item.id] || 0 };
  }));
}

// Same colours and widths as the original page; pct is computed from cents so 75% and 100% land exactly.
function barOf(r) {
  const { item, baseC, limitC, spentC } = r;
  const pct = limitC > 0 ? spentC * 100 / limitC : 0;
  const cls = limitC > 0 ? (pct > 100 ? 'red' : pct >= 75 ? 'orange' : 'green') : 'none';
  // Clamped at 0: a month where refunds outweigh spending must not draw a negative width.
  const width = limitC > 0 ? Math.max(0, Math.min(pct, 100)) : (spentC > 0 ? 100 : 0);
  const room = limitC > 0 ? (limitC - spentC) / 100 : 0;
  return { id: item.id, name: item.name, baseLimit: baseC / 100, limit: limitC / 100, spent: spentC / 100, pct, cls, width, room };
}

/* ---------- reading ---------- */

export function spentByItem(state, monthKey) {
  const c = spentCents(state, monthKey);
  return Object.fromEntries(Object.entries(c).map(([id, v]) => [id, v / 100]));
}

export function effectiveLimit(state, monthKey, itemId) {
  const item = itemById(state, itemId);
  return (cents(item ? item.limit : 0) + (moveCents(state, monthKey)[itemId] || 0)) / 100;
}

export function bars(state, monthKey) {
  const all = rows(state, monthKey);
  return (state.budget || []).map(g => {
    const mine = all.filter(r => r.group === g);
    return {
      group: { id: g.id, name: g.name },
      limit: mine.reduce((s, r) => s + r.limitC, 0) / 100,
      spent: mine.reduce((s, r) => s + r.spentC, 0) / 100,
      items: mine.map(barOf),
    };
  });
}

export const totalLimits = (state, monthKey) => rows(state, monthKey).reduce((s, r) => s + r.limitC, 0) / 100;

/* ---------- Cover it ---------- */

// Whole dollars needed, rounded up to the next $5.
// red: back to 100%. orange: spent / 0.75 − limit + 0.01, which brings it under 75%. Integer maths on cents.
function neededDollars(limitC, spentC, cls) {
  const steps = cls === 'red'
    ? Math.ceil((spentC - limitC) / 500)
    : Math.ceil((4 * spentC - 3 * limitC + 3) / 1500);
  return steps * 5;
}

// What a source can give, in whole dollars, floored.
// soft keeps it under 75% (give ≤ limit × 0.75 − spent); full keeps its limit at or above what it already spent.
const softCap = r => Math.max(0, Math.floor((3 * r.limitC - 4 * r.spentC) / 400));
const fullCap = r => Math.max(0, Math.floor((r.limitC - r.spentC) / 100));
const roomC = r => r.limitC - r.spentC;

// The spec's source order: most room first. More to give under 75% breaks a tie, then budget order.
const inRoomOrder = sources => [...sources].sort((a, b) => roomC(b) - roomC(a) || softCap(b) - softCap(a));

// The fewest sources (at most 3) whose caps reach needed. Among the sets of that size, the first one in
// room order, so the items with the most room give first. null when no 3 sources are enough.
// sources must already be in room order.
function choose(sources, cap, needed) {
  const list = sources.map(r => ({ r, cap: cap(r) })).filter(x => x.cap > 0);
  const biggest = list.map(x => x.cap).sort((a, b) => b - a);
  const first = (k, start, picked, total) => {
    if (picked.length === k) return total >= needed ? picked : null;
    for (let i = start; i <= list.length - (k - picked.length); i++) {
      const got = first(k, i + 1, [...picked, list[i]], total + list[i].cap);
      if (got) return got;
    }
    return null;
  };
  let best = 0;
  for (let k = 1; k <= Math.min(MAX_SOURCES, list.length); k++) {
    best += biggest[k - 1];
    if (best >= needed) return first(k, 0, [], 0); // some k sources are enough: find the first such set
  }
  return null;
}

export function coverSuggestion(state, monthKey, itemId) {
  const all = rows(state, monthKey);
  const target = all.find(r => r.item.id === itemId);
  if (!target || target.limitC <= 0) return null;
  const { cls } = barOf(target);
  if (cls !== 'orange' && cls !== 'red') return null;

  const needed = neededDollars(target.limitC, target.spentC, cls);
  const sources = inRoomOrder(all.filter(r => r.item.id !== itemId && r.limitC > 0 && roomC(r) > 0));
  const give = new Map(); // itemId -> dollars
  const add = (r, amt) => { if (amt > 0) give.set(r.item.id, (give.get(r.item.id) || 0) + amt); };
  let partial = false;

  const soft = choose(sources, softCap, needed);
  if (soft) {
    let left = needed;
    for (const { r, cap } of soft) { const a = Math.min(cap, left); add(r, a); left -= a; }
  } else {
    const full = choose(sources, fullCap, needed);
    if (full) {
      // Each chosen source first gives what keeps it under 75%, then the rest comes from full room in order.
      let left = needed;
      for (const { r } of full) { const a = Math.min(softCap(r), left); add(r, a); left -= a; }
      for (const { r, cap } of full) { const a = Math.min(cap - (give.get(r.item.id) || 0), left); add(r, a); left -= a; }
    } else {
      // Not enough room anywhere: offer everything the 3 roomiest sources can give.
      for (const r of sources.filter(r => fullCap(r) > 0).slice(0, MAX_SOURCES)) add(r, fullCap(r));
      partial = true;
    }
  }

  // Listed most room first, whichever pass added each source.
  const from = sources.filter(r => give.has(r.item.id)).map(r => ({ itemId: r.item.id, amt: give.get(r.item.id) }));
  const total = from.reduce((s, f) => s + f.amt, 0);
  return { to: itemId, needed, from, total, partial: partial || total < needed };
}

// Pushes one move per source into that month. Amounts are clamped to each source's current room,
// so even a stale suggestion can never push a limit below what was already spent.
export function applyCover(state, monthKey, suggestion, today = todayISO()) {
  if (!suggestion || !Array.isArray(suggestion.from)) return [];
  const byId = new Map(rows(state, monthKey).map(r => [r.item.id, r]));
  if (!byId.has(suggestion.to)) return [];
  let m = null; // the month is only touched once a move is really made
  const made = [];
  for (const f of suggestion.from) {
    const src = f && byId.get(f.itemId);
    if (!src || f.itemId === suggestion.to || src.limitC <= 0) continue;
    const amt = Math.min(Math.floor(Number(f.amt) || 0), fullCap(src));
    if (amt <= 0) continue;
    const mv = { id: uid(), date: today, from: f.itemId, to: suggestion.to, amt };
    (m ||= getMonth(state, monthKey)).moves.push(mv);
    made.push(mv);
    src.limitC -= amt * 100;
  }
  return made;
}

/* ---------- raise the base limit ---------- */

// Topped up in each of the 3 months ending at monthKey.
// newLimit = base + average moved in per month, rounded up to the next $10.
export function raiseSuggestion(state, monthKey, itemId) {
  const item = itemById(state, itemId);
  if (!item) return null;
  const months = [addMonths(monthKey, -2), addMonths(monthKey, -1), monthKey];
  const inC = months.map(k => peekMonth(state, k).moves
    .filter(mv => mv && mv.to === itemId && mv.from !== itemId)
    .reduce((s, mv) => s + cents(mv.amt), 0));
  if (inC.some(c => c <= 0)) return null;
  const totalC = inC.reduce((s, c) => s + c, 0);
  const newLimit = Math.ceil((3 * cents(item.limit) + totalC) / 3000) * 10;
  return { itemId, months, newLimit };
}

// Sets the item's base limit. Returns the item, or null when it no longer exists.
export function applyRaise(state, suggestion) {
  if (!suggestion) return null;
  const item = itemById(state, suggestion.itemId);
  if (item) item.limit = suggestion.newLimit;
  return item;
}
