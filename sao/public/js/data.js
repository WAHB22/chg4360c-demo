// SAO data: where the world state comes from and where Wahb's actions go.
//
// Served by the local engine (it answers engine.json with true): same origin
// /api. Anywhere else (the Vercel deployment, a static server): the invented
// demo state that ships with the site, unless this browser opted in once with
// ?engine=on to reach the engine on Wahb's laptop (http://127.0.0.1:3210/api,
// 1.5 s timeout, then the demo). ?engine=off forgets it; ?demo=1 forces the demo.
// In demo mode every action is kept in this browser only (localStorage).

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
    api = null;
    source = 'demo';
    const out = { state: withLocalDemo(state && typeof state === 'object' ? state : {}), source: 'demo' };
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
