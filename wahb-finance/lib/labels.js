// Plain text labels for actions (undo bar, history) and the note saved with each version.
// Plain words, sentence case, no dashes. Amounts use fmtShort ("$1,300", "$6.58").
// Pure ES module: no DOM, no Node APIs.

import { fmtShort, shortDate, joinAnd, findItem, isISODate, isoOf, pad } from './core.js';

const money = n => fmtShort(Number(n) || 0);
const words = (...parts) => parts.filter(p => p !== '' && p != null).join(' ');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const count = v => (Array.isArray(v) ? v.length : Number(v) || 0);

// The name shown for an expense: its note, else its category, else 'Other'.
export function txName(state, tx) {
  const note = String(tx?.note ?? '').trim();
  if (note) return note;
  const item = state && tx ? findItem(state, tx.item) : null;
  return item?.name || 'Other';
}

// "3:20 p.m." in local time.
export function clockTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return '';
  const h = d.getHours();
  return (h % 12 || 12) + ':' + pad(d.getMinutes()) + ' ' + (h < 12 ? 'a.m.' : 'p.m.');
}

// 1 -> '1st', 22 -> '22nd', 13 -> '13th'
export function ordinal(n) {
  const t = n % 100, u = n % 10;
  const suffix = t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th';
  return n + suffix;
}

// 'YYYY-MM-DD' as is; a timestamp becomes its local calendar day.
function dayOf(v) {
  if (v == null || v === '') return null;
  if (isISODate(v)) return v;
  const d = new Date(v);
  return isNaN(d) ? null : isoOf(d);
}

// Item name from a name, or from an id when state is given.
function itemName(state, v) {
  if (v == null) return '';
  return (state && findItem(state, v)?.name) || String(v);
}

// The thing being labelled. Accepts {name} or the record itself ({tx}, {bill}, {item}, {account}, {goal}).
function nameOf(d) {
  if (d.name != null && d.name !== '') return String(d.name);
  if (d.tx) return txName(d.state, d.tx);
  const rec = d.bill || d.item || d.account || d.goal || d.jar || d.group;
  if (rec?.name) return String(rec.name);
  if (d.itemId != null) return itemName(d.state, d.itemId);
  return '';
}

function importLabel(d) {
  const expenses = count(d.expenses), pays = count(d.pays), bills = count(d.bills);
  const got = [];
  if (expenses) got.push(plural(expenses, 'expense', 'expenses'));
  if (pays) got.push(plural(pays, 'pay', 'pays'));
  const parts = got.length ? ['Imported ' + got[0], ...got.slice(1)] : [];
  if (bills) parts.push((parts.length ? 'ticked ' : 'Ticked ') + plural(bills, 'bill', 'bills') + ' paid');
  return parts.length ? joinAnd(parts) : 'Imported nothing';
}

// label(kind, details): details is a plain object; see tests/labels.test.js for every kind.
export function label(kind, details = {}) {
  const d = typeof details === 'string' ? { label: details, name: details } : (details || {});
  const name = nameOf(d);
  const amt = d.amt ?? d.tx?.amt ?? d.pay?.amt;

  switch (kind) {
    case 'addTx': return words('Added', name || 'Other', money(amt));
    case 'editTx': return words('Changed', name || 'Other', money(amt));
    case 'deleteTx': return words('Deleted', name || 'Other', money(amt));

    case 'tickBill': {
      const onTime = d.onTime ?? (isISODate(d.date) && isISODate(d.today) ? d.today <= d.date : false);
      return words('Ticked', name, 'paid', onTime ? 'on time' : '');
    }
    case 'untickBill': return words('Unticked', name);

    case 'addBill': return words('Added bill', name);
    case 'editBill': return words('Changed bill', name);
    case 'deleteBill': return words('Deleted bill', name);

    case 'addItem': return words('Added', name);
    case 'editItem': return words('Changed', name);
    case 'deleteItem': return words('Deleted', name);
    case 'limit': {
      const limit = Number(d.limit ?? d.amt ?? d.item?.limit) || 0;
      return limit > 0 ? words('Changed', name, 'limit to', money(limit)) : words('Removed the', name, 'limit');
    }

    case 'addGroup': return words('Added group', name);
    case 'editGroup': return words('Changed group', name);
    case 'deleteGroup': return words('Deleted group', name);

    case 'addPay': return 'Logged pay ' + money(amt);
    case 'editPay': return 'Changed pay ' + money(amt);
    case 'deletePay': return 'Deleted pay ' + money(amt);

    case 'account': {
      const bal = d.bal ?? d.amt ?? d.account?.bal;
      return bal == null ? words('Updated', name) : words('Updated', name, 'to', money(bal));
    }

    case 'jar': {
      const add = Number(d.add ?? d.amt) || 0;
      if (add > 0) return words('Added', money(add), 'to', name);
      if (add < 0) return words('Took', money(-add), 'from', name);
      return words('Changed', name);
    }

    case 'payPlan': return 'Planned pay set to ' + money(d.amt ?? d.payPlan);

    case 'import': return importLabel(d);

    case 'move': {
      const from = d.fromName ?? itemName(d.state, d.from);
      const to = d.toName ?? itemName(d.state, d.to);
      return words('Moved', money(amt), from, '→', to);
    }

    case 'raise': return words('Raised', name, 'limit to', money(d.newLimit ?? d.limit ?? amt));

    case 'restoreBackup': {
      const day = dayOf(d.date ?? d.savedAt);
      return day ? 'Restored backup from ' + shortDate(day) : 'Restored backup';
    }
    case 'restoreVersion': {
      const at = d.savedAt ?? d.date;
      const day = dayOf(at);
      if (!day) return 'Restored an earlier version';
      const time = isISODate(at) ? '' : clockTime(at);
      return 'Restored the version from ' + shortDate(day) + (time ? ', ' + time : '');
    }

    case 'undo': return `Undid "${d.label ?? d.action?.label ?? ''}"`;

    case 'visaDue': {
      const day = Number(d.day ?? d.visaDueDay);
      return day >= 1 && day <= 31 ? 'Visa due day set to the ' + ordinal(day) : 'Visa due day cleared';
    }
    case 'chequing': {
      const bal = d.bal ?? d.amt;
      return bal == null ? 'Chequing balance cleared' : 'Chequing balance set to ' + money(bal);
    }

    default: return d.label ? String(d.label) : 'Saved';
  }
}

// The note saved with a version, from the labels of the actions in that save.
export function noteFor(labels) {
  const list = (labels || []).filter(Boolean);
  if (!list.length) return 'Saved';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + ' and ' + list[1];
  return list[0] + ' and ' + (list.length - 1) + ' more changes';
}
