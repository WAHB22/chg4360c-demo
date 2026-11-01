import test from 'node:test';
import assert from 'node:assert/strict';
import { diff, applyOps } from '../lib/diff.js';
import { canonical, clone } from '../lib/core.js';
import sample from './fixtures/sample-nov.js';

/* ---------- seeded random helpers ---------- */
function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  return {
    next, int,
    chance: p => next() < p,
    pick: arr => arr[int(arr.length)],
    money: () => Math.round(next() * 50000) / 100,
    word: () => ['Costco', 'Netflix', 'Nuage', 'Rent', 'Gym', 'Pho', 'Metro', 'Lyft', 'Bell'][int(9)],
  };
}
let seq = 0;
const newId = p => `${p}${++seq}`;

function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = r.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
}

const day = r => `2026-11-${String(1 + r.int(28)).padStart(2, '0')}`;
const makeBill = r => ({ id: newId('b'), name: r.word(), amt: r.money(), freq: 'monthly', day: 1 + r.int(28), note: r.chance(0.3) ? 'note' : '' });
const makeTx = r => {
  const tx = { id: newId('t'), date: day(r), item: 'i' + r.int(5), amt: r.money(), note: r.word(), src: 'manual', merchant: r.word(), account: r.pick(['visa', 'chequing', null]) };
  if (r.chance(0.3)) tx.tags = ['a', 'b', 'c'].slice(0, 1 + r.int(3)); // primitive array, replaced whole
  return tx;
};
const makePay = r => ({ id: newId('p'), date: day(r), amt: 1300, hours: r.chance(0.5) ? 64 : null, note: '' });
const makeItem = r => ({ id: newId('i'), name: r.word(), limit: r.int(5) * 50 });
const makeMonth = r => ({
  paid: Object.fromEntries(Array.from({ length: r.int(4) }, () => [`${newId('b')}@${day(r)}`, true])),
  tx: Array.from({ length: r.int(6) }, () => makeTx(r)),
  pays: Array.from({ length: r.int(3) }, () => makePay(r)),
  moves: [],
});

// A realistic v2 state with every kind of shape the diff has to handle.
function makeState(r) {
  return {
    version: 2,
    settings: { payPlan: 1300, visaDueDay: r.chance(0.5) ? 22 : null, chequing: { bal: r.money(), asOf: '2026-11-01' } },
    bills: Array.from({ length: 2 + r.int(6) }, () => makeBill(r)),
    budget: Array.from({ length: 1 + r.int(3) }, () => ({ id: newId('g'), name: r.word(), items: Array.from({ length: r.int(5) }, () => makeItem(r)) })),
    accounts: [
      { id: 'a-cheq', name: 'Chequing', bal: r.money(), goal: 400, kind: 'asset' },
      { id: 'a-visa', name: 'Visa owing', bal: r.money(), limit: 2500, kind: 'debt' },
    ],
    goals: [{ id: 'j1', name: 'Hiver 2027 cushion', target: 12000, saved: r.money() }],
    merchantMap: { costco: 'i1', 'nuage cafe': 'i2' },
    months: { '2026-10': makeMonth(r), '2026-11': makeMonth(r) },
    buildB: { flags: [true, false], deep: { list: [1, 2, 3], name: 'kept' } }, // unknown field from build B
    note: '',
    savedAt: '2026-11-14T15:00:00.000Z',
  };
}

const idLists = s => [
  s.bills, s.budget, s.accounts, s.goals,
  ...s.budget.filter(g => Array.isArray(g.items)).map(g => g.items),
  ...Object.values(s.months).flatMap(m => [m.tx, m.pays, m.moves].filter(Array.isArray)),
].filter(a => Array.isArray(a));

// Edits a person (or build B) could make. Each one mutates s in place.
const EDITS = [
  (r, s) => { const b = r.pick(s.bills); if (b) b.amt = r.money(); },
  (r, s) => { const b = r.pick(s.bills); if (b) b.name = r.word() + ' ' + r.int(9); },
  (r, s) => { const b = r.pick(s.bills); if (b) delete b.note; },
  (r, s) => { const b = r.pick(s.bills); if (b) b.extra = { added: r.int(9) }; },
  (r, s) => { s.bills.splice(r.int(s.bills.length + 1), 0, makeBill(r)); },
  (r, s) => { if (s.bills.length) s.bills.splice(r.int(s.bills.length), 1); },
  (r, s) => { shuffle(r, s.bills); },
  (r, s) => { const list = r.pick(idLists(s)); shuffle(r, list); },
  (r, s) => { const list = r.pick(idLists(s)); if (list.length) list.splice(r.int(list.length), 1); },
  (r, s) => { // remove an element and put it back somewhere else, changed
    const list = r.pick(idLists(s)); if (!list.length) return;
    const [x] = list.splice(r.int(list.length), 1);
    x.changed = true;
    list.splice(r.int(list.length + 1), 0, x);
  },
  (r, s) => { const g = r.pick(s.budget); if (g) g.items.splice(r.int(g.items.length + 1), 0, makeItem(r)); },
  (r, s) => { const g = r.pick(s.budget); const i = g && r.pick(g.items); if (i) i.limit = r.int(10) * 40; },
  (r, s) => { s.budget.splice(r.int(s.budget.length + 1), 0, { id: newId('g'), name: 'New', items: [makeItem(r)] }); },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; if (m) m.tx.splice(r.int(m.tx.length + 1), 0, makeTx(r)); },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; const t = m && r.pick(m.tx); if (t) { t.amt = r.money(); t.note = r.word(); } },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; const t = m && r.pick(m.tx); if (t) t.tags = ['z', ...(t.tags || [])].reverse(); },
  (r, s) => { // move a tx to another month (same id, different array)
    const from = s.months['2026-11'], to = (s.months['2026-12'] ||= { paid: {}, tx: [], pays: [], moves: [] });
    if (from && from.tx.length) to.tx.push(...from.tx.splice(r.int(from.tx.length), 1));
  },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; if (m) m.paid[`${newId('b')}@${day(r)}`] = true; },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; const k = m && r.pick(Object.keys(m.paid)); if (k) delete m.paid[k]; },
  (r, s) => { s.months[`2027-0${1 + r.int(9)}`] = makeMonth(r); },
  (r, s) => { const k = r.pick(Object.keys(s.months)); if (k) delete s.months[k]; },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; if (m) m.moves.push({ id: newId('m'), date: day(r), from: 'i1', to: 'i2', amt: 40 }); },
  (r, s) => { const m = s.months[r.pick(Object.keys(s.months))]; if (m) m.tx = []; },
  (r, s) => { s.settings.payPlan = r.int(20) * 100; },
  (r, s) => { s.settings.chequing = r.chance(0.5) ? null : { bal: r.money(), asOf: day(r) }; },
  (r, s) => { s.settings.visaDueDay = r.chance(0.5) ? undefined : 1 + r.int(31); },
  (r, s) => { s.merchantMap[r.word().toLowerCase()] = 'i' + r.int(5); },
  (r, s) => { delete s.merchantMap.costco; },
  (r, s) => { s.goals[0].saved = r.money(); },
  (r, s) => { s.accounts[r.int(2)].bal = r.chance(0.2) ? null : r.money(); },
  (r, s) => { s.buildB.deep.list = s.buildB.deep.list.concat(r.int(9)); },
  (r, s) => { s.buildB.flags.reverse(); },
  (r, s) => { s.buildB.deep = r.chance(0.5) ? [1, { x: 2 }] : 'now a string'; }, // type change
  (r, s) => { const list = r.pick(idLists(s)); list.push('not an object'); }, // id list becomes a mixed array
  (r, s) => { const list = r.pick(idLists(s)); if (list.length) list.push({ ...list[0] }); }, // duplicate id
];

// Generic edit on any container anywhere in the tree, for shapes the realistic edits do not reach.
function genericEdit(r, root) {
  const nodes = [];
  const visit = v => {
    if (Array.isArray(v)) { nodes.push(v); v.forEach(visit); } else if (v && typeof v === 'object') { nodes.push(v); Object.values(v).forEach(visit); }
  };
  visit(root);
  const node = r.pick(nodes);
  const value = () => r.pick([r.int(100), r.word(), true, null, { id: newId('x'), v: r.int(9) }, [1, 2], { nested: { a: r.int(9) } }]);
  if (Array.isArray(node)) {
    const c = r.int(4);
    if (c === 0) node.splice(r.int(node.length + 1), 0, value());
    else if (c === 1 && node.length) node.splice(r.int(node.length), 1);
    else if (c === 2) node.reverse();
    else node.length = 0;
  } else {
    const keys = Object.keys(node);
    const c = r.int(4);
    if (c === 0 && keys.length) node[r.pick(keys)] = value();
    else if (c === 1 && keys.length) delete node[r.pick(keys)];
    else if (c === 2 && keys.length) node[r.pick(keys)] = undefined;
    else node['k' + r.int(50)] = value();
  }
}

function randomEdits(r, s, n, edits = EDITS) {
  for (let i = 0; i < n; i++) {
    try {
      if (r.chance(0.8)) r.pick(edits)(r, s); else genericEdit(r, s);
    } catch { /* this edit does not fit the shape an earlier edit left: skip it */ }
  }
  return s;
}

const omitUndefined = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/* ---------- shape of ops ---------- */
test('a changed field inside an id list element is one op addressed by id', () => {
  const a = { bills: [{ id: 'b1', amt: 10 }, { id: 'b2', amt: 20 }] };
  const b = clone(a); b.bills[1].amt = 25;
  assert.deepEqual(diff(a, b), [{ path: ['bills', { id: 'b2' }, 'amt'], from: 20, to: 25 }]);
});

test('missing keys are undefined, and setting undefined deletes the key', () => {
  const a = { settings: { payPlan: 1300 }, paid: { 'b1@2026-11-01': true } };
  const b = { settings: { payPlan: 1300, visaDueDay: 22 }, paid: {} };
  const ops = diff(a, b);
  assert.deepEqual(ops, [
    { path: ['settings', 'visaDueDay'], from: undefined, to: 22 },
    { path: ['paid', 'b1@2026-11-01'], from: true, to: undefined },
  ]);
  const back = applyOps(clone(b), ops, 'backward');
  assert.equal('visaDueDay' in back.settings, false);
  assert.equal(canonical(back), canonical(a));
  const fwd = applyOps(clone(a), ops, 'forward');
  assert.equal('b1@2026-11-01' in fwd.paid, false);
});

test('inserts and removes in an id list record the element and its index', () => {
  const a = { tx: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] };
  const b = { tx: [{ id: 't1' }, { id: 't9', amt: 5 }, { id: 't3' }] };
  assert.deepEqual(diff(a, b), [
    { path: ['tx', { id: 't2' }], from: { id: 't2' }, to: undefined, index: 1 },
    { path: ['tx', { id: 't9' }], from: undefined, to: { id: 't9', amt: 5 }, index: 1 },
  ]);
  assert.deepEqual(diff({ tx: [] }, { tx: [{ id: 't1' }] }), [{ path: ['tx', { id: 't1' }], from: undefined, to: { id: 't1' }, index: 0 }]);
});

test('a reorder of common ids is one op on the array', () => {
  const a = { bills: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] };
  const b = { bills: [{ id: 'b3' }, { id: 'b1' }, { id: 'b2' }] };
  assert.deepEqual(diff(a, b), [{ path: ['bills'], from: ['b1', 'b2', 'b3'], to: ['b3', 'b1', 'b2'], order: true }]);
});

test('primitive arrays, mixed arrays and arrays with repeated ids are replaced whole', () => {
  assert.deepEqual(diff({ tags: ['a', 'b'] }, { tags: ['b', 'a'] }), [{ path: ['tags'], from: ['a', 'b'], to: ['b', 'a'] }]);
  assert.deepEqual(diff({ x: [{ id: 'a' }] }, { x: [{ id: 'a' }, 3] }), [{ path: ['x'], from: [{ id: 'a' }], to: [{ id: 'a' }, 3] }]);
  const dup = [{ id: 'a', n: 1 }, { id: 'a', n: 2 }];
  assert.deepEqual(diff({ x: [{ id: 'a', n: 1 }] }, { x: dup }), [{ path: ['x'], from: [{ id: 'a', n: 1 }], to: dup }]);
  assert.deepEqual(diff({ x: [{ id: 1 }] }, { x: [{ id: 2 }] }), [{ path: ['x'], from: [{ id: 1 }], to: [{ id: 2 }] }]); // ids must be strings
});

test('equal states give no ops, key order does not matter', () => {
  assert.deepEqual(diff(clone(sample), clone(sample)), []);
  assert.deepEqual(diff({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), []);
  assert.deepEqual(diff({ a: undefined }, {}), []);
});

test('applyOps mutates and returns the same state; ops never alias the states', () => {
  const a = clone(sample), b = clone(sample);
  b.months['2026-11'].tx.push({ id: 'tn', date: '2026-11-13', item: 'i-groc', amt: 12, note: 'Metro' });
  const ops = diff(a, b);
  b.months['2026-11'].tx.at(-1).amt = 999; // later edits to b do not leak into the ops
  const target = clone(a);
  const out = applyOps(target, ops, 'forward');
  assert.equal(out, target);
  assert.equal(out.months['2026-11'].tx.at(-1).amt, 12);
  out.months['2026-11'].tx.at(-1).amt = 1; // editing the result does not change the ops either
  assert.equal(ops[0].to.amt, 12);
});

test('non object roots are replaced whole', () => {
  assert.deepEqual(diff(1, 2), [{ path: [], from: 1, to: 2 }]);
  assert.equal(applyOps(1, diff(1, 2), 'forward'), 2);
  assert.equal(applyOps(2, diff(1, 2), 'backward'), 1);
});

/* ---------- round trip properties ---------- */
const opKind = op => op.order ? 'order'
  : op.path.length && typeof op.path.at(-1) === 'object' ? (op.to === undefined ? 'remove' : 'insert')
  : op.to === undefined ? 'delete' : op.from === undefined ? 'add' : Array.isArray(op.to) ? 'array' : 'set';

test('property: forward and backward round trips over many random edits', () => {
  const seen = {};
  for (let seed = 1; seed <= 600; seed++) {
    const r = rng(seed);
    const a = makeState(r);
    const b = randomEdits(r, clone(a), 1 + r.int(8));
    const aBefore = canonical(a), bBefore = canonical(b);
    const ops = diff(a, b);
    for (const op of ops) seen[opKind(op)] = (seen[opKind(op)] || 0) + 1;
    assert.equal(canonical(a), aBefore, `diff mutated a (seed ${seed})`);
    assert.equal(canonical(b), bBefore, `diff mutated b (seed ${seed})`);

    const fwd = applyOps(clone(a), ops, 'forward');
    assert.equal(canonical(fwd), canonical(b), `forward (seed ${seed})`);
    const back = applyOps(clone(b), ops, 'backward');
    assert.equal(canonical(back), canonical(a), `backward (seed ${seed})`);

    // Pending ops are stored as JSON and replayed after a reload: the round trip must survive that.
    const stored = JSON.parse(JSON.stringify(ops));
    assert.equal(canonical(applyOps(clone(a), stored, 'forward')), canonical(b), `stored forward (seed ${seed})`);
    assert.equal(canonical(applyOps(clone(b), stored, 'backward')), canonical(a), `stored backward (seed ${seed})`);

    // Element order is exact, not only the content.
    for (const key of ['bills', 'budget']) {
      assert.deepEqual(omitUndefined(fwd[key]), omitUndefined(b[key]), `order of ${key} (seed ${seed})`);
      assert.deepEqual(omitUndefined(back[key]), omitUndefined(a[key]), `order of ${key} back (seed ${seed})`);
    }
    assert.deepEqual(diff(b, b), []);
  }
  // The edits really exercised every kind of op.
  for (const kind of ['set', 'add', 'delete', 'array', 'insert', 'remove', 'order']) assert.ok(seen[kind] >= 20, `${kind}: ${seen[kind]}`);
});

test('property: chains of diffs replay forward and unwind backward', () => {
  for (let seed = 1000; seed < 1150; seed++) {
    const r = rng(seed);
    const states = [makeState(r)];
    for (let i = 0; i < 5; i++) states.push(randomEdits(r, clone(states[i]), 1 + r.int(4)));
    const chain = states.slice(1).map((s, i) => diff(states[i], s));
    let s = clone(states[0]);
    for (const ops of chain) s = applyOps(s, ops, 'forward');
    assert.equal(canonical(s), canonical(states.at(-1)), `forward chain (seed ${seed})`);
    for (const ops of [...chain].reverse()) s = applyOps(s, ops, 'backward');
    assert.equal(canonical(s), canonical(states[0]), `backward chain (seed ${seed})`);
  }
});

/* ---------- applying onto a base that changed elsewhere ---------- */
test('property: a diff applied onto a base changed in other sections keeps those changes', () => {
  const local = ['bills', 'settings', 'merchantMap'];
  const localEdits = EDITS.slice(0, 7).concat([
    (r, s) => { s.settings.payPlan = r.int(20) * 100; },
    (r, s) => { s.settings.chequing = { bal: r.money(), asOf: day(r) }; },
    (r, s) => { s.merchantMap[r.word().toLowerCase()] = 'i' + r.int(5); },
  ]);
  const remoteEdits = EDITS.slice(10, 23).concat([(r, s) => { s.goals[0].saved = r.money(); }]);
  for (let seed = 2000; seed < 2300; seed++) {
    const r = rng(seed);
    const a = makeState(r);
    const b = clone(a); for (let i = 0; i < 1 + r.int(5); i++) r.pick(localEdits)(r, b);
    const c = clone(a); for (let i = 0; i < 1 + r.int(5); i++) r.pick(remoteEdits)(r, c);
    const ops = diff(a, b);
    const out = applyOps(clone(c), ops, 'forward');
    const expected = clone(c);
    for (const k of local) expected[k] = clone(b[k]);
    assert.equal(canonical(out), canonical(expected), `merge (seed ${seed})`);
    // Undoing the local diff on top of the merge gives back the remote state.
    assert.equal(canonical(applyOps(out, ops, 'backward')), canonical(c), `unmerge (seed ${seed})`);
  }
});

test('property: edits to different fields and inserts in the same array both survive', () => {
  for (let seed = 3000; seed < 3300; seed++) {
    const r = rng(seed);
    const a = makeState(r);
    const b = clone(a), c = clone(a);
    const localNew = [], remoteNew = [];
    b.bills.forEach(x => { if (r.chance(0.5)) { x.amt = r.money(); x.note = 'local ' + r.int(9); } });
    for (let i = r.int(3); i > 0; i--) { const x = makeBill(r); localNew.push(x.id); b.bills.splice(r.int(b.bills.length + 1), 0, x); }
    c.bills.forEach(x => { if (r.chance(0.5)) { x.name = 'remote ' + r.int(9); x.day = 1 + r.int(28); } });
    for (let i = r.int(3); i > 0; i--) { const x = makeBill(r); remoteNew.push(x.id); c.bills.splice(r.int(c.bills.length + 1), 0, x); }
    if (r.chance(0.4) && c.bills.length) c.bills.splice(r.int(c.bills.length), 1); // remote delete
    const tx = makeTx(r); b.months['2026-11'].tx.push(tx);
    const tx2 = makeTx(r); c.months['2026-11'].tx.unshift(tx2);

    const out = applyOps(clone(c), diff(a, b), 'forward');
    const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
    const outBills = byId(out.bills), bBills = byId(b.bills), cBills = byId(c.bills);
    assert.deepEqual(Object.keys(outBills).sort(), [...Object.keys(cBills), ...localNew].sort(), `ids (seed ${seed})`);
    for (const id of Object.keys(cBills)) {
      const want = remoteNew.includes(id) ? cBills[id] : { ...cBills[id], amt: bBills[id].amt, note: bBills[id].note };
      assert.equal(canonical(outBills[id]), canonical(want), `bill ${id} (seed ${seed})`);
    }
    for (const id of localNew) assert.equal(canonical(outBills[id]), canonical(bBills[id]));
    // The remote order of its own elements is kept.
    assert.deepEqual(out.bills.map(x => x.id).filter(id => cBills[id]), c.bills.map(x => x.id), `order (seed ${seed})`);
    const ids = out.months['2026-11'].tx.map(t => t.id);
    assert.ok(ids.includes(tx.id) && ids.includes(tx2.id), `both new tx (seed ${seed})`);
  }
});

test('re-applying onto a changed base: other fields survive, diffed paths take the new values', () => {
  const a = clone(sample);
  const b = clone(a); // local: Netflix price, a new tx, untick rent, delete a pay
  b.bills.find(x => x.id === 'b-netflix').amt = 29.99;
  b.months['2026-11'].tx.push({ id: 'tL', date: '2026-11-13', item: 'i-groc', amt: 40, note: 'Metro' });
  delete b.months['2026-11'].paid['b-rent@2026-11-01'];
  b.months['2026-10'].pays = b.months['2026-10'].pays.filter(p => p.id !== 'p-oct9');
  const c = clone(a); // remote: Netflix renamed, its own tx, a goal, a new month, settings
  c.bills.find(x => x.id === 'b-netflix').name = 'Netflix Premium';
  c.months['2026-11'].tx.push({ id: 'tR', date: '2026-11-13', item: 'i-eat', amt: 20, note: 'Pho' });
  c.goals[1].saved = 200;
  c.months['2026-12'] = { paid: {}, tx: [], pays: [{ id: 'p-dec', date: '2026-12-04', amt: 1300, hours: null, note: '' }] };
  c.settings.visaDueDay = 22;

  const out = applyOps(clone(c), diff(a, b), 'forward');
  const netflix = out.bills.find(x => x.id === 'b-netflix');
  assert.equal(netflix.amt, 29.99);
  assert.equal(netflix.name, 'Netflix Premium');
  // Both new tx are kept; the local one goes back at its recorded index (8), ahead of the remote one.
  assert.deepEqual(out.months['2026-11'].tx.map(t => t.id), ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 'tL', 'tR']);
  assert.equal(out.months['2026-11'].paid['b-rent@2026-11-01'], undefined);
  assert.equal(out.months['2026-11'].paid['b-park@2026-11-01'], true);
  assert.deepEqual(out.months['2026-10'].pays.map(p => p.id), ['p-oct23']);
  assert.equal(out.goals[1].saved, 200);
  assert.equal(out.months['2026-12'].pays[0].id, 'p-dec');
  assert.equal(out.settings.visaDueDay, 22);
});

test('a change to an element deleted elsewhere is dropped, not resurrected', () => {
  const a = clone(sample);
  const b = clone(a); b.bills.find(x => x.id === 'b-manga').amt = 6;
  const c = clone(a); c.bills = c.bills.filter(x => x.id !== 'b-manga');
  const out = applyOps(clone(c), diff(a, b), 'forward');
  assert.equal(canonical(out), canonical(c));
  // A set under a key that is missing on the base creates the branch.
  const d = { settings: {} };
  applyOps(d, [{ path: ['settings', 'chequing', 'bal'], from: 1, to: 2 }], 'forward');
  assert.deepEqual(d, { settings: { chequing: { bal: 2 } } });
  // A delete under a missing branch creates nothing.
  const e = { settings: {} };
  applyOps(e, [{ path: ['settings', 'chequing', 'bal'], from: 1, to: undefined }], 'forward');
  assert.deepEqual(e, { settings: {} });
});

test('the same forward ops applied twice give the same result (a replay after a save that went through)', () => {
  for (let seed = 4000; seed < 4100; seed++) {
    const r = rng(seed);
    const a = makeState(r);
    const b = randomEdits(r, clone(a), 1 + r.int(5), EDITS.slice(0, 22));
    const ops = diff(a, b);
    const saved = JSON.stringify(ops);
    const twice = applyOps(clone(b), ops, 'forward');
    assert.equal(canonical(twice), canonical(b), `seed ${seed}`);
    // The result shares nothing with the ops: scribbling over it leaves the ops as they were.
    const scribble = v => { if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (v[k] && typeof v[k] === 'object') scribble(v[k]); else v[k] = 'x'; } };
    scribble(twice);
    assert.equal(JSON.stringify(ops), saved, `ops aliased (seed ${seed})`);
  }
});

test('a reorder applied onto a base with extra elements keeps the extras in place', () => {
  const a = { bills: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] };
  const b = { bills: [{ id: 'b3' }, { id: 'b2' }, { id: 'b1' }] };
  const c = { bills: [{ id: 'b1' }, { id: 'x' }, { id: 'b2' }, { id: 'b3' }] };
  const out = applyOps(clone(c), diff(a, b), 'forward');
  assert.deepEqual(out.bills.map(x => x.id), ['b3', 'x', 'b2', 'b1']);
});

/* ---------- delete then re-add ---------- */
test('deleting an element then re-adding it at its original index restores the order', () => {
  const a = clone(sample);
  const ids = a.bills.map(x => x.id);

  const one = clone(a); one.bills.splice(3, 1);
  const ops1 = diff(a, one);
  assert.deepEqual(ops1.map(o => o.index), [3]);
  assert.deepEqual(applyOps(clone(one), ops1, 'backward').bills.map(x => x.id), ids);

  const two = clone(a); two.bills = two.bills.filter((x, i) => i !== 1 && i !== 4 && i !== 8);
  assert.deepEqual(applyOps(clone(two), diff(a, two), 'backward').bills.map(x => x.id), ids);

  const none = clone(a); none.bills = [];
  const back = applyOps(clone(none), diff(a, none), 'backward');
  assert.deepEqual(back.bills.map(x => x.id), ids);
  assert.equal(JSON.stringify(back.bills), JSON.stringify(a.bills)); // the element itself is exact too

  // On a base that also gained a bill at the end, the deleted one still goes back to index 3.
  const later = clone(one); later.bills.push({ id: 'b-new', name: 'New', amt: 1, freq: 'monthly', day: 2, note: '' });
  const out = applyOps(later, ops1, 'backward');
  assert.deepEqual(out.bills.map(x => x.id), [...ids, 'b-new']);

  // Delete then reorder then undo both, in order.
  const shuffled = clone(one); shuffled.bills.reverse();
  const ops2 = diff(one, shuffled);
  let s = applyOps(clone(shuffled), ops2, 'backward');
  s = applyOps(s, ops1, 'backward');
  assert.deepEqual(s.bills.map(x => x.id), ids);

  // A tx deleted from the middle of a month comes back at the same spot.
  const tx = clone(a); tx.months['2026-11'].tx.splice(4, 1);
  const tback = applyOps(clone(tx), diff(a, tx), 'backward');
  assert.deepEqual(tback.months['2026-11'].tx.map(t => t.id), a.months['2026-11'].tx.map(t => t.id));
});

test('an index past the end is clamped', () => {
  const s = { tx: [{ id: 't1' }] };
  applyOps(s, [{ path: ['tx', { id: 't9' }], from: { id: 't9' }, to: undefined, index: 7 }], 'backward');
  assert.deepEqual(s.tx.map(t => t.id), ['t1', 't9']);
  applyOps(s, [{ path: ['tx', { id: 't0' }], from: undefined, to: { id: 't0' }, index: -3 }], 'forward');
  assert.deepEqual(s.tx.map(t => t.id), ['t0', 't1', 't9']);
});
