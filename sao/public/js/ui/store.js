// The interface's shared state: the world state from data.js, where Wahb is,
// what is open, his settings. Views read from here and subscribe to changes.

import { BOT, MAX_ACTIVE } from '../bots.js';
import { PLACE } from '../places.js';
import { store as ls, clean } from './dom.js';

const PREFS_KEY = 'sao.ui.prefs.v1';
const DEFAULT_PREFS = { skipIntro: false, sound: 'off', reduceMotion: false };

export const S = {
  state: null,          // world state (SPEC.md state shape), may be partial
  source: null,         // 'engine' | 'demo' | 'none'
  error: null,          // string when loading failed
  loading: true,
  place: 'town',
  open: null,           // the view that is open, for example 'report' or 'place:campus'
  quiet: false,
  prefs: { ...DEFAULT_PREFS, ...(ls(PREFS_KEY) || {}) },
};

const subs = new Set();
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function emit(what) {
  for (const fn of subs) {
    try { fn(what); } catch (e) { console.warn('[sao ui]', e); }
  }
}

export function setPref(key, value) {
  S.prefs[key] = value;
  ls(PREFS_KEY, S.prefs);
  emit('prefs');
}

/* ------------------------------------------------------------- derived data */

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function st() {
  return obj(S.state);
}

export function bots() {
  return arr(st().bots).filter((b) => b && BOT[b.core]);
}

export const ACTIVE_STATES = new Set(['working', 'traveling', 'waiting']);

export function activeBots() {
  return bots().filter((b) => ACTIVE_STATES.has(b.state)).slice(0, MAX_ACTIVE);
}

export function botsAt(place) {
  return bots().filter((b) => b.place === place);
}

export function botById(id) {
  return bots().find((b) => String(b.id) === String(id)) || bots().find((b) => b.core === id) || null;
}

export function questions() {
  return arr(st().questions).filter((q) => q && q.text);
}

export function questionsAt(place) {
  return questions().filter((q) => q.place === place);
}

export function placeInfo(id) {
  return obj(obj(st().places)[id]);
}

export function draftsAt(place) {
  return arr(placeInfo(place).drafts).filter((d) => d && (d.title || d.text));
}

export function allDrafts() {
  const out = [];
  for (const id of Object.keys(obj(st().places))) {
    if (!PLACE[id]) continue;
    for (const d of draftsAt(id)) out.push({ ...d, place: id });
  }
  return out;
}

export function botName(core) {
  return BOT[core] ? BOT[core].name : core ? clean(core) : '';
}

export function placeName(id) {
  return PLACE[id] ? PLACE[id].name : '';
}

/* --------------------------------------------------------------- dates */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'Mon Nov 30' or 'Nov 30' to a Date in the year that puts it nearest to now.
export function parseDay(str, ref) {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2})/.exec(String(str || ''));
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]);
  if (mo < 0) return null;
  const base = ref instanceof Date ? ref : new Date();
  let best = null;
  for (const y of [base.getFullYear() - 1, base.getFullYear(), base.getFullYear() + 1]) {
    const d = new Date(y, mo, Number(m[2]));
    if (!best || Math.abs(d - base) < Math.abs(best - base)) best = d;
  }
  return best;
}

export function daysLeft(item, ref) {
  if (item && Number.isFinite(Number(item.daysLeft))) return Number(item.daysLeft);
  const d = parseDay(item && item.date, ref);
  if (!d) return null;
  const base = ref instanceof Date ? ref : new Date();
  const a = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((d - a) / 86400000);
}

export function daysText(n) {
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return '1 day left';
  if (n < 0) return n === -1 ? '1 day ago' : `${-n} days ago`;
  return `${n} days left`;
}
