import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spentByItem, effectiveLimit, bars, coverSuggestion, applyCover, raiseSuggestion, applyRaise, totalLimits,
} from '../lib/budget.js';
import { clone, cents, fmtShort, getMonth, joinAnd, monthShort, findItem } from '../lib/core.js';
import { migrate } from '../lib/migrate.js';
import sample from './fixtures/sample-nov.js';

const NOV = '2026-11';
const TODAY = '2026-11-14';
const flat = (s, k) => bars(s, k).flatMap(g => g.items);
const bar = (s, k, id) => flat(s, k).find(i => i.id === id);
const tx = (id, date, item, amt) => ({ id, date, item, amt, note: '' });
const move = (id, date, from, to, amt) => ({ id, date, from, to, amt });

// Tiny seeded random generator (mulberry32) so the property tests are repeatable.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- spent and bars ---------- */

test('spentByItem for the November sample (v1 month without moves)', () => {
  assert.deepEqual(spentByItem(sample, NOV), {
    'i-groc': 278.65, 'i-catfood': 28, 'i-gas': 58, 'i-eat': 64.8, 'i-kylie': 120, 'i-coffee': 23.55, 'i-volley': 74,
  });
  assert.deepEqual(spentByItem(sample, '2026-12'), {});
  const s = clone(sample);
  s.months[NOV].tx.push(tx('a', '2026-11-13', 'i-groc', 0.1), tx('b', '2026-11-13', 'i-groc', 0.2), tx('c', '2026-11-13', 'i-groc', -10));
  assert.equal(spentByItem(s, NOV)['i-groc'], 268.95); // 278.65 + 0.10 + 0.20 − 10 (a refund), exact in cents
});

test('bars for the November sample', () => {
  const b = bars(sample, NOV);
  assert.deepEqual(b.map(g => [g.group, g.limit, g.spent]), [
    [{ id: 'g-food', name: 'Food' }, 700, 367],
    [{ id: 'g-pets', name: 'Pets' }, 55, 28],
    [{ id: 'g-trans', name: 'Transport' }, 60, 58],
    [{ id: 'g-pers', name: 'Personal' }, 529, 194],
  ]);
  const groc = bar(sample, NOV, 'i-groc');
  assert.deepEqual({ ...groc, pct: undefined, width: undefined }, {
    id: 'i-groc', name: 'Groceries', baseLimit: 400, limit: 400, spent: 278.65, pct: undefined, cls: 'green', width: undefined, room: 121.35,
  });
  assert.ok(Math.abs(groc.pct - 69.6625) < 1e-9);
  assert.equal(groc.width, groc.pct);
  assert.equal(bar(sample, NOV, 'i-catfood').cls, 'orange'); // 28 / 30 = 93.3%
  assert.equal(bar(sample, NOV, 'i-gas').cls, 'orange'); // 58 / 60 = 96.7%
  assert.equal(bar(sample, NOV, 'i-volley').cls, 'green'); // 74 / 104 = 71.2%
  assert.deepEqual(bar(sample, NOV, 'i-alc'), { id: 'i-alc', name: 'Alcohol', baseLimit: 0, limit: 0, spent: 0, pct: 0, cls: 'none', width: 0, room: 0 });
  // Migrated data gives the same bars
  assert.deepEqual(bars(migrate(sample), NOV), bars(sample, NOV));
});

test('bar colour and width boundaries', () => {
  const one = (limit, spent) => {
    const s = { budget: [{ id: 'g', name: 'G', items: [{ id: 'i', name: 'I', limit }] }], months: { [NOV]: { tx: spent == null ? [] : [tx('t', '2026-11-02', 'i', spent)] } } };
    const { cls, width, room } = bar(s, NOV, 'i');
    return [cls, width, room];
  };
  assert.deepEqual(one(100, 74.99), ['green', 74.99, 25.01]);
  assert.deepEqual(one(100, 75), ['orange', 75, 25]);
  assert.deepEqual(one(0.4, 0.3), ['orange', 75, 0.1]); // 75% exactly even where floats would say 74.999
  assert.deepEqual(one(100, 100), ['orange', 100, 0]);
  assert.deepEqual(one(100, 100.01), ['red', 100, -0.01]);
  assert.deepEqual(one(60, 90), ['red', 100, -30]);
  assert.deepEqual(one(0, 12), ['none', 100, 0]); // limit 0 with spending: full grey bar
  assert.deepEqual(one(0, null), ['none', 0, 0]);
  assert.deepEqual(one(50, -5), ['green', 0, 55]); // only a refund: empty bar, never a negative width
  assert.deepEqual(one(0, -5), ['none', 0, 0]);
});

// The original page's render() code for bars, ported as is (floats).
function originalBars(S, key) {
  const m = S.months[key] || { tx: [] };
  const spentBy = {}; m.tx.forEach(t => spentBy[t.item] = (spentBy[t.item] || 0) + Number(t.amt));
  return S.budget.map(g => ({
    gl: g.items.reduce((s, i) => s + i.limit, 0),
    gs: g.items.reduce((s, i) => s + (spentBy[i.id] || 0), 0),
    items: g.items.map(i => {
      const s = spentBy[i.id] || 0, pct = i.limit > 0 ? s / i.limit * 100 : 0;
      const cls = i.limit > 0 ? (pct > 100 ? 'red' : pct >= 75 ? 'orange' : '') : 'none';
      const w = i.limit > 0 ? Math.min(pct, 100) : (s > 0 ? 100 : 0);
      return { cls: cls || 'green', w };
    }),
  }));
}

// A random month: groups, items (some with limit 0), purchases, refunds, and (when withMoves) earlier moves.
function randomState(r, { withMoves = true, refunds = true } = {}) {
  const pick = a => a[Math.floor(r() * a.length)];
  const LIMITS = [0, 0, 10, 15, 25, 30, 50, 60, 100, 104, 150, 200, 400];
  let n = 0;
  const budget = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, g) => ({
    id: 'g' + g, name: 'Group ' + g,
    items: Array.from({ length: 1 + Math.floor(r() * 6) }, () => {
      const id = 'i' + n++;
      const limit = r() < 0.15 ? Math.round(r() * 50000) / 100 : pick(LIMITS);
      return { id, name: 'Item ' + id, limit };
    }),
  }));
  const items = budget.flatMap(g => g.items);
  const key = '2026-' + String(1 + Math.floor(r() * 12)).padStart(2, '0');
  const txs = [];
  for (const it of items) {
    const count = Math.floor(r() * 4);
    const scale = it.limit > 0 ? it.limit * (0.2 + r() * 0.8) : 40;
    for (let k = 0; k < count; k++) {
      const amt = Math.max(0.01, Math.round(r() * scale * 100) / 100);
      txs.push(tx('t' + txs.length, key + '-10', it.id, refunds && r() < 0.05 ? -amt : amt));
    }
  }
  const month = { paid: {}, tx: txs, pays: [] };
  if (withMoves && r() < 0.6) {
    month.moves = [];
    const funded = items.filter(i => i.limit >= 10);
    for (let k = 0; funded.length && k < Math.floor(r() * 4); k++) {
      const a = pick(funded), b = pick(items);
      if (a !== b) month.moves.push(move('m' + k, key + '-05', a.id, b.id, 1 + Math.floor(r() * 9)));
    }
  } // else: a v1 month with no moves list at all
  return { key, state: { version: 1, settings: { payPlan: 1300 }, bills: [], budget, accounts: [], months: { [key]: month } } };
}

test('bars match the original page for many random months', () => {
  const r = rng(11);
  for (let run = 0; run < 400; run++) {
    const { key, state } = randomState(r, { withMoves: false, refunds: false });
    const ours = bars(state, key), orig = originalBars(state, key);
    ours.forEach((g, gi) => {
      assert.equal(g.limit, Math.round(orig[gi].gl * 100) / 100);
      assert.equal(g.spent, Math.round(orig[gi].gs * 100) / 100);
      g.items.forEach((it, ii) => {
        assert.equal(it.cls, orig[gi].items[ii].cls, `run ${run} ${it.id}`);
        assert.ok(Math.abs(it.width - orig[gi].items[ii].w) < 1e-9, `run ${run} ${it.id} width`);
      });
    });
  }
});

test('effective limits follow the moves of that month only', () => {
  const s = clone(sample);
  getMonth(s, NOV).moves.push(move('m1', TODAY, 'i-cloth', 'i-gas', 20), move('m2', TODAY, 'i-cloth', 'i-catfood', 10));
  getMonth(s, '2026-12').moves.push(move('m3', '2026-12-02', 'i-gas', 'i-groc', 5));
  assert.equal(effectiveLimit(s, NOV, 'i-gas'), 80);
  assert.equal(effectiveLimit(s, NOV, 'i-catfood'), 40);
  assert.equal(effectiveLimit(s, NOV, 'i-cloth'), 120);
  assert.equal(effectiveLimit(s, NOV, 'i-groc'), 400);
  assert.equal(effectiveLimit(s, '2026-12', 'i-gas'), 55);
  assert.equal(effectiveLimit(s, '2026-10', 'i-gas'), 60);
  assert.equal(effectiveLimit(s, NOV, 'nope'), 0);
  const gas = bar(s, NOV, 'i-gas');
  assert.deepEqual([gas.baseLimit, gas.limit, gas.cls, gas.room], [60, 80, 'green', 22]); // 58 / 80 = 72.5%
  assert.equal(totalLimits(s, NOV), 1344); // 700 + 55 + 60 + 529: moves never change the month total
  assert.equal(totalLimits(sample, NOV), 1344);
});

/* ---------- Cover it ---------- */

test('cover suggestions on the November sample', () => {
  // Gas: 58 / 60 is orange. 58 / 0.75 − 60 + 0.01 = 17.34, up to $20. Clothing has the most room under 75% (112).
  assert.deepEqual(coverSuggestion(sample, NOV, 'i-gas'), { to: 'i-gas', needed: 20, from: [{ itemId: 'i-cloth', amt: 20 }], total: 20, partial: false });
  // Cat food: 28 / 0.75 − 30 + 0.01 = 7.34, up to $10.
  assert.deepEqual(coverSuggestion(sample, NOV, 'i-catfood'), { to: 'i-catfood', needed: 10, from: [{ itemId: 'i-cloth', amt: 10 }], total: 10, partial: false });
  assert.equal(coverSuggestion(sample, NOV, 'i-groc'), null); // green
  assert.equal(coverSuggestion(sample, NOV, 'i-alc'), null); // no limit
  assert.equal(coverSuggestion(sample, NOV, 'nope'), null);
});

test('needed rounds up to the next $5', () => {
  const needFor = (limit, spent) => {
    const s = { budget: [{ id: 'g', name: 'G', items: [{ id: 'a', name: 'A', limit }, { id: 'b', name: 'B', limit: 1000 }] }], months: { [NOV]: { tx: [tx('t', '2026-11-02', 'a', spent)] } } };
    return coverSuggestion(s, NOV, 'a')?.needed ?? null;
  };
  assert.equal(needFor(100, 105), 5); // red: 5.00 exactly stays 5
  assert.equal(needFor(100, 105.01), 10); // red: 5.01 -> 10
  assert.equal(needFor(100, 100.01), 5);
  assert.equal(needFor(100, 75), 5); // orange: 100.00 − 100 + 0.01 = 0.01 -> 5
  assert.equal(needFor(100, 90), 25); // orange: 120.00 − 100 + 0.01 = 20.01 -> 25
  assert.equal(needFor(100, 74.99), null); // green
});

// Sources for a hand made month: target T (limit 100, spent 150 = red, needs $50) and givers.
function coverMonth(givers) {
  const items = [{ id: 'T', name: 'Target', limit: 100 }, ...givers.map(([id, limit]) => ({ id, name: id, limit }))];
  const txs = [tx('t0', '2026-11-02', 'T', 150), ...givers.filter(g => g[2]).map(([id, , spent], k) => tx('t' + (k + 1), '2026-11-03', id, spent))];
  return { budget: [{ id: 'g', name: 'G', items }], months: { [NOV]: { paid: {}, tx: txs, pays: [] } } };
}

test('cover prefers keeping sources under 75%', () => {
  // A could give 60 of its room, but only 15 keeps it under 75% (0.75 × 100 − 60). B gives 37 the same way (0.75 × 50 = 37.5).
  const s = coverMonth([['A', 100, 60], ['B', 50, 0], ['C', 40, 0]]);
  // soft caps: B 37, C 30, A 15 -> B + C reach 50 with two sources
  assert.deepEqual(coverSuggestion(s, NOV, 'T'), { to: 'T', needed: 50, from: [{ itemId: 'B', amt: 37 }, { itemId: 'C', amt: 13 }], total: 50, partial: false });
});

test('cover uses as few sources as possible', () => {
  const s = coverMonth([['A', 20, 0], ['B', 20, 0], ['C', 100, 0], ['D', 20, 0]]);
  assert.deepEqual(coverSuggestion(s, NOV, 'T').from, [{ itemId: 'C', amt: 50 }]);
});

test('cover falls back to full room when staying under 75% is not enough', () => {
  // soft caps: A 15, B 7, C 7 = 29 < 50. Full room: A 40, B 12, C 10.
  const s = coverMonth([['A', 100, 60], ['B', 20, 8], ['C', 10, 0]]);
  const sug = coverSuggestion(s, NOV, 'T');
  // A and B (40 + 12 = 52) are enough: each gives its under 75% share first (15 and 7), then A gives 25 more and B 3 more.
  assert.deepEqual(sug, { to: 'T', needed: 50, from: [{ itemId: 'A', amt: 40 }, { itemId: 'B', amt: 10 }], total: 50, partial: false });
});

test('cover is partial when there is not enough room, and never uses more than 3 sources', () => {
  const s = coverMonth([['A', 10, 0], ['B', 10, 2.5], ['C', 10, 5], ['D', 10, 9.5], ['E', 30, 31]]);
  // full room floored: A 10, B 7, C 5, D 0 (0.50 left), E over its limit: top three give 22
  assert.deepEqual(coverSuggestion(s, NOV, 'T'), { to: 'T', needed: 50, from: [{ itemId: 'A', amt: 10 }, { itemId: 'B', amt: 7 }, { itemId: 'C', amt: 5 }], total: 22, partial: true });
  const alone = coverMonth([['E', 30, 31]]);
  assert.deepEqual(coverSuggestion(alone, NOV, 'T'), { to: 'T', needed: 50, from: [], total: 0, partial: true });
});

test('applyCover on the November sample', () => {
  const s = clone(sample);
  assert.equal(s.months[NOV].moves, undefined); // v1 month
  const sug = coverSuggestion(s, NOV, 'i-gas');
  const made = applyCover(s, NOV, sug, TODAY);
  assert.equal(made.length, 1);
  assert.deepEqual({ ...made[0], id: undefined }, { id: undefined, date: TODAY, from: 'i-cloth', to: 'i-gas', amt: 20 });
  assert.equal(typeof made[0].id, 'string');
  assert.deepEqual(s.months[NOV].moves, made);
  assert.equal(totalLimits(s, NOV), totalLimits(sample, NOV));
  assert.deepEqual([effectiveLimit(s, NOV, 'i-gas'), effectiveLimit(s, NOV, 'i-cloth')], [80, 130]);
  assert.equal(bar(s, NOV, 'i-gas').cls, 'green');
  assert.equal(coverSuggestion(s, NOV, 'i-gas'), null);
  // Other months untouched
  assert.deepEqual(s.months['2026-10'], sample.months['2026-10']);
  assert.deepEqual(applyCover(s, NOV, null, TODAY), []);
});

test('applyCover clamps a stale suggestion so no source goes below its spent', () => {
  const s = clone(sample);
  const sug = coverSuggestion(s, NOV, 'i-gas'); // 20 from Clothing
  s.months[NOV].tx.push(tx('late', '2026-11-13', 'i-cloth', 141.50)); // Clothing now has 8.50 of room
  const made = applyCover(s, NOV, sug, TODAY);
  assert.deepEqual(made.map(m => m.amt), [8]);
  assert.ok(effectiveLimit(s, NOV, 'i-cloth') >= 141.50);
  // A source listed twice cannot be drained past its room either
  const t = clone(sample);
  applyCover(t, NOV, { to: 'i-gas', needed: 200, from: [{ itemId: 'i-toys', amt: 8 }, { itemId: 'i-toys', amt: 8 }], total: 16, partial: false }, TODAY);
  assert.equal(effectiveLimit(t, NOV, 'i-toys'), 0);
  assert.equal(totalLimits(t, NOV), totalLimits(sample, NOV));
});

// Fewest sources (at most 3) whose caps reach needed, computed independently from the spec wording.
function minSources(caps, needed) {
  const top = caps.filter(c => c > 0).sort((a, b) => b - a).slice(0, 3);
  let total = 0;
  for (let k = 0; k < top.length; k++) if ((total += top[k]) >= needed) return { k: k + 1, enough: true };
  return { k: top.length, enough: false, total };
}

test('cover invariants over many random months', () => {
  const r = rng(2026);
  const seen = { soft: 0, full: 0, partial: 0, red: 0, orange: 0, offered: 0 };
  for (let run = 0; run < 2000; run++) {
    const { key, state } = randomState(r);
    const before = flat(state, key);
    for (const target of before) {
      const sug = coverSuggestion(state, key, target.id);
      if (!(target.limit > 0) || (target.cls !== 'orange' && target.cls !== 'red')) { assert.equal(sug, null); continue; }
      seen.offered++; seen[target.cls]++;
      const msg = `run ${run} ${target.id}`;

      // Shape
      assert.equal(sug.to, target.id);
      assert.ok(sug.needed > 0 && sug.needed % 5 === 0, msg);
      assert.ok(sug.from.length <= 3, msg);
      assert.equal(sug.total, sug.from.reduce((s, f) => s + f.amt, 0));
      assert.equal(new Set(sug.from.map(f => f.itemId)).size, sug.from.length);
      for (const f of sug.from) {
        const src = before.find(i => i.id === f.itemId);
        assert.ok(Number.isInteger(f.amt) && f.amt > 0, msg);
        assert.ok(src && src.id !== target.id && src.limit > 0 && src.room > 0, msg);
      }

      // Enough room, fewest sources, partial
      const others = before.filter(i => i.id !== target.id && i.limit > 0 && i.room > 0);
      const soft = minSources(others.map(i => Math.floor((3 * cents(i.limit) - 4 * cents(i.spent)) / 400)), sug.needed);
      const full = minSources(others.map(i => Math.floor((cents(i.limit) - cents(i.spent)) / 100)), sug.needed);
      if (full.enough) {
        assert.equal(sug.partial, false, msg);
        assert.equal(sug.total, sug.needed, msg);
        assert.equal(sug.from.length, soft.enough ? soft.k : full.k, msg);
        seen[soft.enough ? 'soft' : 'full']++;
      } else {
        assert.equal(sug.partial, true, msg);
        assert.equal(sug.total, full.total, msg);
        assert.equal(sug.from.length, full.k, msg);
        seen.partial++;
      }

      // Apply on a copy
      const s2 = clone(state);
      const made = applyCover(s2, key, sug, TODAY);
      assert.deepEqual(made.map(m => [m.from, m.to, m.amt, m.date]), sug.from.map(f => [f.itemId, target.id, f.amt, TODAY]));
      assert.equal(cents(totalLimits(s2, key)), cents(totalLimits(state, key)), msg + ' totalLimits');
      const after = flat(s2, key);
      for (const it of after) {
        const was = before.find(i => i.id === it.id);
        if (cents(was.limit) >= cents(was.spent)) assert.ok(cents(it.limit) >= cents(it.spent), msg + ' ' + it.id + ' went below spent');
        if (sug.from.some(f => f.itemId === it.id)) {
          assert.ok(cents(it.limit) >= cents(it.spent), msg + ' source below spent');
          if (soft.enough) assert.ok(it.pct < 75, msg + ' source pushed over 75%');
        }
      }
      const t2 = after.find(i => i.id === target.id);
      assert.equal(cents(t2.limit), cents(target.limit) + sug.total * 100);
      if (!sug.partial) assert.ok(target.cls === 'red' ? t2.pct <= 100 : t2.pct < 75, msg + ' still needs cover');
    }
  }
  // Every branch was exercised
  for (const k of Object.keys(seen)) assert.ok(seen[k] > 20, `only ${seen[k]} ${k} cases`);
});

/* ---------- raise ---------- */

function toppedUp() {
  const s = clone(sample);
  getMonth(s, '2026-09').moves.push(move('m9', '2026-09-24', 'i-cloth', 'i-groc', 70));
  getMonth(s, '2026-10').moves.push(move('m10a', '2026-10-12', 'i-cloth', 'i-groc', 50), move('m10b', '2026-10-27', 'i-kylie', 'i-groc', 30));
  getMonth(s, NOV).moves.push(move('m11', TODAY, 'i-cloth', 'i-groc', 75));
  return s;
}

test('raise after three months of top ups', () => {
  const s = toppedUp();
  const sug = raiseSuggestion(s, NOV, 'i-groc');
  // moved in: Sep 70, Oct 50 + 30 = 80, Nov 75. Average 225 / 3 = 75. 400 + 75 = 475, up to $480.
  assert.deepEqual(sug, { itemId: 'i-groc', months: ['2026-09', '2026-10', '2026-11'], newLimit: 480 });
  const name = findItem(s, sug.itemId).name;
  const text = `${name} topped up ${joinAnd(sug.months.map(monthShort))}. Make it ${fmtShort(sug.newLimit)}?`;
  assert.equal(text, 'Groceries topped up Sep, Oct and Nov. Make it $480?');

  // Moves out of Groceries are not top ups; Clothing gave every month and gets nothing.
  assert.equal(raiseSuggestion(s, NOV, 'i-cloth'), null);
  // Only two months end at October (Aug has none)
  assert.equal(raiseSuggestion(s, '2026-10', 'i-groc'), null);
  // December has no top up yet
  assert.equal(raiseSuggestion(s, '2026-12', 'i-groc'), null);
  assert.equal(raiseSuggestion(s, NOV, 'nope'), null);
});

test('raise needs a top up in each of the three months', () => {
  const s = toppedUp();
  s.months['2026-10'].moves = [];
  assert.equal(raiseSuggestion(s, NOV, 'i-groc'), null);
  // A whole number average stays: 60, 60, 60 -> 400 + 60 = 460
  const t = clone(sample);
  for (const k of ['2026-09', '2026-10', NOV]) getMonth(t, k).moves.push(move('m' + k, k + '-10', 'i-cloth', 'i-groc', 60));
  assert.equal(raiseSuggestion(t, NOV, 'i-groc').newLimit, 460);
  // Cents: 10.01 each month -> 410.01, up to 420
  const u = clone(sample);
  for (const k of ['2026-09', '2026-10', NOV]) getMonth(u, k).moves.push(move('m' + k, k + '-10', 'i-cloth', 'i-groc', 10.01));
  assert.equal(raiseSuggestion(u, NOV, 'i-groc').newLimit, 420);
});

test('raise across the new year', () => {
  const s = clone(sample);
  for (const k of ['2026-11', '2026-12', '2027-01']) getMonth(s, k).moves.push(move('m' + k, k + '-10', 'i-cloth', 'i-gas', 20));
  assert.deepEqual(raiseSuggestion(s, '2027-01', 'i-gas'), { itemId: 'i-gas', months: ['2026-11', '2026-12', '2027-01'], newLimit: 80 });
});

test('applyRaise sets the base limit only', () => {
  const s = toppedUp();
  const item = applyRaise(s, raiseSuggestion(s, NOV, 'i-groc'));
  assert.equal(item.limit, 480);
  assert.equal(s.budget[0].items[0].limit, 480);
  assert.equal(bar(s, NOV, 'i-groc').baseLimit, 480);
  assert.equal(effectiveLimit(s, NOV, 'i-groc'), 555); // 480 + the 75 moved in this month
  assert.equal(bar(s, NOV, 'i-cloth').baseLimit, 150);
  assert.equal(applyRaise(s, { itemId: 'nope', newLimit: 5 }), null);
  assert.equal(applyRaise(s, null), null);
});

test('reading functions never change the state', () => {
  const s = clone(sample);
  spentByItem(s, NOV); bars(s, NOV); totalLimits(s, NOV); effectiveLimit(s, NOV, 'i-gas');
  coverSuggestion(s, NOV, 'i-gas'); raiseSuggestion(s, NOV, 'i-groc'); bars(s, '2027-05');
  assert.deepEqual(s, sample);
});
