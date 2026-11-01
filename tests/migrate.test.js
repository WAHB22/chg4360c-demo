import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, defaults, SCHEMA_VERSION } from '../lib/migrate.js';
import { fingerprint } from '../lib/merchants.js';
import { clone } from '../lib/core.js';
import sample from './fixtures/sample-nov.js';

// Every path and value in `before` is still there, unchanged, in `after`.
// The top level version is the one value migrate is meant to change (1 or none becomes 2).
function assertKept(before, after, path = 'doc') {
  if (before !== null && typeof before === 'object') {
    assert.ok(after !== null && typeof after === 'object', `${path} is still an object`);
    assert.equal(Array.isArray(after), Array.isArray(before), `${path} keeps its type`);
    if (Array.isArray(before)) assert.equal(after.length, before.length, `${path} keeps its length`);
    for (const k of Object.keys(before)) {
      if (path === 'doc' && k === 'version') continue;
      assert.ok(k in after, `${path}.${k} is kept`);
      assertKept(before[k], after[k], `${path}.${k}`);
    }
  } else {
    assert.equal(after, before, `${path} is unchanged`);
  }
}

// A v1 doc with extra fields at every level, like another build might add.
function withExtras() {
  const d = clone(sample);
  d.foo = { bar: [1, 2] };
  d.settings.theme = 'dark';
  d.bills[0].color = 'teal';
  d.budget[0].icon = 'cart';
  d.budget[0].items[0].emoji = 'apple';
  d.accounts[2].asOf = '2026-11-10';
  d.goals[1].deadline = '2027-01-05';
  const nov = d.months['2026-11'];
  nov.extraMonth = true;
  nov.paid['b-rent@2026-11-01'] = true;
  nov.tx[0].tags = ['bulk', 'monthly'];
  nov.tx[1].merchant = 'PET VALU #123 MONTREAL QC';
  nov.pays[0].employer = 'Bobino';
  nov.moves = [{ id: 'm1', date: '2026-11-10', from: 'i-cloth', to: 'i-groc', amt: 40, reason: 'top up' }];
  return d;
}

test('SCHEMA_VERSION is 2', () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test('migrate never mutates its input and returns a new object at every level', () => {
  const doc = withExtras();
  const before = clone(doc);
  const out = migrate(doc);
  assert.deepEqual(doc, before);
  assert.notEqual(out, doc);
  assert.notEqual(out.settings, doc.settings);
  assert.notEqual(out.bills[0], doc.bills[0]);
  assert.notEqual(out.months['2026-11'].tx[0], doc.months['2026-11'].tx[0]);
  out.months['2026-11'].tx[0].amt = 1;
  out.bills[0].name = 'x';
  assert.deepEqual(doc, before);
});

test('migrate is idempotent', () => {
  const docs = [sample, withExtras(), {}, { version: 5 }, { settings: { chequing: { bal: 10 } } }, defaults()];
  for (const d of docs) {
    const once = migrate(d);
    assert.deepEqual(migrate(once), once);
  }
});

test('keeps every original field and value of a v1 doc', () => {
  const doc = withExtras();
  const out = migrate(doc);
  assertKept(doc, out);
  assert.deepEqual(out.foo, { bar: [1, 2] });
  assert.equal(out.settings.theme, 'dark');
  assert.equal(out.bills[0].color, 'teal');
  assert.equal(out.budget[0].icon, 'cart');
  assert.equal(out.budget[0].items[0].emoji, 'apple');
  assert.equal(out.accounts[2].asOf, '2026-11-10');
  assert.equal(out.goals[1].deadline, '2027-01-05');
  assert.equal(out.months['2026-11'].extraMonth, true);
  assert.deepEqual(out.months['2026-11'].tx[0].tags, ['bulk', 'monthly']);
  assert.equal(out.months['2026-11'].pays[0].employer, 'Bobino');
  assert.equal(out.months['2026-11'].moves[0].reason, 'top up');
  assert.equal(out.savedAt, sample.savedAt);
});

test('fills the v2 fields with their defaults', () => {
  const out = migrate(sample);
  assert.equal(out.version, 2);
  assert.equal(out.settings.payPlan, 1300);
  assert.equal(out.settings.visaDueDay, null);
  assert.deepEqual(out.settings.chequing, { bal: null, asOf: null });
  assert.deepEqual(out.merchantMap, {});
  assert.equal(out.note, '');
  for (const key of ['2026-10', '2026-11']) {
    const m = out.months[key];
    assert.ok(m.paid && typeof m.paid === 'object');
    assert.ok(Array.isArray(m.tx) && Array.isArray(m.pays) && Array.isArray(m.moves));
  }
  assert.deepEqual(out.months['2026-10'].moves, []);
  assert.deepEqual(out.months['2026-10'].tx, []);
});

test('each tx gets src, merchant, account and fp', () => {
  const out = migrate(sample);
  const [t1, , , , t5] = out.months['2026-11'].tx;
  assert.equal(t1.src, 'manual');
  assert.equal(t1.merchant, 'Costco');
  assert.equal(t1.account, null);
  assert.equal(t1.fp, '18240|costco');
  assert.equal(t1.fp, fingerprint(182.40, 'Costco'));
  // no note: merchant is '' and the fingerprint has no merchant part
  assert.equal(t5.merchant, '');
  assert.equal(t5.fp, '12000|');
  const t3 = out.months['2026-11'].tx[2];
  assert.equal(t3.fp, '5800|petro canada');
});

test('fp is built from merchant when merchant is already there', () => {
  const out = migrate(withExtras());
  const t2 = out.months['2026-11'].tx[1];
  assert.equal(t2.merchant, 'PET VALU #123 MONTREAL QC');
  assert.equal(t2.fp, '2800|pet valu');
});

test('a v2 doc keeps what it already has', () => {
  const doc = {
    version: 2,
    settings: { payPlan: 0, visaDueDay: 22, chequing: { bal: 420, asOf: '2026-11-10', src: 'manual' } },
    bills: [], budget: [], accounts: [], goals: [],
    merchantMap: { costco: 'i-groc' },
    note: 'Added Costco $182.40',
    months: {
      '2026-11': {
        paid: { 'b1@2026-11-01': true },
        tx: [
          { id: 't1', date: '2026-11-02', item: 'i-groc', amt: 182.4, note: 'Costco', src: 'statement', fp: 'custom|fp', merchant: 'COSTCO WHOLESALE #503', account: 'visa' },
          { id: 't2', date: '2026-11-03', item: 'i-eat', amt: 10, note: 'Lunch', merchant: '', account: null, src: 'screenshot', fp: '1000|' },
          { id: 't3', date: '2026-11-04', item: 'i-gas', amt: 50, note: 'Esso', account: 'chequing' },
        ],
        pays: [{ id: 'p1', date: '2026-11-06', amt: 1300, hours: null, note: '' }],
        moves: [{ id: 'm1', date: '2026-11-07', from: 'a', to: 'b', amt: 20 }],
      },
    },
    savedAt: '2026-11-14T15:00:00.000Z',
  };
  const out = migrate(doc);
  assertKept(doc, out);
  assert.equal(out.settings.payPlan, 0);
  assert.equal(out.settings.visaDueDay, 22);
  const [t1, t2, t3] = out.months['2026-11'].tx;
  assert.equal(t1.fp, 'custom|fp');
  assert.equal(t2.merchant, '');
  assert.equal(t2.fp, '1000|');
  assert.equal(t3.account, 'chequing');
  assert.equal(t3.src, 'manual');
  assert.equal(t3.merchant, 'Esso');
  assert.equal(t3.fp, '5000|esso');
  assert.deepEqual(migrate(out), out);
});

test('a newer version number is kept and defaults are still filled', () => {
  const out = migrate({ version: 3, settings: {}, months: { '2026-11': { tx: [{ id: 'a', amt: 5, note: 'Tim Hortons' }] } } });
  assert.equal(out.version, 3);
  assert.equal(out.settings.payPlan, 1300);
  assert.deepEqual(out.settings.chequing, { bal: null, asOf: null });
  const m = out.months['2026-11'];
  assert.deepEqual(m.paid, {});
  assert.deepEqual(m.pays, []);
  assert.deepEqual(m.moves, []);
  assert.equal(m.tx[0].fp, '500|tim hortons');
});

test('version 1 or no version becomes 2', () => {
  assert.equal(migrate({ version: 1 }).version, 2);
  assert.equal(migrate({}).version, 2);
  assert.equal(migrate({ version: 2 }).version, 2);
});

test('settings.chequing: missing keys filled with null, values kept', () => {
  assert.deepEqual(migrate({ settings: { chequing: { bal: 420 } } }).settings.chequing, { bal: 420, asOf: null });
  assert.deepEqual(migrate({ settings: { chequing: { asOf: '2026-11-01' } } }).settings.chequing, { bal: null, asOf: '2026-11-01' });
  assert.deepEqual(migrate({ settings: { chequing: null } }).settings.chequing, { bal: null, asOf: null });
  assert.deepEqual(migrate({ settings: { chequing: { bal: 0, asOf: null, x: 1 } } }).settings.chequing, { bal: 0, asOf: null, x: 1 });
});

test('payPlan only defaults when missing', () => {
  assert.equal(migrate({ settings: {} }).settings.payPlan, 1300);
  assert.equal(migrate({ settings: { payPlan: 0 } }).settings.payPlan, 0);
  assert.equal(migrate({ settings: { payPlan: 1450.5 } }).settings.payPlan, 1450.5);
  assert.equal(migrate({}).settings.payPlan, 1300);
});

test('never changes amounts, ids, dates, names, limits or balances', () => {
  const doc = clone(sample);
  doc.accounts[0].bal = 420.37;
  doc.months['2026-11'].tx[0].amt = '182.40'; // even a string amount stays as typed
  const out = migrate(doc);
  assertKept(doc, out);
  assert.equal(out.months['2026-11'].tx[0].amt, '182.40');
  assert.equal(out.months['2026-11'].tx[0].fp, '18240|costco');
  assert.equal(out.accounts[0].bal, 420.37);
});

test('not an object gives an empty v2 shell', () => {
  for (const v of [null, undefined, 'x', 3, []]) {
    const out = migrate(v);
    assert.equal(out.version, 2);
    assert.equal(out.settings.payPlan, 1300);
    assert.deepEqual(out.months, {});
  }
});

test('defaults() match the original page and are migrated', () => {
  const d = defaults();
  assert.equal(d.version, 2);
  assert.deepEqual(d.settings, { payPlan: 1300, visaDueDay: null, chequing: { bal: null, asOf: null } });
  assert.deepEqual(d.merchantMap, {});
  assert.equal(d.note, '');
  assert.deepEqual(d.months, {});

  const strip = ({ id, ...rest }) => rest;
  assert.deepEqual(d.bills.map(strip), [
    { name: 'Rent (my half)', amt: 587.50, freq: 'monthly', day: 1, note: '' },
    { name: 'Parking (my half)', amt: 90, freq: 'monthly', day: 1, note: '' },
    { name: 'Internet (Bell)', amt: 89.43, freq: 'monthly', day: 22, note: '' },
    { name: 'Phone + Crave/Disney (Bell)', amt: 90.83, freq: 'monthly', day: 18, note: '' },
    { name: 'Spotify', amt: 14.44, freq: 'monthly', day: 6, note: '' },
    { name: 'Netflix', amt: 27.11, freq: 'monthly', day: 16, note: '' },
    { name: 'iCloud', amt: 4.59, freq: 'monthly', day: 3, note: '' },
    { name: 'Claude Max', amt: 100, freq: 'monthly', day: 4, note: 'Placeholder, check the CAD charge' },
    { name: 'Gym (ABC)', amt: 31.58, freq: 'biweekly', anchor: '2026-09-03', note: '' },
    { name: 'Manga', amt: 5.64, freq: 'monthly', day: null, note: 'Add the date' },
  ]);
  assert.deepEqual(d.budget.map(g => [g.name, g.items.map(i => [i.name, i.limit])]), [
    ['Food', [['Groceries', 400], ['Eating out', 150], ['Coffee and snacks', 50], ['Takeout and delivery', 50], ['Meal prep supplies', 50], ['Alcohol', 0]]],
    ['Pets', [['Cat food', 30], ['Litter', 15], ['Toys', 10], ['Vet', 0]]],
    ['Transport', [['Gas', 60], ['Insurance', 0], ['Car wash and maintenance', 0], ['Uber', 0], ['Lyft', 0]]],
    ['Personal', [['Clothing and shoes', 150], ['Haircuts', 50], ['Dates with Kylie', 200], ['Volleyball', 104], ['School', 25], ['Errors', 0]]],
  ]);
  assert.deepEqual(d.accounts.map(strip), [
    { name: 'Chequing', bal: null, goal: 400, kind: 'asset' },
    { name: 'Savings', bal: null, goal: 1000, kind: 'asset' },
    { name: 'Visa owing', bal: null, limit: 2500, kind: 'debt' },
  ]);
  assert.deepEqual(d.goals.map(strip), [
    { name: 'Automne 2026 gap', target: 10043, saved: 0 },
    { name: 'Hiver 2027 cushion', target: 12000, saved: 0 },
    { name: 'Automne 2027 cushion', target: 14000, saved: 0 },
  ]);
});

test('defaults() ids are fresh and unique', () => {
  const ids = d => [...d.bills, ...d.budget, ...d.budget.flatMap(g => g.items), ...d.accounts, ...d.goals].map(x => x.id);
  const a = ids(defaults()), b = ids(defaults());
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.every(id => typeof id === 'string' && id.length > 0));
  assert.notDeepEqual(a, b);
});
