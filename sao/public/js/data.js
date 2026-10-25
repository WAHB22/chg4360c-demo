// SAO data: where the world state comes from and where Wahb's actions go.
//
// Served by the local engine (it answers engine.json with true): same origin
// /api. Anywhere else (the Vercel deployment, a static server): the invented
// demo state that ships with the site, unless this browser opted in once with
// ?engine=on to reach the engine on Wahb's laptop (http://127.0.0.1:3210/api,
// 1.5 s timeout, then the demo). ?engine=off forgets it; ?demo=1 forces the demo.
// In demo mode every action is kept in this browser only (localStorage).

import { now as clockNow, period as clockPeriod, fmtDate, fmtTime } from './clock.js';

const ENGINE_DEFAULT = 'http://127.0.0.1:3210/api';
const TIMEOUT_MS = 1500;
const POLL_MS = 30000;
const DEMO_URL = new URL('../demo/state.json', import.meta.url).href;

const LOCAL = {
  orders: 'sao.ui.orders.local.v1', // shared with main.js
  answers: 'sao.data.answers.local.v1',
  approvals: 'sao.data.approvals.local.v1',
};

let api = null; // the engine base that answered, or null in demo mode
let source = null; // 'engine' | 'demo' | 'none'
let lastText = '';
let demoState = null; // the demo file as loaded, for its stable weather

/* ------------------------------------------------------------- helpers */

function param(name) {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch (e) {
    return null;
  }
}

function isLocalHost(host) {
  const h = String(host || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
}

function readLocal(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function pushLocal(key, entry) {
  try {
    const list = readLocal(key);
    list.push(entry);
    localStorage.setItem(key, JSON.stringify(list.slice(-200)));
    return true;
  } catch (e) {
    return false;
  }
}

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    return await fetch(url, { cache: 'no-store', credentials: 'omit', ...opts, signal: ctl ? ctl.signal : undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ENGINE_KEY = 'sao.data.engine.v1';
const MARKER_URL = new URL('../engine.json', import.meta.url).href;

function remembered(value) {
  try {
    if (value === undefined) return localStorage.getItem(ENGINE_KEY);
    if (value === null) localStorage.removeItem(ENGINE_KEY);
    else localStorage.setItem(ENGINE_KEY, value);
  } catch (e) { /* storage blocked */ }
  return null;
}

// Is this page served by the engine itself? The engine answers engine.json
// with true; a static host (Vercel, a plain file server) serves the file with
// false. Asking for a file that always exists keeps the console free of 404s.
async function servedByEngine() {
  try {
    const r = await fetchWithTimeout(MARKER_URL, { headers: { Accept: 'application/json' } }, TIMEOUT_MS);
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && j.engine === true);
  } catch (e) {
    return false;
  }
}

// The engine bases to try, in order. Another origin (the deployment, a static
// server) only calls the laptop engine when this browser asked for it once with
// ?engine=on (port 3210) or ?engine=http://127.0.0.1:PORT; ?engine=off forgets
// it. Visitors never see a refused connection or a local network prompt.
async function engineCandidates() {
  const list = [];
  const here = typeof location !== 'undefined' ? location : null;
  if (here && /^https?:$/.test(here.protocol) && (await servedByEngine())) list.push(`${here.origin}/api`);
  const ask = param('engine');
  if (ask === 'off') remembered(null);
  else if (ask === 'on' || ask === '1') remembered(ENGINE_DEFAULT);
  else if (ask) {
    try {
      const u = new URL(ask);
      if (u.protocol === 'http:' && isLocalHost(u.hostname)) remembered(`${u.origin}/api`);
    } catch (e) { /* ignore a bad override */ }
  }
  const saved = remembered();
  if (saved) {
    try {
      const u = new URL(saved);
      if (u.protocol === 'http:' && isLocalHost(u.hostname)) list.push(`${u.origin}/api`);
    } catch (e) { remembered(null); }
  }
  return [...new Set(list)];
}

async function readEngine(base, ms = TIMEOUT_MS) {
  const r = await fetchWithTimeout(`${base}/state`, { headers: { Accept: 'application/json' } }, ms);
  if (!r.ok) throw new Error(`engine ${r.status}`);
  const text = await r.text();
  const state = JSON.parse(text);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('engine sent no state');
  return { state, text };
}

// Demo answers and approvals made in this browser stay made after a reload.
function withLocalDemo(state) {
  const answered = new Set(readLocal(LOCAL.answers).map((a) => a && String(a.id)));
  if (answered.size && Array.isArray(state.questions)) state.questions = state.questions.filter((q) => !q || !answered.has(String(q.id)));
  return state;
}

async function loadDemo(error) {
  try {
    const r = await fetchWithTimeout(DEMO_URL, {}, 8000);
    if (!r.ok) throw new Error(`demo ${r.status}`);
    const state = await r.json();
    demoState = state && typeof state === 'object' ? state : null;
    api = null;
    source = 'demo';
    const out = { state: withLocalDemo(state && typeof state === 'object' ? liveDemo(state) : {}), source: 'demo' };
    if (error) out.error = error;
    return out;
  } catch (e) {
    api = null;
    source = 'none';
    return { state: null, source: 'none', error: error || String((e && e.message) || e) };
  }
}

async function post(path, body) {
  const r = await fetchWithTimeout(`${api}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, 5000);
  let data = null;
  try {
    data = await r.json();
  } catch (e) { /* empty body */ }
  if (!r.ok || (data && data.ok === false)) throw new Error((data && data.error) || `engine ${r.status}`);
  return data || { ok: true };
}

/* ------------------------------------------------- the demo keeps time */

// The invented demo was written at one evening (generatedAt). So it never
// reads stale or out of hour, it is moved onto the live clock: every date in
// it slides by whole days so that evening is the latest one already past, the
// morning brief carries today's date, and each place and bot takes its line
// for the hour (morning, day, sunset, night) with start times counted back
// from now. Only the demo is touched; engine state is shown as sent.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86400000;
const DATE_RE = /\b(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b/g;

function torontoDay(d) {
  // the Toronto calendar day as a UTC midnight, plus minutes into that day
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const o = {};
    for (const x of f.formatToParts(d)) o[x.type] = x.value;
    return { day: Date.UTC(+o.year, +o.month - 1, +o.day), min: (+o.hour % 24) * 60 + +o.minute };
  } catch (e) {
    return { day: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()), min: d.getHours() * 60 + d.getMinutes() };
  }
}

function shiftText(text, shift, anchor) {
  if (!shift || typeof text !== 'string' || text.indexOf(' ') < 0) return text;
  const a = new Date(anchor);
  return text.replace(DATE_RE, (all, wd, mon, dd) => {
    const m = MON.indexOf(mon);
    const n = Number(dd);
    if (m < 0 || n < 1 || n > 31) return all;
    // a month far before the anchor's belongs to the next year (Feb, Jun)
    let y = a.getUTCFullYear();
    if (m < a.getUTCMonth() - 5) y += 1;
    else if (m > a.getUTCMonth() + 6) y -= 1;
    const t = new Date(Date.UTC(y, m, n) + shift * DAY_MS);
    const out = `${MON[t.getUTCMonth()]} ${t.getUTCDate()}`;
    return wd ? `${WD[t.getUTCDay()]} ${out}` : out;
  });
}

function shiftAll(v, shift, anchor, depth = 0) {
  if (depth > 12) return v;
  if (typeof v === 'string') return shiftText(v, shift, anchor);
  if (Array.isArray(v)) return v.map((x) => shiftAll(x, shift, anchor, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = shiftAll(v[k], shift, anchor, depth + 1);
    return o;
  }
  return v;
}

function forHour(obj, per, at) {
  if (!obj || typeof obj !== 'object') return obj;
  const t = obj.times && typeof obj.times === 'object' ? obj.times[per] : null;
  const out = { ...obj };
  delete out.times;
  if (t && typeof t === 'object') {
    for (const k of Object.keys(t)) if (k !== 'startedAgo') out[k] = t[k];
    const ago = Number(t.startedAgo);
    if (Number.isFinite(ago) && ago >= 0) out.startedAt = fmtTime(new Date(at.getTime() - ago * 60000));
  }
  return out;
}

// The same clock the tag and the quiet pill read: ?at= moves the whole clock,
// ?time= alone sets a typical hour for that period, so the report header, the
// brief and the status pill agree in every review shot.
const PERIOD_HOUR = { morning: [7, 40], day: [13, 20], sunset: [18, 40], night: [23, 10] };
export function demoNow() {
  const n = clockNow();
  if (param('at')) return n;
  const want = PERIOD_HOUR[param('time')];
  if (!want) return n;
  const [hh, mm] = fmtTime(n).split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return n;
  return new Date(n.getTime() + ((want[0] * 60 + want[1]) - (hh * 60 + mm)) * 60000);
}

export function liveDemo(state, at = demoNow()) {
  if (!state || typeof state !== 'object') return state;
  try {
    const per = clockPeriod(at);
    const gen = new Date(state.generatedAt || '');
    let s = state;
    if (!isNaN(gen)) {
      const g = torontoDay(gen);
      const n = torontoDay(at);
      // the demo evening is the latest one already past: today once its hour
      // has come, otherwise yesterday
      const target = n.min >= g.min ? n.day : n.day - DAY_MS;
      const shift = Math.round((target - g.day) / DAY_MS);
      // a demo opened a season away keeps its own dates rather than drift
      if (shift && Math.abs(shift) <= 150) {
        s = shiftAll(state, shift, g.day);
        s.generatedAt = new Date(gen.getTime() + shift * DAY_MS).toISOString();
      }
      // the report was written that evening: say so when it is not tonight's
      if (s.report && typeof s.report === 'object' && typeof s.report.at === 'string' && target !== n.day && n.min >= 5 * 60) {
        s.report = { ...s.report, at: `${s.report.at}, last night` };
      }
    }
    if (s.places && typeof s.places === 'object') {
      const places = {};
      for (const k of Object.keys(s.places)) places[k] = forHour(s.places[k], per, at);
      s.places = places;
    }
    if (Array.isArray(s.bots)) s.bots = s.bots.map((b) => forHour(b, per, at));
    // the morning brief is today's
    if (s.brief && typeof s.brief === 'object') {
      const today = torontoDay(at).day;
      const due = Array.isArray(s.brief.due)
        ? s.brief.due.map((d) => {
            if (!d || typeof d.date !== 'string') return d;
            const m = /^(?:\w{3} )?(\w{3}) (\d{1,2})$/.exec(d.date.trim());
            if (!m || MON.indexOf(m[1]) < 0) return d;
            let y = new Date(today).getUTCFullYear();
            let t = Date.UTC(y, MON.indexOf(m[1]), Number(m[2]));
            if (t < today - 180 * DAY_MS) t = Date.UTC(y + 1, MON.indexOf(m[1]), Number(m[2]));
            return { ...d, daysLeft: Math.round((t - today) / DAY_MS) };
          })
        : s.brief.due;
      s.brief = { ...s.brief, date: fmtDate(at), due };
    }
    return s;
  } catch (e) {
    return state;
  }
}

/* ------------------------------------------------------------- the API */

export async function loadState() {
  if (param('demo') === '1') return loadDemo(null);
  // no engine expected here: the demo, with no error to report
  let lastError = null;
  for (const base of await engineCandidates()) {
    try {
      const { state, text } = await readEngine(base);
      api = base;
      source = 'engine';
      lastText = text;
      return { state, source: 'engine' };
    } catch (e) {
      lastError = 'engine unavailable';
    }
  }
  return loadDemo(lastError);
}

export async function sendOrder({ place, text } = {}) {
  const order = { place: place || 'town', text: String(text || '').trim() };
  if (!order.text) return { ok: false, saved: null, error: 'empty order' };
  if (source === 'engine' && api) {
    try {
      const r = await post('order', order);
      return { ok: true, saved: 'engine', id: r.id };
    } catch (e) {
      /* the engine went away: keep it here so nothing is lost */
    }
  }
  const ok = pushLocal(LOCAL.orders, { ...order, at: new Date().toISOString() });
  return { ok, saved: 'local' };
}

export async function answerQuestion(id, answer) {
  const entry = { id: String(id), answer: String(answer == null ? '' : answer).trim() };
  if (!entry.id || !entry.answer) return { ok: false, saved: null };
  if (source === 'engine' && api) {
    try {
      await post('answer', entry);
      return { ok: true, saved: 'engine' };
    } catch (e) { /* fall back to this browser */ }
  }
  const ok = pushLocal(LOCAL.answers, { ...entry, at: new Date().toISOString() });
  return { ok, saved: 'local' };
}

export async function approve(id) {
  const entry = { id: String(id == null ? '' : id) };
  if (!entry.id) return { ok: false, saved: null };
  if (source === 'engine' && api) {
    try {
      await post('approve', entry);
      return { ok: true, saved: 'engine' };
    } catch (e) { /* fall back to this browser */ }
  }
  const ok = pushLocal(LOCAL.approvals, { ...entry, at: new Date().toISOString() });
  return { ok, saved: 'local' };
}

// Fire and forget: tells ICON that Wahb is here (it ends an AFK loop).
export function pingActivity() {
  if (source !== 'engine' || !api) return;
  try {
    fetch(`${api}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true, credentials: 'omit', cache: 'no-store' }).catch(() => {});
  } catch (e) { /* never matters */ }
}

// Polls the engine every 30 s while the page is visible; calls cb(state) when
// it changed. Returns a function that stops the polling.
export function onState(cb) {
  if (typeof cb !== 'function' || source !== 'engine' || !api) return () => {};
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || busy || (typeof document !== 'undefined' && document.hidden)) return;
    busy = true;
    try {
      const { state, text } = await readEngine(api, 5000);
      const changed = text !== lastText;
      lastText = text;
      if (changed) cb(state);
    } catch (e) {
      /* the laptop is asleep or the engine stopped: try again next time */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, POLL_MS);
  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) tick();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

export function currentSource() {
  return source;
}

// The engine base that answered (for example '/api' on this laptop), or null.
export function engineBase() {
  return source === 'engine' && api ? api : null;
}

// The stable weather that ships with the demo state, or null. Never calls the
// network beyond the demo file itself, so the tag reads the same on every load.
export async function demoWeather() {
  try {
    if (!demoState) {
      const r = await fetchWithTimeout(DEMO_URL, {}, 8000);
      if (r.ok) demoState = await r.json();
    }
    const w = demoState && demoState.weather;
    if (!w || typeof w !== 'object') return null;
    const kinds = ['clear', 'clouds', 'rain', 'snow', 'fog'];
    const kind = kinds.includes(w.kind) ? w.kind : 'clear';
    const t = Number(w.tempC);
    return { kind, tempC: Number.isFinite(t) ? Math.round(t) : null, label: String(w.label || 'Clear').slice(0, 40) };
  } catch (e) {
    return null;
  }
}
