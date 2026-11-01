// Client sync engine: load, debounced save, 409 replay, offline queue, refused saves, undo and restore. Pure ES module.
//
// Invariant: state = the saved doc it is based on (state.savedAt) + the forward ops of every pending action.
// A state object is never changed in place once it is published: every change builds a new object,
// so an action's `before` and `after` stay exact for undo.
// migrate, noteFor and defaults are injected (the page passes the real ones from lib/migrate.js and lib/labels.js).
import { clone, canonical, uid, pad } from './core.js';
import { diff, applyOps } from './diff.js';

const ENDPOINT = '/api/data';
const CACHE = 'finance-cache', PENDING = 'finance-pending', KEY = 'finance-key';
// Sync bookkeeping, never part of an action: undo and restore keep the current values.
const BOOKKEEPING = ['savedAt', 'note', 'baseSavedAt'];
const MAX_ATTEMPTS = 3;
// A save the server will never take as it is (400 invalid or too big, 413 too big for Vercel): not retried on a timer.
const REFUSED = new Set([400, 413]);
const DASHES = /\s*(?:[\u2010-\u2015]|\s-\s)\s*/g;

export const STATUS_TEXT = {
  saving: 'Saving…',
  ok: 'Synced',
  offline: "Offline, showing this device's copy",
  notSetUp: 'This device is not set up',
  retry: 'Not synced yet, saved on this device. Will retry.',
  conflict: 'Could not sync, will retry',
  refused: 'Could not save: the server refused this save. Your changes are kept on this device.',
};

// Status text for a 400 or 413 answer to a save. `error` is the server's message, when it sent one.
// Shown as is, so it is kept short, with no dashes and no trailing full stop; otherwise a plain fallback.
export function refusedText(error) {
  const why = typeof error === 'string' ? error.replace(DASHES, ', ').replace(/\s+/g, ' ').trim().replace(/[\s.!]+$/, '') : '';
  if (!why || why.length > 160) return STATUS_TEXT.refused;
  return `Could not save: ${why}. Your changes are kept on this device.`;
}

// 'Synced 3:20 p.m.' in local time, the same on every browser.
export function syncedText(when) {
  const d = new Date(when);
  const h = d.getHours();
  return `Synced ${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

const isDoc = d => d !== null && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.bills);
const sameDoc = (x, y) => canonical(x, BOOKKEEPING) === canonical(y, BOOKKEEPING);
const isStoredAction = a => a && typeof a.id === 'string' && Array.isArray(a.ops);
const replay = (base, actions) => actions.reduce((s, a) => applyOps(s, a.ops, 'forward'), base);

export function createSync({
  fetch = (...args) => globalThis.fetch(...args),
  storage = globalThis.localStorage,
  getKey,
  now = () => Date.now(),
  onState = () => {},
  onStatus = () => {},
  migrate, noteFor, defaults,
  debounceMs = 700, retryMs = 5000, lockWaitMs = 250,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  if (typeof migrate !== 'function' || typeof noteFor !== 'function' || typeof defaults !== 'function') {
    throw new TypeError('createSync needs migrate, noteFor and defaults');
  }
  // Injected functions are always called unbound (a browser fetch called as a method of another object throws).
  getKey ||= () => storage.getItem(KEY);

  let state = null;
  let pending = [];           // [{id, label, ops, before?, after?, at?}], oldest first
  let status = null;          // {code, text}
  let inflight = null;        // promise of the running push cycle
  let again = false;          // push() was asked for while a PUT was in flight
  let needsPush = false;      // the server is empty: push the state even with nothing pending
  let generation = 0;         // bumps on every state change, so a slow refresh never overwrites newer work
  let pushTimer = null, retryTimer = null;

  /* ---------- storage ---------- */
  function readJSON(key) {
    try { const s = storage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  function persist() {
    try {
      storage.setItem(CACHE, JSON.stringify(state));
      if (pending.length) storage.setItem(PENDING, JSON.stringify(pending.map(({ id, label, ops }) => ({ id, label, ops }))));
      else storage.removeItem(PENDING);
    } catch { /* storage full or blocked: the server copy still works */ }
  }

  /* ---------- helpers ---------- */
  function setStatus(code, text) {
    status = { code, text };
    onStatus(text, code);
  }
  function setState(next, { notify = true } = {}) {
    state = next;
    generation++;
    persist();
    if (notify) onState(state);
  }
  function stop() {
    if (pushTimer) clearTimer(pushTimer);
    if (retryTimer) clearTimer(retryTimer);
    pushTimer = retryTimer = null;
  }
  function notSetUp() {
    // Never show cached data on a device that is not set up. Storage is left alone so nothing unsaved is lost.
    state = null;
    generation++;
    stop();
    setStatus('not-set-up', STATUS_TEXT.notSetUp);
    return { state: null, status: 'not-set-up' };
  }
  function schedulePush() {
    if (pushTimer) clearTimer(pushTimer);
    pushTimer = setTimer(() => { pushTimer = null; push(); }, debounceMs);
  }
  function scheduleRetry() {
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = setTimer(() => { retryTimer = null; push(); }, retryMs);
  }
  // A pause inside a push cycle. Never cleared by stop(): the cycle always resumes, then checks the state.
  const pause = ms => new Promise(resolve => setTimer(resolve, ms));

  // -> {status: http status or 0 for a network error, json}. No key means 401 without asking the server.
  async function request(method, query = '', body) {
    let key = null;
    try { key = getKey(); } catch { /* storage blocked: this device cannot be set up */ }
    if (!key) return { status: 401, json: null };
    const headers = { 'x-app-key': key };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try { res = await fetch(ENDPOINT + query, { method, headers, body, cache: 'no-store' }); } catch { return { status: 0, json: null }; }
    let json = null;
    try { json = await res.json(); } catch { /* not JSON: treated like a server error */ }
    return { status: res.status, json };
  }

  /* ---------- load and refresh ---------- */
  async function load() {
    stop();
    needsPush = false; // only this load's answer decides whether the server is empty
    const cache = readJSON(CACHE);
    const stored = readJSON(PENDING);
    pending = Array.isArray(stored) ? stored.filter(isStoredAction) : [];
    const res = await request('GET');
    if (res.status === 401) return notSetUp();

    if (res.status === 200 && isDoc(res.json)) {
      // When remote.savedAt equals the cached savedAt, this equals the cache.
      setState(replay(migrate(res.json), pending));
      if (pending.length) { setStatus('saving', STATUS_TEXT.saving); push(); } else setStatus('ok', STATUS_TEXT.ok);
      return { state, status: 'ok' };
    }
    const local = migrate(isDoc(cache) ? cache : defaults());
    if (res.status === 200 && res.json && res.json.empty === true) {
      needsPush = true;
      setState(local);
      setStatus('saving', STATUS_TEXT.saving);
      push();
      return { state, status: 'empty' };
    }
    setState(local);
    setStatus('offline', STATUS_TEXT.offline);
    if (pending.length) scheduleRetry();
    return { state, status: 'offline' };
  }

  async function refresh() {
    const gen = generation;
    const res = await request('GET');
    if (res.status === 401) return { ...notSetUp(), changed: false };
    if (res.status !== 200 || !isDoc(res.json)) {
      return { state, status: res.status === 200 && res.json && res.json.empty ? 'empty' : 'offline', changed: false };
    }
    const busy = !state || pending.length || inflight || gen !== generation;
    if (busy || res.json.savedAt === state.savedAt) {
      // The server answered and this device holds its newest copy: no longer offline.
      if (!busy && status && status.code === 'offline') setStatus('ok', STATUS_TEXT.ok);
      return { state, status: 'ok', changed: false };
    }
    needsPush = false; // the server is not empty any more: there is nothing of ours to send
    setState(migrate(res.json));
    setStatus('ok', STATUS_TEXT.ok);
    return { state, status: 'ok', changed: true };
  }

  /* ---------- actions ---------- */
  function requireState() {
    if (!state) throw new Error('Nothing is loaded yet');
  }
  // Records the change from the current state to `next` as one action. Bookkeeping fields follow the current state.
  function record(label, next) {
    const before = state;
    for (const k of BOOKKEEPING) {
      if (before[k] === undefined) delete next[k]; else next[k] = before[k];
    }
    const ops = diff(before, next);
    const action = { id: uid(), label: String(label), ops, before, after: next, at: now() };
    if (!ops.length) { action.after = before; return action; } // nothing changed: nothing to save
    pending.push(action);
    try {
      setState(next);
    } finally {
      // Even if the page fails to render, the change is pending and stored, so it still gets sent.
      setStatus('saving', STATUS_TEXT.saving);
      schedulePush();
    }
    return action;
  }

  function act(label, mutate) {
    requireState();
    const draft = clone(state);
    mutate(draft);
    return record(label, draft);
  }

  function undo(action) {
    requireState();
    // Exact when nothing else changed since; otherwise only this action's own paths go back.
    const next = action.after && action.before && sameDoc(state, action.after)
      ? clone(action.before)
      : applyOps(clone(state), action.ops, 'backward');
    return record(`Undid "${action.label}"`, next);
  }

  function restore(doc, label = 'Restored backup') {
    requireState();
    if (!isDoc(doc)) throw new Error('That file is not a finance backup');
    // The backup's own savedAt is old; record() keeps the current one as the base so the save is not a conflict.
    return record(label, migrate(clone(doc)));
  }

  /* ---------- pushing ---------- */
  function push() {
    if (pushTimer) { clearTimer(pushTimer); pushTimer = null; }
    if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
    if (inflight) { again = true; return inflight; }
    if (!state || (!pending.length && !needsPush)) return Promise.resolve();
    inflight = cycle().finally(() => { inflight = null; });
    return inflight;
  }

  async function cycle() {
    do {
      again = false;
      const result = await pushOnce();
      // A refused save sets no retry timer, so a push asked for meanwhile (an act made during that PUT) runs now.
      if (result !== 'ok' && !(result === 'refused' && again)) return;
    } while (again && pending.length);
  }

  // One push with up to MAX_ATTEMPTS PUTs (each 409 replays the pending actions on the newest doc first).
  // -> 'ok' | 'retry' (a timer will push again) | 'refused' (only the next act or a reload pushes again) | 'stop'.
  async function pushOnce() {
    for (let attempt = 1; ; attempt++) {
      const batch = pending.slice();
      const base = state.savedAt ?? null;
      const note = noteFor(batch.map(a => a.label));
      const body = JSON.stringify({ ...state, savedAt: base, baseSavedAt: base, note });
      const res = await request('PUT', '', body);
      if (!state) return 'stop'; // marked not set up meanwhile

      if (res.status === 200 && res.json && res.json.savedAt) {
        needsPush = false;
        const done = new Set(batch.map(a => a.id));
        pending = pending.filter(a => !done.has(a.id)); // actions made while the PUT was in flight stay pending
        setState({ ...state, savedAt: res.json.savedAt, note }, { notify: false });
        if (pending.length) setStatus('saving', STATUS_TEXT.saving); else setStatus('synced', syncedText(now()));
        return 'ok';
      }
      if (res.status === 401) { notSetUp(); return 'stop'; }
      if (REFUSED.has(res.status)) {
        // Sending the same save again gets the same answer, so there is no retry timer. The pending actions stay
        // on this device; the next act (or undo, restore) or a reload pushes again.
        setStatus('refused', refusedText(res.json && res.json.error));
        return 'refused';
      }
      if (res.status === 409) {
        const latest = isDoc(res.json && res.json.latest) ? res.json.latest : await fetchLatest();
        if (latest) {
          // The newest copy is the very one this save started from: nothing newer was saved, so the 409 came
          // from the server's save lock (another save was still running). That save gets a moment to finish.
          const lockConflict = latest.savedAt != null && latest.savedAt === base;
          needsPush = false;
          setState(replay(migrate(latest), pending));
          if (!pending.length) { setStatus('synced', syncedText(now())); return 'ok'; }
          if (attempt < MAX_ATTEMPTS) {
            if (lockConflict) {
              await pause(lockWaitMs);
              if (!state) return 'stop';
            }
            continue;
          }
        }
        setStatus('conflict', STATUS_TEXT.conflict);
        scheduleRetry();
        return 'retry';
      }
      // Network error, 5xx, or anything unexpected: everything is already saved on this device.
      setStatus('retry', STATUS_TEXT.retry);
      scheduleRetry();
      return 'retry';
    }
  }

  async function fetchLatest() {
    const res = await request('GET');
    return res.status === 200 && isDoc(res.json) ? res.json : null;
  }

  /* ---------- history (GET ?history=1 and ?version=) ---------- */
  async function history() {
    const res = await request('GET', '?history=1');
    if (res.status === 401) { notSetUp(); return null; }
    return res.status === 200 && res.json && Array.isArray(res.json.versions) ? res.json.versions : null;
  }
  async function fetchVersion(id) {
    const res = await request('GET', '?version=' + encodeURIComponent(id));
    if (res.status === 401) { notSetUp(); return null; }
    return res.status === 200 && isDoc(res.json) ? res.json : null;
  }

  // Resolves when no push is running (tests, and the page before it hides).
  async function idle() {
    while (inflight) await inflight.catch(() => {});
  }

  return {
    load, refresh, act, undo, restore, push, history, fetchVersion, idle, stop,
    get state() { return state; },
    get pending() { return pending.slice(); },
    get status() { return status; },
  };
}
