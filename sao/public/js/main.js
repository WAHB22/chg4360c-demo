// SAO main: wires the world together with the contracts in SPEC.md.
// The vista, the crowd, the map and the data engine load as separate modules;
// if one is missing or throws, the rest of the world keeps working.
//
// URL overrides for screenshots and tests:
//   ?place=<id>  ?time=morning|day|sunset|night  ?season=...  ?weather=...
//   ?open=report|brief|floors|rules|settings|bots|drafts|questions|map|place:<id>
//   ?demo=1  ?intro=0  ?brief=0  ?at=<ISO time>

import { PLACE } from './places.js';
import { BOT } from './bots.js';
import * as clock from './clock.js';
import { h, param, store, clean, copyText, isPhone, reducedMotion } from './ui/dom.js';
import { S, subscribe, emit, st, bots, botsAt, botById, questions, allDrafts, placeName, ACTIVE_STATES } from './ui/store.js';
import { mountStatus, renderStatus, wake } from './ui/status.js';
import { mountTag, renderTag } from './ui/tag.js';
import { mountMenu, dropIn, setBadges, setPressed } from './ui/menu.js';
import { mountCaption, renderCaption } from './ui/caption.js';
import { mountToast, say, releaseHeld } from './ui/toast.js';
import { mountSheets, openSheet, showSheet, closeSheet, currentSheet, refill } from './ui/sheet.js';
import { placeView, botsView, draftsView, draftView, questionsView } from './ui/views.js';
import { reportView, reportTitle, briefView, briefTitle, prewarmBrief } from './ui/report.js';
import { floorsView } from './ui/floors.js';
import { rulesView, settingsView } from './ui/charter.js';
import { mountDock, menuGrid } from './ui/dock.js';
import { runIntro } from './ui/intro.js';
import { setSound, setSoundQuiet, cue } from './ui/sound.js';
import { hooks } from './ui/cards.js';
import { COPY } from './ui/copy.js';

const M = { vista: null, characters: null, map: null, data: null };
const LAST_PLACE = 'sao.ui.place.v1';
const INTRO_DAY = 'sao.ui.intro.day.v1';
const BRIEF_DAY = 'sao.ui.brief.day.v1';
const LOCAL_ORDERS = 'sao.ui.orders.local.v1';

let weatherNow; // undefined until the first forecast answer, then an object or null
let lastPeriod = null;
let lastSeason = null;
let viewArgs = {};
let mapOpener = null;
let dirty = false;

const $ = (sel) => document.querySelector(sel);

function safe(fn, label) {
  try {
    return fn();
  } catch (e) {
    console.warn(`[sao] ${label || 'step'} failed`, e);
    return undefined;
  }
}

async function load(name) {
  try {
    return await import(`./${name}.js`);
  } catch (e) {
    console.warn(`[sao] module ${name}.js did not load`, e);
    return null;
  }
}

/* ------------------------------------------------------------------ boot */

// On a laptop the caption card hangs just under the traveller card, so the
// vista's dark foreground corners and the start of its path stay in view.
// The status block grows with its content; its foot is kept in a CSS value.
function trackStatusFoot(hud) {
  const world = $('#world');
  const st = hud && hud.querySelector('.status');
  if (!world || !st) return;
  const set = () => {
    const foot = st.offsetTop + st.offsetHeight;
    if (foot > 0) world.style.setProperty('--status-foot', `${Math.round(foot)}px`);
  };
  set();
  if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(st);
  else window.addEventListener('resize', set);
}

async function boot() {
  const root = document.documentElement;
  if (S.prefs.reduceMotion) root.classList.add('reduce-motion');

  const hud = $('#hud');
  mountStatus(hud, { onBotTap: (id) => openBot(id) });
  mountTag(hud);
  mountMenu(hud, { onOpen: (id, btn) => openView(id, {}, btn) });
  mountCaption($('#caption-slot'), { onOpenPlace: (id) => openView(`place:${id}`) });
  trackStatusFoot(hud);
  mountToast(document.body);
  mountSheets(document.body, { onClose: () => { S.open = null; delete document.documentElement.dataset.panel; setPressed(null); } });
  mountDock($('#dock-slot'), {
    onMap: (b) => toggleMap(true, b),
    onMenu: (b) => openView('menu', {}, b),
    onIcon: (b) => openView('report', {}, b),
  });
  $('#map-close').addEventListener('click', () => toggleMap(false));
  renderCaption(null, { loading: true });
  {
    const n0 = nowish();
    renderTag({ day: clock.weekday(n0), time: clock.fmtTime(n0), weather: undefined, quiet: false });
  }

  // where Wahb stands
  const want = param('place');
  S.place = PLACE[want] ? want : PLACE[store(LAST_PLACE)] ? store(LAST_PLACE) : 'town';
  const openParam = param('open') || '';
  if (openParam.startsWith('place:') && PLACE[openParam.slice(6)]) S.place = openParam.slice(6);

  const [vista, characters, map, data] = await Promise.all([load('vista'), load('characters'), load('map'), load('data')]);
  Object.assign(M, { vista, characters, map, data });
  if (characters && typeof characters.spriteSVG === 'function') hooks.sprite = characters.spriteSVG;
  // the brief banner reuses the painted town at morning when the vista holds it
  hooks.vistaLayers = () => {
    if (!vista || typeof vista.currentPlace !== 'function' || vista.currentPlace() !== 'town') return null;
    if (clock.period(clock.now()) !== 'morning') return null;
    const stage = document.querySelector('#vista .sv-stage');
    // only the full paint: the quick one stair steps when it fills the banner
    if (!stage || stage.dataset.res !== 'full') return null;
    const layers = ['canvas.sv-sky', 'canvas.sv-land'].map((q) => stage.querySelector(q));
    if (layers.some((c) => !c || !c.width || !c.height)) return null;
    try {
      const land = layers[1];
      const px = land.getContext('2d').getImageData(Math.round(land.width * 0.6), Math.round(land.height * 0.55), 1, 1).data;
      if (!px[3]) return null; // not painted yet
    } catch (e) { /* unreadable pixels: trust the painted flag */ }
    return layers;
  };
  if (!vista || !characters || !map) say(COPY.error.module, { force: true });

  updateQuiet(false);
  const vEl = $('#vista');
  if (vista) {
    safe(() => vista.mountVista(vEl, { onPlaceTap: (id) => openView(`place:${id}`) }), 'mountVista');
    safe(() => vista.setAmbience(ambience()), 'setAmbience');
    safe(() => vista.showPlace(S.place, { instant: true }), 'showPlace');
    if (characters) safe(() => characters.mountCrowd(vista.crowdLayer(), { onBotTap: (id) => openBot(id) }), 'mountCrowd');
  } else {
    vEl.classList.add('vista-missing');
  }
  if (map) safe(() => map.mountMap($('#map-host'), { onTravel: (id) => travel(id, { fromMap: true }), onBotTap: (id) => openBot(id) }), 'mountMap');
  renderScene();

  // the opening ritual runs while the state loads
  const today = clock.fmtDate(clock.now());
  const first = store(INTRO_DAY) !== today;
  store(INTRO_DAY, today);
  const intro = runIntro({ vista: vEl, first, skip: param('intro') === '0' || S.prefs.skipIntro }).then(() => dropIn());

  await loadWorld();
  clockTick();
  refreshWeather();
  clock.onTick(clockTick);
  setInterval(refreshWeather, 20 * 60 * 1000);
  if (data && typeof data.onState === 'function') safe(() => data.onState((next) => applyState(next)), 'onState');

  wireActivity();
  if (S.prefs.sound !== 'off') {
    // a saved sound choice starts on the first intentional tap, never on its own
    const arm = () => {
      setSound(S.prefs.sound);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
  }

  await intro;
  // any deep link (?open= or ?place=) is where Wahb meant to land: no brief over it
  if (openParam) openFromParam(openParam);
  else if (!param('place')) maybeBrief();
  setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(() => safe(prewarmBrief, 'prewarmBrief'), { timeout: 4000 }), 3500);
}

/* ----------------------------------------------------------------- state */

async function loadWorld() {
  S.loading = true;
  emit('state');
  let res = null;
  if (M.data && typeof M.data.loadState === 'function') {
    try {
      res = await M.data.loadState();
    } catch (e) {
      res = { state: null, source: 'none', error: String((e && e.message) || e) };
    }
  }
  if (!res || !res.state) {
    // data.js missing or empty: read the demo file directly
    try {
      const r = await fetch('demo/state.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(`demo ${r.status}`);
      res = { state: await r.json(), source: 'demo', error: (res && res.error) || 'engine unavailable' };
    } catch (e) {
      res = { state: null, source: 'none', error: (res && res.error) || String((e && e.message) || e) };
    }
  }
  S.loading = false;
  S.state = res.state && typeof res.state === 'object' ? res.state : {};
  S.source = res.source || 'none';
  S.error = res.error || null;
  // one small "Demo world" badge says it once; the lines themselves read clean
  if (S.source === 'demo') S.state = undemo(S.state);
  const errEl = $('#world-error');
  if (S.source === 'none') {
    errEl.hidden = false;
  } else {
    errEl.hidden = true;
    // only where an engine is expected (this machine); a deployment is always the demo
    const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
    if (S.error && S.source === 'demo' && M.data && local && param('demo') !== '1' && !S.quiet) say(COPY.error.demo);
  }
  updateQuiet(false);
  renderAll();
}

function undemo(v, depth = 0) {
  if (depth > 12) return v;
  if (typeof v === 'string') {
    const t = v.replace(/(^|\n)\s*Demo content only\.\s*/g, '$1').replace(/(^|\n)(\s*)Demo:\s*/g, '$1$2').replace(/^\s+/, '');
    return t && t !== v ? t.charAt(0).toUpperCase() + t.slice(1) : t || v;
  }
  if (Array.isArray(v)) return v.map((x) => undemo(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = undemo(v[k], depth + 1);
    return o;
  }
  return v;
}

function applyState(next) {
  if (!next || typeof next !== 'object') return;
  if (S.source === 'demo') next = undemo(next);
  const prev = st();
  const prevQ = new Set((Array.isArray(prev.questions) ? prev.questions : []).map((q) => q && q.id));
  const prevDrafts = allDrafts().length;
  S.state = next;
  S.loading = false;
  const freshQ = questions().filter((q) => !prevQ.has(q.id));
  const newDrafts = allDrafts().length - prevDrafts;
  if (freshQ.length) {
    const q = freshQ[0];
    say(COPY.msg.newQuestion(BOT[q.from] ? BOT[q.from].name : 'ICON'));
    if (!S.quiet) cue();
  }
  if (newDrafts > 0) say(COPY.msg.newDrafts(newDrafts));
  renderAll();
}

function renderAll() {
  safe(renderStatus, 'status');
  renderCaption(S.place, { loading: S.loading && !PLACE[S.place] });
  if (!S.loading) renderCaption(S.place);
  safe(renderBadges, 'badges');
  renderScene();
  refreshOpen();
}

function renderBadges() {
  const r = st().report || {};
  const counts = {
    report: Array.isArray(r.needsMe) ? Math.min(3, r.needsMe.length) : 0,
    bots: bots().filter((b) => ACTIVE_STATES.has(b.state)).length,
    drafts: allDrafts().length,
    questions: questions().length,
  };
  setBadges(counts);
  S.counts = counts;
}

function sceneBots(id) {
  if (id === 'town') return bots().filter((b) => b.place === 'town' || !ACTIVE_STATES.has(b.state));
  return botsAt(id);
}

function renderScene() {
  if (M.characters) safe(() => M.characters.setScene(S.place, S.loading ? [] : sceneBots(S.place), { quiet: S.quiet, reduced: reducedMotion() }), 'setScene');
  if (M.map) safe(() => M.map.updateMap(S.loading ? {} : st(), { current: S.place }), 'updateMap');
}

/* ----------------------------------------------------------- clock, quiet */

// The clock tag and the quiet pill follow the same overrides as the painting:
// ?at= moves the whole clock; ?time= alone sets a typical hour for that period,
// so a review shot of the night scene also reads night on the tag.
const PERIOD_HOUR = { morning: [7, 40], day: [13, 20], sunset: [18, 40], night: [23, 10] };
function nowish() {
  const n = clock.now();
  if (param('at')) return n;
  const want = PERIOD_HOUR[param('time')];
  if (!want) return n;
  const [hh, mm] = clock.fmtTime(n).split(':').map(Number);
  let delta = (want[0] * 60 + want[1]) - (hh * 60 + mm);
  return new Date(n.getTime() + delta * 60000);
}

function ambience() {
  const n = clock.now();
  return { time: clock.period(n), season: clock.season(n), weather: weatherNow ? weatherNow.kind : undefined, quiet: S.quiet };
}

function updateQuiet(announce = true) {
  const n = nowish();
  const was = S.quiet;
  S.quiet = safe(() => clock.isQuiet(n, st().quiet || undefined), 'isQuiet') || false;
  document.documentElement.classList.toggle('is-quiet', S.quiet);
  setSoundQuiet(S.quiet);
  if (was && !S.quiet && announce) releaseHeld();
  return was !== S.quiet;
}

function clockTick() {
  const n = nowish();
  const changed = updateQuiet(true);
  renderTag({ day: clock.weekday(n), time: clock.fmtTime(n), weather: weatherNow, quiet: S.quiet, until: safe(() => clock.quietUntil(n, st().quiet || undefined)) });
  const p = clock.period(n);
  const s = clock.season(n);
  if (M.vista && (p !== lastPeriod || s !== lastSeason || changed)) safe(() => M.vista.setAmbience(ambience()), 'setAmbience');
  lastPeriod = p;
  lastSeason = s;
  if (changed) renderScene();
  if (S.open === 'floors' || S.open === 'brief') refreshOpen();
}

async function refreshWeather() {
  try {
    weatherNow = (await clock.weather()) || null;
  } catch (e) {
    weatherNow = null;
  }
  const n = nowish();
  renderTag({ day: clock.weekday(n), time: clock.fmtTime(n), weather: weatherNow, quiet: S.quiet, until: safe(() => clock.quietUntil(n, st().quiet || undefined)) });
  if (M.vista) safe(() => M.vista.setAmbience(ambience()), 'setAmbience');
}

/* ---------------------------------------------------------------- travel */

async function travel(id, { fromMap = false, quiet = false } = {}) {
  if (!PLACE[id]) return;
  const same = id === S.place;
  S.place = id;
  store(LAST_PLACE, id);
  if (fromMap && isPhone()) toggleMap(false);
  if (!same) {
    if (M.vista) safe(() => M.vista.showPlace(id), 'showPlace');
    renderCaption(id, { animate: true });
    // the crowd swaps while the old view fades out
    setTimeout(renderScene, reducedMotion() ? 0 : 600);
    if (M.map) safe(() => M.map.updateMap(st(), { current: id }), 'updateMap');
  }
  if (S.open && S.open.startsWith('place:') && S.open !== `place:${id}`) openView(`place:${id}`);
  else if (!quiet && fromMap && !isPhone() && S.open == null && same) openView(`place:${id}`);
}

function toggleMap(open, opener) {
  const root = document.documentElement;
  const on = open == null ? !root.classList.contains('map-open') : open;
  if (on) {
    mapOpener = opener || document.activeElement;
    if (currentSheet()) closeSheet({ silent: true });
    root.classList.add('map-open');
    $('#map').setAttribute('aria-modal', 'true');
    setPressed('map');
    setTimeout(() => $('#map-close').focus({ preventScroll: true }), 60);
  } else if (root.classList.contains('map-open')) {
    root.classList.remove('map-open');
    $('#map').removeAttribute('aria-modal');
    setPressed(null);
    if (mapOpener && document.contains(mapOpener)) mapOpener.focus({ preventScroll: true });
  }
}

/* ----------------------------------------------------------------- views */

const act = {
  open: (view, opts) => openView(view, opts),
  close: () => closeSheet(),
  openBot: (id) => openBot(id),
  openDraft: (d, place) => openView('draft', { draft: d, from: place ? `place:${place}` : S.open, fromArgs: place ? {} : { place: viewArgs.place } }),
  copyDraft: async (d, btn) => {
    const text = [clean(d.title), clean(d.text || d.body || '')].filter(Boolean).join('\n\n');
    const ok = await copyText(`DRAFT\n${text}`);
    say(ok ? COPY.msg.copied : COPY.error.copy, { force: true });
    if (ok && btn) flash(btn, 'Copied');
  },
  approve: async (d, btn) => {
    try {
      if (M.data && typeof M.data.approve === 'function') await M.data.approve(d.id);
      say(COPY.msg.approved, { force: true });
      if (btn) {
        btn.disabled = true;
        const t = btn.querySelector('span:last-child');
        if (t) t.textContent = 'Approved';
      }
    } catch (e) {
      say(COPY.error.answer, { force: true });
    }
  },
  order: (place, text) => sendOrder(place, text),
  answer: (q, text) => answer(q, text),
  stop: async (b) => {
    const name = clean(b.name) || (BOT[b.core] || {}).name || 'The bot';
    try {
      if (M.data && typeof M.data.stopBot === 'function') await M.data.stopBot(b.id);
      else await sendOrder(b.place || 'town', `Stop ${name}${b.task ? `: ${clean(b.task)}` : ''}`, { silent: true });
    } catch (e) { /* the order fallback keeps it locally */ }
    say(COPY.msg.stopped(name), { force: true });
  },
  need: (item) => {
    const q = questions().find((x) => String(x.id) === String(item && item.link));
    openView('questions', { focus: q ? q.id : null });
  },
  path: async (text, btn) => {
    const ok = await sendOrder('town', `Next path: ${text}`, { silent: true });
    if (btn && ok !== false) {
      btn.disabled = true;
      btn.textContent = 'Saved for next loop';
    }
    say(COPY.msg.orderSaved, { force: true });
  },
  sound: (v) => setSound(v),
  motion: (v) => {
    document.documentElement.classList.toggle('reduce-motion', v);
    renderScene();
  },
};

function flash(btn, text) {
  const t = btn.querySelector('span:last-child') || btn;
  const old = t.textContent;
  t.textContent = text;
  setTimeout(() => { t.textContent = old; }, 1600);
}

async function sendOrder(place, text, { silent = false } = {}) {
  let saved = 'local';
  try {
    if (M.data && typeof M.data.sendOrder === 'function') {
      const r = await M.data.sendOrder({ place, text });
      if (r && r.ok === false) throw new Error('not saved');
      saved = (r && r.saved) || 'local';
    } else {
      const list = store(LOCAL_ORDERS) || [];
      list.push({ place, text, at: new Date().toISOString() });
      store(LOCAL_ORDERS, list);
    }
  } catch (e) {
    const list = store(LOCAL_ORDERS) || [];
    list.push({ place, text, at: new Date().toISOString() });
    store(LOCAL_ORDERS, list);
    if (!silent) say(COPY.error.order, { force: true });
    return true;
  }
  if (!silent) say(saved === 'engine' ? COPY.msg.orderSaved : COPY.msg.orderLocal, { force: true });
  return true;
}

async function answer(q, text) {
  try {
    if (M.data && typeof M.data.answerQuestion === 'function') await M.data.answerQuestion(q.id, text);
    else {
      const list = store('sao.ui.answers.local.v1') || [];
      list.push({ id: q.id, answer: text, at: new Date().toISOString() });
      store('sao.ui.answers.local.v1', list);
    }
    say(COPY.msg.answered, { force: true });
  } catch (e) {
    say(COPY.error.answer, { force: true });
  }
  // the card folds away; the question leaves the state after its fold
  setTimeout(() => {
    const s = st();
    if (Array.isArray(s.questions)) s.questions = s.questions.filter((x) => x.id !== q.id);
    safe(renderBadges, 'badges');
    safe(renderStatus, 'status');
    if (M.map) safe(() => M.map.updateMap(st(), { current: S.place }), 'updateMap');
    refreshOpen();
  }, 1500);
  return true;
}

function openBot(id) {
  if (id === 'icon') {
    openView('report');
    return;
  }
  const b = botById(id);
  openView('bots', { focus: b ? b.id : id });
}

function viewSpec(view, args) {
  if (view.startsWith('place:')) {
    const id = view.slice(6);
    const p = PLACE[id];
    if (!p) return null;
    return { kind: 'panel', title: p.name, sub: p.ref, symbol: p.symbol, render: () => placeView(id, act), className: 'is-place' };
  }
  switch (view) {
    case 'report': {
      const t = reportTitle();
      return { kind: 'modal', title: t.title, sub: t.sub, symbol: 'compass', render: () => reportView(act), className: 'is-report' };
    }
    case 'brief': {
      const t = briefTitle();
      return { kind: 'modal', title: t.title, sub: t.sub, render: () => briefView(act, { now: clock.now() }), className: 'is-brief' };
    }
    case 'floors':
      return { kind: 'modal', title: 'The tower of floors', sub: 'Term progress and the parallel climbs', symbol: 'crest', render: () => floorsView(act, { now: clock.now(), initial: args.tab }), className: 'is-floors' };
    case 'bots':
      return { kind: 'panel', title: 'Bots', sub: 'Your found family at work', symbol: 'bots', render: () => botsView(act, { focus: args.focus }) };
    case 'drafts':
      return { kind: 'panel', title: 'Drafts', sub: args.place ? placeName(args.place) : 'Everything your bots wrote', symbol: 'drafts', render: () => draftsView(act, { place: args.place }) };
    case 'draft': {
      const d = args.draft || {};
      const from = args.from;
      return {
        kind: 'panel',
        title: clean(d.title) || 'Draft',
        sub: placeName(d.place) || 'Draft',
        back: from ? { label: 'Back', onBack: () => openView(from, args.fromArgs || {}) } : null,
        render: () => draftView(d, act),
      };
    }
    case 'questions':
      return { kind: 'panel', title: 'Questions', sub: 'At most 3 at a time', symbol: 'questions', render: () => questionsView(act) };
    case 'rules':
      return { kind: 'panel', title: 'Rules', sub: 'The charter stone', symbol: 'rules', render: () => rulesView(act), className: 'is-rules' };
    case 'settings':
      return { kind: 'panel', title: 'Settings', sub: 'Saved on this device', symbol: 'settings', render: () => settingsView(act) };
    case 'menu':
      return { kind: 'panel', title: 'Menu', sub: '', render: () => [menuGrid((id, btn) => openView(id, {}, btn), S.counts || {})], className: 'is-menu' };
    default:
      return null;
  }
}

async function openView(view, args = {}, opener) {
  if (view === 'map') {
    toggleMap(true, opener);
    return;
  }
  if (document.documentElement.classList.contains('map-open')) toggleMap(false);
  if (view.startsWith('place:')) {
    const id = view.slice(6);
    if (PLACE[id] && id !== S.place) travel(id, { quiet: true });
  }
  const spec = viewSpec(view, args);
  if (!spec) return;
  viewArgs = { ...args };
  S.open = view;
  document.documentElement.dataset.panel = view;
  setPressed(view);
  const handle = await openSheet({ ...spec, id: view, opener: opener || undefined });
  refill(handle, safe(spec.render, `render ${view}`) || []);
  handle.render = spec.render;
  showSheet(handle);
  if (view === 'bots' && args.focus) scrollToCard(handle, `[data-bot="${cssEsc(args.focus)}"]`);
  if (view === 'questions' && args.focus) scrollToCard(handle, `[data-q="${cssEsc(args.focus)}"]`);
  if (view === 'brief') store(BRIEF_DAY, clock.fmtDate(clock.now()));
}

function cssEsc(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function scrollToCard(handle, sel) {
  setTimeout(() => {
    const el = handle.body.querySelector(sel);
    if (!el) return;
    el.classList.add('is-lit');
    el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, 120);
}

// Re-render the open view after new state, unless Wahb is typing in it.
function refreshOpen() {
  const c = currentSheet();
  if (!c || !c.render) return;
  const active = document.activeElement;
  const typing = active && c.el.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') && active.value;
  if (typing) {
    dirty = true;
    return;
  }
  if (c.el.querySelector('.qcard.is-answered')) return;
  refill(c, safe(c.render, 'refresh') || []);
  dirty = false;
}

function openFromParam(v) {
  if (v.startsWith('place:')) openView(v);
  else if (['report', 'brief', 'floors', 'rules', 'settings', 'bots', 'drafts', 'questions', 'map', 'menu'].includes(v)) openView(v);
}

// The morning brief: on the first open after 7:00 each day, never in quiet hours.
function maybeBrief() {
  const n = clock.now();
  const [hh] = clock.fmtTime(n).split(':').map(Number);
  if (S.quiet || hh < 7) return;
  // ?brief=0 (and ?intro=0, used by screenshots and tests) land on the world itself
  if (param('brief') === '0' || param('intro') === '0') return;
  if (store(BRIEF_DAY) === clock.fmtDate(n)) return;
  if (!st().brief) return;
  openView('brief');
}

/* -------------------------------------------------------------- activity */

function wireActivity() {
  let last = 0;
  const ping = () => {
    wake();
    const t = Date.now();
    if (t - last < 20000) return;
    last = t;
    if (M.data && typeof M.data.pingActivity === 'function') safe(() => M.data.pingActivity(), 'pingActivity');
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, ping, { passive: true });
  window.addEventListener('pointermove', () => wake(), { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !currentSheet() && document.documentElement.classList.contains('map-open')) toggleMap(false);
  });
  document.addEventListener('focusout', () => {
    if (dirty) setTimeout(() => { if (dirty) refreshOpen(); }, 0);
  });
}

subscribe((what) => {
  if (what === 'prefs') document.documentElement.classList.toggle('reduce-motion', !!S.prefs.reduceMotion);
});

$('#world-retry') && $('#world-retry').addEventListener('click', () => loadWorld());

boot().catch((e) => {
  console.error('[sao] boot failed', e);
  const err = $('#world-error');
  if (err) err.hidden = false;
});
