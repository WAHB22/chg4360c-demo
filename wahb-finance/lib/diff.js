// Structural diff of two states, and applying that diff forward or backward. Pure ES module.
//
// An op is {path, from, to} with optional extras:
//   path segments are object keys, or {id} for an element of an id list (see isIdList).
//   An element insert or remove has a path ending in {id}, the whole element in `to` (insert) or `from` (remove),
//   and `index`: its position on the side where it exists.
//   A reorder of the ids both sides keep is one op on the array itself: {path, from: [ids], to: [ids], order: true}.
// Ops address elements by id, never by position, so a diff can be applied onto a base that changed elsewhere
// (that is how pending changes are replayed after a 409) and only touches the paths it recorded.
import { clone } from './core.js';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdSeg = seg => seg !== null && typeof seg === 'object';
// Own properties only, so a key like 'constructor' or '__proto__' never reads the prototype.
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const setKey = (o, k, v) => {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  else o[k] = v;
};

// Every element is a plain object with a string id, and the ids are unique.
function isIdList(arr) {
  const seen = new Set();
  for (const x of arr) {
    if (!isObj(x) || typeof x.id !== 'string' || seen.has(x.id)) return false;
    seen.add(x.id);
  }
  return true;
}

// NaN equals NaN here: a bad number typed into a form must not turn every later action into a change.
const same = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));

// Deep equality where a missing key and an undefined value are the same thing.
function equal(a, b) {
  if (same(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (!isObj(a) || !isObj(b)) return false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!equal(own(a, k), own(b, k))) return false;
  return true;
}

const sameList = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

export function diff(a, b) {
  const ops = [];
  walk(a, b, [], ops);
  return ops;
}

function walk(a, b, path, ops) {
  if (same(a, b)) return;
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(own(a, k), own(b, k), [...path, k], ops);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isIdList(a) && isIdList(b)) return walkIdList(a, b, path, ops);
    if (equal(a, b)) return;
  }
  ops.push({ path, from: clone(a), to: clone(b) });
}

// Op order matters for the backward pass, which runs the list in reverse:
// removes (highest index first), then the reorder, then inserts (lowest index first), then changes inside kept elements.
// Reversed, that undoes the inserts, restores the old order, and puts removed elements back lowest index first,
// so every element lands exactly at its recorded index.
function walkIdList(a, b, path, ops) {
  const inA = new Map(a.map(x => [x.id, x]));
  const inB = new Map(b.map(x => [x.id, x]));
  for (let i = a.length - 1; i >= 0; i--) {
    if (!inB.has(a[i].id)) ops.push({ path: [...path, { id: a[i].id }], from: clone(a[i]), to: undefined, index: i });
  }
  const keptA = a.filter(x => inB.has(x.id)).map(x => x.id);
  const keptB = b.filter(x => inA.has(x.id)).map(x => x.id);
  if (!sameList(keptA, keptB)) ops.push({ path, from: keptA, to: keptB, order: true });
  for (let i = 0; i < b.length; i++) {
    if (!inA.has(b[i].id)) ops.push({ path: [...path, { id: b[i].id }], from: undefined, to: clone(b[i]), index: i });
  }
  for (const id of keptB) walk(inA.get(id), inB.get(id), [...path, { id }], ops);
}

export function applyOps(state, ops, direction = 'forward') {
  const back = direction === 'backward';
  const list = back ? [...ops].reverse() : ops;
  for (const op of list) state = applyOne(state, op, back);
  return state;
}

function applyOne(root, op, back) {
  if (!op || !Array.isArray(op.path)) return root;
  const { path } = op;
  const value = back ? op.from : op.to;
  if (op.order) {
    const arr = reach(root, path, path.length, false);
    if (Array.isArray(arr) && Array.isArray(value)) reorder(arr, value);
    return root;
  }
  if (path.length === 0) return clone(value); // the root itself was not an object on one side
  const last = path[path.length - 1];
  const parent = reach(root, path, path.length - 1, value !== undefined);
  if (parent == null) return root; // what it changed is gone from this base (deleted elsewhere): leave it
  if (isIdSeg(last)) {
    if (!Array.isArray(parent)) return root;
    const at = parent.findIndex(x => isObj(x) && x.id === last.id);
    if (value === undefined) {
      if (at >= 0) parent.splice(at, 1);
    } else if (at >= 0) {
      parent[at] = clone(value); // already there (a replay of a save that went through): same result
    } else {
      const index = Math.max(0, Math.min(Number.isInteger(op.index) ? op.index : parent.length, parent.length));
      parent.splice(index, 0, clone(value));
    }
    return root;
  }
  if (!isObj(parent)) return root;
  // The value this op replaces, as it recorded it. A whole object or id list that the op adds or removes
  // (most often a month: its first expense, pay or tick) may exist on this base with another device's content in it.
  const other = back ? op.to : op.from;
  const cur = own(parent, last);
  if (value === undefined) {
    // Removing what it added: take out only its part; the container goes only when nothing else is left in it.
    if (other !== undefined && sameKind(cur, other) && !subtract(cur, other)) return root;
    delete parent[last];
  } else if (other === undefined && sameKind(cur, value)) {
    merge(cur, value); // added here by another device too: keep both
  } else {
    setKey(parent, last, clone(value));
  }
  return root;
}

const isList = v => Array.isArray(v) && isIdList(v);
const sameKind = (x, y) => (isObj(x) && isObj(y)) || (isList(x) && isList(y));

// Puts `val` into `cur` (same kind) without dropping anything `cur` already holds. Where both have a value, `val` wins.
function merge(cur, val) {
  if (Array.isArray(cur)) {
    val.forEach((x, i) => {
      const at = cur.findIndex(y => y.id === x.id);
      if (at >= 0) merge(cur[at], x);
      else cur.splice(Math.min(i, cur.length), 0, clone(x));
    });
    return;
  }
  for (const k of Object.keys(val)) {
    const c = own(cur, k), v = val[k];
    if (v === undefined) continue;
    if (sameKind(c, v)) merge(c, v);
    else setKey(cur, k, clone(v));
  }
}

// Takes out of `cur` what `prev` held, keeping anything added or changed since. A list or object that empties
// stays as an empty one, so a month keeps its shape. Returns true when nothing else is left in `cur`.
function subtract(cur, prev) {
  if (equal(cur, prev)) return true;
  if (Array.isArray(cur)) {
    const ids = new Set(prev.map(x => x.id));
    for (let i = cur.length - 1; i >= 0; i--) if (ids.has(cur[i].id)) cur.splice(i, 1);
    return cur.length === 0;
  }
  let left = false;
  for (const k of Object.keys(cur)) {
    const c = cur[k], p = own(prev, k);
    if (p === undefined || !(sameKind(c, p) ? subtract(c, p) : equal(c, p))) { left = true; continue; }
    if (isObj(c)) { for (const key of Object.keys(c)) delete c[key]; }
    else if (isList(c)) c.length = 0;
    else delete cur[k]; // a value or a plain array it set: gone
  }
  return !left;
}

// Walks path[0..n-1] and returns that container. When `create` is set, a missing (or null) branch is created
// as {} or, when the next segment is an id, as []. Returns null when the path cannot be followed on this base.
function reach(root, path, n, create) {
  let cur = root;
  for (let i = 0; i < n; i++) {
    const seg = path[i];
    if (isIdSeg(seg)) {
      if (!Array.isArray(cur)) return null;
      cur = cur.find(x => isObj(x) && x.id === seg.id);
      if (!cur) return null;
      continue;
    }
    if (!isObj(cur)) return null;
    let next = own(cur, seg);
    if (next == null) {
      if (!create) return null;
      next = isIdSeg(path[i + 1]) ? [] : {};
      setKey(cur, seg, next);
    }
    cur = next;
  }
  return cur;
}

// Puts the listed ids in the listed order, using only the slots those elements already occupy.
// Elements not in the list (added elsewhere) keep their positions.
function reorder(arr, ids) {
  const want = new Set(ids);
  const slots = [], byId = new Map();
  arr.forEach((x, i) => {
    if (isObj(x) && want.has(x.id) && !byId.has(x.id)) { slots.push(i); byId.set(x.id, x); }
  });
  const order = [...want].filter(id => byId.has(id));
  slots.forEach((slot, i) => { arr[slot] = byId.get(order[i]); });
}
