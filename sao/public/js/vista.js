// SAO vista: the painted view of the current place.
// Layers, back to front, inside a 16:9 canvas that covers the vista box:
//   stage   sky, drifting clouds, land (or the real painting), lights (pulse)
//   crowd   where characters.js draws the bots (crowdLayer())
//   front   dark soft foliage framing the corners
// then, over the whole vista: color grade per time, horizon haze, weather
// particles, paper grain, the hit area on the subject and a small tag while
// the real painting is still to come. Parallax follows the pointer (back 4 px,
// mid 8 px, front 14 px) with a little spring. Reduced motion turns every
// effect into a short fade or a still image.

import { PLACE } from './places.js';
import { paintPlace } from './scene.js';
import { weekday } from './clock.js';

const VW = 1600;
const VH = 900;
const BLEED = 22; // px of extra canvas so parallax never shows an edge
const TIMES = ['morning', 'day', 'sunset', 'night'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

let root = null;
let canvas = null;
let stagesEl = null;
let crowdEl = null;
let frontsEl = null;
let hitEl = null;
let gradeEl = null;
let hazeEl = null;
let wxEl = null;
let tagEl = null;
let onTap = null;

let current = null; // { id, stage, front, image }
let pendingId = null;
const amb = { time: 'day', season: 'autumn', weather: 'clear', quiet: false };
let quietTimer = null;
let swapTimer = null;
let travelToken = 0;
let geom = { w: 0, h: 0, cw: 0, ch: 0, left: 0, top: 0, scale: 1 };

const imageCache = new Map();

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!(mq && mq.matches);

/* ----------------------------------------------------------------- styles */

const CSS = `
.sv-vista{position:absolute;inset:0;overflow:hidden;background:#1B2230;isolation:isolate;contain:strict}
.sv-canvas{position:absolute;transform-origin:0 0}
.sv-group{position:absolute;inset:0;will-change:transform}
.sv-stage,.sv-frontwrap{position:absolute;inset:0;transform-origin:50% 52%;will-change:opacity,transform}
.sv-layer{position:absolute;inset:0}
.sv-sky,.sv-land{isolation:isolate;will-change:transform}
.sv-layer>svg,.sv-cloudstrip>svg,.sv-frontwrap>svg{display:block;width:100%;height:100%}
.sv-pic{display:block;width:100%;height:100%;user-select:none;-webkit-user-drag:none;pointer-events:none}
.sv-clouds{overflow:hidden}
.sv-cloudstrip{position:absolute;top:0;left:0;width:200%;height:100%;display:flex;will-change:transform;animation:svDrift var(--drift,60s) linear infinite}
.sv-cloudstrip>svg,.sv-cloudstrip>img{width:50%;flex:0 0 50%;height:100%}
.sv-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.sv-lights{mix-blend-mode:screen;transition:opacity 1.6s ease}
.sv-vista[data-glow="on"] .sv-lights{animation:svPulse var(--pulse,4s) ease-in-out infinite alternate}
.sv-lights .lw{transition:opacity .9s ease}
.sv-vista[data-quiet="on"] .sv-lights{opacity:.7}
.sv-crowd{position:absolute;inset:0;pointer-events:none}
.sv-crowd>*{pointer-events:auto}
.sv-fronts{pointer-events:none}
.sv-hit{position:absolute;background:transparent;border:0;padding:0;margin:0;cursor:pointer;border-radius:10px;min-width:44px;min-height:44px;-webkit-tap-highlight-color:transparent}
.sv-hit:focus{outline:none}
.sv-hit:focus-visible{outline:2px solid #E8C88E;outline-offset:4px}
.sv-grade,.sv-haze,.sv-grain,.sv-wx{position:absolute;inset:0;pointer-events:none}
.sv-grade{transition:background-color 2.4s ease,opacity 2.4s ease}
.sv-haze{transition:opacity 2.4s ease,background 2.4s ease}
.sv-grain{opacity:.05;mix-blend-mode:overlay;background-size:220px 220px}
.sv-tag{position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:rgba(27,34,48,.85);border:1px solid rgba(232,200,142,.6);color:#F3EFE6;font:13px/1.5 "Times New Roman",Georgia,serif;letter-spacing:.01em;pointer-events:none;opacity:0;transition:opacity .4s ease;white-space:nowrap}
.sv-vista[data-tag="on"] .sv-tag{opacity:.88}
.sv-wx i{position:absolute;top:0;display:block;will-change:transform}
.sv-wx .sv-rain{width:1.5px;height:var(--len,18px);background:linear-gradient(rgba(220,230,245,0),rgba(228,236,248,.7));animation:svRain var(--dur,.7s) linear infinite;animation-delay:var(--delay,0s)}
.sv-wx .sv-fall{animation:svFall var(--dur,12s) linear infinite;animation-delay:var(--delay,0s)}
.sv-wx .sv-fall>b{display:block;animation:svSway var(--sway,4s) ease-in-out infinite alternate;animation-delay:var(--delay,0s)}
.sv-wx .sv-flake{width:var(--size,4px);height:var(--size,4px);border-radius:50%;background:rgba(246,248,252,.9);box-shadow:0 0 4px rgba(246,248,252,.5)}
.sv-wx svg{display:block}
.sv-vista[data-paused="on"] *{animation-play-state:paused!important}
@keyframes svDrift{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}
@keyframes svPulse{from{opacity:.78}to{opacity:1}}
@keyframes svRain{from{transform:translate3d(0,-40px,0) rotate(12deg)}to{transform:translate3d(calc(var(--svh,900px) * -.21),calc(var(--svh,900px) + 40px),0) rotate(12deg)}}
@keyframes svFall{from{transform:translate3d(0,-30px,0)}to{transform:translate3d(var(--dx,0px),calc(var(--svh,900px) + 30px),0)}}
@keyframes svSway{from{transform:translate3d(calc(var(--amp,30px) * -1),0,0) rotate(calc(var(--rot,50deg) * -1))}to{transform:translate3d(var(--amp,30px),0,0) rotate(var(--rot,50deg))}}
@media (prefers-reduced-motion: reduce){
  .sv-cloudstrip,.sv-vista[data-glow="on"] .sv-lights{animation:none}
  .sv-wx{display:none}
  .sv-grade,.sv-haze,.sv-lights{transition-duration:.2s}
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('sao-vista-style')) return;
  const st = document.createElement('style');
  st.id = 'sao-vista-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const GRAIN = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.2 -.1'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
})();

/* ----------------------------------------------------------------- helpers */

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function kindOf(w) {
  const k = w && typeof w === 'object' ? w.kind : w;
  return ['clear', 'clouds', 'rain', 'snow', 'fog'].includes(k) ? k : 'clear';
}

function isWeekend() {
  try {
    const d = weekday();
    return d === 'Sat' || d === 'Sun';
  } catch (e) {
    return false;
  }
}

function assetUrl(id, time) {
  try {
    return new URL(`../assets/places/${id}-${time}.webp`, import.meta.url).href;
  } catch (e) {
    return `assets/places/${id}-${time}.webp`;
  }
}

function probe(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve) => {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = url;
    } catch (e) {
      resolve(false);
    }
  });
  imageCache.set(url, p);
  return p;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function animate(node, frames, ms, easing = 'cubic-bezier(.22,.61,.36,1)') {
  if (!node || typeof node.animate !== 'function' || ms <= 0) {
    if (node && frames.length) Object.assign(node.style, frames[frames.length - 1]);
    return Promise.resolve();
  }
  const a = node.animate(frames, { duration: ms, easing, fill: 'forwards' });
  return a.finished.then(() => {
    Object.assign(node.style, frames[frames.length - 1]);
    a.cancel();
  }).catch(() => {});
}

/* ----------------------------------------------------------------- geometry */

function fit() {
  if (!root || !canvas) return;
  const w = root.clientWidth || 1;
  const h = root.clientHeight || 1;
  const scale = Math.max((w + BLEED * 2) / VW, (h + BLEED * 2) / VH);
  const cw = VW * scale;
  const ch = VH * scale;
  const left = (w - cw) / 2;
  const top = (h - ch) / 2;
  geom = { w, h, cw, ch, left, top, scale };
  canvas.style.width = `${VW}px`;
  canvas.style.height = `${VH}px`;
  canvas.style.transform = `translate3d(${left}px,${top}px,0) scale(${scale})`;
  root.style.setProperty('--svh', `${Math.round(h)}px`);
  placeHit();
}

function placeHit() {
  if (!hitEl) return;
  const id = current ? current.id : pendingId;
  const pl = PLACE[id];
  if (!pl) {
    hitEl.hidden = true;
    return;
  }
  const s = pl.subject;
  hitEl.hidden = false;
  hitEl.style.left = `${s.x - s.w / 2}%`;
  hitEl.style.top = `${s.y - s.h / 2}%`;
  hitEl.style.width = `${s.w}%`;
  hitEl.style.height = `${s.h}%`;
  hitEl.setAttribute('aria-label', `Open ${pl.name}`);
}

/* ----------------------------------------------------------------- parallax */

const px = { tx: 0, ty: 0, x: 0, y: 0, vx: 0, vy: 0, raf: 0, last: 0 };

function parallaxTick(now) {
  px.raf = 0;
  // a soft, slightly under damped spring in real time: the view lags a little
  // behind the hand and settles with weight, whatever the frame rate
  const dt = Math.min(0.05, Math.max(0.001, ((now || performance.now()) - (px.last || now || 0)) / 1000)) || 0.016;
  px.last = now || performance.now();
  const stiff = 38;
  const damping = 9.5;
  px.vx += ((px.tx - px.x) * stiff - px.vx * damping) * dt;
  px.vy += ((px.ty - px.y) * stiff - px.vy * damping) * dt;
  px.x += px.vx * dt;
  px.y += px.vy * dt;
  applyParallax();
  if (Math.abs(px.tx - px.x) > 0.0005 || Math.abs(px.ty - px.y) > 0.0005 || Math.abs(px.vx) > 0.0005 || Math.abs(px.vy) > 0.0005) {
    px.raf = requestAnimationFrame(parallaxTick);
  } else {
    px.last = 0;
  }
}

function applyParallax() {
  const s = geom.scale || 1;
  // offsets are in screen px; the canvas is scaled, so divide by its scale
  const set = (node, d) => {
    if (node) node.style.transform = `translate3d(${(-px.x * d) / s}px,${(-px.y * d) / s}px,0)`;
  };
  set(stagesEl, 4);
  set(crowdEl, 8);
  set(frontsEl, 14);
}

function onPointer(e) {
  if (reduced() || !root || (e.pointerType && e.pointerType === 'touch')) return;
  const r = root.getBoundingClientRect();
  px.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
  px.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
  if (!px.raf) {
    px.last = performance.now();
    px.raf = requestAnimationFrame(parallaxTick);
  }
}

function onLeave() {
  px.tx = 0;
  px.ty = 0;
  if (!px.raf && !reduced()) {
    px.last = performance.now();
    px.raf = requestAnimationFrame(parallaxTick);
  }
}

/* -------------------------------------------------------------------- stage */

function sceneOpts(extra = {}) {
  return { time: amb.time, season: amb.season, weather: amb.weather, weekend: isWeekend(), quiet: amb.quiet, ...extra };
}

function buildStage(id) {
  const stage = el('div', 'sv-stage');
  const front = el('div', 'sv-frontwrap');
  const o = sceneOpts();
  let sky = '';
  let clouds = '';
  let land = '';
  let lights = '';
  let fr = '';
  try {
    sky = paintPlace(id, { ...o, part: 'sky' });
    clouds = paintPlace(id, { ...o, part: 'clouds' });
    land = paintPlace(id, { ...o, part: 'land' });
    lights = paintPlace(id, { ...o, part: 'lights' });
    fr = paintPlace(id, { ...o, part: 'front' });
  } catch (e) {
    sky = paintPlace(id, o);
  }
  const drift = 40 + ((id.length * 7) % 30); // 40 to 70 s per pass
  // The heavy painted layers go in as images: the browser rasterizes each one
  // once and then only moves bitmaps around (clouds drift, parallax, fades).
  const urls = [];
  const img = (svg, cls) => {
    const u = svgUrl(svg);
    if (!u) return `<div class="sv-layer ${cls}">${svg}</div>`;
    urls.push(u);
    return `<img class="sv-layer sv-pic ${cls}" alt="" decoding="async" src="${u}">`;
  };
  const cu = svgUrl(clouds);
  if (cu) urls.push(cu);
  const strip = cu ? `<img class="sv-pic" alt="" decoding="async" src="${cu}"><img class="sv-pic" alt="" decoding="async" src="${cu}">` : `${clouds}${clouds}`;
  stage.innerHTML = `${img(sky, 'sv-sky')}<div class="sv-layer sv-clouds"><div class="sv-cloudstrip" style="--drift:${drift}s">${strip}</div></div>${img(land, 'sv-land')}<div class="sv-layer sv-lights">${lights}</div>`;
  front.innerHTML = img(fr, 'sv-frontpic');
  const pics = Array.from(stage.querySelectorAll('img')).concat(Array.from(front.querySelectorAll('img')));
  const ready = Promise.race([
    Promise.all(pics.map((p) => (typeof p.decode === 'function' ? p.decode().catch(() => {}) : Promise.resolve()))),
    wait(2500),
  ]);
  const rec = { id, stage, front, image: false, time: amb.time, urls, ready };
  const url = assetUrl(id, amb.time);
  probe(url).then((ok) => {
    if (!ok || !stage.isConnected) return;
    // the real painting replaces the placeholder (its own lights and leaves are painted in)
    const img = el('img', 'sv-img');
    img.alt = '';
    img.decoding = 'async';
    img.src = url;
    img.style.opacity = '0';
    stage.appendChild(img);
    animate(img, [{ opacity: '0' }, { opacity: '1' }], reduced() ? 200 : 700).then(() => {
      for (const c of Array.from(stage.children)) if (c !== img) c.remove();
      front.innerHTML = '';
    });
    rec.image = true;
    if (current === rec) setTag(false);
  });
  return rec;
}

function setTag(on) {
  if (root) root.dataset.tag = on ? 'on' : 'off';
}

function mountRec(rec) {
  stagesEl.appendChild(rec.stage);
  frontsEl.appendChild(rec.front);
}

function dropRec(rec) {
  if (!rec) return;
  rec.stage.remove();
  rec.front.remove();
  // keep the blob alive a moment in case the browser is still decoding it
  const urls = rec.urls || [];
  setTimeout(() => urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }), 4000);
}

function svgUrl(svg) {
  try {
    if (typeof Blob !== 'function' || !URL.createObjectURL) return null;
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  } catch (e) {
    return null;
  }
}

function syncLights() {
  if (!root) return;
  const glow = (amb.time === 'sunset' || amb.time === 'night') && !reduced();
  root.dataset.glow = glow ? 'on' : 'off';
  root.style.setProperty('--pulse', `${3 + (amb.time === 'night' ? 2 : 1)}s`);
  root.dataset.quiet = amb.quiet ? 'on' : 'off';
}

// The quiet hours: window halos go out one by one, then the land settles on
// the version with most windows dark.
function applyQuiet(on) {
  if (!current) return;
  const halos = Array.from(current.stage.querySelectorAll('.sv-lights .lw'));
  const order = halos.map((h, i) => [h, (i * 7919) % 97]).sort((a, b) => a[1] - b[1]).map((p) => p[0]);
  order.forEach((h, k) => {
    const keep = k % 5 === 0;
    h.style.transitionDelay = on ? `${Math.min(6000, k * 320)}ms` : `${Math.min(2000, k * 80)}ms`;
    h.style.opacity = on && !keep ? '0' : '';
  });
  clearTimeout(quietTimer);
  const delay = on ? Math.min(6000, order.length * 320) + 900 : 0;
  quietTimer = setTimeout(() => crossfade(reduced() ? 200 : 2000), reduced() ? 0 : delay);
}

async function crossfade(ms) {
  if (!current || !root) return;
  const id = current.id;
  const old = current;
  const rec = buildStage(id);
  rec.stage.style.opacity = '0.001';
  rec.front.style.opacity = '0.001';
  mountRec(rec);
  await rec.ready;
  if (current !== old) {
    dropRec(rec);
    return;
  }
  current = rec;
  setTag(!rec.image);
  await nextFrame();
  await Promise.all([
    animate(rec.stage, [{ opacity: '0.001' }, { opacity: '1' }], ms, 'ease-in-out'),
    animate(rec.front, [{ opacity: '0.001' }, { opacity: '1' }], ms, 'ease-in-out'),
  ]);
  if (old !== current) dropRec(old);
}

/* ------------------------------------------------------------------ ambience */

function applyGrade() {
  if (!gradeEl || !hazeEl) return;
  const t = amb.time;
  const g = {
    morning: ['soft-light', 'rgba(255,214,196,0.28)'],
    day: ['normal', 'rgba(0,0,0,0)'],
    sunset: ['soft-light', 'rgba(255,168,92,0.34)'],
    night: ['multiply', 'rgba(64,84,138,0.26)'],
  }[t] || ['normal', 'rgba(0,0,0,0)'];
  gradeEl.style.mixBlendMode = g[0];
  gradeEl.style.backgroundColor = g[1];
  const hz = {
    morning: 'rgba(246,226,222,0.30)', day: 'rgba(214,228,238,0.20)', sunset: 'rgba(246,200,150,0.24)', night: 'rgba(60,84,124,0.20)',
  }[t];
  const fog = kindOf(amb.weather) === 'fog' ? 1.8 : 1;
  hazeEl.style.background = `linear-gradient(to bottom, rgba(0,0,0,0) 30%, ${hz} 46%, rgba(0,0,0,0) 62%)`;
  hazeEl.style.opacity = String(Math.min(1, 0.9 * fog));
  hazeEl.style.mixBlendMode = t === 'night' ? 'screen' : 'normal';
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function buildWeather() {
  if (!wxEl) return;
  wxEl.textContent = '';
  if (reduced()) return;
  const kind = kindOf(amb.weather);
  const frag = document.createDocumentFragment();
  if (kind === 'rain') {
    for (let i = 0; i < 70; i++) {
      const d = el('i', 'sv-rain');
      d.style.left = `${rnd(-5, 125)}%`;
      d.style.setProperty('--len', `${Math.round(rnd(12, 24))}px`);
      d.style.setProperty('--dur', `${rnd(0.55, 0.9).toFixed(2)}s`);
      d.style.setProperty('--delay', `${(-rnd(0, 1)).toFixed(2)}s`);
      d.style.opacity = rnd(0.35, 0.8).toFixed(2);
      frag.appendChild(d);
    }
  }
  if (kind === 'snow') {
    for (let i = 0; i < 56; i++) {
      const d = el('i', 'sv-fall');
      const b = el('b', 'sv-flake', d);
      d.style.left = `${rnd(0, 100)}%`;
      d.style.setProperty('--dur', `${rnd(9, 16).toFixed(1)}s`);
      d.style.setProperty('--delay', `${(-rnd(0, 16)).toFixed(1)}s`);
      d.style.setProperty('--dx', `${Math.round(rnd(-40, 40))}px`);
      b.style.setProperty('--size', `${rnd(2.5, 5.5).toFixed(1)}px`);
      b.style.setProperty('--sway', `${rnd(2.5, 4.5).toFixed(1)}s`);
      b.style.setProperty('--amp', `${Math.round(rnd(8, 22))}px`);
      b.style.setProperty('--rot', '0deg');
      b.style.opacity = rnd(0.5, 0.95).toFixed(2);
      frag.appendChild(d);
    }
  }
  const leafy = (amb.season === 'autumn' || amb.season === 'spring') && kind !== 'rain' && kind !== 'snow';
  if (leafy) {
    const n = amb.season === 'autumn' ? 16 : 10;
    const cols = amb.season === 'autumn' ? ['#D9822B', '#E6A73E', '#C96A2C', '#B9783A', '#E9B04A'] : ['#F4C9D4', '#F8DDE4', '#EAB1C3'];
    const night = amb.time === 'night';
    for (let i = 0; i < Math.min(20, n); i++) {
      const d = el('i', 'sv-fall');
      const b = el('b', '', d);
      const col = cols[i % cols.length];
      const w = Math.round(rnd(9, 15));
      b.innerHTML = `<svg width="${w}" height="${Math.round(w * 0.55)}" viewBox="0 0 20 11" aria-hidden="true"><path d="M0 5.5Q8 -1.5 20 5.5Q8 12.5 0 5.5Z" fill="${col}" fill-opacity="${night ? 0.45 : 0.9}"/><path d="M1 5.5L18 5.5" stroke="rgba(90,60,40,.5)" stroke-width=".8"/></svg>`;
      d.style.left = `${rnd(-5, 100)}%`;
      d.style.setProperty('--dur', `${rnd(12, 22).toFixed(1)}s`);
      d.style.setProperty('--delay', `${(-rnd(0, 22)).toFixed(1)}s`);
      d.style.setProperty('--dx', `${Math.round(rnd(60, 220))}px`);
      b.style.setProperty('--sway', `${rnd(2.2, 4).toFixed(1)}s`);
      b.style.setProperty('--amp', `${Math.round(rnd(18, 46))}px`);
      b.style.setProperty('--rot', `${Math.round(rnd(35, 80))}deg`);
      frag.appendChild(d);
    }
  }
  wxEl.appendChild(frag);
}

/* ------------------------------------------------------------------- public */

export function mountVista(container, { onPlaceTap } = {}) {
  if (!container || typeof document === 'undefined') return;
  injectStyle();
  onTap = typeof onPlaceTap === 'function' ? onPlaceTap : null;
  if (root && root.parentNode) root.remove();
  root = el('div', 'sv-vista', container);
  canvas = el('div', 'sv-canvas', root);
  stagesEl = el('div', 'sv-group sv-stages', canvas);
  hitEl = el('button', 'sv-hit', canvas);
  hitEl.type = 'button';
  hitEl.hidden = true;
  crowdEl = el('div', 'sv-group sv-crowd', canvas);
  frontsEl = el('div', 'sv-group sv-fronts', canvas);
  gradeEl = el('div', 'sv-grade', root);
  hazeEl = el('div', 'sv-haze', root);
  wxEl = el('div', 'sv-wx', root);
  wxEl.setAttribute('aria-hidden', 'true');
  const grain = el('div', 'sv-grain', root);
  grain.style.backgroundImage = GRAIN;
  tagEl = el('div', 'sv-tag', root);
  tagEl.textContent = 'Painting coming';
  setTag(false);

  hitEl.addEventListener('click', () => {
    const id = current ? current.id : pendingId;
    if (onTap && id) onTap(id);
  });
  root.addEventListener('pointermove', onPointer, { passive: true });
  root.addEventListener('pointerleave', onLeave, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fit()).observe(root);
  else window.addEventListener('resize', fit);
  document.addEventListener('visibilitychange', () => {
    if (root) root.dataset.paused = document.hidden ? 'on' : 'off';
  });
  if (mq && typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', () => {
      px.tx = px.ty = px.x = px.y = px.vx = px.vy = 0;
      applyParallax();
      syncLights();
      buildWeather();
    });
  }
  fit();
  applyGrade();
  syncLights();
  buildWeather();
  if (pendingId) {
    const id = pendingId;
    pendingId = null;
    showPlace(id, { instant: true });
  }
}

export async function showPlace(placeId, { instant } = {}) {
  const id = PLACE[placeId] ? placeId : 'town';
  if (!root) {
    pendingId = id;
    return;
  }
  if (current && current.id === id && current.time === amb.time) return;
  const token = ++travelToken;
  const old = current;
  const rec = buildStage(id);
  const fast = reduced();
  if (instant || !old) {
    dropRec(old);
    mountRec(rec);
    current = rec;
    placeHit();
    setTag(!rec.image);
    if (!instant && !old) {
      rec.stage.style.opacity = '0';
      rec.front.style.opacity = '0';
      await rec.ready;
      await nextFrame();
      await Promise.all([
        animate(rec.stage, [{ opacity: '0' }, { opacity: '1' }], fast ? 200 : 700),
        animate(rec.front, [{ opacity: '0' }, { opacity: '1' }], fast ? 200 : 700),
      ]);
    }
    return;
  }
  // travel: the old view eases out and lifts toward the viewer while the new one
  // is painted out of sight; then the new one settles in.
  rec.stage.style.opacity = '0.001';
  rec.front.style.opacity = '0.001';
  mountRec(rec);
  if (fast) {
    await rec.ready;
    current = rec;
    placeHit();
    setTag(!rec.image);
    await Promise.all([
      animate(rec.stage, [{ opacity: '0.001' }, { opacity: '1' }], 200, 'linear'),
      animate(rec.front, [{ opacity: '0.001' }, { opacity: '1' }], 200, 'linear'),
      animate(old.stage, [{ opacity: '1' }, { opacity: '0' }], 200, 'linear'),
      animate(old.front, [{ opacity: '1' }, { opacity: '0' }], 200, 'linear'),
    ]);
    dropRec(old);
    return;
  }
  const outEase = 'cubic-bezier(.55,.06,.68,.19)';
  const inEase = 'cubic-bezier(.16,1,.3,1)';
  await Promise.all([
    animate(old.stage, [{ opacity: '1', transform: 'scale(1)' }, { opacity: '0', transform: 'scale(1.03)' }], 600, outEase),
    animate(old.front, [{ opacity: '1', transform: 'scale(1)' }, { opacity: '0', transform: 'scale(1.03)' }], 600, outEase),
    animate(crowdEl, [{ opacity: '1' }, { opacity: '0' }], 600, outEase),
    rec.ready,
  ]);
  dropRec(old);
  if (token !== travelToken) {
    dropRec(rec);
    return;
  }
  current = rec;
  placeHit();
  setTag(!rec.image);
  await Promise.all([
    animate(rec.stage, [{ opacity: '0', transform: 'scale(1.03)' }, { opacity: '1', transform: 'scale(1)' }], 700, inEase),
    animate(rec.front, [{ opacity: '0', transform: 'scale(1.03)' }, { opacity: '1', transform: 'scale(1)' }], 700, inEase),
    animate(crowdEl, [{ opacity: '0' }, { opacity: '1' }], 700, inEase),
  ]);
}

export function setAmbience({ time, season, weather, quiet } = {}) {
  const t = TIMES.includes(time) ? time : amb.time;
  const s = SEASONS.includes(season) ? season : amb.season;
  const w = weather === undefined ? amb.weather : kindOf(weather);
  const q = quiet === undefined ? amb.quiet : !!quiet;
  const sceneChanged = t !== amb.time || s !== amb.season || w !== amb.weather;
  const quietChanged = q !== amb.quiet;
  const weatherChanged = w !== amb.weather || s !== amb.season;
  amb.time = t;
  amb.season = s;
  amb.weather = w;
  amb.quiet = q;
  if (!root) return;
  applyGrade();
  syncLights();
  if (weatherChanged || sceneChanged) buildWeather();
  clearTimeout(swapTimer);
  if (sceneChanged && current) {
    // time of day and season changes cross fade over a couple of seconds
    clearTimeout(quietTimer);
    swapTimer = setTimeout(() => crossfade(reduced() ? 200 : 2400), 0);
  } else if (quietChanged) {
    applyQuiet(q);
  }
}

export function crowdLayer() {
  return crowdEl;
}

export function subjectRect() {
  const id = current ? current.id : pendingId;
  const pl = PLACE[id];
  if (!pl || !root) return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  const s = pl.subject;
  const x = geom.left + ((s.x - s.w / 2) / 100) * geom.cw;
  const y = geom.top + ((s.y - s.h / 2) / 100) * geom.ch;
  const width = (s.w / 100) * geom.cw;
  const height = (s.h / 100) * geom.ch;
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

// Maps a point in place percent coordinates to pixels in the vista box
// (useful for anything that must sit on the painting, such as markers).
export function toScreen(xPct, yPct) {
  return { x: geom.left + (xPct / 100) * geom.cw, y: geom.top + (yPct / 100) * geom.ch };
}

export function currentPlace() {
  return current ? current.id : pendingId;
}
