import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../lib/core.js';

test('dates', () => {
  assert.equal(C.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(C.addDays('2026-03-08', 1), '2026-03-09'); // DST day in Canada
  assert.equal(C.daysBetween('2026-11-14', '2026-11-20'), 6);
  assert.equal(C.monthEnd('2026-02'), '2026-02-28');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
  assert.equal(C.shortDate('2026-11-14'), 'Nov 14');
});
test('money', () => {
  assert.equal(C.sum([0.1, 0.2]), 0.3);
  assert.equal(C.fmt(1234.5), '$1,234.50');
  assert.equal(C.fmt(-6.58), '-$6.58');
  assert.equal(C.fmtShort(1300), '$1,300');
  assert.equal(C.fmtShort(6.58), '$6.58');
});
test('biweekly gym matches the original page', () => {
  const gym = { id: 'g', freq: 'biweekly', anchor: '2026-09-03', amt: 31.58 };
  assert.deepEqual(C.billOccurrences(gym, '2026-11'), ['2026-11-12', '2026-11-26']);
  assert.deepEqual(C.billOccurrences(gym, '2026-10'), ['2026-10-01', '2026-10-15', '2026-10-29']);
  assert.deepEqual(C.billOccurrencesBetween(gym, '2026-11-14', '2026-12-10'), ['2026-11-26', '2026-12-10']);
});
test('monthly bill clamps and no date', () => {
  assert.deepEqual(C.billOccurrences({ day: 31 }, '2026-02'), ['2026-02-28']);
  assert.deepEqual(C.billOccurrences({ day: null }, '2026-11'), ['2026-11-??']);
  assert.deepEqual(C.billOccurrencesBetween({ day: null }, '2026-11-01', '2026-11-30'), []);
});
test('peekMonth does not create months', () => {
  const s = { months: {} };
  assert.equal(C.peekMonth(s, '2026-11').tx.length, 0);
  assert.deepEqual(s.months, {});
  C.getMonth(s, '2026-11').tx.push({});
  assert.equal(s.months['2026-11'].tx.length, 1);
});
test('canonical ignores key order and only top level omits', () => {
  assert.equal(C.canonical({ b: 1, a: { note: 'x', z: 1 } , note: 'top'}, ['note']), C.canonical({ a: { z: 1, note: 'x' }, b: 1 }));
});
