// Core app (docs/UI.md): boot, device key, sync wiring, the home bands, forms, sheet, undo bar, month switcher,
// backup download and restore. Every number comes from lib/*; every change goes through app.act with a lib/labels.js label.
// Feature modules (safe, forecast, cover, import, history) get the app object through mount(app).

import * as core from '../lib/core.js';
import * as money from '../lib/money.js';
import * as budget from '../lib/budget.js';
import * as forecastLib from '../lib/forecast.js';
import * as merchants from '../lib/merchants.js';
import * as csv from '../lib/csv.js';
import * as importer from '../lib/importer.js';
import * as labels from '../lib/labels.js';
import * as migrateLib from '../lib/migrate.js';
import * as diffLib from '../lib/diff.js';
import * as syncLib from '../lib/sync.js';
import * as motifs from './motifs.js';

const {
  esc, fmt, fmtShort, num, uid, shortDate, monthName, monthOf, addMonths, daysBetween, daysInMonth, isISODate,
  peekMonth, getMonth, allItems, findItem, billRows, chequingAccount, visaAccount, todayISO,
} = core;
const { label, clockTime, ordinal } = labels;

const $ = id => document.getElementById(id);
const FEATURES = ['safe', 'forecast', 'cover', 'import', 'history'];
const KEY = 'finance-key';
const FIRST_SEEN = 'finance-first-seen';
const PAID_WITH = 'finance-paid-with';
const STORIES = {
  jars: 'Winners at the Panathenaic games took home an amphora of olive oil.',
  forecast: 'Lachesis measured the thread. This one measures your month.',
  safe: 'Athenians called their coins owls.',
};

/* ---------- storage (localStorage, or memory when the browser blocks it) ---------- */
const storage = (() => {
  try {
    const t = '__finance_probe__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch {
    const mem = new Map();
    return { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  }
})();
const store = {
  get: k => { try { return storage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { storage.setItem(k, v); } catch { /* full or blocked */ } },
};

/* ---------- address bar: device key and ?today= ---------- */
const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// The setup link is /#key=XYZ (a fragment never reaches the server, so the key is in no request or log);
// the older /?key=XYZ still works. Either way the key is stored and taken out of the address bar.
(function takeKey() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromHash = hash.get('key');
  const k = fromHash ?? params.get('key');
  if (k == null) return;
  if (k.trim()) store.set(KEY, k.trim());
  params.delete('key');
  hash.delete('key');
  const q = params.toString();
  const h = fromHash != null ? (hash.toString() ? '#' + hash.toString() : '') : location.hash; // any other fragment stays as it was
  history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + h);
})();
// Opening the setup link in a tab that already shows the page only changes the fragment, and the browser does not
// reload for that. Store the key, clean the address bar and start again with it.
window.addEventListener('hashchange', () => {
  const k = new URLSearchParams(location.hash.replace(/^#/, '')).get('key');
  if (k == null) return;
  if (k.trim()) store.set(KEY, k.trim());
  history.replaceState(history.state, '', location.pathname + location.search);
  location.reload();
});
const todayOverride = isLocal && isISODate(params.get('today')) ? params.get('today') : null;
const today = () => todayOverride || todayISO();

/* ---------- small helpers ---------- */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => window.matchMedia('(pointer: coarse)').matches;
const listeners = { render: new Set(), synced: new Set() };
function emit(event, arg) {
  for (const fn of listeners[event] || []) {
    try { fn(arg); } catch (e) { console.error(`A ${event} listener failed:`, e); }
  }
}
function on(event, fn) {
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(fn);
  return () => listeners[event].delete(fn);
}
const itemOptions = state => (state.budget || []).flatMap(g => (g.items || []).map(i => ({ value: i.id, label: i.name, group: g.name })));
const defaultDate = () => (viewMonth === monthOf(today()) ? today() : viewMonth + '-01');
const asNumberOrNull = v => { const n = num(v); return n == null || !Number.isFinite(n) ? null : n; };

/* ---------- sync engine ---------- */
let viewMonth = monthOf(today());
let win = null; // a real win to celebrate on the next render: {type:'bill', key} or {type:'jar', id, from}
let ready = false; // the page draws once every feature module is mounted, so nothing shifts in after the first draw

const engine = syncLib.createSync({
  storage,
  getKey: () => store.get(KEY),
  onState: () => { if (ready) render(); },
  onStatus: (text, code) => onSyncStatus(text, code),
  migrate: migrateLib.migrate,
  noteFor: labels.noteFor,
  defaults: migrateLib.defaults,
});

function onSyncStatus(text, code) {
  if (code === 'not-set-up') { showNotSetUp(); return; }
  let shown = text;
  if (code === 'ok' && engine.state && engine.state.savedAt) shown = syncedSince(engine.state.savedAt);
  setStatus(shown, code);
  if (code === 'synced') emit('synced', engine.state && engine.state.savedAt);
}
// "Synced 3:20 p.m." when the last save was today, else "Synced · last change Nov 13".
function syncedSince(savedAt) {
  const d = new Date(savedAt);
  if (isNaN(d)) return 'Synced';
  return core.isoOf(d) === todayISO() ? 'Synced ' + clockTime(d) : 'Synced · last change ' + shortDate(core.isoOf(d));
}
function setStatus(text, code = 'custom') {
  const el = $('status');
  el.textContent = text;
  el.dataset.code = code;
}

/* ---------- app object (docs/UI.md) ---------- */
const app = {
  get state() { return engine.state; },
  today,
  month: () => viewMonth,
  setMonth(key) {
    if (!/^\d{4}-\d{2}$/.test(String(key))) return;
    viewMonth = key;
    render();
  },
  act,
  restore,
  render: () => render(),
  on,
  api,
  form,
  sheet,
  toast,
  status: text => setStatus(String(text ?? '')),
  openExpense: tx => openExpense(tx),
  openPay: pay => openPay(pay),
  openAccount: id => openAccount(id),
  story,
  motifs,
  lib: { core, money, budget, forecast: forecastLib, merchants, csv, importer, labels, migrate: migrateLib, diff: diffLib, sync: syncLib },
};
if (isLocal) window.__finance = app; // local dev and e2e only

function act(lbl, mutate, { undo = true } = {}) {
  let action;
  try {
    action = engine.act(String(lbl), mutate);
  } finally {
    win = null;
  }
  if (action && action.ops && action.ops.length && undo) showUndo(action.label, action);
  return action;
}

function restore(doc, lbl) {
  const action = engine.restore(doc, lbl || label('restoreBackup', { savedAt: doc && doc.savedAt }));
  if (action.ops.length) showUndo(action.label, action);
  else toast('That backup matches what is here already.');
  return action;
}

// fetch with the device key. {ok, status, json}; throws only when offline.
async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const key = store.get(KEY);
  if (key) headers.set('x-app-key', key);
  let body = init.body;
  const plain = body != null && typeof body === 'object' && Object.getPrototypeOf(body) !== null
    && !(body instanceof Blob) && !(body instanceof FormData) && !(body instanceof ArrayBuffer)
    && !(body instanceof URLSearchParams) && !ArrayBuffer.isView(body) && !(body instanceof ReadableStream);
  if (plain) {
    body = JSON.stringify(body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  const res = await fetch(path, { cache: 'no-store', ...init, headers, body });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  // The key no longer works (changed on the server): the engine's own GET gets the same 401 and hides every number.
  if (res.status === 401 && engine.state) engine.refresh().catch(() => {});
  return { ok: res.ok, status: res.status, json };
}

// The optional one line story, only in the first week on this device.
function story(key) {
  const text = STORIES[key];
  if (!text) return '';
  const first = store.get(FIRST_SEEN);
  if (!isISODate(first)) return '';
  const age = daysBetween(first, today());
  return age >= 0 && age < 7 ? text : '';
}

/* ---------- screens ---------- */
function showApp() {
  $('notsetup').hidden = true;
  $('main').hidden = false;
  $('fabs').hidden = false;
  $('monthNav').hidden = false;
  $('status').hidden = false;
  document.querySelector('.skip').hidden = false;
}
function showNotSetUp() {
  for (const d of document.querySelectorAll('dialog.sheet')) { try { d.close(); } catch { /* gone */ } d.remove(); }
  hideUndo(true);
  $('main').hidden = true;
  $('fabs').hidden = true;
  $('monthNav').hidden = true;
  $('status').hidden = true;
  document.querySelector('.skip').hidden = true;
  $('notsetup').hidden = false;
  // No data and no cached numbers anywhere in the DOM, the screen reader region and the hidden labels included.
  for (const id of ['summary', 'budget', 'bills', 'tx', 'pays', 'goals', 'accounts', 'safe', 'forecast']) { const el = $(id); if (el) el.innerHTML = ''; }
  for (const id of ['announce', 'undoText', 'payPlan', 'txCount', 'limitsDay', 'monthLabel']) { const el = $(id); if (el) el.textContent = ''; }
}

/* ---------- render ---------- */
function section(name, fn) {
  try { fn(); } catch (e) { console.error(`Could not draw ${name}:`, e); }
}

function render() {
  const s = engine.state;
  if (!s) return;
  showApp();
  // The sections are redrawn from scratch: the focused control (a bill column ticked with the keyboard, say)
  // gets focus back on its new copy, so the next Tab goes on from there.
  const focusKey = focusKeyOf(document.activeElement);
  const M = viewMonth, t = today();
  $('monthLabel').textContent = monthName(M);
  section('the month summary', () => renderSummary(s, M));
  section('spending limits', () => renderLimits(s, M, t));
  section('bills', () => renderBills(s, M, t));
  section('spending', () => renderTx(s, M));
  section('paycheques', () => renderPays(s, M));
  section('tuition jars', () => renderJars(s));
  section('accounts', () => renderAccounts(s, t));
  win = null;
  emit('render', app);
  const a = document.activeElement;
  if (focusKey && (!a || a === document.body || !a.isConnected)) document.querySelector(focusKey)?.focus({ preventScroll: true });
}

function renderSummary(s, M) {
  const tot = money.monthTotals(s, M);
  const item = (key, name, value, extra = '', cls = '') =>
    `<div class="sum-item ${cls}"><dt>${name}</dt><dd><span class="amt" data-sum="${key}">${value}</span>${extra}</dd></div>`;
  $('summary').innerHTML =
    item('earned', 'Earned', fmt(tot.earned))
    + item('bills', 'Bills', fmt(tot.billsTotal))
    + item('spent', 'Spent', fmt(tot.spent))
    + item('paid', 'Bills paid', fmt(tot.paid), `<small>of ${fmt(tot.billsTotal)}</small>`)
    + item('left', 'Left this month', fmt(tot.left), '', 'left');
}

function renderLimits(s, M, t) {
  const cur = monthOf(t);
  $('limitsDay').textContent = M === cur ? `Day ${Number(t.slice(8))} of ${daysInMonth(M)}` : M < cur ? 'Month ended' : 'Not started';
  const past = M < cur && peekMonth(s, M).tx.length > 0;
  const groups = budget.bars(s, M);
  $('budget').innerHTML = groups.map(g => `
    <div class="group">
      <div class="group-head"><span class="caps" data-user>${esc(g.group.name)}</span><span class="amt">${fmtShort(g.spent)} of ${fmtShort(g.limit)}</span></div>
      ${g.items.map(i => barRow(i, g.group.id, past)).join('')}
    </div>`).join('') || '<div class="empty">No categories yet.</div>';
}

function barRow(i, groupId, past) {
  const amount = i.limit > 0
    ? `<b>${fmtShort(i.spent)}</b> of ${fmtShort(i.limit)}`
    : i.baseLimit > 0 ? `<b>${fmtShort(i.spent)}</b> of ${fmtShort(i.limit)}` : `<b>${fmtShort(i.spent)}</b> · no limit`;
  const held = past && i.limit > 0 && i.spent <= i.limit ? `<span class="held">${motifs.olive({ w: 16, h: 16 })}held</span>` : '';
  const icon = /grocer/i.test(i.name) ? motifs.pomegranate({ w: 18, h: 18 }) : '';
  const state = i.cls === 'red' ? 'over the limit' : i.cls === 'orange' ? 'close to the limit' : i.cls === 'green' ? 'under 75%' : '';
  return `
    <div class="bar-row">
      <button class="bar-hit" type="button" data-item="${esc(i.id)}" data-group="${esc(groupId)}">
        <span class="bar-top"><span class="nm">${icon}<span data-user>${esc(i.name)}</span>${held}</span><span class="amt">${amount}</span></span>
        <span class="track${i.cls === 'none' ? ' quiet' : ''}" aria-hidden="true"><span class="fill ${i.cls}" style="width:${Math.max(0, Math.min(100, i.width)).toFixed(1)}%"></span></span>
        ${state ? `<span class="sr-only">, ${state}</span>` : ''}
      </button>
      <div class="cover-slot" data-item="${esc(i.id)}"></div>
    </div>`;
}

function renderBills(s, M, t) {
  const rows = billRows(s, M);
  $('bills').innerHTML = rows.map(r => {
    const noDate = r.date.endsWith('??');
    let tag = '';
    if (!r.paid && !noDate) {
      if (r.date < t) tag = '<span class="tag late">late</span>';
      else if (daysBetween(t, r.date) <= 3) tag = '<span class="tag soon">soon</span>';
    }
    const when = noDate ? 'no date set' : (r.b.freq === 'biweekly' ? 'every 2 weeks · ' : '') + shortDate(r.date);
    const note = r.b.note ? ` · <span data-user>${esc(r.b.note)}</span>` : '';
    const fresh = win && win.type === 'bill' && win.key === r.key && r.paid;
    const wreath = fresh && win.onTime ? `<span class="win-wreath">${motifs.wreath()}</span>` : '';
    return `
      <div class="row bill${r.paid ? ' is-paid' : ''}">
        <button class="col-btn${fresh ? ' just-paid' : ''}" type="button" data-key="${esc(r.key)}" aria-pressed="${r.paid}" aria-label="${esc(r.b.name)}${noDate ? '' : ', ' + shortDate(r.date)}, paid">${motifs.column(r.paid)}${wreath}</button>
        <button class="row-main" type="button" data-bill="${esc(r.b.id)}">
          <span class="name"><b><span data-user>${esc(r.b.name)}</span>${tag}</b><small>${when}${note}${r.paid ? ' · paid' : ''}</small></span>
          <span class="amt">${fmt(r.b.amt)}</span>
        </button>
      </div>`;
  }).join('') || `<div class="empty">${motifs.arch()}<span>No bills yet.</span></div>`;
}

function renderTx(s, M) {
  const m = peekMonth(s, M);
  const items = Object.fromEntries(allItems(s).map(i => [i.id, i]));
  const tx = [...m.tx].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('txCount').textContent = tx.length ? tx.length + ' logged' : '';
  const paidWith = { visa: 'Visa', chequing: 'Chequing' };
  $('tx').innerHTML = tx.map(x => {
    const parts = [isISODate(x.date) ? shortDate(x.date) : esc(x.date)];
    if (x.note) parts.push(`<span data-user>${esc(x.note)}</span>`);
    if (paidWith[x.account]) parts.push(paidWith[x.account]);
    return `
      <button class="row" type="button" data-tx="${esc(x.id)}">
        <span class="name"><b data-user>${esc(items[x.item]?.name || 'Other')}</b><small>${parts.join(' · ')}</small></span>
        <span class="amt">${fmt(Number(x.amt))}</span>
      </button>`;
  }).join('') || `<div class="empty">${motifs.arch()}<span>Nothing logged yet. Tap + Expense.</span></div>`;
}

function renderPays(s, M) {
  const m = peekMonth(s, M);
  $('payPlan').textContent = 'planning about ' + fmtShort(s.settings?.payPlan) + ' each';
  const pays = [...m.pays].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  $('pays').innerHTML = pays.map(p => `
    <button class="row" type="button" data-pay="${esc(p.id)}">
      <span class="name"><b data-user>${esc(p.note ? importer.incomeNote(p.note) : 'Bobino pay')}</b><small>${isISODate(p.date) ? shortDate(p.date) : esc(p.date)}${p.hours ? ' · ' + esc(p.hours) + ' h' : ''}</small></span>
      <span class="amt pos">${fmt(Number(p.amt))}</span>
    </button>`).join('') || `<div class="empty">${motifs.arch()}<span>No paycheques logged this month.</span></div>`;
}

function renderJars(s) {
  $('goals').innerHTML = (s.goals || []).map((g, i) => {
    const target = Number(g.target) || 0, saved = Number(g.saved) || 0;
    const pct = target > 0 ? Math.max(0, Math.min(saved / target, 1)) : 0;
    // Whole percent rounded down, in cents, so 100% shows only once the jar is really full ($10,000 of $10,043 is 99%).
    const tC = core.cents(target), sC = Math.max(0, Math.min(core.cents(saved), tC));
    const pctText = tC > 0 ? Math.floor(sC * 100 / tC) : 0;
    const from = win && win.type === 'jar' && win.id === g.id ? win.from : null;
    return `
      <button class="jar" type="button" data-goal="${esc(g.id)}" aria-label="${esc(g.name)}: ${fmtShort(saved)} of ${fmtShort(target)}. Add savings">
        ${motifs.amphora(pct, { id: 'jarclip' + i, from, w: 64, h: 73 })}
        <b>${fmtShort(saved)}</b>
        <small>of ${fmtShort(target)} · ${pctText}%</small>
        <small data-user>${esc(g.name)}</small>
      </button>`;
  }).join('');
  const text = story('jars');
  $('jarsStory').textContent = text;
  $('jarsStory').hidden = !text;
}

function renderAccounts(s, t) {
  const visa = visaAccount(s), cheq = chequingAccount(s);
  $('accounts').innerHTML = (s.accounts || []).map(a => {
    const value = a.bal == null ? '<span class="amt hint">tap to enter</span>' : `<span class="amt">${fmt(a.bal)}</span>`;
    const sub = [a.kind === 'debt' ? `limit ${fmt(a.limit || 0)}` : `goal ${fmt(a.goal || 0)}`];
    if (visa && a.id === visa.id && s.settings?.visaDueDay) sub.push(`due the ${ordinal(Number(s.settings.visaDueDay))}`);
    const asOf = cheq && a.id === cheq.id ? s.settings?.chequing?.asOf : a.asOf;
    if (isISODate(asOf)) sub.push(asOf === t ? 'updated today' : `as of ${shortDate(asOf)}`);
    let tag = '';
    if (a.bal != null && a.kind === 'asset' && a.goal) tag = a.bal >= a.goal ? '<span class="tag good">on goal</span>' : '<span class="tag low">below goal</span>';
    return `
      <button class="row" type="button" data-acc="${esc(a.id)}">
        <span class="name"><b><span data-user>${esc(a.name)}</span>${tag}</b><small>${sub.join(' · ')}</small></span>
        ${value}
      </button>`;
  }).join('');
}

/* ---------- sheet ---------- */
const CLOSE_MS = 350; // longer than a double tap's gap
const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const FOCUS_ATTRS = ['data-tx', 'data-pay', 'data-bill', 'data-key', 'data-item', 'data-goal', 'data-acc'];
// A selector that finds the same control again after a re-render replaced it.
function focusKeyOf(el) {
  if (!el || el === document.body || !(el instanceof Element)) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  for (const a of FOCUS_ATTRS) if (el.hasAttribute(a)) return `${el.tagName.toLowerCase()}[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  return null;
}

function sheet({ title = '', body = '', onMount, actions = [], wide = false, onClose } = {}) {
  const opener = document.activeElement;
  const openerKey = focusKeyOf(opener);
  const tid = 'sheet-t-' + uid();
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet' + (wide ? ' wide' : '');
  dlg.setAttribute('aria-labelledby', tid);
  dlg.innerHTML = `
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-head"><h2 id="${tid}" tabindex="-1">${esc(title)}</h2><button class="icon-btn sheet-x" type="button" aria-label="Close">${CLOSE_ICON}</button></div>
    <div class="sheet-body"></div>
    <div class="sheet-foot"></div>`;
  const bodyEl = dlg.querySelector('.sheet-body');
  const footEl = dlg.querySelector('.sheet-foot');
  let closed = false;

  const handle = {
    el: dlg,
    body: bodyEl,
    close,
    get closed() { return closed; },
    setBody(content) {
      bodyEl.replaceChildren();
      if (content instanceof Node) bodyEl.append(content);
      else bodyEl.innerHTML = content == null ? '' : String(content);
    },
    setActions(list) {
      footEl.replaceChildren();
      for (const a of list || []) {
        if (!a) continue;
        const b = document.createElement('button');
        b.type = a.submit ? 'submit' : 'button';
        if (a.submit) b.setAttribute('form', a.submit);
        b.className = a.primary ? 'btn-primary' : a.danger ? 'btn-danger push-left' : 'btn';
        b.textContent = a.label;
        b.disabled = !!a.disabled;
        if (a.id) b.id = a.id;
        if (a.onClick) b.addEventListener('click', e => a.onClick(e, handle));
        footEl.append(b);
      }
    },
  };

  function close() {
    if (closed) return;
    closed = true;
    const done = () => {
      if (dlg.open) dlg.close();
      dlg.remove();
      const back = opener && opener.isConnected ? opener : openerKey ? document.querySelector(openerKey) : null;
      const last = !document.querySelector('dialog.sheet[open]');
      if (last && back && typeof back.focus === 'function') back.focus({ preventScroll: true });
      try { onClose && onClose(); } catch (e) { console.error(e); }
      // The control it opened from left with the change (a deleted row) and onClose placed nothing either.
      if (last && !back) focusAfterGone(openerKey);
    };
    dlg.classList.remove('is-open');
    dlg.classList.add('is-closing');
    // The slide (260 ms) or fade (150 ms) ends first; the sheet stays, invisible, until CLOSE_MS so the second
    // tap of a double tap lands on it (and is swallowed) instead of on Undo or whatever is under it.
    setTimeout(done, CLOSE_MS);
  }

  handle.setBody(body);
  handle.setActions(actions);
  // A closing sheet takes no second tap, click or Enter while it slides away (a double tap must not save twice).
  // It stays hit testable on purpose: the second tap is swallowed here instead of landing on the page under it.
  dlg.addEventListener('click', e => { if (closed) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  document.body.append(dlg);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('close', () => { if (!closed) { closed = true; dlg.remove(); } });
  dlg.addEventListener('click', e => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) close(); // a tap on the backdrop
  });
  dlg.querySelector('.sheet-x').addEventListener('click', close);
  dlg.showModal();
  void dlg.offsetHeight; // commit the start position so the slide runs
  dlg.classList.add('is-open');

  // Focus: the first [autofocus] field on a laptop, otherwise the title (no keyboard pops up on a phone).
  const auto = !coarse() && bodyEl.querySelector('[autofocus]');
  (auto || dlg.querySelector('#' + CSS.escape(tid))).focus({ preventScroll: true });

  if (onMount) {
    try { onMount(handle); } catch (e) { console.error('Sheet onMount failed:', e); }
  }
  return handle;
}

// After a delete the control a sheet opened from is gone: the keyboard goes to Undo while the bar offers it
// (Undo then brings it back to the restored row), otherwise to the top of the page content.
function focusAfterGone(openerKey) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;
  const btn = $('undoBtn');
  if (undoAction && !btn.hidden && $('undo').classList.contains('is-shown')) {
    undoReturn = openerKey;
    btn.focus({ preventScroll: true });
    return;
  }
  focusMain();
}
function focusMain() {
  const main = $('main');
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus({ preventScroll: true });
}

/* ---------- form (the original dialog form on a sheet) ---------- */
function fieldHtml(fid, f) {
  const id = fid + '-' + f.name;
  const show = f.showIf ? ` data-show-if="${esc(f.showIf.field)}" data-show-value="${esc([].concat(f.showIf.equals).join('|'))}"` : '';
  const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
  const val = f.value == null ? '' : String(f.value);
  if (f.type === 'hidden') return `<input type="hidden" name="${esc(f.name)}" value="${esc(val)}">`;
  if (f.type === 'note') return `<p class="field help"${show}>${esc(f.text || f.label)}</p>`;
  if (f.type === 'select') {
    const opts = f.options || [];
    const hasCurrent = opts.some(o => String(o.value) === val);
    const extra = val && !hasCurrent && f.missingLabel ? [{ value: val, label: f.missingLabel }] : [];
    const groups = [];
    for (const o of [...extra, ...opts]) {
      const g = o.group || '';
      let bucket = groups.find(x => x.g === g);
      if (!bucket) groups.push(bucket = { g, list: [] });
      bucket.list.push(o);
    }
    const option = o => `<option value="${esc(o.value)}"${String(o.value) === val ? ' selected' : ''}>${esc(o.label)}</option>`;
    const inner = groups.map(b => (b.g ? `<optgroup label="${esc(b.g)}">${b.list.map(option).join('')}</optgroup>` : b.list.map(option).join(''))).join('');
    return `<label class="field" for="${id}"${show}><span class="label">${esc(f.label)}</span><select id="${id}" name="${esc(f.name)}"${f.autofocus ? ' autofocus' : ''}>${inner}</select>${help}</label>`;
  }
  if (f.type === 'choice') {
    return `<fieldset class="field"${show}><legend class="label">${esc(f.label)}</legend><div class="choice">${(f.options || []).map(o =>
      `<label><input type="radio" name="${esc(f.name)}" value="${esc(o.value)}"${String(o.value) === val ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>${help}</fieldset>`;
  }
  const type = f.type || 'text';
  const attrs = [
    `id="${id}"`, `name="${esc(f.name)}"`, `type="${esc(type)}"`, `value="${esc(val)}"`,
    f.step ? `step="${esc(f.step)}"` : '', f.min != null ? `min="${esc(f.min)}"` : '', f.max != null ? `max="${esc(f.max)}"` : '',
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '', f.required ? 'required' : '',
    `inputmode="${type === 'number' ? (f.integer ? 'numeric' : 'decimal') : 'text'}"`, 'autocomplete="off"',
    f.autofocus ? 'autofocus' : '',
  ].filter(Boolean).join(' ');
  return `<label class="field" for="${id}"${show}><span class="label">${esc(f.label)}</span><input ${attrs}>${help}</label>`;
}

function form({ title, fields = [], submit = 'Save', onSave, onDelete, deleteLabel = 'Delete' } = {}) {
  const fid = 'form-' + uid();
  const list = fields.filter(Boolean);
  const firstInput = list.find(f => !['hidden', 'note', 'choice'].includes(f.type));
  if (firstInput && !list.some(f => f.autofocus)) firstInput.autofocus = true;
  const body = `<form id="${fid}" class="form-grid" novalidate>${list.map(f => fieldHtml(fid, f)).join('')}<p class="form-error" role="alert" hidden></p></form>`;
  let handle;
  const actions = [
    onDelete ? { label: deleteLabel, danger: true, onClick: () => { if (handle.closed) return; handle.close(); onDelete(); } } : null,
    { label: 'Cancel', onClick: () => handle.close() },
    { label: submit, primary: true, submit: fid },
  ];
  handle = sheet({
    title, body, actions,
    onMount(h) {
      const f = h.el.querySelector('form');
      const err = f.querySelector('.form-error');
      const sync = () => {
        for (const el of f.querySelectorAll('[data-show-if]')) {
          const ctl = f.elements[el.dataset.showIf];
          const value = ctl ? (ctl.value ?? '') : '';
          const show = el.dataset.showValue.split('|').includes(String(value));
          el.hidden = !show;
          for (const input of el.querySelectorAll('input,select')) input.disabled = !show;
        }
      };
      f.addEventListener('change', sync);
      sync();
      f.addEventListener('submit', e => {
        e.preventDefault();
        if (h.closed) return; // a double tap or a second Enter: saved once already
        err.hidden = true;
        if (!f.checkValidity()) { f.reportValidity(); return; }
        const values = Object.fromEntries(new FormData(f));
        let result;
        try { result = onSave ? onSave(values) : undefined; } catch (ex) {
          console.error(ex);
          result = 'Could not save that. Check the fields and try again.';
        }
        if (result === false) return;
        if (typeof result === 'string' && result) { err.textContent = result; err.hidden = false; return; }
        h.close();
      });
    },
  });
  return handle;
}

/* ---------- undo bar and toast ---------- */
let undoTimer = null, undoAction = null, undoMs = 0;
let undoReturn = null; // where the keyboard goes after Undo: the control the change was made from
function showUndo(text, action, ms = 8000) {
  if (action) {
    const a = document.activeElement;
    undoReturn = a && !a.closest('#undo, dialog') ? focusKeyOf(a) : null;
  }
  const bar = $('undo');
  undoAction = action || null;
  $('undoBtn').hidden = !undoAction;
  $('undoText').textContent = text;
  // Screen readers hear it from a region that is always there (the bar itself starts hidden).
  const live = $('announce');
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
  bar.hidden = false;
  void bar.offsetHeight;
  bar.classList.add('is-shown');
  document.body.classList.add('has-undo');
  // On the root, so the page's scroll padding (html) and the floating buttons (body) both read it.
  document.documentElement.style.setProperty('--undo-h', bar.offsetHeight + 'px');
  undoMs = ms;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => hideUndo(), ms);
}
function hideUndo(now = false) {
  clearTimeout(undoTimer);
  undoTimer = null;
  undoAction = null;
  const bar = $('undo');
  bar.classList.remove('is-shown');
  document.body.classList.remove('has-undo');
  if (now) bar.hidden = true;
}
function toast(text) { showUndo(String(text ?? ''), null, 4000); }
function doUndo() {
  const a = undoAction;
  const back = undoReturn;
  const fromBar = $('undo').contains(document.activeElement);
  hideUndo();
  if (!a || !engine.state) return;
  const u = engine.undo(a);
  toast(u.label);
  // The Undo button hides with the toast: the keyboard goes back to the row the undo restored (or the page).
  if (fromBar) {
    const el = back ? document.querySelector(back) : null;
    if (el) el.focus({ preventScroll: true }); else focusMain();
  }
}

/* ---------- forms for the core sections ---------- */
// Finds a record by id in any month and removes it: {key, index, rec} or null. Only inside an action.
function takeFrom(draft, list, id) {
  for (const [key, m] of Object.entries(draft.months || {})) {
    const arr = m && m[list];
    if (!Array.isArray(arr)) continue;
    const index = arr.findIndex(x => x && x.id === id);
    if (index >= 0) return { key, index, rec: arr.splice(index, 1)[0] };
  }
  return null;
}
// Files a record under the month of its own date; an edit that stays in its month keeps its place.
function fileUnder(draft, list, rec, was) {
  const arr = getMonth(draft, monthOf(rec.date))[list];
  if (was && was.key === monthOf(rec.date)) arr.splice(Math.min(was.index, arr.length), 0, rec);
  else arr.push(rec);
}

function openExpense(t) {
  const s = engine.state;
  if (!s) return;
  const options = itemOptions(s);
  const last = store.get(PAID_WITH);
  form({
    title: t ? 'Edit expense' : 'Add expense',
    fields: [
      { name: 'amt', label: 'Amount', type: 'number', step: '0.01', value: t?.amt, required: true, placeholder: '12.50' },
      { name: 'item', label: 'Category', type: 'select', options, value: t?.item ?? options[0]?.value, missingLabel: 'Other' },
      { name: 'date', label: 'Date', type: 'date', value: t?.date || defaultDate(), required: true },
      { name: 'note', label: 'Note (optional)', value: t?.note, placeholder: 'Costco' },
      { name: 'account', label: 'Paid with', type: 'choice', value: t ? (t.account || '') : (last === 'visa' || last === 'chequing' ? last : ''),
        options: [{ value: 'visa', label: 'Visa' }, { value: 'chequing', label: 'Chequing' }, { value: '', label: 'Not sure' }] },
    ],
    onSave(v) {
      const amt = asNumberOrNull(v.amt);
      if (amt == null) return 'Enter an amount.';
      if (!isISODate(v.date)) return 'Pick a date.';
      const note = String(v.note ?? '').trim();
      const account = v.account === 'visa' || v.account === 'chequing' ? v.account : null;
      store.set(PAID_WITH, account || '');
      const base = t ? { ...t } : { id: uid(), src: 'manual' };
      const src = base.src || 'manual';
      const merchant = src === 'manual' ? note : (base.merchant ?? note);
      const rec = { ...base, date: v.date, item: v.item, amt, note, src, merchant, fp: merchants.fingerprint(amt, merchant), account };
      act(label(t ? 'editTx' : 'addTx', { state: engine.state, tx: rec }), d => {
        const was = t ? takeFrom(d, 'tx', t.id) : null;
        fileUnder(d, 'tx', rec, was);
      });
    },
    onDelete: t ? () => act(label('deleteTx', { state: engine.state, tx: t }), d => { takeFrom(d, 'tx', t.id); }) : null,
  });
}

function openPay(p) {
  if (!engine.state) return;
  form({
    title: p ? 'Edit paycheque' : 'Log paycheque',
    fields: [
      { name: 'amt', label: 'Net amount', type: 'number', step: '0.01', value: p?.amt, required: true, placeholder: '1300' },
      { name: 'date', label: 'Pay date', type: 'date', value: p?.date || defaultDate(), required: true },
      { name: 'hours', label: 'Hours (optional)', type: 'number', step: '0.25', value: p?.hours },
      { name: 'note', label: 'Note (optional)', value: p?.note },
    ],
    onSave(v) {
      const amt = asNumberOrNull(v.amt);
      if (amt == null) return 'Enter the amount.';
      if (!isISODate(v.date)) return 'Pick the pay date.';
      const rec = { ...(p || {}), id: p?.id || uid(), amt, date: v.date, hours: asNumberOrNull(v.hours), note: String(v.note ?? '').trim() };
      act(label(p ? 'editPay' : 'addPay', { amt }), d => {
        const was = p ? takeFrom(d, 'pays', p.id) : null;
        fileUnder(d, 'pays', rec, was);
      });
    },
    onDelete: p ? () => act(label('deletePay', { amt: p.amt }), d => { takeFrom(d, 'pays', p.id); }) : null,
  });
}

function openPayPlan() {
  const s = engine.state;
  if (!s) return;
  form({
    title: 'Planned paycheque',
    fields: [{ name: 'p', label: 'Plan with this amount per pay', type: 'number', step: '1', value: s.settings?.payPlan, required: true }],
    onSave(v) {
      const amt = asNumberOrNull(v.p) || 0;
      act(label('payPlan', { amt }), d => { d.settings ||= {}; d.settings.payPlan = amt; });
    },
  });
}

function editBill(b) {
  if (!engine.state) return;
  form({
    title: b ? 'Edit bill' : 'Add bill',
    fields: [
      { name: 'name', label: 'Name', value: b?.name, required: true },
      { name: 'amt', label: 'Amount', type: 'number', step: '0.01', value: b?.amt, required: true },
      { name: 'freq', label: 'How often', type: 'select', value: b?.freq || 'monthly', options: [{ value: 'monthly', label: 'Every month' }, { value: 'biweekly', label: 'Every 2 weeks' }] },
      { name: 'day', label: 'Due day of the month', type: 'number', step: '1', min: 1, max: 31, integer: true, value: b?.day, placeholder: '1 to 31', showIf: { field: 'freq', equals: 'monthly' } },
      { name: 'anchor', label: 'One past charge date', type: 'date', value: b?.anchor, showIf: { field: 'freq', equals: 'biweekly' } },
      { name: 'note', label: 'Note (optional)', value: b?.note },
    ],
    onSave(v) {
      const name = String(v.name ?? '').trim();
      if (!name) return 'Give the bill a name.';
      const amt = asNumberOrNull(v.amt);
      if (amt == null) return 'Enter the amount.';
      const freq = v.freq === 'biweekly' ? 'biweekly' : 'monthly';
      const day = freq === 'monthly' ? asNumberOrNull(v.day) : (b?.day ?? null);
      if (day != null && !(Number.isInteger(day) && day >= 1 && day <= 31)) return 'The due day is a number from 1 to 31.';
      const anchor = freq === 'biweekly' ? (isISODate(v.anchor) ? v.anchor : null) : (b?.anchor ?? null);
      if (freq === 'biweekly' && !anchor) return 'Pick one past charge date.';
      const rec = { ...(b || {}), id: b?.id || uid(), name, amt, freq, day, anchor, note: String(v.note ?? '').trim() };
      act(label(b ? 'editBill' : 'addBill', { name }), d => {
        d.bills ||= [];
        const i = d.bills.findIndex(x => x.id === rec.id);
        if (i >= 0) d.bills[i] = rec; else d.bills.push(rec);
      });
    },
    onDelete: b ? () => act(label('deleteBill', { bill: b }), d => { d.bills = (d.bills || []).filter(x => x.id !== b.id); }) : null,
  });
}

function editItem(itemId, groupId) {
  const s = engine.state;
  const g = (s.budget || []).find(x => x.id === groupId);
  const i = g && (g.items || []).find(x => x.id === itemId);
  if (!i) return;
  form({
    title: 'Edit ' + i.name,
    fields: [
      { name: 'name', label: 'Name', value: i.name, required: true },
      { name: 'limit', label: 'Monthly limit (0 means no limit)', type: 'number', step: '0.01', value: i.limit },
    ],
    onSave(v) {
      const name = String(v.name ?? '').trim();
      if (!name) return 'Give the category a name.';
      const limit = asNumberOrNull(v.limit) || 0;
      const renamed = name !== i.name;
      const lbl = renamed ? label('editItem', { name }) : label('limit', { name, limit });
      act(lbl, d => {
        const it = (d.budget.find(x => x.id === groupId)?.items || []).find(x => x.id === itemId);
        if (!it) return;
        it.name = name;
        it.limit = limit;
      });
    },
    onDelete: () => act(label('deleteItem', { name: i.name }), d => {
      const gg = d.budget.find(x => x.id === groupId);
      if (gg) gg.items = (gg.items || []).filter(x => x.id !== itemId);
    }),
  });
}

function addItem() {
  const s = engine.state;
  if (!s) return;
  form({
    title: 'Add category',
    fields: [
      { name: 'group', label: 'Group', type: 'select', value: s.budget?.[0]?.id ?? '__new', options: [...(s.budget || []).map(g => ({ value: g.id, label: g.name })), { value: '__new', label: 'New group' }] },
      { name: 'newGroup', label: 'New group name', showIf: { field: 'group', equals: '__new' } },
      { name: 'name', label: 'Category name', required: true },
      { name: 'limit', label: 'Monthly limit (0 means no limit)', type: 'number', step: '0.01', value: 0 },
    ],
    onSave(v) {
      const name = String(v.name ?? '').trim();
      if (!name) return 'Give the category a name.';
      const limit = asNumberOrNull(v.limit) || 0;
      act(label('addItem', { name }), d => {
        d.budget ||= [];
        let g = d.budget.find(x => x.id === v.group);
        if (!g) { g = { id: uid(), name: String(v.newGroup ?? '').trim() || 'Other', items: [] }; d.budget.push(g); }
        g.items ||= [];
        g.items.push({ id: uid(), name, limit });
      });
    },
  });
}

function openAccount(accountId) {
  const s = engine.state;
  if (!s) return;
  const a = (s.accounts || []).find(x => x.id === accountId);
  if (!a) return;
  const isDebt = a.kind === 'debt';
  const isVisa = visaAccount(s)?.id === a.id;
  const isCheq = chequingAccount(s)?.id === a.id;
  form({
    title: a.name,
    fields: [
      { name: 'bal', label: isDebt ? 'Amount owing now' : 'Balance now', type: 'number', step: '0.01', value: a.bal },
      isDebt ? { name: 'limit', label: 'Card limit', type: 'number', step: '1', value: a.limit }
        : { name: 'goal', label: 'Goal', type: 'number', step: '1', value: a.goal },
      isVisa ? { name: 'due', label: 'Payment due day', type: 'number', step: '1', min: 1, max: 31, integer: true, placeholder: '1 to 31', value: s.settings?.visaDueDay, help: 'The day of the month the Visa payment comes out of chequing.' } : null,
    ],
    onSave(v) {
      const t = today();
      const bal = asNumberOrNull(v.bal);
      const balChanged = bal !== (a.bal ?? null);
      let due;
      if (isVisa) {
        due = asNumberOrNull(v.due);
        if (due != null && !(Number.isInteger(due) && due >= 1 && due <= 31)) return 'The due day is a number from 1 to 31.';
      }
      const dueChanged = isVisa && due !== (s.settings?.visaDueDay ?? null);
      const chq = s.settings?.chequing || {};
      const cheqChanged = isCheq && (balChanged || (chq.bal ?? null) !== bal);
      const lbl = balChanged ? label('account', { account: a, bal })
        : dueChanged ? label('visaDue', { day: due })
        : cheqChanged ? label('chequing', { bal })
        : label('account', { account: a });
      act(lbl, d => {
        const acc = (d.accounts || []).find(x => x.id === a.id);
        if (!acc) return;
        acc.bal = bal;
        if (isDebt) acc.limit = asNumberOrNull(v.limit); else acc.goal = asNumberOrNull(v.goal);
        d.settings ||= {};
        if (isVisa) {
          d.settings.visaDueDay = due;
          if (balChanged) { if (bal == null) delete acc.asOf; else acc.asOf = t; }
        }
        // Fields another build stored on settings.chequing are kept (SPEC 0: unknown fields stay untouched).
        if (cheqChanged) d.settings.chequing = { ...(d.settings.chequing || {}), bal, asOf: bal == null ? null : t };
      });
    },
  });
}

function editGoal(goalId) {
  const s = engine.state;
  const g = (s.goals || []).find(x => x.id === goalId);
  if (!g) return;
  form({
    title: g.name,
    fields: [
      { name: 'add', label: 'Add to this jar (use minus to take out)', type: 'number', step: '0.01', placeholder: '200' },
      { name: 'saved', label: 'Or set total saved', type: 'number', step: '0.01', value: g.saved },
      { name: 'target', label: 'Target', type: 'number', step: '1', value: g.target },
      { name: 'name', label: 'Name', value: g.name },
    ],
    onSave(v) {
      const add = asNumberOrNull(v.add);
      const oldSaved = Number(g.saved) || 0;
      const saved = add != null ? core.sum([oldSaved, add]) : (asNumberOrNull(v.saved) ?? oldSaved);
      const target = asNumberOrNull(v.target) ?? g.target;
      const name = String(v.name ?? '').trim() || g.name;
      const lbl = add ? label('jar', { goal: g, add }) : label('jar', { goal: g });
      if (add > 0) {
        const t0 = Number(target) || 0;
        win = { type: 'jar', id: g.id, from: t0 > 0 ? Math.max(0, Math.min(oldSaved / t0, 1)) : 0 };
      }
      act(lbl, d => {
        const gg = (d.goals || []).find(x => x.id === g.id);
        if (!gg) return;
        gg.saved = saved;
        gg.target = target;
        gg.name = name;
      });
    },
  });
}

/* ---------- events ---------- */
function wire() {
  $('prev').addEventListener('click', () => app.setMonth(addMonths(viewMonth, -1)));
  $('next').addEventListener('click', () => app.setMonth(addMonths(viewMonth, 1)));
  $('fab').addEventListener('click', () => openExpense());
  $('addBill').addEventListener('click', () => editBill());
  $('addItem').addEventListener('click', () => addItem());
  $('addPay').addEventListener('click', () => openPay());
  $('payPlan').addEventListener('click', () => openPayPlan());
  $('undoBtn').addEventListener('click', doUndo);

  $('bills').addEventListener('click', e => {
    const s = engine.state;
    if (!s) return;
    const col = e.target.closest('.col-btn');
    if (col) {
      const key = col.dataset.key;
      const at = key.lastIndexOf('@');
      const billId = key.slice(0, at), date = key.slice(at + 1);
      const bill = (s.bills || []).find(b => b.id === billId);
      if (!bill) return;
      const mk = monthOf(date);
      const t = today();
      if (peekMonth(s, mk).paid[key]) {
        act(label('untickBill', { bill }), d => { delete getMonth(d, mk).paid[key]; });
      } else {
        const onTime = isISODate(date) && t <= date;
        win = onTime ? { type: 'bill', key, onTime: true } : null;
        act(label('tickBill', { bill, date, today: t }), d => { getMonth(d, mk).paid[key] = true; });
      }
      return;
    }
    const row = e.target.closest('[data-bill]');
    if (row) editBill((s.bills || []).find(b => b.id === row.dataset.bill));
  });

  $('budget').addEventListener('click', e => {
    const hit = e.target.closest('.bar-hit');
    if (hit) editItem(hit.dataset.item, hit.dataset.group);
  });
  $('tx').addEventListener('click', e => {
    const row = e.target.closest('[data-tx]');
    if (!row || !engine.state) return;
    const tx = peekMonth(engine.state, viewMonth).tx.find(x => x.id === row.dataset.tx);
    if (tx) openExpense(tx);
  });
  $('pays').addEventListener('click', e => {
    const row = e.target.closest('[data-pay]');
    if (!row || !engine.state) return;
    const p = peekMonth(engine.state, viewMonth).pays.find(x => x.id === row.dataset.pay);
    if (p) openPay(p);
  });
  $('accounts').addEventListener('click', e => {
    const row = e.target.closest('[data-acc]');
    if (row) openAccount(row.dataset.acc);
  });
  $('goals').addEventListener('click', e => {
    const jar = e.target.closest('[data-goal]');
    if (jar) editGoal(jar.dataset.goal);
  });

  $('exportBtn').addEventListener('click', () => {
    const s = engine.state;
    if (!s) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
    a.download = 'finance-backup-' + todayISO() + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async e => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    let doc = null;
    try { doc = JSON.parse(await file.text()); } catch { doc = null; }
    input.value = '';
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.bills)) { toast('That file is not a finance backup.'); return; }
    try { restore(doc, label('restoreBackup', { savedAt: doc.savedAt })); } catch { toast('That file is not a finance backup.'); }
  });

  // Undo from the keyboard while the bar shows (Ctrl or Cmd + Z outside text fields).
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
    if (!undoAction || document.querySelector('dialog.sheet[open]')) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    e.preventDefault();
    doUndo();
  });
  // Pause the undo timer while the bar has focus or the pointer.
  const bar = $('undo');
  const pause = () => { clearTimeout(undoTimer); undoTimer = null; };
  const resume = () => { if (bar.classList.contains('is-shown') && !undoTimer) undoTimer = setTimeout(() => hideUndo(), Math.min(undoMs, 4000)); };
  bar.addEventListener('focusin', pause);
  bar.addEventListener('focusout', resume);
  bar.addEventListener('pointerenter', pause);
  bar.addEventListener('pointerleave', resume);

  document.addEventListener('visibilitychange', () => {
    if (!engine.state) return;
    if (document.visibilityState === 'visible') engine.refresh().catch(() => {});
    else engine.push();
  });
  window.addEventListener('online', () => { if (engine.state) engine.push(); });
}

/* ---------- boot ---------- */
function drawStatic() {
  $('wordmark').innerHTML = motifs.wordmark({ w: 116, h: 24 });
  $('nsArt').innerHTML = motifs.arch({ w: 168, h: 168 });
  $('temple').innerHTML = motifs.templeEngraving();
  for (const slot of document.querySelectorAll('.torn-slot')) slot.outerHTML = motifs.torn(Number(slot.dataset.seed) || 1);
}

// Every module is fetched at once (they load while the data does); they are mounted in the fixed order.
function loadFeatures() {
  return FEATURES.map(name => import(`./${name}.js`).catch(e => { console.error(`ui/${name}.js could not load:`, e); return null; }));
}
async function mountFeatures(loading) {
  const mods = await Promise.all(loading);
  mods.forEach((mod, i) => {
    if (!mod) return;
    try {
      if (typeof mod.mount === 'function') mod.mount(app);
    } catch (e) {
      console.error(`ui/${FEATURES[i]}.js could not start:`, e);
    }
  });
}

async function boot() {
  drawStatic();
  if (!isISODate(store.get(FIRST_SEEN))) store.set(FIRST_SEEN, today());
  wire();
  setStatus('Loading', 'loading');
  document.body.classList.add('first-paint');
  const features = loadFeatures();
  let res = null;
  try {
    res = await engine.load();
  } catch (e) {
    console.error('Loading failed:', e);
  }
  if (!res || res.status === 'not-set-up' || !engine.state) { showNotSetUp(); return; }
  await mountFeatures(features);
  if (!engine.state) { showNotSetUp(); return; } // a save answered 401 while the modules mounted
  ready = true;
  render();
  setTimeout(() => document.body.classList.remove('first-paint'), 900);
}

boot();
