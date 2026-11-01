// Reviewer tests for lib/budget.js (SPEC 5.4) and lib/forecast.js (SPEC 5.5): spec rules and edge cases
// the first round of tests did not pin down. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  spentByItem, effectiveLimit, bars, coverSuggestion, applyCover, raiseSuggestion, applyRaise, totalLimits,
} from '../lib/budget.js';
import { forecast, visaOwing } from '../lib/forecast.js';
import { canonical, cents, clone, getMonth } from '../lib/core.js';
import { migrate } from '../lib/migrate.js';
import sample from './fixtures/sample-nov.js';
import fsample, { today as FTODAY, nextPay as FNEXT } from './fixtures/forecast-sample.js';

const NOV = '2026-11';
const TODAY = '2026-11-14';
const flat = (s, k) => bars(s, k).flatMap(g => g.items);
const bar = (s, k, id) => flat(s, k).find(i => i.id === id);
const tx = (id, date, item, amt, extra = {}) => ({ id, date, item, amt, note: '', ...extra });
const move = (id, date, from, to, amt) => ({ id, date, from, to, amt });
const at = (r, date) => r.points.find(p => p.date === date);
const DASHES = /[–—]| - /;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

// mulberry32, so the random months are the same on every run
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One month with limits, spending, refunds and earlier moves (some into limit 0 items), or a v1 month with no moves list.
function randomMonth(r) {
  const pick = a => a[Math.floor(r() * a.length)];
  const LIMITS = [0, 10, 20, 25, 40, 50, 60, 75, 100, 150, 200, 300, 400, 1000];
  let n = 0;
  const budget = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, g) => ({
    id: 'g' + g, name: 'G' + g,
    items: Array.from({ length: 2 + Math.floor(r() * 6) }, () => ({ id: 'i' + n++, name: 'I' + n, limit: r() < 0.2 ? Math.round(r() * 40000) / 100 : pick(LIMITS) })),
  }));
  const items = budget.flatMap(g => g.items);
  const key = '2027-' + String(1 + Math.floor(r() * 12)).padStart(2, '0');
  const txs = [];
  for (const it of items) {
    for (let k = Math.floor(r() * 4); k > 0; k--) {
      const amt = Math.max(0.01, Math.round(r() * (it.limit > 0 ? it.limit * 0.7 : 30) * 100) / 100);
      txs.push(tx('t' + txs.length, key + '-09', it.id, r() < 0.06 ? -amt : amt));
    }
  }
  const month = { paid: {}, tx: txs, pays: [] };
  if (r() < 0.7) {
    month.moves = [];
    const funded = items.filter(i => i.limit >= 10);
    for (let k = Math.floor(r() * 5); funded.length && k > 0; k--) {
      const a = pick(funded), b = pick(items);
      if (a !== b) month.moves.push(move('m' + k, key + '-03', a.id, b.id, 1 + Math.floor(r() * 9)));
    }
  }
  return { key, state: { version: 1, settings: { payPlan: 1300 }, bills: [], budget, accounts: [], months: { [key]: month } } };
}

const softCapOf = i => Math.max(0, Math.floor((3 * cents(i.limit) - 4 * cents(i.spent)) / 400));
const fullCapOf = i => Math.max(0, Math.floor((cents(i.limit) - cents(i.spent)) / 100));

/* ---------- Cover it: source order ---------- */

function oneGroup(items, spent, moves) {
  const month = { paid: {}, tx: Object.entries(spent).map(([id, amt], k) => tx('t' + k, '2026-11-05', id, amt)), pays: [] };
  if (moves) month.moves = moves;
  return { budget: [{ id: 'g', name: 'G', items: Object.entries(items).map(([id, limit]) => ({ id, name: id, limit })) }], months: { [NOV]: month } };
}

test('cover takes from the item with the most room when one source is enough either way', () => {
  // A: room 300, gives 50 under 75% (750 − 700). B: room 100, gives 75 under 75%. T: 135 of 100 is red, needs 35.
  const s = oneGroup({ T: 100, A: 1000, B: 100 }, { T: 135, A: 700 });
  assert.deepEqual(coverSuggestion(s, NOV, 'T'), { to: 'T', needed: 35, from: [{ itemId: 'A', amt: 35 }], total: 35, partial: false });
  // T at 160 needs 60: A alone (50) is not enough under 75%, B alone (75) is, so one source still wins over room order.
  const t = oneGroup({ T: 100, A: 1000, B: 100 }, { T: 160, A: 700 });
  assert.deepEqual(coverSuggestion(t, NOV, 'T').from, [{ itemId: 'B', amt: 60 }]);
});

test('cover lists its sources most room first', () => {
  // T needs 50. Under 75%: B (room 60) gives 45, A (room 40) gives 30. Two sources, the roomier one gives first.
  const s = oneGroup({ T: 100, A: 40, B: 60 }, { T: 150 });
  assert.deepEqual(coverSuggestion(s, NOV, 'T').from, [{ itemId: 'B', amt: 45 }, { itemId: 'A', amt: 5 }]);
  // Full room fallback where the roomiest source has nothing to give under 75%: A (room 40, 120 of 160 spent,
  // 0.75 × 160 − 120 = 0) gives 40 of full room; B (room 12) gives 7 under 75% then 3 more. A is still listed first.
  const f = oneGroup({ T: 100, A: 160, B: 20 }, { T: 150, A: 120, B: 8 });
  assert.deepEqual(coverSuggestion(f, NOV, 'T'), { to: 'T', needed: 50, from: [{ itemId: 'A', amt: 40 }, { itemId: 'B', amt: 10 }], total: 50, partial: false });
});

test('cover sources use the effective limit, after earlier moves', () => {
  // B has a base of 100 but 60 already moved out this month: room 40, gives 15 under 75% (0.75 × 40 − 15).
  const s = oneGroup({ T: 60, B: 100, C: 50 }, { T: 58, B: 15 }, [move('m0', '2026-11-02', 'B', 'C', 60)]);
  assert.equal(bar(s, NOV, 'B').room, 25);
  // T: 58 / 0.75 − 60 + 0.01 = 17.34 -> 20. C has room 110 and gives 82 under 75%: one source, C.
  assert.deepEqual(coverSuggestion(s, NOV, 'T').from, [{ itemId: 'C', amt: 20 }]);
});

test('needed at the $5 boundaries, by hand', () => {
  const needFor = (limit, spent) => coverSuggestion(oneGroup({ a: limit, b: 1000 }, { a: spent }), NOV, 'a')?.needed ?? null;
  assert.equal(needFor(100, 78.74), 5); // 104.9867 − 100 + 0.01 = 4.9967 -> 5
  assert.equal(needFor(100, 78.75), 10); // 105.00 − 100 + 0.01 = 5.01 -> 10
  assert.equal(needFor(60, 60), 25); // orange at exactly 100%: 80 − 60 + 0.01 = 20.01 -> 25
  assert.equal(needFor(60, 60.01), 5); // red: 0.01 -> 5
  assert.equal(needFor(10.5, 21), 15); // red: 10.50 -> 15
});

test('cover: no source left out has more room than one picked, over many random months', () => {
  const r = rng(4360);
  let checked = 0, partials = 0, multi = 0;
  for (let run = 0; run < 1500; run++) {
    const { key, state } = randomMonth(r);
    const items = flat(state, key);
    for (const t of items) {
      const sug = coverSuggestion(state, key, t.id);
      if (!sug) continue;
      const msg = `run ${run} ${t.id}`;
      const others = items.filter(i => i.id !== t.id && i.limit > 0 && i.room > 0);
      const top3 = cap => others.map(cap).sort((a, b) => b - a).slice(0, 3).reduce((s, c) => s + c, 0);
      const cap = top3(softCapOf) >= sug.needed ? softCapOf : fullCapOf;
      const picked = sug.from.map(f => others.find(i => i.id === f.itemId));
      assert.ok(picked.every(Boolean), msg);
      for (let k = 1; k < picked.length; k++) assert.ok(cents(picked[k - 1].room) >= cents(picked[k].room), msg + ' not most room first');
      const total = picked.reduce((s, i) => s + cap(i), 0);
      for (const c of picked) for (const u of others) {
        if (picked.includes(u) || cents(u.room) <= cents(c.room) || cap(u) <= 0) continue;
        if (sug.partial) assert.fail(`${msg}: partial left out ${u.id} with more room than ${c.id}`);
        assert.ok(total - cap(c) + cap(u) < sug.needed, `${msg}: ${u.id} has more room than ${c.id} and would also cover it`);
      }
      checked++; if (sug.partial) partials++; if (picked.length > 1) multi++;
    }
  }
  assert.ok(checked > 1000 && partials > 50 && multi > 100, `${checked} ${partials} ${multi}`);
});

test('applying covers one after another keeps every invariant', () => {
  const r = rng(99);
  for (let run = 0; run < 400; run++) {
    const { key, state } = randomMonth(r);
    const total = cents(totalLimits(state, key));
    const okBefore = new Set(flat(state, key).filter(i => cents(i.limit) >= cents(i.spent)).map(i => i.id));
    for (const t of flat(state, key)) {
      const sug = coverSuggestion(state, key, t.id); // recomputed on the state left by earlier covers
      if (!sug) continue;
      applyCover(state, key, sug, TODAY);
      assert.equal(cents(totalLimits(state, key)), total, `run ${run} total`);
      for (const i of flat(state, key)) if (okBefore.has(i.id)) assert.ok(cents(i.limit) >= cents(i.spent), `run ${run} ${i.id} below spent`);
    }
  }
});

/* ---------- applyCover writes ---------- */

test('applyCover keeps the month as it was apart from the new moves', () => {
  const s = clone(sample);
  s.months[NOV].extra = { from: 'build B' };
  s.months[NOV].moves = [{ id: 'old', date: '2026-11-03', from: 'i-hair', to: 'i-toys', amt: 4, by: 'B' }];
  const before = clone(s);
  const made = applyCover(s, NOV, coverSuggestion(s, NOV, 'i-gas'), TODAY);
  assert.equal(made.length, 1);
  assert.deepEqual(s.months[NOV].moves, [...before.months[NOV].moves, ...made]);
  s.months[NOV].moves = before.months[NOV].moves;
  assert.equal(canonical(s), canonical(before));
});

test('applyCover that makes no move changes nothing, not even an empty moves list', () => {
  const s = clone(sample); // v1: November has no moves list
  const noop = { to: 'i-gas', needed: 20, from: [{ itemId: 'nope', amt: 5 }, { itemId: 'i-gas', amt: 5 }, { itemId: 'i-cloth', amt: 0 }, { itemId: 'i-cloth', amt: -3 }, { itemId: 'i-cloth', amt: 'x' }, null] };
  assert.deepEqual(applyCover(s, NOV, noop, TODAY), []);
  assert.deepEqual(applyCover(s, NOV, { to: 'nope', from: [{ itemId: 'i-cloth', amt: 5 }] }, TODAY), []);
  assert.deepEqual(applyCover(s, '2027-04', noop, TODAY), []);
  assert.equal(canonical(s), canonical(sample));
});

test('applyCover on a month with no entry yet creates it', () => {
  const s = clone(sample);
  const made = applyCover(s, '2027-04', { to: 'i-gas', needed: 10, from: [{ itemId: 'i-catfood', amt: 10 }] }, '2027-04-02');
  assert.deepEqual(made.map(m => [m.from, m.to, m.amt, m.date]), [['i-catfood', 'i-gas', 10, '2027-04-02']]);
  assert.deepEqual(s.months['2027-04'].moves, made);
  assert.equal(totalLimits(s, '2027-04'), totalLimits(sample, '2027-04'));
  assert.deepEqual([effectiveLimit(s, '2027-04', 'i-gas'), effectiveLimit(s, '2027-04', 'i-catfood')], [70, 20]);
});

/* ---------- raise ---------- */

test('raise uses the amounts moved in each month, not net of moves out', () => {
  const s = clone(sample);
  getMonth(s, '2026-09').moves.push(move('a', '2026-09-20', 'i-cloth', 'i-groc', 70));
  getMonth(s, '2026-10').moves.push(move('b', '2026-10-20', 'i-cloth', 'i-groc', 50), move('c', '2026-10-21', 'i-groc', 'i-gas', 30));
  getMonth(s, NOV).moves.push(move('d', TODAY, 'i-kylie', 'i-groc', 75));
  // moved in: 70, 50, 75. Average 195 / 3 = 65. 400 + 65 = 465, up to 470.
  assert.deepEqual(raiseSuggestion(s, NOV, 'i-groc'), { itemId: 'i-groc', months: ['2026-09', '2026-10', '2026-11'], newLimit: 470 });
});

test('raise needs a real top up in each of the 3 months ending at the month', () => {
  const base = () => {
    const s = clone(sample);
    for (const k of ['2026-09', '2026-10', NOV]) getMonth(s, k).moves.push(move('m' + k, k + '-10', 'i-cloth', 'i-groc', 40));
    return s;
  };
  assert.equal(raiseSuggestion(base(), NOV, 'i-groc').newLimit, 440);
  const self = base(); self.months['2026-10'].moves = [move('x', '2026-10-10', 'i-groc', 'i-groc', 40)];
  assert.equal(raiseSuggestion(self, NOV, 'i-groc'), null); // a move to itself is not a top up
  const zero = base(); zero.months['2026-10'].moves[0].amt = 0;
  assert.equal(raiseSuggestion(zero, NOV, 'i-groc'), null);
  const later = base(); delete later.months['2026-09'].moves; getMonth(later, '2026-12').moves.push(move('y', '2026-12-01', 'i-cloth', 'i-groc', 40));
  assert.equal(raiseSuggestion(later, NOV, 'i-groc'), null); // December is after the month asked about
  assert.equal(raiseSuggestion(later, '2026-12', 'i-groc').newLimit, 440); // Oct, Nov, Dec
});

test('reading functions never change a deeply frozen v1 state', () => {
  const s = clone(sample);
  getMonth(s, '2026-09').moves.push(move('a', '2026-09-20', 'i-cloth', 'i-groc', 70));
  getMonth(s, '2026-10').moves.push(move('b', '2026-10-20', 'i-cloth', 'i-groc', 50));
  s.months[NOV].moves = [move('c', TODAY, 'i-kylie', 'i-groc', 75)];
  s.months['2026-08'] = { tx: [tx('x', '2026-08-02', 'i-gas', 70)] }; // v1 month with only tx
  const frozen = deepFreeze(clone(s));
  for (const k of ['2026-08', '2026-10', NOV, '2027-02']) {
    spentByItem(frozen, k); bars(frozen, k); totalLimits(frozen, k);
    for (const i of flat(frozen, k)) { effectiveLimit(frozen, k, i.id); coverSuggestion(frozen, k, i.id); raiseSuggestion(frozen, k, i.id); }
  }
  assert.equal(raiseSuggestion(frozen, NOV, 'i-groc').newLimit, 470); // 400 + (70 + 50 + 75) / 3 = 465 -> 470
  assert.equal(canonical(frozen), canonical(s));
});

test('a group with no items list does not break anything', () => {
  const s = clone(sample);
  s.budget.splice(1, 0, { id: 'g-new', name: 'New group' });
  assert.deepEqual(bars(s, NOV)[1], { group: { id: 'g-new', name: 'New group' }, limit: 0, spent: 0, items: [] });
  assert.equal(effectiveLimit(s, NOV, 'i-gas'), 60);
  assert.equal(totalLimits(s, NOV), 1344);
  assert.equal(coverSuggestion(s, NOV, 'i-gas').needed, 20);
  assert.equal(raiseSuggestion(s, NOV, 'i-gas'), null);
  assert.equal(applyRaise(s, { itemId: 'i-gas', newLimit: 70 }).limit, 70);
  assert.equal(applyCover(s, NOV, coverSuggestion(s, NOV, 'i-catfood'), TODAY).length, 1);

  const f = clone(fsample);
  f.budget.push({ id: 'g-new', name: 'New group' });
  getMonth(f, NOV).tx.push(tx('nn', '2026-11-13', 'i-groc', 5, { account: 'chequing' })); // no note: label is the category
  const r = forecast(f, FTODAY, { nextPay: FNEXT });
  assert.ok(at(r, FTODAY).events.some(e => e.label === 'Groceries' && e.amt === -5));
});

/* ---------- forecast ---------- */

test('forecast on v1 data (tx with no account count as chequing), by hand', () => {
  const s = migrate(sample);
  s.settings.chequing = { bal: 420, asOf: '2026-11-12' };
  const r = forecast(s, TODAY, { nextPay: { date: '2026-11-20', estimate: true } });
  // All November tx have no account: 182.40 + 28 + 58 + 64.80 + 120 + 96.25 + 23.55 + 74 = 647.00; 647 / 30 = 21.5667 -> 21.57
  assert.equal(r.dailySpend, 21.57);
  // Today: nothing after Nov 12 yet (the Nov 12 Volleyball and Gym are in the balance) = 420
  assert.equal(at(r, TODAY).bal, 420);
  // Nov 19: 420 − 5 × 21.57 − 27.11 (Netflix) − 90.83 (Phone + Crave) = 420 − 107.85 − 27.11 − 90.83 = 194.21
  assert.equal(at(r, '2026-11-19').bal, 194.21);
  // Nov 30: 194.21 + 1300 − 11 × 21.57 − 89.43 (Internet) − 31.58 (Gym) = 194.21 + 1300 − 237.27 − 89.43 − 31.58 = 1135.93
  assert.equal(at(r, '2026-11-30').bal, 1135.93);
  // No Visa due day in v1 data: nothing subtracted, the marker shows the owing instead
  assert.deepEqual(r.visaMarker, { amt: 640, text: 'Visa owing $640. Set its due date to include it.' });
  // The same on the unmigrated v1 doc
  const v1 = clone(sample);
  v1.settings.chequing = { bal: 420, asOf: '2026-11-12' };
  assert.deepEqual(forecast(v1, TODAY, { nextPay: { date: '2026-11-20', estimate: true } }), r);
});

test('forecast across the new year, by hand', () => {
  const s = clone(fsample);
  s.settings.chequing = { bal: 2000, asOf: '2026-12-28' };
  s.settings.visaDueDay = 5;
  getMonth(s, '2026-12').tx.push(tx('d20', '2026-12-20', 'i-groc', 90, { note: 'Metro', account: 'chequing' }));
  const r = forecast(s, '2026-12-28', { nextPay: { date: '2027-01-08', estimate: true } });
  // Only Metro 90 falls in Nov 29 .. Dec 28: 90 / 30 = 3.00 a day
  assert.equal(r.dailySpend, 3);
  assert.equal(r.end, '2027-01-08');
  assert.deepEqual(r.points.map(p => p.date).slice(2, 6), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  // Jan 1: 2000 − 4 × 3 − 587.50 (Rent) − 90 (Parking) = 1310.50
  assert.equal(at(r, '2027-01-01').bal, 2000 - 4 * 3 - 587.50 - 90);
  // Jan 5: Visa 640 + 13.06 + 100.63 = 753.69. 1310.50 − 4 × 3 − 4.59 (iCloud) − 100 (Claude Max) − 753.69 = 440.22
  assert.equal(at(r, '2027-01-05').bal, 440.22);
  // Jan 7, the day before pay: 440.22 − 2 × 3 − 14.44 (Spotify) − 31.58 (Gym) = 388.20, the lowest, the day of Gym
  assert.equal(at(r, '2027-01-07').bal, 388.2);
  assert.deepEqual(r.lowest, { date: '2027-01-07', bal: 388.2, note: 'the day of Gym' });
  // Jan 8: 388.20 + 1300 (pay estimate) − 3 = 1685.20
  assert.equal(at(r, '2027-01-08').bal, 1685.2);
});

test('Visa due day clamps to the end of February, leap years included', () => {
  const visaDays = (today, due) => {
    const s = clone(fsample);
    s.settings.chequing = { bal: 1000, asOf: today };
    s.settings.visaDueDay = due;
    return forecast(s, today, { nextPay: null }).points.filter(p => p.events.some(e => e.type === 'visa')).map(p => p.date);
  };
  assert.deepEqual(visaDays('2027-02-10', 31), ['2027-02-28']);
  assert.deepEqual(visaDays('2028-02-10', 30), ['2028-02-29']);
  assert.deepEqual(visaDays('2028-02-10', 29), ['2028-02-29']);
  assert.deepEqual(visaDays('2028-02-10', '22'), ['2028-02-22']); // a day typed as text still works
});

test('a Visa payment due today counts only when the balance was entered before today', () => {
  const visaOn = asOf => {
    const s = clone(fsample);
    s.settings.chequing = { bal: 1000, asOf };
    return at(forecast(s, '2026-11-22', { nextPay: { date: '2026-12-04', estimate: true } }), '2026-11-22').events.filter(e => e.type === 'visa').map(e => e.amt);
  };
  assert.deepEqual(visaOn('2026-11-21'), [-753.69]);
  assert.deepEqual(visaOn('2026-11-22'), []); // the balance he typed today already reflects today
});

test('refunds lower the daily spending and the Visa payment', () => {
  const s = clone(fsample);
  getMonth(s, NOV).tx.push(tx('r1', '2026-11-12', 'i-groc', -20, { note: 'Refund', account: 'chequing' }));
  getMonth(s, NOV).tx.push(tx('r2', '2026-11-12', 'i-act', -13.06, { note: 'Refund', account: 'visa' }));
  const r = forecast(s, FTODAY, { nextPay: FNEXT });
  // (602.50 − 20) / 30 = 19.4167 -> 19.42
  assert.equal(r.dailySpend, 19.42);
  // 640 + 13.06 + 100.63 − 13.06 = 740.63
  assert.equal(visaOwing(s), 740.63);
  assert.ok(at(r, '2026-11-22').events.some(e => e.type === 'visa' && e.amt === -740.63));
});

test('a purchase dated after today is not subtracted on its date', () => {
  const base = forecast(fsample, FTODAY, { nextPay: FNEXT });
  const s = clone(fsample);
  getMonth(s, NOV).tx.push(tx('f', '2026-11-25', 'i-groc', 300, { note: 'Costco', account: 'chequing' }));
  const r = forecast(s, FTODAY, { nextPay: FNEXT });
  assert.deepEqual(r.points.map(p => p.bal), base.points.map(p => p.bal)); // after today only the estimate is used
});

test('no planned pay means no estimated pay', () => {
  for (const plan of [0, null, undefined]) {
    const s = clone(fsample);
    s.settings.payPlan = plan;
    const r = forecast(s, FTODAY, { nextPay: FNEXT });
    assert.ok(r.points.every(p => p.events.every(e => e.type !== 'pay')), String(plan));
    assert.equal(at(r, '2026-11-30').bal, 151.73 - 1300);
  }
});

test('a chequing balance that is text, empty or not a number', () => {
  const run = bal => { const s = clone(fsample); s.settings.chequing.bal = bal; return forecast(s, FTODAY, { nextPay: FNEXT }); };
  assert.equal(at(run('254'), '2026-11-30').bal, 151.73);
  assert.deepEqual(run(''), { missing: 'chequing' });
  assert.deepEqual(run('abc'), { missing: 'chequing' });
  assert.deepEqual(run(undefined), { missing: 'chequing' });
});

test('an asOf after today counts as today', () => {
  const s = clone(fsample);
  s.settings.chequing = { bal: 254, asOf: '2026-11-20' };
  const r = forecast(s, FTODAY, { nextPay: FNEXT });
  assert.deepEqual(r.start, { date: FTODAY, bal: 254 });
  assert.deepEqual(at(r, FTODAY).events, []);
});

test('lowest note names every bill on that day', () => {
  const s = {
    version: 2,
    settings: { payPlan: 0, visaDueDay: null, chequing: { bal: 1000, asOf: '2026-11-30' } },
    bills: [
      { id: 'b1', name: 'Rent (my half)', amt: 587.50, freq: 'monthly', day: 1, note: '' },
      { id: 'b2', name: 'Parking (my half)', amt: 90, freq: 'monthly', day: 1, note: '' },
    ],
    budget: [], accounts: [], goals: [], merchantMap: {}, months: {},
  };
  const r = forecast(s, '2026-11-30', { nextPay: { date: '2026-12-04', estimate: true } });
  assert.deepEqual(r.lowest, { date: '2026-12-01', bal: 322.5, note: 'the day of Rent and Parking' });
  assert.equal(r.negative, null);
  assert.equal(r.visaMarker, null); // no Visa account at all
});

test('a dip of one cent still needs $10', () => {
  const s = clone(fsample);
  s.settings.chequing.bal = 306.68; // 306.68 − 306.69 = −0.01 on Nov 19
  const r = forecast(s, FTODAY, { nextPay: FNEXT });
  assert.equal(r.lowest.bal, -0.01);
  assert.deepEqual(r.negative, { firstDate: '2026-11-19', need: 10, text: 'Move $10 from savings before Nov 19' });
  for (const t of [r.negative.text, r.lowest.note]) assert.doesNotMatch(t, DASHES);
});

test('forecast never changes a deeply frozen state', () => {
  const frozen = deepFreeze(clone(fsample));
  const r = forecast(frozen, FTODAY, { nextPay: FNEXT });
  assert.equal(at(r, '2026-11-30').bal, 151.73);
  assert.equal(canonical(frozen), canonical(fsample));
});

/* ---------- daylight saving (Montreal) ---------- */

const nextDayUTC = d => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

// Runs a forecast in a child Node with TZ set, so the clock changes of America/Toronto are really crossed.
function forecastIn(tz, state, today, nextPay) {
  const code = `const { forecast } = await import(${JSON.stringify(new URL('../lib/forecast.js', import.meta.url).href)});
    const [s, t, np] = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(forecast(s, t, { nextPay: np })));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code, JSON.stringify([state, today, nextPay])], { env: { ...process.env, TZ: tz } });
  return JSON.parse(String(out));
}

test('points are one per calendar day across the clock changes, in Montreal time', () => {
  for (const [today, pay] of [['2026-10-28', '2026-11-06'], ['2027-03-10', '2027-03-20']]) {
    const s = clone(fsample);
    s.settings.chequing = { bal: 1000, asOf: today };
    const r = forecastIn('America/Toronto', s, today, { date: pay, estimate: true });
    assert.deepEqual(r, forecast(s, today, { nextPay: { date: pay, estimate: true } }), today);
    for (let k = 1; k < r.points.length; k++) assert.equal(r.points[k].date, nextDayUTC(r.points[k - 1].date));
    assert.equal(r.points[r.points.length - 1].date, r.end);
  }
});

test('a bill due every 2 weeks on the 1st of a winter month stays in the forecast in Montreal time', {
  // was a todo for the core.js clock change bug, fixed
}, () => {
  const s = clone(fsample);
  s.bills = [{ id: 'b-x', name: 'Gym', amt: 31.58, freq: 'biweekly', anchor: '2026-10-20', note: '' }]; // Oct 20, Nov 3, Nov 17, Dec 1
  s.settings.chequing = { bal: 1000, asOf: '2026-11-28' };
  const r = forecastIn('America/Toronto', s, '2026-11-28', { date: '2026-12-04', estimate: true });
  assert.ok(at(r, '2026-12-01').events.some(e => e.type === 'bill' && e.amt === -31.58));
});

/* ---------- SPEC 11: a raise is not suggested again for the same top ups ---------- */

test('after a raise is accepted the same months never suggest it again; three new months of top ups can', () => {
  const s = clone(sample);
  getMonth(s, '2026-09').moves.push(move('m9', '2026-09-24', 'i-cloth', 'i-groc', 70));
  getMonth(s, '2026-10').moves.push(move('m10a', '2026-10-12', 'i-cloth', 'i-groc', 50), move('m10b', '2026-10-27', 'i-kylie', 'i-groc', 30));
  getMonth(s, NOV).moves.push(move('m11', TODAY, 'i-cloth', 'i-groc', 75));
  const sug = raiseSuggestion(s, NOV, 'i-groc');
  assert.deepEqual(sug, { itemId: 'i-groc', months: ['2026-09', '2026-10', '2026-11'], newLimit: 480 });

  const item = applyRaise(s, sug);
  assert.equal(item.limit, 480);
  assert.equal(item.raisedAt, '2026-11');
  const stored = s.budget[0].items[0];
  assert.deepEqual(Object.keys(stored).sort(), [...Object.keys(sample.budget[0].items[0]), 'raisedAt'].sort()); // one extra field, nothing else

  // The next render (and every one after it) for the same months: no new card offering $560.
  for (let i = 0; i < 3; i++) assert.equal(raiseSuggestion(s, NOV, 'i-groc'), null);
  assert.equal(raiseSuggestion(clone(s), NOV, 'i-groc'), null, 'raisedAt survives a save and reload');

  // New top ups in Dec and Jan: the 3 months ending in Dec or Jan still include Nov, which was already used.
  getMonth(s, '2026-12').moves.push(move('m12', '2026-12-10', 'i-cloth', 'i-groc', 40));
  getMonth(s, '2027-01').moves.push(move('m1', '2027-01-10', 'i-cloth', 'i-groc', 40));
  assert.equal(raiseSuggestion(s, '2026-12', 'i-groc'), null);
  assert.equal(raiseSuggestion(s, '2027-01', 'i-groc'), null);
  // A third new month: Dec, Jan and Feb are all after the raise. 480 + 40 = 520.
  getMonth(s, '2027-02').moves.push(move('m2', '2027-02-10', 'i-cloth', 'i-groc', 40));
  const again = raiseSuggestion(s, '2027-02', 'i-groc');
  assert.deepEqual(again, { itemId: 'i-groc', months: ['2026-12', '2027-01', '2027-02'], newLimit: 520 });
  applyRaise(s, again);
  assert.equal(stored.raisedAt, '2027-02');
  assert.equal(raiseSuggestion(s, '2027-02', 'i-groc'), null);
});

test('raisedAt: older months stay quiet, it never moves back, and a value that is not a month is ignored', () => {
  const s = clone(sample);
  for (const k of ['2026-08', '2026-09', '2026-10', NOV]) getMonth(s, k).moves.push(move('m' + k, k + '-10', 'i-cloth', 'i-groc', 40));
  applyRaise(s, raiseSuggestion(s, NOV, 'i-groc'));
  const groc = s.budget[0].items[0];
  assert.equal(groc.raisedAt, NOV);
  assert.equal(raiseSuggestion(s, '2026-10', 'i-groc'), null); // Aug, Sep, Oct: before the raise
  // A stale suggestion for an earlier month sets the limit but keeps the later raisedAt.
  applyRaise(s, { itemId: 'i-groc', months: ['2026-08', '2026-09', '2026-10'], newLimit: 450 });
  assert.equal(groc.limit, 450);
  assert.equal(groc.raisedAt, NOV);
  // A suggestion built by hand with no months only sets the limit.
  const gas = applyRaise(s, { itemId: 'i-gas', newLimit: 70 });
  assert.equal(gas.limit, 70);
  assert.equal('raisedAt' in gas, false);
  // Data from elsewhere with a raisedAt that is not 'YYYY-MM' does not block suggestions.
  groc.raisedAt = 'soon';
  assert.equal(raiseSuggestion(s, NOV, 'i-groc').newLimit, 490); // 450 + 40
});
