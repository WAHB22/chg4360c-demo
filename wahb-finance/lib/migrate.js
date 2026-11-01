// v1 -> v2 migration and the starting data. Pure ES module: no DOM, no Node APIs.
// Only fills missing fields. Never renames, removes or changes a value that is already there,
// and keeps every field it does not know about (build B shares the same data).

import { uid, clone } from './core.js';
import { fingerprint } from './merchants.js';

export const SCHEMA_VERSION = 2;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// The original page's defaults(), copied exactly, then migrated to v2.
export function defaults() {
  const B = (name, amt, day, note) => ({ id: uid(), name, amt, freq: 'monthly', day, note: note || '' });
  const I = (name, limit) => ({ id: uid(), name, limit });
  return migrate({
    version: 1,
    settings: { payPlan: 1300 },
    bills: [
      B('Rent (my half)', 587.50, 1),
      B('Parking (my half)', 90, 1),
      B('Internet (Bell)', 89.43, 22),
      B('Phone + Crave/Disney (Bell)', 90.83, 18),
      B('Spotify', 14.44, 6),
      B('Netflix', 27.11, 16),
      B('iCloud', 4.59, 3),
      B('Claude Max', 100, 4, 'Placeholder, check the CAD charge'),
      { id: uid(), name: 'Gym (ABC)', amt: 31.58, freq: 'biweekly', anchor: '2026-09-03', note: '' },
      B('Manga', 5.64, null, 'Add the date'),
    ],
    budget: [
      { id: uid(), name: 'Food', items: [I('Groceries', 400), I('Eating out', 150), I('Coffee and snacks', 50), I('Takeout and delivery', 50), I('Meal prep supplies', 50), I('Alcohol', 0)] },
      { id: uid(), name: 'Pets', items: [I('Cat food', 30), I('Litter', 15), I('Toys', 10), I('Vet', 0)] },
      { id: uid(), name: 'Transport', items: [I('Gas', 60), I('Insurance', 0), I('Car wash and maintenance', 0), I('Uber', 0), I('Lyft', 0)] },
      { id: uid(), name: 'Personal', items: [I('Clothing and shoes', 150), I('Haircuts', 50), I('Dates with Kylie', 200), I('Volleyball', 104), I('School', 25), I('Errors', 0)] },
    ],
    accounts: [
      { id: uid(), name: 'Chequing', bal: null, goal: 400, kind: 'asset' },
      { id: uid(), name: 'Savings', bal: null, goal: 1000, kind: 'asset' },
      { id: uid(), name: 'Visa owing', bal: null, limit: 2500, kind: 'debt' },
    ],
    goals: [
      { id: uid(), name: 'Automne 2026 gap', target: 10043, saved: 0 },
      { id: uid(), name: 'Hiver 2027 cushion', target: 12000, saved: 0 },
      { id: uid(), name: 'Automne 2027 cushion', target: 14000, saved: 0 },
    ],
    months: {},
  });
}

function fillTx(t) {
  if (!isObj(t)) return;
  t.src ??= 'manual';
  t.merchant ??= (t.note || '');
  if (t.account === undefined) t.account = null;
  t.fp ??= fingerprint(t.amt, t.merchant);
}

function fillMonth(m) {
  if (!isObj(m)) return;
  m.paid ??= {};
  m.tx ??= [];
  m.pays ??= [];
  m.moves ??= [];
  if (Array.isArray(m.tx)) m.tx.forEach(fillTx);
}

// Returns a new object (deep copy); doc is never touched. migrate(migrate(x)) deep equals migrate(x).
export function migrate(doc) {
  const out = isObj(doc) ? clone(doc) : {};

  // A newer build may have moved on: keep its version number, still fill what we need.
  if (!(Number(out.version) > SCHEMA_VERSION)) out.version = SCHEMA_VERSION;

  if (!isObj(out.settings)) out.settings = {};
  const s = out.settings;
  if (s.payPlan === undefined) s.payPlan = 1300; // only when missing: 0 or null stay as they are
  s.visaDueDay ??= null;
  s.chequing ??= { bal: null, asOf: null };
  if (isObj(s.chequing)) {
    s.chequing.bal ??= null;
    s.chequing.asOf ??= null;
  }

  out.merchantMap ??= {};
  out.note ??= '';
  out.months ??= {};
  if (isObj(out.months)) Object.values(out.months).forEach(fillMonth);

  return out;
}
