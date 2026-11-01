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

test('the 5th column decides the account: a masked card is Visa, empty is chequing; a trailing empty 6th is fine', () => {
  const lines = [
    '2026-11-04,TIM HORTONS #2231,3.45,,4500********1234',   // 1 Visa
    '2026-11-04,TIM HORTONS #2231,3.45,,',                   // 2 chequing: empty 5th column
    '2026-11-04,TIM HORTONS #2231,3.45,,4500********1234,',  // 3 Visa, trailing comma
    '2026-11-04,TIM HORTONS #2231,3.45,,,',                  // 4 chequing, trailing comma
    '2026-11-04,TIM HORTONS #2231,3.45,,************1234',   // 5 Visa, fully masked
    '2026-11-04,TIM HORTONS #2231,3.45,,"4500 **** **** 1234"', // 6 Visa, spaced
    '2026-11-04,TIM HORTONS #2231,3.45,,BALANCE',            // 7 not a card
    '2026-11-04,TIM HORTONS #2231,3.45,,420.00',             // 8 not a card (a balance)
    '2026-11-04,TIM HORTONS #2231,3.45,,123456',             // 9 not masked
    '2026-11-04,TIM HORTONS #2231,3.45,,4500********1234,X', // 10 a 6th column with text
    '2026-11-04,TIM HORTONS #2231,3.45,,,,',                 // 11 7 columns
  ];
  const { rows, skipped } = parseCSV(lines.join('\n'));
  assert.deepEqual(rows.map(r => r.account), ['visa', 'chequing', 'visa', 'chequing', 'visa', 'visa']);
  assert.deepEqual(rows.map(r => r.raw), lines.slice(0, 6), 'raw keeps the trailing comma');
  assert.ok(rows.every(r => r.merchant === 'TIM HORTONS #2231' && r.amount === 3.45 && r.direction === 'out'));
  assert.deepEqual(skipped, [
    { line: 7, reason: 'The 5th column is not a card number' },
    { line: 8, reason: 'The 5th column is not a card number' },
    { line: 9, reason: 'The 5th column is not a card number' },
    { line: 10, reason: 'Expected 4 or 5 columns, found 6' },
    { line: 11, reason: 'Expected 4 or 5 columns, found 7' },
  ]);
  for (const s of skipped) assert.equal(hasDash(s.reason), false, s.reason);
  // A chequing export with an empty 5th column on every line.
  const cheq = parseCSV('2026-11-06,BOBINO PAYROLL,,1300.00,\r\n2026-11-09,E-TRANSFER RECEIVED Kylie,,40.00,');
  assert.deepEqual(cheq.rows.map(r => [r.account, r.direction, r.amount]), [['chequing', 'in', 1300], ['chequing', 'in', 40]]);
});

test('a Visa export masked with X is still read as Visa', async () => {
  const { parseCSV } = await import('../lib/csv.js');
  const { rows, skipped } = parseCSV('2026-10-31,"NUAGE CAFE MONTREAL QC",6.58,,4500XXXXXXXX1234\n');
  assert.equal(skipped.length, 0);
  assert.equal(rows[0].account, 'visa');
});
