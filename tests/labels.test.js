import test from 'node:test';
import assert from 'node:assert/strict';
import { label, noteFor, txName, clockTime, ordinal } from '../lib/labels.js';
import sample from './fixtures/sample-nov.js';

const tx = { id: 't1', date: '2026-11-02', item: 'i-groc', amt: 182.40, note: 'Costco' };

test('txName: note, else category name, else Other', () => {
  assert.equal(txName(sample, tx), 'Costco');
  assert.equal(txName(sample, { ...tx, note: '' }), 'Groceries');
  assert.equal(txName(sample, { ...tx, note: '   ' }), 'Groceries');
  assert.equal(txName(sample, { ...tx, note: '', item: 'gone' }), 'Other');
  assert.equal(txName(null, { amt: 5 }), 'Other');
});

test('expense labels', () => {
  assert.equal(label('addTx', { name: 'Costco', amt: 182.40 }), 'Added Costco $182.40');
  assert.equal(label('editTx', { name: 'Costco', amt: 182.40 }), 'Changed Costco $182.40');
  assert.equal(label('deleteTx', { name: 'Costco', amt: 182.40 }), 'Deleted Costco $182.40');
  // the tx itself can be passed, its name comes from txName
  assert.equal(label('addTx', { state: sample, tx }), 'Added Costco $182.40');
  assert.equal(label('addTx', { state: sample, tx: { ...tx, note: '', amt: 120 } }), 'Added Groceries $120');
  assert.equal(label('addTx', { state: sample, tx: { ...tx, note: '', item: null, amt: 3 } }), 'Added Other $3');
  // refund: minus sign on the amount
  assert.equal(label('addTx', { name: 'Costco', amt: -20 }), 'Added Costco -$20');
});

test('bill tick labels', () => {
  assert.equal(label('tickBill', { name: 'Netflix' }), 'Ticked Netflix paid');
  assert.equal(label('tickBill', { name: 'Netflix', onTime: true }), 'Ticked Netflix paid on time');
  assert.equal(label('tickBill', { name: 'Netflix', onTime: false }), 'Ticked Netflix paid');
  assert.equal(label('tickBill', { bill: { name: 'Netflix' }, date: '2026-11-16', today: '2026-11-14' }), 'Ticked Netflix paid on time');
  assert.equal(label('tickBill', { bill: { name: 'Netflix' }, date: '2026-11-16', today: '2026-11-17' }), 'Ticked Netflix paid');
  assert.equal(label('tickBill', { name: 'Manga', date: '2026-11-??', today: '2026-11-14' }), 'Ticked Manga paid');
  assert.equal(label('untickBill', { name: 'Netflix' }), 'Unticked Netflix');
});

test('bill labels', () => {
  assert.equal(label('addBill', { name: 'Spotify' }), 'Added bill Spotify');
  assert.equal(label('editBill', { bill: { name: 'Spotify' } }), 'Changed bill Spotify');
  assert.equal(label('deleteBill', { name: 'Spotify' }), 'Deleted bill Spotify');
});

test('category labels', () => {
  assert.equal(label('addItem', { name: 'Activities' }), 'Added Activities');
  assert.equal(label('editItem', { name: 'Activities' }), 'Changed Activities');
  assert.equal(label('deleteItem', { item: { name: 'Activities' } }), 'Deleted Activities');
  assert.equal(label('limit', { name: 'Groceries', limit: 480 }), 'Changed Groceries limit to $480');
  assert.equal(label('limit', { name: 'Groceries', limit: 0 }), 'Removed the Groceries limit');
  assert.equal(label('addGroup', { name: 'Kids' }), 'Added group Kids');
});

test('pay labels', () => {
  assert.equal(label('addPay', { amt: 1300 }), 'Logged pay $1,300');
  assert.equal(label('editPay', { pay: { amt: 1300 } }), 'Changed pay $1,300');
  assert.equal(label('deletePay', { amt: 1300 }), 'Deleted pay $1,300');
  assert.equal(label('addPay', { amt: 1287.65 }), 'Logged pay $1,287.65');
  assert.equal(label('payPlan', { amt: 1300 }), 'Planned pay set to $1,300');
});

test('account and jar labels', () => {
  assert.equal(label('account', { name: 'Chequing', bal: 420 }), 'Updated Chequing to $420');
  assert.equal(label('account', { account: { name: 'Visa owing', bal: 640.5 } }), 'Updated Visa owing to $640.50');
  assert.equal(label('account', { name: 'Savings', bal: null }), 'Updated Savings');
  assert.equal(label('jar', { name: 'Hiver 2027 cushion', add: 200 }), 'Added $200 to Hiver 2027 cushion');
  assert.equal(label('jar', { name: 'Hiver 2027 cushion', add: -50 }), 'Took $50 from Hiver 2027 cushion');
  assert.equal(label('jar', { name: 'Hiver 2027 cushion' }), 'Changed Hiver 2027 cushion');
  assert.equal(label('jar', { goal: { name: 'Hiver 2027 cushion' }, add: 0 }), 'Changed Hiver 2027 cushion');
});

test('import labels', () => {
  assert.equal(label('import', { expenses: 4 }), 'Imported 4 expenses');
  assert.equal(label('import', { expenses: 4, pays: 1 }), 'Imported 4 expenses and 1 pay');
  assert.equal(label('import', { expenses: 4, bills: 2 }), 'Imported 4 expenses and ticked 2 bills paid');
  assert.equal(label('import', { expenses: 4, pays: 2, bills: 1, total: 158.27 }), 'Imported 4 expenses, 2 pays and ticked 1 bill paid');
  assert.equal(label('import', { expenses: 1, pays: 0, bills: 0 }), 'Imported 1 expense');
  assert.equal(label('import', { bills: 2 }), 'Ticked 2 bills paid');
  assert.equal(label('import', { pays: 1 }), 'Imported 1 pay');
  assert.equal(label('import', { expenses: [{}, {}], pays: [], bills: [] }), 'Imported 2 expenses');
  assert.equal(label('import', {}), 'Imported nothing');
});

test('move and raise labels', () => {
  assert.equal(label('move', { amt: 40, from: 'Volleyball', to: 'Groceries' }), 'Moved $40 Volleyball → Groceries');
  assert.equal(label('move', { state: sample, amt: 40, from: 'i-volley', to: 'i-groc' }), 'Moved $40 Volleyball → Groceries');
  assert.equal(label('raise', { name: 'Groceries', newLimit: 480 }), 'Raised Groceries limit to $480');
  assert.equal(label('raise', { state: sample, itemId: 'i-groc', months: ['2026-09', '2026-10', '2026-11'], newLimit: 480 }), 'Raised Groceries limit to $480');
});

test('restore labels', () => {
  assert.equal(label('restoreBackup', { date: '2026-11-01' }), 'Restored backup from Nov 1');
  assert.equal(label('restoreBackup', { savedAt: new Date(2026, 10, 1, 9, 5).toISOString() }), 'Restored backup from Nov 1');
  assert.equal(label('restoreBackup', {}), 'Restored backup');
  const at = new Date(2026, 10, 14, 15, 20).toISOString();
  assert.equal(label('restoreVersion', { savedAt: at }), 'Restored the version from Nov 14, 3:20 p.m.');
  assert.equal(label('restoreVersion', { savedAt: '2026-11-14' }), 'Restored the version from Nov 14');
});

test('undo label', () => {
  assert.equal(label('undo', { label: 'Deleted Costco $182.40' }), 'Undid "Deleted Costco $182.40"');
  assert.equal(label('undo', 'Deleted Costco $182.40'), 'Undid "Deleted Costco $182.40"');
  assert.equal(label('undo', { action: { label: 'Ticked Netflix paid' } }), 'Undid "Ticked Netflix paid"');
});

test('settings labels', () => {
  assert.equal(label('visaDue', { day: 22 }), 'Visa due day set to the 22nd');
  assert.equal(label('visaDue', { day: 1 }), 'Visa due day set to the 1st');
  assert.equal(label('visaDue', { day: 13 }), 'Visa due day set to the 13th');
  assert.equal(label('visaDue', { day: null }), 'Visa due day cleared');
  assert.equal(label('chequing', { bal: 420 }), 'Chequing balance set to $420');
  assert.equal(label('chequing', { bal: 0 }), 'Chequing balance set to $0');
});

test('unknown kind falls back safely', () => {
  assert.equal(label('somethingNew'), 'Saved');
  assert.equal(label('somethingNew', { label: 'Did a thing' }), 'Did a thing');
});

test('clockTime and ordinal', () => {
  assert.equal(clockTime(new Date(2026, 10, 14, 15, 20)), '3:20 p.m.');
  assert.equal(clockTime(new Date(2026, 10, 14, 9, 5)), '9:05 a.m.');
  assert.equal(clockTime(new Date(2026, 10, 14, 0, 0)), '12:00 a.m.');
  assert.equal(clockTime(new Date(2026, 10, 14, 12, 30)), '12:30 p.m.');
  assert.equal(clockTime('not a date'), '');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
});

test('noteFor', () => {
  assert.equal(noteFor([]), 'Saved');
  assert.equal(noteFor(undefined), 'Saved');
  assert.equal(noteFor(['A']), 'A');
  assert.equal(noteFor(['A', 'B']), 'A and B');
  assert.equal(noteFor(['A', 'B', 'C']), 'A and 2 more changes');
  assert.equal(noteFor(['A', 'B', 'C', 'D']), 'A and 3 more changes');
  assert.equal(noteFor(['Added Costco $182.40', 'Ticked Netflix paid']), 'Added Costco $182.40 and Ticked Netflix paid');
});

test('no label has a dash in it', () => {
  const at = new Date(2026, 10, 14, 15, 20).toISOString();
  const all = [
    label('addTx', { name: 'Costco', amt: 182.4 }), label('tickBill', { name: 'Netflix', onTime: true }),
    label('limit', { name: 'Groceries', limit: 0 }), label('jar', { name: 'Hiver 2027 cushion', add: -50 }),
    label('import', { expenses: 4, pays: 1, bills: 2 }), label('import', {}), label('move', { amt: 40, from: 'Volleyball', to: 'Groceries' }),
    label('restoreBackup', {}), label('restoreVersion', { savedAt: at }), label('restoreVersion', {}),
    label('visaDue', {}), label('chequing', {}), label('account', { name: 'Savings' }), label('nope'),
    noteFor([]), noteFor(['A', 'B', 'C']),
  ];
  for (const s of all) assert.doesNotMatch(s, /[‐-―]| - /, s);
});
