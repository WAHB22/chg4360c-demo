// SAO clock: real Toronto time, period of day, season, quiet hours, weather.
// Everything is computed for America/Toronto. Overrides for testing come from
// the page URL: ?at=ISO, ?time=morning|day|sunset|night, ?season=..., ?weather=...
// Nothing in this module throws.

const TZ = 'America/Toronto';
const PERIODS = ['morning', 'day', 'sunset', 'night'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const KINDS = ['clear', 'clouds', 'rain', 'snow', 'fog'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Weather never comes from a third party in the browser: the engine answers
// /api/weather (Open-Meteo fetched on the laptop, cached 30 min), and the demo
// uses the stable weather that ships in demo/state.json.
const CACHE_KEY = 'sao.weather.v2';
const CACHE_MS = 20 * 60 * 1000;

function param(name) {
  try {
    if (typeof location === 'undefined' || !location.search) return null;
    const v = new URLSearchParams(location.search).get(name);
    return v == null || v === '' ? null : v;
  } catch (e) {
    return null;
  }
}

let fmt = null;
function parts(date) {
  const d = date instanceof Date && !isNaN(date) ? date : now();
  try {
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', weekday: 'short',
      });
    }
    const out = {};
    for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
    const hour = Number(out.hour) % 24;
    return {
      year: Number(out.year), month: Number(out.month) - 1, day: Number(out.day),
      hour, minute: Number(out.minute), weekday: DAYS.indexOf(out.weekday),
    };
  } catch (e) {
    return {
      year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay(),
    };
  }
}

function toMin(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return fallback;
  return (Number(m[1]) % 24) * 60 + Math.min(59, Number(m[2]));
}

function within(m, start, end) {
  if (start === end) return false;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

// Real time, with an optional ?at=ISO override (the clock keeps running from it).
const bootReal = Date.now();
export function now() {
  try {
    const at = param('at');
    if (at) {
      const t = new Date(at);
      if (!isNaN(t)) return new Date(t.getTime() + (Date.now() - bootReal));
    }
  } catch (e) { /* fall through */ }
  return new Date();
}

export function period(date) {
  const o = param('time');
  if (o && PERIODS.includes(o)) return o;
  const p = parts(date);
  const m = p.hour * 60 + p.minute;
  if (m >= 300 && m < 540) return 'morning';
  if (m >= 540 && m < 1020) return 'day';
  if (m >= 1020 && m < 1200) return 'sunset';
  return 'night';
}

export function season(date) {
  const o = param('season');
  if (o && SEASONS.includes(o)) return o;
  const mo = parts(date).month;
  if (mo === 11 || mo <= 1) return 'winter';
  if (mo <= 4) return 'spring';
  if (mo <= 7) return 'summer';
  return 'autumn';
}

// shifts: [{day:'Wed', start:'06:30', end:'14:00'}]. Also accepts the whole
// state.quiet object {nightStart, nightEnd, shifts}.
export function isQuiet(date, shifts) {
  try {
    let list = shifts;
    let ns = 22 * 60;
    let ne = 7 * 60;
    if (shifts && !Array.isArray(shifts) && typeof shifts === 'object') {
      ns = toMin(shifts.nightStart, ns);
      ne = toMin(shifts.nightEnd, ne);
      list = shifts.shifts;
    }
    const p = parts(date);
    const m = p.hour * 60 + p.minute;
    if (within(m, ns, ne)) return true;
    if (Array.isArray(list)) {
      for (const s of list) {
        if (!s) continue;
        const day = DAYS.indexOf(String(s.day || '').slice(0, 3));
        const a = toMin(s.start, null);
        const b = toMin(s.end, null);
        if (a == null || b == null) continue;
        if (a < b) {
          if (day === p.weekday && m >= a && m < b) return true;
        } else if (a > b) {
          // overnight shift: starts on its day, ends the next morning
          if (day === p.weekday && m >= a) return true;
          if ((day + 1) % 7 === p.weekday && m < b) return true;
        }
      }
    }
  } catch (e) { /* not quiet */ }
  return false;
}

export function quietUntil(date, shifts) {
  // label helper for the moon tag, for example 'Quiet hours until 7:00'
  try {
    const p = parts(date);
    const m = p.hour * 60 + p.minute;
    let ne = 7 * 60;
    let ns = 22 * 60;
    let list = shifts;
    if (shifts && !Array.isArray(shifts) && typeof shifts === 'object') {
      ns = toMin(shifts.nightStart, ns);
      ne = toMin(shifts.nightEnd, ne);
      list = shifts.shifts;
    }
    if (within(m, ns, ne)) return `${Math.floor(ne / 60)}:${String(ne % 60).padStart(2, '0')}`;
    if (Array.isArray(list)) {
      for (const s of list) {
        const day = DAYS.indexOf(String((s && s.day) || '').slice(0, 3));
        const a = toMin(s && s.start, null);
        const b = toMin(s && s.end, null);
        if (a == null || b == null) continue;
        if ((day === p.weekday && m >= a && (a > b || m < b)) || (a > b && (day + 1) % 7 === p.weekday && m < b)) {
          return s.end;
        }
      }
    }
  } catch (e) { /* none */ }
  return null;
}

export function fmtTime(date) {
  const p = parts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function fmtDate(date) {
  const p = parts(date);
  const wd = DAYS[p.weekday] || '';
  return `${wd} ${MONTHS[p.month] || ''} ${p.day}`.trim();
}

// Toronto weekday short name, for example 'Sat'.
export function weekday(date) {
  return DAYS[parts(date).weekday] || '';
}

const LABELS = { clear: 'Clear', clouds: 'Cloudy', rain: 'Rain', snow: 'Snow', fog: 'Fog' };

function readCache() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !v.data || typeof v.at !== 'number') return null;
    return v;
  } catch (e) {
    return null;
  }
}

function writeCache(data, base) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), base, data }));
  } catch (e) { /* storage blocked */ }
}

let inflight = null;
let dataMod = null;

async function dataModule() {
  if (!dataMod) dataMod = import('./data.js').catch(() => null);
  return dataMod;
}

function clean(w) {
  if (!w || typeof w !== 'object' || !KINDS.includes(w.kind)) return null;
  const t = Number(w.tempC);
  return { kind: w.kind, tempC: w.tempC != null && isFinite(t) ? Math.round(t) : null, label: String(w.label || LABELS[w.kind]).slice(0, 40) };
}

export async function weather() {
  try {
    const o = param('weather');
    if (o && KINDS.includes(o)) return { kind: o, tempC: null, label: LABELS[o] };
    const d = await dataModule();
    const base = d && typeof d.engineBase === 'function' ? d.engineBase() : null;
    if (!base) {
      // demo mode (static deployment, ?demo=1, or no engine): the same answer every load
      return d && typeof d.demoWeather === 'function' ? clean(await d.demoWeather()) : null;
    }
    const cached = readCache();
    if (cached && cached.base === base && Date.now() - cached.at < CACHE_MS) return cached.data;
    if (typeof fetch !== 'function') return cached ? cached.data : null;
    if (!inflight) {
      inflight = (async () => {
        let timer = null;
        try {
          const ctl = typeof AbortController === 'function' ? new AbortController() : null;
          if (ctl) timer = setTimeout(() => ctl.abort(), 10000);
          const res = await fetch(`${base}/weather`, { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
          if (!res.ok) return cached ? cached.data : null;
          const j = await res.json();
          const data = clean(j && j.weather);
          if (data) writeCache(data, base);
          return data || (cached ? cached.data : null);
        } catch (e) {
          return cached ? cached.data : null;
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      inflight.finally(() => { inflight = null; });
    }
    return await inflight;
  } catch (e) {
    return null;
  }
}

// Calls cb() at the start of each minute. Returns a function that stops it.
export function onTick(cb) {
  if (typeof cb !== 'function') return () => {};
  let stopped = false;
  let interval = null;
  const fire = () => { if (!stopped) { try { cb(); } catch (e) { /* keep ticking */ } } };
  const ms = 60000 - (Date.now() % 60000) + 50;
  const first = setTimeout(() => {
    fire();
    interval = setInterval(fire, 60000);
  }, ms);
  return () => {
    stopped = true;
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
