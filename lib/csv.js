// CIBC CSV statements -> import rows (spec 6.3). Pure ES module.
// No header row in CIBC exports (one is skipped if present). Columns: date, description, debit, credit,
// and on Visa a 5th masked card number column ('4500********1234').
// Account: 'visa' only when the 5th column looks like a masked card number; 4 columns, or an empty 5th column,
// = 'chequing'. A 5th column holding anything else is reported, not guessed. One empty 6th column (a trailing
// comma) is tolerated.

import { daysInMonth, pad, round2 } from './core.js';

// One line into fields. Quoted fields may hold commas and doubled quotes. null when a quote is never closed.
function splitLine(line) {
  const fields = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  if (quoted) return null;
  fields.push(field);
  return fields.map(f => f.trim());
}

// 'YYYY-MM-DD' or 'MM/DD/YYYY' (one digit month or day allowed) -> 'YYYY-MM-DD', or null.
function parseDate(s) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s), y, mo, d;
  if (m) [, y, mo, d] = m.map(Number);
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [, mo, d, y] = m.map(Number);
  else return null;
  if (mo < 1 || mo > 12 || y < 1900) return null;
  const key = y + '-' + pad(mo);
  if (d < 1 || d > daysInMonth(key)) return null;
  return key + '-' + pad(d);
}

// '' -> null (empty column); a number (may be negative); NaN when it is not a number.
// Accepts '$', spaces, thousands commas ('1,234.56'), a decimal comma ('182,40') and (12.00) for negatives.
function parseAmount(s) {
  let t = String(s).replace(/[\s$]/g, '');
  if (t === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
  const v = round2(Number(t));
  return neg ? -v : v;
}

const isBlank = fields => fields.every(f => f === '');
// Digits and a mask of asterisks or X (spaces allowed), with at least one of each: '4500********1234', '4500XXXXXXXX1234'.
const isMaskedCard = f => /^[\d*xX\s]+$/.test(f) && /\d/.test(f) && /[*xX]/.test(f);

export function parseCSV(text) {
  const rows = [], skipped = [];
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\n|\r/);
  let seenContent = false;

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    const all = splitLine(raw);
    if (!all) { skipped.push({ line, reason: 'A quote is never closed' }); seenContent = true; return; }
    if (isBlank(all)) return;
    // A trailing comma after the 5th column gives an empty 6th one: dropped.
    const fields = all.length === 6 && all[5] === '' ? all.slice(0, 5) : all;

    const date = parseDate(fields[0]);
    // A header row ('Date,Description,...') can only be the first line with content.
    if (!date && !seenContent && /[a-z]/i.test(fields[0])) { seenContent = true; return; }
    seenContent = true;

    if (fields.length !== 4 && fields.length !== 5) {
      skipped.push({ line, reason: `Expected 4 or 5 columns, found ${all.length}` });
      return;
    }
    if (!date) { skipped.push({ line, reason: 'The date is not valid' }); return; }

    const merchant = fields[1].replace(/\s+/g, ' ');
    if (!merchant) { skipped.push({ line, reason: 'No description' }); return; }

    const debit = parseAmount(fields[2]), credit = parseAmount(fields[3]);
    if (Number.isNaN(debit) || Number.isNaN(credit)) { skipped.push({ line, reason: 'The amount is not a number' }); return; }
    const hasDebit = debit != null && debit !== 0, hasCredit = credit != null && credit !== 0;
    if (hasDebit && hasCredit) { skipped.push({ line, reason: 'Both debit and credit are filled' }); return; }
    if (!hasDebit && !hasCredit) { skipped.push({ line, reason: 'No amount' }); return; }

    const card = fields.length === 5 ? fields[4] : '';
    if (card !== '' && !isMaskedCard(card)) { skipped.push({ line, reason: 'The 5th column is not a card number' }); return; }

    // A negative amount in a column means money the other way.
    const value = hasDebit ? debit : credit;
    let direction = hasDebit ? 'out' : 'in';
    if (value < 0) direction = direction === 'out' ? 'in' : 'out';

    rows.push({
      date,
      time: null,
      merchant,
      amount: Math.abs(value),
      direction,
      account: card ? 'visa' : 'chequing',
      raw,
    });
  });

  return { rows, skipped };
}
