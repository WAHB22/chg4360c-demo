// Synthetic CIBC style CSV exports, as JS strings (never .csv files: those are git ignored on purpose).
// Not his real data. Card numbers are masked placeholders.

const CARD = '4500********1234';

// Visa: 5 columns (date, description, debit, credit, masked card). No header row, LF line ends.
export const visa = [
  `2026-11-03,"COSTCO WHOLESALE W1234 MONTREAL, QC",182.40,,${CARD}`,
  `2026-11-04,TIM HORTONS #2231,3.45,,${CARD}`,
  `2026-11-05,PAYMENT THANK YOU/PAIEMENT MERCI,,500.00,${CARD}`,
  `2026-11-06,"BOB ""THE"" DUMPLING, BAR",42.10,,${CARD}`,
  `2026-11-15,NETFLIX.COM,27.11,,${CARD}`,
  `2026-11-07,COSTCO WHOLESALE W1234,,25.00,${CARD}`,
].join('\n');

// Chequing: 4 columns (date, description, debit, credit). CRLF line ends, a quoted plain field.
export const chequing = [
  '2026-11-06,BOBINO PAYROLL,,1300.00',
  '2026-11-08,INTERNET TRANSFER 000000123456,200.00,',
  '2026-11-09,E-TRANSFER RECEIVED Kylie,,40.00',
  '2026-11-21,"BELL CANADA",89.43,',
  '2026-11-18,BELL CANADA,90.83,',
].join('\r\n');

// A header row variant (some exports add one), with a byte order mark.
export const withHeader = '﻿' + [
  'Transaction Date,Description,Debit,Credit,Card Number',
  `2026-11-10,PET VALU #123,28.00,,${CARD}`,
  `2026-11-11,UBER* EATS,24.50,,${CARD}`,
].join('\n');

// MM/DD/YYYY dates, one digit months and days.
export const usDates = [
  '11/05/2026,PETRO-CANADA 98765,58.00,',
  '1/7/2027,"MAXI & CIE, LAVAL",12.34,',
].join('\n');

// Blank lines, whitespace lines, comma only lines, amounts with $ and thousands, and lines that must be skipped.
export const messy = [
  '',                                              // 1 blank
  '2026-11-12,ABC 3843-AF,$31.58,',                // 2 ok
  '   ',                                           // 3 blank
  ',,,',                                           // 4 empty fields
  '2026-11-13,"SAVEURS EPICERIE URBAINE","1,234.56",', // 5 ok, thousands
  '2026-11-13,TOO FEW',                            // 6 skipped: columns
  '2026-02-30,BAD DATE,10.00,',                    // 7 skipped: date
  '2026-11-14,BOTH,10.00,10.00',                   // 8 skipped: both
  '2026-11-14,NONE,,',                             // 9 skipped: no amount
  '2026-11-14,"NEVER CLOSED,10.00,',               // 10 skipped: quote
  '2026-11-14,WORDS,ten,',                         // 11 skipped: not a number
  'Date,Description,Debit,Credit',                 // 12 skipped: a header in the middle is not a date
  '2026-11-14,REVERSAL,-15.00,',                   // 13 ok: negative debit is money in
  '2026-11-14,,5.00,',                             // 14 skipped: no description
  '',                                              // 15 blank
].join('\n');
