// Shared helpers for the import tests (merchants, csv, importer). Synthetic data only.
import { clone, findItem, getMonth } from '../../lib/core.js';
import { fingerprint } from '../../lib/merchants.js';
import sample from '../fixtures/sample-nov.js';

// A fresh copy of the November sample (v1 shape: tx have no merchant, fp or src).
export const freshState = () => clone(sample);

// A reader row, money out on the Visa by default.
export const row = (merchant, amount, more = {}) => ({
  date: '2026-11-14', time: null, merchant, amount, direction: 'out', account: 'visa', raw: `${merchant}  $${amount}`, ...more,
});

// One batch for buildReview.
export const batch = (fileId, rows, src = 'screenshot') => ({ fileId, name: fileId, src, rows });

export const itemName = (state, id) => findItem(state, id)?.name ?? null;

// Adds a saved v2 shaped tx (the fields migrate would fill) and returns it.
export function addTx(state, tx) {
  const full = { id: 'tx-' + Math.random().toString(36).slice(2, 8), src: 'manual', account: null, note: '', ...tx };
  full.merchant ??= full.note || '';
  full.fp ??= fingerprint(full.amt, full.merchant);
  getMonth(state, full.date.slice(0, 7)).tx.push(full);
  return full;
}

// True when the text has an em dash, en dash or spaced hyphen (not allowed in UI text).
export const hasDash = s => /[—–]|\s-\s/.test(String(s));
