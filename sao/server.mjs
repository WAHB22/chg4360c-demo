// SAO local engine. Serves the painted world from ./public and a small JSON API
// that reads and writes ICON's files one level up (the repo root on Wahb's
// laptop). Node 20 or newer, no dependencies. Binds to 127.0.0.1 only.
//
//   GET  /api/state     world state (world.json, overlaid with orders.json and drafts/)
//   GET  /api/memory    memory.md as plain text
//   POST /api/order     {place, text}          appends to orders.json orders
//   POST /api/answer    {id, answer}           records an answer on a question
//   POST /api/approve   {id}                   records an approval
//   POST /api/activity  {}                     writes last-activity.json
//
// Rules: JSON bodies only, at most 64 KB; never crash on missing or malformed
// files; never overwrite a file it could not parse; never log file contents.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PLACE } from './public/js/places.js';
import { BOT } from './public/js/bots.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const ROOT = path.resolve(HERE, '..');
const FILES = {
  world: path.join(ROOT, 'world.json'),
  orders: path.join(ROOT, 'orders.json'),
  memory: path.join(ROOT, 'memory.md'),
  activity: path.join(ROOT, 'last-activity.json'),
  drafts: path.join(ROOT, 'drafts'),
};

const HOST = '127.0.0.1';
const PORT = toPort(process.env.SAO_PORT) || 3210;
const MAX_BODY = 64 * 1024;
const MAX_QUESTIONS = 3; // the charter: at most 3 questions at once
const MAX_DRAFT_TEXT = 20000;
const TZ = 'America/Toronto';

// Origins allowed to call the API from another site (the Vercel deployment).
const EXTRA_ORIGINS = new Set(
  String(process.env.SAO_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[^/\s]+$/i.test(s))
    .map((s) => s.toLowerCase()),
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-site',
};

/* ------------------------------------------------------------- helpers */

function toPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 0;
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function str(v, max = 2000) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

const fmtParts = (d, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...opts }).formatToParts(d).map((p) => [p.type, p.value]));

// 'Sat Oct 24'
function fmtDay(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const p = fmtParts(d, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${p.weekday.replace('.', '')} ${p.month.replace('.', '')} ${p.day}`;
}

// 'Sat Oct 24 14:05'
function fmtStamp(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const p = fmtParts(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${fmtDay(d)} ${p.hour}:${p.minute}`;
}

// ISO with the Toronto offset, for generatedAt
function isoToronto(d = new Date()) {
  const p = fmtParts(d, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

async function readText(file, max = 512 * 1024) {
  try {
    const fh = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(max);
      const { bytesRead } = await fh.read(buf, 0, max, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

// {ok:true, data} | {ok:false, missing:true} | {ok:false, bad:true}
async function readJSON(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    return { ok: false, missing: e && e.code === 'ENOENT' };
  }
  try {
    return { ok: true, data: JSON.parse(text.replace(/^﻿/, '')) };
  } catch {
    return { ok: false, bad: true };
  }
}

async function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
}

// One write at a time, so two taps never lose an order.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/* -------------------------------------------------------- place guesses */

// Keyword guesses, most specific first. Each maps to a place and its bot.
const GUESSES = [
  [/social.?events?|tournament|soccer|7v7|run.?club|event|kiosk|\bport\b|club/, 'fields', 'herald'],
  [/trailer|bobino|bagel|caf[eé]|manager|wagon/, 'bobino', 'baker'],
  [/intern|linkedin|career|resume|\bcv\b|job|recruit|cover.?letter|tower/, 'tower', 'scout'],
  [/social|instagram|tiktok|reel|content|studio|animation|faceless|lighthouse/, 'lighthouse', 'bard'],
  [/money|bank|budget|vault|finance|saving|invest/, 'vault', 'steward'],
  [/\bgym\b|workout|training|lift/, 'gym', 'keeper'],
  [/grocer|costco|market|shopping/, 'market', 'keeper'],
  [/meal|kitchen|recipe|cook|food/, 'kitchen', 'keeper'],
  [/\bhome\b|chore|rest|sleep|idea.?desk/, 'home', 'keeper'],
  [/ch[gm].?\d{4}|gng.?\d{4}|school|course|exam|midterm|quiz|final|study|assignment|lab|deadline|campus|class|lecture/, 'campus', 'scholar'],
];

function guessPlace(text) {
  const t = String(text || '').toLowerCase();
  for (const [re, place, bot] of GUESSES) if (re.test(t)) return { place, bot };
  return { place: 'town', bot: 'icon' };
}

const KIND = { campus: 'study', tower: 'outreach', bobino: 'pitch', fields: 'event', lighthouse: 'content', vault: 'money', gym: 'training', kitchen: 'meal', market: 'list', home: 'idea', town: 'note' };

/* --------------------------------------------------------------- state */

function questionCard(q) {
  if (!isObj(q)) return null;
  const text = str(q.text, 1200);
  if (!text) return null;
  const g = guessPlace(q.for);
  const place = PLACE[q.place] ? q.place : g.place;
  const from = BOT[q.from] ? q.from : g.bot;
  const options = arr(q.options)
    .map((o) => (typeof o === 'string' ? o : isObj(o) ? o.label || o.text || '' : ''))
    .map((o) => str(o, 200))
    .filter(Boolean)
    .slice(0, 4);
  const asked = q.askedAt ? new Date(q.askedAt) : null;
  const card = {
    id: String(q.id),
    from,
    place,
    text,
    options,
    guess: options.length ? (Number.isInteger(q.guess) && q.guess >= 0 && q.guess < options.length ? q.guess : 0) : null,
    askedAt: asked && !Number.isNaN(asked.getTime()) ? fmtDay(asked) : str(q.askedAt, 40),
    must: q.must === true,
  };
  if (q.for) card.project = str(String(q.for), 60);
  return card;
}

function isAnswered(q) {
  return isObj(q) && (q.answer != null || q.answeredAt != null || ['answered', 'closed', 'done'].includes(String(q.status || '').toLowerCase()));
}

async function readDrafts() {
  let names = [];
  try {
    names = (await fs.readdir(FILES.drafts, { withFileTypes: true })).filter((e) => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.slice(0, 200)) {
    const file = path.join(FILES.drafts, name);
    let st;
    try {
      st = await fs.stat(file);
    } catch {
      continue;
    }
    const raw = (await readText(file, 256 * 1024)) || '';
    const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
    let title = '';
    let place = '';
    let kind = '';
    let byline = null;
    const body = [];
    for (const line of lines) {
      const head = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      const pl = /^\s*place\s*:\s*([a-z]+)\s*$/i.exec(line);
      const kd = /^\s*kind\s*:\s*([a-z ]{2,24})\s*$/i.exec(line);
      const by = /^\s*DRAFT,?\s+by\s+(.+?)\s*(?:\(([^)]+)\))?\s*$/i.exec(line);
      if (!byline && by) { byline = { role: by[1], model: by[2] || '' }; continue; }
      if (!title && head) { title = head[1]; continue; }
      if (!place && pl && PLACE[pl[1].toLowerCase()]) { place = pl[1].toLowerCase(); continue; }
      if (!kind && kd) { kind = kd[1].trim().toLowerCase(); continue; }
      body.push(line);
    }
    const stem = name.replace(/\.md$/i, '');
    if (!title) title = stem.replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/[-_]+/g, ' ').trim() || stem;
    if (!place) place = guessPlace(stem).place;
    out.push({
      id: `file:${stem}`,
      title: str(title, 160),
      time: fmtStamp(st.mtime),
      kind: kind || KIND[place] || 'note',
      text: body.join('\n').trim().slice(0, MAX_DRAFT_TEXT),
      file: `drafts/${name}`,
      ...(byline ? { by: str(byline.role, 60), model: str(byline.model, 60) } : {}),
      place,
      mtimeMs: st.mtimeMs,
    });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

async function buildState() {
  const world = await readJSON(FILES.world);
  const base = world.ok && isObj(world.data) ? world.data : {};
  const state = { ...base };
  state.mode = 'live';
  // stable between polls: the newest of ICON's files when world.json gives no time
  if (typeof base.generatedAt !== 'string') {
    const times = await Promise.all([FILES.world, FILES.orders, FILES.drafts].map((f) => fs.stat(f).then((s) => s.mtimeMs, () => 0)));
    const newest = Math.max(...times);
    state.generatedAt = isoToronto(newest ? new Date(newest) : new Date());
  }
  const notes = [];
  if (!world.ok) notes.push(world.bad ? 'world.json could not be read' : 'world.json not written yet');

  // questions: orders.json is the live queue; world.json questions fill in
  const orders = await readJSON(FILES.orders);
  if (orders.ok === false && orders.bad) notes.push('orders.json could not be read');
  const od = orders.ok && isObj(orders.data) ? orders.data : {};
  const answeredIds = new Set(arr(od.answers).filter(isObj).map((a) => String(a.id)));
  const seen = new Set();
  const open = [];
  for (const q of [...arr(od.questions), ...arr(base.questions)]) {
    if (!isObj(q) || q.id == null || seen.has(String(q.id))) continue;
    seen.add(String(q.id));
    if (isAnswered(q) || answeredIds.has(String(q.id))) continue;
    const card = questionCard(q);
    if (card) open.push(card);
  }
  open.sort((a, b) => Number(b.must) - Number(a.must));
  state.questions = open.slice(0, MAX_QUESTIONS);
  state.questionsWaiting = open.length;

  // drafts from drafts/*.md join each place's drafts
  const places = isObj(base.places) ? Object.fromEntries(Object.entries(base.places).map(([k, v]) => [k, isObj(v) ? { ...v } : {}])) : {};
  for (const d of await readDrafts()) {
    const { place, mtimeMs, ...draft } = d;
    const info = places[place] || (places[place] = {});
    const list = arr(info.drafts).slice();
    if (!list.some((x) => isObj(x) && String(x.id) === draft.id)) list.push(draft);
    info.drafts = list;
    if (!info.status) info.status = 'active';
  }
  for (const q of state.questions) {
    const info = places[q.place] || (places[q.place] = {});
    if (!info.status || info.status === 'active' || info.status === 'idle') info.status = 'waiting';
  }
  state.places = places;

  const queued = arr(od.orders).filter((o) => isObj(o) && String(o.status || '').toLowerCase() === 'queued').length;
  state.engine = { ordersQueued: queued, notes };
  return state;
}

/* ----------------------------------------------------------------- http */

function isLocalOrigin(origin) {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function originAllowed(origin) {
  if (!origin) return true; // same origin navigation or a local tool
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' || u.protocol === 'https:') && (host === '127.0.0.1' || host === 'localhost' || host === '[::1]')) return true;
  return EXTRA_ORIGINS.has(`${u.protocol}//${u.host}`.toLowerCase());
}

// DNS rebinding guard: only answer requests addressed to this machine by name.
function hostAllowed(hostHeader) {
  const h = String(hostHeader || '').toLowerCase();
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !originAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  const payload = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY,
    'Content-Type': isText ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (!type.startsWith('application/json')) {
      reject(Object.assign(new Error('JSON bodies only'), { status: 415 }));
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      reject(Object.assign(new Error('Body too large'), { status: 413 }));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) {
        done = true;
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        if (!isObj(v)) throw new Error('not an object');
        resolve(v);
      } catch {
        reject(Object.assign(new Error('Malformed JSON'), { status: 400 }));
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      reject(Object.assign(new Error('Read error'), { status: 400 }));
    });
  });
}

// Loads orders.json for a change; a missing file starts empty, a broken one is left alone.
async function editOrders(change) {
  return serial(async () => {
    const r = await readJSON(FILES.orders);
    if (!r.ok && !r.missing) throw Object.assign(new Error('orders.json could not be read, nothing was changed'), { status: 409 });
    const data = r.ok && isObj(r.data) ? r.data : {};
    if (r.ok && !isObj(r.data)) throw Object.assign(new Error('orders.json has an unexpected shape, nothing was changed'), { status: 409 });
    for (const k of ['questions', 'approvals', 'orders']) if (!Array.isArray(data[k])) data[k] = arr(data[k]);
    const result = change(data);
    await writeJSON(FILES.orders, data);
    return result;
  });
}

const API = {
  'GET /api/state': async () => [200, await buildState()],

  // memory.md is for this laptop only: never answered to another origin
  'GET /api/memory': async (body, req) => {
    if (req.headers.origin && !isLocalOrigin(req.headers.origin)) return [403, { ok: false, error: 'memory.md is only shown on this laptop' }];
    const text = await readText(FILES.memory, 1024 * 1024);
    if (text == null) return [404, { ok: false, error: 'memory.md not found' }];
    return [200, text, { 'Content-Type': 'text/markdown; charset=utf-8' }];
  },

  'POST /api/order': async (body) => {
    const text = str(body.text, 2000);
    if (!text) return [400, { ok: false, error: 'An order needs text' }];
    const place = PLACE[body.place] ? body.place : 'town';
    const order = { id: newId('w'), place, text, at: new Date().toISOString(), status: 'queued', source: 'world' };
    await editOrders((d) => d.orders.push(order));
    return [200, { ok: true, saved: 'engine', id: order.id }];
  },

  'POST /api/answer': async (body) => {
    const id = str(body.id == null ? '' : String(body.id), 200);
    const answer = str(typeof body.answer === 'number' ? String(body.answer) : body.answer, 2000);
    if (!id || !answer) return [400, { ok: false, error: 'An answer needs id and answer' }];
    const at = new Date().toISOString();
    const where = await editOrders((d) => {
      const q = d.questions.find((x) => isObj(x) && String(x.id) === id);
      if (q) {
        q.answer = answer;
        q.answeredAt = at;
        q.answeredVia = 'world';
        return 'question';
      }
      // a question that only lives in world.json: keep the answer beside the queue
      if (!Array.isArray(d.answers)) d.answers = [];
      d.answers.push({ id, answer, at, source: 'world' });
      return 'answers';
    });
    return [200, { ok: true, saved: 'engine', recorded: where }];
  },

  'POST /api/approve': async (body) => {
    const id = str(body.id == null ? '' : String(body.id), 200);
    if (!id) return [400, { ok: false, error: 'An approval needs id' }];
    const at = new Date().toISOString();
    const where = await editOrders((d) => {
      const a = d.approvals.find((x) => isObj(x) && String(x.id) === id) || d.approvals.find((x) => isObj(x) && x.source === 'world' && String(x.for) === id);
      if (a) {
        a.status = 'approved';
        a.approvedAt = at;
        a.approvedVia = 'world';
        return 'updated';
      }
      d.approvals.push({ id: newId('a'), for: id, status: 'approved', approvedAt: at, source: 'world', note: str(body.note, 500) || undefined });
      return 'added';
    });
    return [200, { ok: true, saved: 'engine', recorded: where }];
  },

  'POST /api/activity': async () => {
    const t = Date.now();
    await serial(() => writeJSON(FILES.activity, { lastActivity: new Date(t).toISOString(), epochMs: t, source: 'world' }));
    return [200, { ok: true }];
  },
};

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { ok: false, error: 'Bad path' });
  }
  if (rel.includes('\0') || rel.includes('\\')) return send(res, 400, { ok: false, error: 'Bad path' });
  // no dotfiles, no climbing out of public
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return send(res, 404, 'Not found');
  let file = path.resolve(PUBLIC, `.${path.posix.normalize(`/${rel}`)}`);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found');

  let st = await fs.stat(file).catch(() => null);
  if (st && st.isDirectory()) {
    file = path.join(file, 'index.html');
    st = await fs.stat(file).catch(() => null);
  } else if (!st && !path.extname(file)) {
    // clean URLs: /recap serves recap.html
    const alt = `${file}.html`;
    const s2 = await fs.stat(alt).catch(() => null);
    if (s2) {
      file = alt;
      st = s2;
    }
  }
  if (!st || !st.isFile()) return send(res, 404, 'Not found');
  // symlinks must not lead outside public either
  const real = await fs.realpath(file).catch(() => null);
  const realPublic = await fs.realpath(PUBLIC).catch(() => PUBLIC);
  if (!real || (real !== realPublic && !real.startsWith(realPublic + path.sep))) return send(res, 404, 'Not found');

  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    ...SECURITY,
    'Content-Type': type,
    'Content-Length': String(st.size),
    'Cache-Control': /^image\/|^audio\/|^video\//.test(type) ? 'public, max-age=3600' : 'no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...SECURITY, ETag: etag, 'Cache-Control': headers['Cache-Control'] });
    return res.end();
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const fh = await fs.open(real, 'r').catch(() => null);
  if (!fh) return res.end();
  const stream = fh.createReadStream();
  stream.on('error', () => res.destroy());
  stream.on('close', () => fh.close().catch(() => {}));
  stream.pipe(res);
}

async function handle(req, res) {
  if (!hostAllowed(req.headers.host)) return send(res, 421, { ok: false, error: 'Unknown host' });
  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    return send(res, 400, { ok: false, error: 'Bad request' });
  }
  const pathname = url.pathname;

  // A static host serves public/engine.json ({"engine": false}); the engine
  // answers the same path with true, so the page only calls /api where one is.
  if (pathname === '/engine.json' && (req.method === 'GET' || req.method === 'HEAD')) return send(res, 200, { engine: true, api: '/api' });
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const origin = req.headers.origin;
  const allowed = originAllowed(origin);
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    if (!allowed) return send(res, 403, { ok: false, error: 'Origin not allowed' });
    const pna = String(req.headers['access-control-request-private-network'] || '') === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {};
    res.writeHead(204, { ...SECURITY, ...cors, 'Access-Control-Allow-Private-Network': 'true', ...pna, 'Content-Length': '0' });
    return res.end();
  }
  // reads from a foreign origin get no data; writes are refused outright
  if (!allowed) return send(res, 403, { ok: false, error: 'Origin not allowed' });
  if (req.method === 'POST' && String(req.headers['sec-fetch-site'] || '') === 'cross-site' && !origin) return send(res, 403, { ok: false, error: 'Origin not allowed' });

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = API[`${method} ${pathname.replace(/\/+$/, '')}`];
  if (!route) {
    const known = Object.keys(API).some((k) => k.endsWith(` ${pathname.replace(/\/+$/, '')}`));
    return send(res, known ? 405 : 404, { ok: false, error: known ? 'Method not allowed' : 'Not found' }, cors);
  }
  let body = {};
  if (method === 'POST') {
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, e.status || 400, { ok: false, error: e.message }, cors);
    }
  }
  try {
    const [status, payload, extra] = await route(body, req);
    return send(res, status, payload, { ...cors, ...(extra || {}) });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    if (status === 500) console.error(`[sao] ${method} ${pathname} failed: ${e && e.code ? e.code : 'error'}`);
    return send(res, status, { ok: false, error: status === 500 ? 'The engine could not finish that' : e.message }, cors);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    try {
      if (!res.headersSent) send(res, 500, { ok: false, error: 'The engine could not finish that' });
      else res.destroy();
    } catch {
      /* the socket is already gone */
    }
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* gone */ }
});
server.on('error', (e) => {
  console.error(`[sao] could not start on ${HOST}:${PORT} (${e.code || 'error'})`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const extra = EXTRA_ORIGINS.size ? `, also answering ${[...EXTRA_ORIGINS].join(', ')}` : '';
  console.log(`[sao] the world is open at http://${HOST}:${PORT}${extra}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
