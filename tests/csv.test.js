import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../lib/csv.js';
import { visa, chequing, withHeader, usDates, messy } from './fixtures/statement-sample.js';
import { hasDash } from './helpers/import-helpers.js';

test('Visa export: 5 columns, quoted commas and doubled quotes', () => {
  const { rows, skipped } = parseCSV(visa);
  assert.deepEqual(skipped, []);
  assert.equal(rows.length, 6);
  assert.ok(rows.every(r => r.account === 'visa' && r.time === null));
  assert.deepEqual(rows[0], {
    date: '2026-11-03',
    time: null,
    merchant: 'COSTCO WHOLESALE W1234 MONTREAL, QC',
    amount: 182.4,
    direction: 'out',
    account: 'visa',
    raw: '2026-11-03,"COSTCO WHOLESALE W1234 MONTREAL, QC",182.40,,4500********1234',
  });
  assert.equal(rows[2].merchant, 'PAYMENT THANK YOU/PAIEMENT MERCI');
  assert.equal(rows[2].direction, 'in');
  assert.equal(rows[2].amount, 500);
  assert.equal(rows[3].merchant, 'BOB "THE" DUMPLING, BAR');
  assert.equal(rows[3].amount, 42.1);
  assert.equal(rows[5].direction, 'in'); // a credit on the Visa
});

test('raw is the original line', () => {
  const lines = visa.split('\n');
  parseCSV(visa).rows.forEach((r, i) => assert.equal(r.raw, lines[i]));
  const cheq = chequing.split('\r\n');
  parseCSV(chequing).rows.forEach((r, i) => assert.equal(r.raw, cheq[i]));
});

test('chequing export: 4 columns, CRLF line ends', () => {
  const { rows, skipped } = parseCSV(chequing);
  assert.deepEqual(skipped, []);
  assert.deepEqual(rows.map(r => [r.date, r.merchant, r.amount, r.direction, r.account]), [
    ['2026-11-06', 'BOBINO PAYROLL', 1300, 'in', 'chequing'],
    ['2026-11-08', 'INTERNET TRANSFER 000000123456', 200, 'out', 'chequing'],
    ['2026-11-09', 'E-TRANSFER RECEIVED Kylie', 40, 'in', 'chequing'],
    ['2026-11-21', 'BELL CANADA', 89.43, 'out', 'chequing'],
    ['2026-11-18', 'BELL CANADA', 90.83, 'out', 'chequing'],
  ]);
});

test('a header row is skipped quietly, with or without a byte order mark', () => {
  const { rows, skipped } = parseCSV(withHeader);
  assert.deepEqual(skipped, []);
  assert.deepEqual(rows.map(r => r.merchant), ['PET VALU #123', 'UBER* EATS']);
  assert.equal(rows[0].date, '2026-11-10');
  assert.equal(rows[0].raw, '2026-11-10,PET VALU #123,28.00,,4500********1234');
  assert.equal(parseCSV(withHeader.replace('﻿', '')).rows.length, 2);
});

test('MM/DD/YYYY dates become YYYY-MM-DD', () => {
  const { rows, skipped } = parseCSV(usDates);
  assert.deepEqual(skipped, []);
  assert.deepEqual(rows.map(r => [r.date, r.merchant, r.amount]), [
    ['2026-11-05', 'PETRO-CANADA 98765', 58],
    ['2027-01-07', 'MAXI & CIE, LAVAL', 12.34],
  ]);
});

test('blank lines are ignored and bad lines are reported with their line number', () => {
  const { rows, skipped } = parseCSV(messy);
  assert.deepEqual(rows.map(r => [r.merchant, r.amount, r.direction]), [
    ['ABC 3843-AF', 31.58, 'out'],
    ['SAVEURS EPICERIE URBAINE', 1234.56, 'out'],
    ['REVERSAL', 15, 'in'],
  ]);
  assert.deepEqual(skipped, [
    { line: 6, reason: 'Expected 4 or 5 columns, found 2' },
    { line: 7, reason: 'The date is not valid' },
    { line: 8, reason: 'Both debit and credit are filled' },
    { line: 9, reason: 'No amount' },
    { line: 10, reason: 'A quote is never closed' },
    { line: 11, reason: 'The amount is not a number' },
    { line: 12, reason: 'The date is not valid' },
    { line: 14, reason: 'No description' },
  ]);
  for (const s of skipped) assert.equal(hasDash(s.reason), false, s.reason);
});

test('empty or missing text gives no rows', () => {
  assert.deepEqual(parseCSV(''), { rows: [], skipped: [] });
  assert.deepEqual(parseCSV(undefined), { rows: [], skipped: [] });
  assert.deepEqual(parseCSV('\n\n  \n'), { rows: [], skipped: [] });
});

test('amount formats', () => {
  const one = line => parseCSV(line).rows[0];
  assert.equal(one('2026-11-01,A,"$1,300.00",').amount, 1300);
  assert.equal(one('2026-11-01,A,182,').amount, 182);
  assert.equal(one('2026-11-01,A,"182,40",').amount, 182.4);
  assert.equal(one('2026-11-01,A,(12.00),').direction, 'in');
  assert.equal(one('2026-11-01,A,,-5.00').direction, 'out');
  assert.equal(one('2026-11-01,A,0.00,7.25').direction, 'in'); // a 0.00 debit counts as empty
  assert.equal(one('2026-11-01,A,0.1,').amount, 0.1);
});
