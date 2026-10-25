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

import { PLACE, PLACES, MAP } from './places.js';
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
let heading = null; // the place a travel is going to, from its first frame
const amb = { time: 'day', season: 'autumn', weather: 'clear', quiet: false };
let quietTimer = null;
let swapTimer = null;
let travelToken = 0;
let geom = { w: 0, h: 0, cw: 0, ch: 0, left: 0, top: 0, scale: 1 };

const imageCache = new Map();

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
// the system setting, or the in app "Reduce motion" switch (a class on <html>)
const reduced = () => !!(mq && mq.matches) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'));

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
canvas.sv-layer{display:block;width:100%;height:100%}
canvas.sv-cloudstrip{display:block}
.sv-cloudstrip.sv-cb{top:-3%;animation:svDrift var(--drift2,96s) linear infinite,svMorph 23s cubic-bezier(.45,0,.55,1) infinite alternate;opacity:.0}
.sv-shafts{opacity:.5;transform-origin:20% 0;will-change:opacity,transform;animation:svShaft 11s cubic-bezier(.45,0,.55,1) infinite alternate}
.sv-mist{will-change:transform,opacity;animation:svMist var(--mt,38s) cubic-bezier(.45,0,.55,1) infinite alternate}
.sv-mist.m2{animation-duration:var(--mt2,53s);animation-direction:alternate-reverse}
.sv-vista[data-breathe="on"] .sv-stage{animation:svBreathe 17s cubic-bezier(.45,0,.55,1) infinite alternate}
.sv-vista[data-breathe="on"] .sv-frontwrap{animation:svBreatheF 13s cubic-bezier(.45,0,.55,1) infinite alternate}
.sv-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.sv-lights{transition:opacity 1.6s ease;will-change:opacity}
.sv-lights>canvas{position:absolute;inset:0;width:100%;height:100%;transition:opacity 1.4s cubic-bezier(.4,0,.2,1)}
.sv-vista[data-glow="on"] .sv-lights{animation:svPulse var(--pulse,4.6s) cubic-bezier(.45,0,.55,1) infinite}
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
.sv-tag{position:absolute;left:16px;bottom:132px;padding:3px 11px;border-radius:999px;background:rgba(27,34,48,.85);border:1px solid rgba(232,200,142,.6);color:#F3EFE6;font:italic 12px/1.5 "Times New Roman",Georgia,serif;pointer-events:none;opacity:0;transition:opacity 1.1s cubic-bezier(.4,0,.2,1);white-space:nowrap}
.sv-vista[data-tag="on"] .sv-tag{opacity:.6;transition-duration:.5s}
.sv-wx i{position:absolute;top:0;display:block;will-change:transform}
.sv-wx .sv-rain{width:1.5px;height:var(--len,18px);background:linear-gradient(rgba(220,230,245,0),rgba(228,236,248,.7));animation:svRain var(--dur,.7s) linear infinite;animation-delay:var(--delay,0s)}
.sv-wx .sv-fall{animation:svFall var(--dur,12s) linear infinite;animation-delay:var(--delay,0s)}
.sv-wx .sv-fall>b{display:block;animation:svSway var(--sway,4s) cubic-bezier(.37,0,.63,1) infinite alternate;animation-delay:var(--delay,0s)}
.sv-wx .sv-fall svg{will-change:transform;animation:svFlip var(--flip,1.8s) cubic-bezier(.45,.05,.55,.95) infinite;animation-delay:var(--delay,0s)}
.sv-wx .sv-flake{width:var(--size,4px);height:var(--size,4px);border-radius:50%;background:rgba(246,248,252,.9);box-shadow:0 0 4px rgba(246,248,252,.5)}
.sv-wx svg{display:block}
.sv-leaves{pointer-events:none;overflow:visible}
.sv-leaf{position:absolute;display:block;opacity:0;will-change:transform,opacity;animation:svLeaf var(--dur,12s) linear infinite;animation-delay:var(--delay,0s)}
.sv-leaf>b{display:block;animation:svSway var(--sway,4s) cubic-bezier(.37,0,.63,1) infinite alternate;animation-delay:var(--delay,0s)}
.sv-leaf svg{display:block;will-change:transform;animation:svFlip var(--flip,1.8s) cubic-bezier(.45,.05,.55,.95) infinite;animation-delay:var(--delay,0s)}
html.reduce-motion .sv-leaves{display:none}
.sv-vista[data-paused="on"] *{animation-play-state:paused!important}
@keyframes svDrift{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}
@keyframes svPulse{0%{opacity:.8}22%{opacity:.97}38%{opacity:.9}61%{opacity:1}83%{opacity:.86}100%{opacity:.8}}
@keyframes svMorph{0%,12%{opacity:0}100%{opacity:.55}}
@keyframes svShaft{from{opacity:.32;transform:skewX(-2deg)}to{opacity:.72;transform:skewX(1.5deg)}}
@keyframes svMist{from{transform:translate3d(-3%,0,0);opacity:.7}to{transform:translate3d(3%,-.6%,0);opacity:1}}
@keyframes svBreathe{from{transform:translate3d(0,0,0)}to{transform:translate3d(-3px,1px,0)}}
@keyframes svBreatheF{from{transform:translate3d(0,0,0)}to{transform:translate3d(5px,-2px,0)}}
@keyframes svFlip{0%{transform:rotateX(0) rotateZ(0)}28%{transform:rotateX(70deg) rotateZ(16deg)}52%{transform:rotateX(175deg) rotateZ(-8deg)}79%{transform:rotateX(260deg) rotateZ(11deg)}100%{transform:rotateX(360deg) rotateZ(0)}}
@keyframes svRain{from{transform:translate3d(0,-40px,0) rotate(12deg)}to{transform:translate3d(calc(var(--svh,900px) * -.21),calc(var(--svh,900px) + 40px),0) rotate(12deg)}}
@keyframes svLeaf{0%{transform:translate3d(0,0,0);opacity:0}8%{opacity:.95}70%{opacity:.85}100%{transform:translate3d(var(--dx,60px),var(--fy,240px),0);opacity:0}}
@keyframes svFall{from{transform:translate3d(0,-30px,0)}to{transform:translate3d(var(--dx,0px),calc(var(--svh,900px) + 30px),0)}}
@keyframes svSway{0%{transform:translate3d(calc(var(--amp,30px) * -1),-7px,0) rotate(calc(var(--rot,50deg) * -1))}50%{transform:translate3d(0,5px,0) rotate(0)}100%{transform:translate3d(var(--amp,30px),-7px,0) rotate(var(--rot,50deg))}}
@media (prefers-reduced-motion: reduce){
  .sv-cloudstrip,.sv-vista[data-glow="on"] .sv-lights,.sv-shafts,.sv-mist,.sv-vista .sv-stage,.sv-vista .sv-frontwrap{animation:none!important}
  .sv-cloudstrip.sv-cb{opacity:.3}
  .sv-wx,.sv-leaves{display:none}
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

// The paintings that exist are listed in assets/places/paintings.json, so the
// world never asks for a file that is not there (no 404s in the console).
let listed = null;
function paintingList() {
  if (listed) return listed;
  let url = 'assets/places/paintings.json';
  try { url = new URL('../assets/places/paintings.json', import.meta.url).href; } catch (e) { /* relative */ }
  listed = (typeof fetch === 'function' ? fetch(url, { cache: 'no-cache' }) : Promise.reject(new Error('no fetch')))
    .then((r) => (r.ok ? r.json() : { paintings: [] }))
    .then((j) => new Set((j && Array.isArray(j.paintings) ? j.paintings : []).map((n) => String(n).trim())))
    .catch(() => new Set());
  return listed;
}

function probe(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const name = String(url).split('/').pop();
  const p = paintingList().then((set) => (set.has(name) ? load(url) : false));
  imageCache.set(url, p);
  return p;
}

function load(url) {
  return new Promise((resolve) => {
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
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function animate(node, frames, ms, easing = 'cubic-bezier(.22,.61,.36,1)', delay = 0) {
  if (!node || typeof node.animate !== 'function' || ms <= 0) {
    if (node && frames.length) Object.assign(node.style, frames[frames.length - 1]);
    return Promise.resolve();
  }
  const a = node.animate(frames, { duration: ms, delay, easing, fill: 'both' });
  const settle = () => {
    Object.assign(node.style, frames[frames.length - 1]);
    try { a.cancel(); } catch (e) { /* gone */ }
  };
  // a busy or hidden tab may stall the frames: the travel never waits on them
  return Promise.race([a.finished, wait(ms + delay + 400)]).then(settle, settle);
}

/* ----------------------------------------------------------------- geometry */

function fit(ease) {
  if (!root || !canvas) return;
  const w = root.clientWidth || 1;
  const h = root.clientHeight || 1;
  const cover = Math.max((w + BLEED * 2) / VW, (h + BLEED * 2) / VH);
  const pl = PLACE[hereId()];
  const s = pl && pl.subject ? pl.subject : { x: 50, y: 50, w: 30, h: 30 };
  const de = typeof document !== 'undefined' ? document.documentElement : null;
  const phone = w < 720;
  // a phone bottom sheet covers the lower 60 percent: the subject moves into
  // the visible top 40 percent, stepping back a little if it would not fit
  const sheet = phone && de && de.classList.contains('has-sheet');
  let scale = cover;
  let room = h;
  if (sheet) {
    room = h * 0.4;
    const need = (s.h / 100) * VH * 1.18;
    scale = Math.max((w + BLEED * 2) / VW, Math.min(cover, room / need));
  }
  const cw = VW * scale;
  const ch = VH * scale;
  const sx = (s.x / 100) * cw;
  const sTop = ((s.y - s.h / 2) / 100) * ch;
  const sH = (s.h / 100) * ch;
  // across: the subject sits a touch off centre (never dead centre on wide
  // bands), and the canvas never shows an edge
  const bias = phone ? 0.5 : 0.5 + (s.x >= 50 ? 0.03 : -0.03);
  let left = w * bias - sx;
  left = Math.min(-BLEED, Math.max(w + BLEED - cw, left));
  if (cw <= w + BLEED * 2) left = (w - cw) / 2;
  // down: keep the whole subject (tower tops, the gold bot on a roof) with a
  // margin, then spend the rest of the room on the path below it
  const margin = Math.min(room * 0.1, 48);
  const slack = Math.max(0, room - sH - margin * 2);
  let top = margin + slack * (sheet ? 0.5 : 0.3) - sTop;
  if (sheet) top = Math.min(-BLEED, Math.max(room - ch, top));
  else top = Math.min(-BLEED, Math.max(h + BLEED - ch, top));
  geom = { w, h, cw, ch, left, top, scale };
  canvas.style.width = `${VW}px`;
  canvas.style.height = `${VH}px`;
  canvas.style.transition = ease && !reduced() ? 'transform 640ms cubic-bezier(.22,.7,.25,1)' : 'none';
  canvas.style.transform = `translate3d(${left}px,${top}px,0) scale(${scale})`;
  root.style.setProperty('--svh', `${Math.round(h)}px`);
  placeHit();
}

function hereId() {
  return heading || (current ? current.id : pendingId);
}

function placeHit() {
  if (!hitEl) return;
  const id = hereId();
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

// The time of day grade, horizon haze and paper grain are baked into each
// painted layer once (canvas), so nothing on screen blends live while the
// clouds drift: the browser only moves finished bitmaps.
const GRADE = {
  morning: { op: 'soft-light', color: 'rgba(255,200,150,0.22)', haze: 'rgba(250,224,196,0.20)', hop: 'source-over' },
  day: { op: null, color: null, haze: 'rgba(214,228,238,0.20)', hop: 'source-over' },
  sunset: { op: 'soft-light', color: 'rgba(255,168,92,0.34)', haze: 'rgba(246,200,150,0.24)', hop: 'source-over' },
  night: { op: 'multiply', color: 'rgba(64,84,138,0.26)', haze: 'rgba(60,84,124,0.20)', hop: 'screen' },
};

let paperTile = null;
function paper() {
  if (paperTile) return paperTile;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const x = c.getContext('2d');
  if (!x) return null;
  const d = x.createImageData(160, 160);
  let seed = 9173;
  for (let i = 0; i < d.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = 96 + (seed % 120);
    d.data[i] = v;
    d.data[i + 1] = v * 0.97;
    d.data[i + 2] = v * 0.9;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  paperTile = c;
  return c;
}

// f < 1 gives the quick first pass (a soft low resolution version that is
// swapped for the full one when the browser has time)
function bakeSize(f = 1) {
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const k = Math.min(1.5, Math.max(0.7, (geom.scale || 1) * dpr)) * f;
  return { w: Math.round(VW * k), h: Math.round(VH * k), k: Math.round(k * 100) / 100 };
}

function rasterize(svg) {
  const u = svgUrl(svg);
  if (!u) return Promise.resolve(null);
  return new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    const done = (ok) => {
      setTimeout(() => { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }, 0);
      resolve(ok ? im : null);
    };
    im.onload = () => done(im.naturalWidth > 0 || im.width > 0);
    im.onerror = () => done(false);
    im.src = u;
  });
}

// draws one painted layer into a canvas, then lays the grade, haze and grain
// only where that layer has paint (masked by its own alpha)
function bake(cv, img, { grade = true, haze = false, hole = null, grain = 0, twice = false, flip = false, f = 1 } = {}) {
  const { w, h } = bakeSize(f);
  const W2 = twice ? w * 2 : w;
  cv.width = W2;
  cv.height = h;
  const x = cv.getContext('2d');
  if (!x) return false;
  // the SVG is rasterized once (it is the costly step); the second copy of a
  // cloud strip and the masks below reuse those pixels
  if (flip) {
    x.save();
    x.translate(W2, 0);
    x.scale(-1, 1);
  }
  x.drawImage(img, 0, 0, w, h);
  if (flip) x.restore();
  if (twice) x.drawImage(cv, flip ? w : 0, 0, w, h, flip ? 0 : w, 0, w, h);
  const G = GRADE[amb.time] || GRADE.day;
  const passes = [];
  if (grade && G.op) passes.push([G.op, (c) => { c.fillStyle = G.color; c.fillRect(0, 0, W2, h); }]);
  if (haze) {
    const fog = kindOf(amb.weather) === 'fog' ? 1.8 : 1;
    passes.push([G.hop, (c) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0.3, 'rgba(0,0,0,0)');
      gr.addColorStop(0.46, G.haze);
      gr.addColorStop(0.62, 'rgba(0,0,0,0)');
      c.globalAlpha = Math.min(1, 0.9 * fog);
      c.fillStyle = gr;
      c.fillRect(0, 0, W2, h);
      if (fog > 1) {
        c.globalAlpha = 0.22;
        c.fillStyle = G.haze;
        c.fillRect(0, 0, W2, h);
      }
      if (hole) {
        // the subject keeps its own color: the haze is cut away there with a
        // soft feathered edge, so only what lies behind it goes pale
        const cx = (hole.x / 100) * W2;
        const cy = (hole.y / 100) * h;
        // the cut covers the whole subject box (not only its core), so no
        // milky veil ever sits on the subject's edges
        const rx = Math.max(1, (hole.w / 100) * W2 * 0.8);
        const ry = Math.max(1, (hole.h / 100) * h * 0.8);
        c.save();
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'destination-out';
        c.translate(cx, cy);
        c.scale(1, ry / rx);
        const rg = c.createRadialGradient(0, 0, rx * 0.62, 0, 0, rx);
        rg.addColorStop(0, 'rgba(0,0,0,1)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = rg;
        c.fillRect(-rx, -rx, rx * 2, rx * 2);
        c.restore();
      }
    }]);
  }
  if (grain && paper()) {
    passes.push(['soft-light', (c) => {
      c.globalAlpha = grain;
      c.fillStyle = c.createPattern(paper(), 'repeat');
      c.fillRect(0, 0, W2, h);
    }]);
  }
  if (passes.length) {
    // the layer's own alpha, copied once before any pass changes it
    const mask = document.createElement('canvas');
    mask.width = W2;
    mask.height = h;
    const mx = mask.getContext('2d');
    const t = document.createElement('canvas');
    t.width = W2;
    t.height = h;
    const tx = t.getContext('2d');
    if (tx && mx) {
      mx.drawImage(cv, 0, 0);
      for (const [op, paint] of passes) {
        tx.globalCompositeOperation = 'source-over';
        tx.globalAlpha = 1;
        tx.clearRect(0, 0, W2, h);
        paint(tx);
        tx.globalAlpha = 1;
        tx.globalCompositeOperation = 'destination-in';
        tx.drawImage(mask, 0, 0);
        x.globalCompositeOperation = op;
        x.drawImage(t, 0, 0);
      }
      x.globalCompositeOperation = 'source-over';
      mask.width = mask.height = t.width = t.height = 0;
    }
  }
  return true;
}

// a mirrored copy of a baked cloud strip (the grade is even, so mirroring the
// result equals baking the mirrored image, at none of the cost)
function mirror(dst, src) {
  dst.width = src.width;
  dst.height = src.height;
  const x = dst.getContext('2d');
  if (!x) return;
  x.save();
  x.translate(src.width, 0);
  x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  x.restore();
}

// shafts of light through the sky at day and morning: soft wedges, baked once
function bakeShafts(cv) {
  const { w, h } = bakeSize();
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d');
  if (!x) return;
  const warm = amb.time === 'morning' ? '255,226,176' : '255,240,206';
  if ('filter' in x) x.filter = `blur(${Math.round(w / 70)}px)`;
  const sx = w * (amb.time === 'morning' ? 0.12 : 0.28);
  const rays = [[0.18, 0.05, 0.065], [0.47, 0.07, 0.045], [0.63, 0.03, 0.03]];
  for (const [at, wid, a] of rays) {
    const gx = sx + w * at;
    const gr = x.createLinearGradient(sx, 0, gx, h * 0.85);
    gr.addColorStop(0, `rgba(${warm},${a})`);
    gr.addColorStop(0.7, `rgba(${warm},${a * 0.45})`);
    gr.addColorStop(1, `rgba(${warm},0)`);
    x.fillStyle = gr;
    x.beginPath();
    x.moveTo(sx - w * 0.01, -h * 0.05);
    x.lineTo(sx + w * 0.012, -h * 0.05);
    x.lineTo(gx + w * wid, h * 0.88);
    x.lineTo(gx - w * wid * 0.7, h * 0.9);
    x.closePath();
    x.fill();
  }
}

// morning mist and fog: long soft banks low over the land, baked once
function bakeMist(cv, seed, dense) {
  const { w, h } = bakeSize();
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d');
  if (!x) return;
  const col = amb.time === 'night' ? '150,170,200' : amb.time === 'sunset' ? '250,220,200' : amb.time === 'morning' ? '250,230,208' : '232,238,244';
  if ('filter' in x) x.filter = `blur(${Math.round(w / 55)}px)`;
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const n = dense ? 14 : 9;
  for (let i = 0; i < n; i++) {
    const cx = w * (rand() * 1.1 - 0.05);
    const cy = h * (dense ? 0.56 + rand() * 0.2 : 0.5 + rand() * 0.1);
    const rx = w * (0.12 + rand() * 0.18);
    const ry = h * (0.025 + rand() * 0.04);
    x.fillStyle = `rgba(${col},${((dense ? 0.24 : 0.05) + rand() * (dense ? 0.1 : 0.05)).toFixed(2)})`;
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.06, 0, Math.PI * 2);
    x.fill();
  }
}

// gives every window halo one of four groups, so quiet hours can put the
// windows out group by group while each group stays one baked bitmap
function lightGroups(svg) {
  let k = 0;
  const tagged = svg.replace(/class="lw/g, () => `class="lw q${(k++ * 7) % 4}`);
  const at = tagged.indexOf('>') + 1;
  const only = (css) => tagged.slice(0, at) + `<style>${css}</style>` + tagged.slice(at);
  const out = [only('.lw{display:none}')];
  if (!k) return [];
  return [0, 1, 2, 3].map((q) => only(`.lw{display:none}.lw.q${q}{display:inline}`));
}

// Every baked view is kept (per place, time, season, weather, quiet hours and
// weekday or weekend), so a revisit or a travel back is instant. The cache is
// held to a pixel budget, oldest first out.
const layerCache = new Map();
const svgCache = new Map();
const CACHE_BYTES = 180 * 1024 * 1024;
const QUICK = 0.45;

function stageKey(id) {
  return [id, amb.time, amb.season, kindOf(amb.weather), amb.quiet ? 1 : 0, isWeekend() ? 1 : 0].join('|');
}

function bytesOf(L) {
  let n = 0;
  for (const c of [L.sky, L.ca, L.cb, L.land, L.front, ...(L.lights || [])]) if (c) n += c.width * c.height * 4;
  return n;
}

function cachePut(key, L) {
  layerCache.delete(key);
  layerCache.set(key, L);
  let total = 0;
  for (const v of layerCache.values()) total += v.bytes || 0;
  for (const [k, v] of layerCache) {
    if (total <= CACHE_BYTES || layerCache.size <= 1) break;
    if (v.inUse && v.inUse()) continue;
    total -= v.bytes || 0;
    layerCache.delete(k);
  }
}

function sceneParts(id, key) {
  if (svgCache.has(key)) return svgCache.get(key);
  const o = sceneOpts();
  let parts = null;
  try {
    parts = {
      sky: paintPlace(id, { ...o, part: 'sky' }),
      clouds: paintPlace(id, { ...o, part: 'clouds' }),
      land: paintPlace(id, { ...o, part: 'land' }),
      lights: paintPlace(id, { ...o, part: 'lights' }),
      front: paintPlace(id, { ...o, part: 'front' }),
    };
  } catch (e) {
    parts = { sky: paintPlace(id, o), clouds: '', land: '', lights: '', front: '' };
  }
  svgCache.set(key, parts);
  if (svgCache.size > 6) svgCache.delete(svgCache.keys().next().value);
  return parts;
}

// lets the browser paint a frame (and answer a tap) between two costly layers
function breathe(ms = 0) {
  return new Promise((r) => {
    if (typeof requestIdleCallback === 'function' && ms > 0) requestIdleCallback(() => r(), { timeout: ms });
    else setTimeout(r, ms);
  });
}

// Falling leaves come only from the trees each place really has: crown
// centres and sizes in painting pixels, read from the scene layout.
const CROWNS = {
  campus: [[128, 494, 130], [1450, 543, 170], [300, 484, 60]],
  town: [[872, 443, 80], [230, 542, 100], [1380, 508, 105]],
  bobino: [[286, 466, 125], [664, 290, 110], [1012, 255, 120], [1318, 325, 100]],
  home: [[1150, 368, 150]],
  kitchen: [[250, 465, 115], [1290, 502, 100]],
  gym: [[160, 508, 85], [1460, 502, 100]],
  market: [[150, 502, 100], [1470, 508, 105]],
  fields: [[104, 443, 105], [1452, 455, 70]],
};
const MAX_LEAVES = 6;

function buildLeaves(id, parent) {
  const crowns = CROWNS[id];
  if (!crowns || reduced()) return;
  const kind = kindOf(amb.weather);
  if (!(amb.season === 'autumn' || amb.season === 'spring') || kind === 'rain' || kind === 'snow') return;
  const box = el('div', 'sv-layer sv-leaves', parent);
  box.setAttribute('aria-hidden', 'true');
  const cols = amb.season === 'autumn' ? ['#D9822B', '#E6A73E', '#C2672E', '#B9783A', '#E9B04A', '#A9552F', '#D7A24C'] : ['#F4C9D4', '#F8DDE4', '#EAB1C3'];
  const night = amb.time === 'night';
  const n = Math.min(MAX_LEAVES, amb.season === 'autumn' ? 6 : 4);
  for (let i = 0; i < n; i++) {
    const [cx, cy, r] = crowns[i % crowns.length];
    const d = el('i', 'sv-leaf', box);
    const b = el('b', '', d);
    const col = cols[(i * 3) % cols.length];
    const w = Math.round(rnd(10, 16));
    b.innerHTML = `<svg width="${w}" height="${Math.round(w * 0.55)}" viewBox="0 0 20 11" aria-hidden="true"><path d="M0 5.5Q8 -1.5 20 5.5Q8 12.5 0 5.5Z" fill="${col}" fill-opacity="${night ? 0.45 : 0.9}"/><path d="M1 5.5L18 5.5" stroke="rgba(90,60,40,.5)" stroke-width=".8"/></svg>`;
    // born inside the lower half of the crown, then a long slow fall that
    // fades out before it reaches the ground
    d.style.left = `${Math.round(cx + rnd(-0.7, 0.7) * r)}px`;
    d.style.top = `${Math.round(cy + rnd(-0.1, 0.45) * r)}px`;
    const dur = rnd(9, 15);
    d.style.setProperty('--dur', `${dur.toFixed(1)}s`);
    // every leaf waits its turn, so they never leave the trees all at once
    d.style.setProperty('--delay', `${(-rnd(0, dur) + i * 0.4).toFixed(1)}s`);
    d.style.setProperty('--fy', `${Math.round(rnd(1.3, 2.2) * r)}px`);
    d.style.setProperty('--dx', `${Math.round(rnd(40, 160))}px`);
    b.style.setProperty('--sway', `${rnd(2.2, 4).toFixed(1)}s`);
    b.style.setProperty('--amp', `${Math.round(rnd(14, 34))}px`);
    b.style.setProperty('--rot', `${Math.round(rnd(35, 80))}deg`);
    b.style.setProperty('--flip', `${rnd(1.2, 2.6).toFixed(2)}s`);
  }
}

// Idle pre rendering: once the current view is at full resolution, the places
// most likely to come next (joined to this one by a road, then the rest) are
// painted at full resolution off screen, one layer per idle slot, straight into
// the view cache, so the next travel is a cache hit. Any travel, or a change of
// light or weather, stops the run. The cache budget is never pushed into
// evicting a view: the run ends when the next view would not fit.
let preToken = 0;
const preStats = [];

function nextPlaces(id) {
  const near = [];
  for (const r of (MAP && MAP.roads) || []) {
    if (r.from === id && !near.includes(r.to)) near.push(r.to);
    else if (r.to === id && !near.includes(r.from)) near.push(r.from);
  }
  // the solid roads (the often travelled ones) first
  const solid = new Set(((MAP && MAP.roads) || []).filter((r) => r.solid && (r.from === id || r.to === id)).map((r) => (r.from === id ? r.to : r.from)));
  near.sort((a, b) => (solid.has(b) ? 1 : 0) - (solid.has(a) ? 1 : 0));
  const rest = PLACES.map((p) => p.id).filter((p) => p !== id && !near.includes(p));
  return [...near, ...rest].filter((p) => PLACE[p]);
}

function cacheBytes() {
  let n = 0;
  for (const v of layerCache.values()) n += v.bytes || 0;
  return n;
}

function idleSlot(timeout = 10000) {
  return new Promise((r) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback((d) => r(d), { timeout });
    else setTimeout(() => r(null), 60);
  });
}

async function prerenderOne(id, alive) {
  const key = stageKey(id);
  const size = bakeSize();
  const hit = layerCache.get(key);
  if (hit && hit.k === size.k) return 'hit';
  const t0 = performance.now();
  const o = sceneOpts();
  const names = ['land', 'sky', 'front', 'clouds', 'lights'];
  const parts = {};
  for (const part of names) {
    await idleSlot();
    if (!alive()) return 'stopped';
    try { parts[part] = paintPlace(id, { ...o, part }); } catch (e) { parts[part] = ''; }
  }
  const mk = (cls) => {
    const c = document.createElement('canvas');
    if (cls) c.className = cls;
    c.setAttribute('aria-hidden', 'true');
    return c;
  };
  const sky = mk('sv-layer sv-sky');
  const ca = mk('sv-cloudstrip');
  const cb = mk('sv-cloudstrip sv-cb');
  const land = mk('sv-layer sv-land');
  const fr = mk('sv-layer sv-frontpic');
  const groups = parts.lights ? lightGroups(parts.lights) : [];
  const lights = groups.map(() => mk(''));
  const subject = PLACE[id] && PLACE[id].subject;
  const layers = [
    [parts.land, (im) => bake(land, im, { haze: true, hole: subject, grain: 0.12, f: 1 })],
    [parts.sky, (im) => bake(sky, im, { haze: true, grain: 0.1, f: 1 })],
    [parts.front, (im) => bake(fr, im, { grain: 0.08, f: 1 })],
    [parts.clouds, (im) => { bake(ca, im, { twice: true, f: 1 }); mirror(cb, ca); }],
    ...groups.map((svg, i) => [svg, (im) => bake(lights[i], im, { grade: false, f: 1 })]),
  ];
  for (const [svg, paint] of layers) {
    if (!svg) continue;
    const im = await rasterize(svg);
    await idleSlot();
    if (!alive()) return 'stopped';
    if (im) paint(im);
  }
  // the light, weather or size changed while painting: this view is stale
  if (stageKey(id) !== key || bakeSize().k !== size.k) return 'stale';
  const L = { k: size.k, sky, ca, cb, land, front: fr, lights, inUse: () => false };
  L.bytes = bytesOf(L);
  if (cacheBytes() + L.bytes > CACHE_BYTES) return 'full';
  cachePut(key, L);
  const ms = Math.round(performance.now() - t0);
  preStats.push({ id, ms });
  try { if (performance.mark) performance.mark(`sao-vista-pre-${id}`); } catch (e) { /* not available */ }
  return 'done';
}

function prerenderAround(id) {
  const token = ++preToken;
  const travel = travelToken;
  const ambKey = stageKey(id);
  const alive = () => token === preToken && travel === travelToken && stageKey(id) === ambKey && !(typeof document !== 'undefined' && document.hidden);
  (async () => {
    await wait(reduced() ? 400 : 1600);
    let budget = 0;
    for (const next of nextPlaces(id)) {
      if (!alive()) return;
      // stop before a view would push an older one out of the cache
      if (budget && cacheBytes() + budget > CACHE_BYTES) return;
      const r = await prerenderOne(next, alive);
      if (r === 'stopped' || r === 'stale' || r === 'full') return;
      if (r === 'done') {
        const L = layerCache.get(stageKey(next));
        if (L) budget = L.bytes || budget;
      }
    }
  })().catch(() => {});
}

// timing, for the performance panel and tests: [{id, ms}] of finished pre renders
export function prerenderStats() {
  return preStats.slice();
}

// timing marks for measuring first paint and travel (performance panel only)
function mark(rec, what) {
  try { if (typeof performance !== 'undefined' && performance.mark) performance.mark(`sao-vista-${what}-${rec.id}`); } catch (e) { /* not available */ }
}

function buildStage(id) {
  const stage = el('div', 'sv-stage');
  const front = el('div', 'sv-frontwrap');
  const key = stageKey(id);
  const drift = 40 + ((id.length * 7) % 30); // 40 to 70 s per pass
  const kind = kindOf(amb.weather);
  const shafts = (amb.time === 'day' || amb.time === 'morning') && (kind === 'clear' || kind === 'clouds');
  const mist = amb.time === 'morning' || kind === 'fog' || kind === 'rain';
  const cv = (cls, parent) => {
    const c = el('canvas', cls, parent);
    c.setAttribute('aria-hidden', 'true');
    return c;
  };
  let sky = cv('sv-layer sv-sky', stage);
  const cl = el('div', 'sv-layer sv-clouds', stage);
  let ca = cv('sv-cloudstrip', cl);
  let cb = cv('sv-cloudstrip sv-cb', cl);
  cl.style.setProperty('--drift', `${drift}s`);
  cl.style.setProperty('--drift2', `${Math.round(drift * 1.7)}s`);
  let land = cv('sv-layer sv-land', stage);
  const sh = shafts ? cv('sv-layer sv-shafts', stage) : null;
  const m1 = mist ? cv('sv-layer sv-mist', stage) : null;
  const m2 = mist ? cv('sv-layer sv-mist m2', stage) : null;
  const lightsEl = el('div', 'sv-layer sv-lights', stage);
  let fr = cv('sv-layer sv-frontpic', front);
  buildLeaves(id, stage);
  const rec = { id, key, stage, front, image: false, time: amb.time, urls: [], lightCanvases: [], res: 'quick', dead: false };
  const quietLights = () => {
    if (amb.quiet && rec.lightCanvases.length) rec.lightCanvases.forEach((c, i) => { c.style.opacity = i === 0 ? '0.6' : '0'; });
  };
  const size = bakeSize();
  const hit = layerCache.get(key);
  if (hit && hit.k === size.k && ![hit.sky, hit.land].some((c) => c && c.isConnected)) {
    // a view painted before: its finished bitmaps move straight in
    sky.replaceWith(hit.sky); sky = hit.sky;
    ca.replaceWith(hit.ca); ca = hit.ca;
    cb.replaceWith(hit.cb); cb = hit.cb;
    land.replaceWith(hit.land); land = hit.land;
    fr.replaceWith(hit.front); fr = hit.front;
    for (const c of hit.lights) {
      c.style.cssText = '';
      lightsEl.appendChild(c);
    }
    rec.lightCanvases = hit.lights.slice();
    rec.res = 'full';
    stage.dataset.res = 'full';
    hit.inUse = () => !rec.dead;
    cachePut(key, hit);
    rec.ready = Promise.resolve().then(quietLights).then(() => mark(rec, 'cache'));
    rec.ready.then(() => wait(1200)).then(() => { if (current === rec && !rec.dead) prerenderAround(id); });
  } else {
    stage.dataset.res = 'quick';
    const parts = sceneParts(id, key);
    const groups = parts.lights ? lightGroups(parts.lights) : [];
    const lightCv = groups.map(() => cv('', lightsEl));
    rec.lightCanvases = lightCv.slice();
    const subject = PLACE[id] && PLACE[id].subject;
    // what to paint, most visible first
    const layers = [
      [parts.land, (im, f) => bake(land, im, { haze: true, hole: subject, grain: 0.12, f })],
      [parts.sky, (im, f) => bake(sky, im, { haze: true, grain: 0.1, f })],
      [parts.front, (im, f) => bake(fr, im, { grain: 0.08, f })],
      [parts.clouds, (im, f) => { bake(ca, im, { twice: true, f }); mirror(cb, ca); }],
      ...groups.map((svg, i) => [svg, (im, f) => bake(lightCv[i], im, { grade: false, f })]),
    ];
    const imgs = Promise.all(layers.map(([svg]) => rasterize(svg)));
    const quick = imgs.then(async (list) => {
      for (let i = 0; i < layers.length; i++) {
        if (rec.dead) return;
        if (list[i]) layers[i][1](list[i], QUICK);
        if (i < 3) await breathe(0);
      }
    }).catch(() => {});
    rec.ready = Promise.race([quick, wait(6000)]).then(quietLights).then(() => mark(rec, 'quick'));
    // then the full resolution, one layer at a time while the browser is idle,
    // after any travel has settled; the finished view goes into the cache
    rec.full = quick.then(async () => {
      const list = await imgs;
      await wait(reduced() ? 300 : 1300);
      for (let i = 0; i < layers.length; i++) {
        if (rec.dead) return;
        await breathe(1500);
        if (rec.dead) return;
        if (list[i]) layers[i][1](list[i], 1);
      }
      rec.res = 'full';
      stage.dataset.res = 'full';
      mark(rec, 'full');
      const L = { k: size.k, sky, ca, cb, land, front: fr, lights: lightCv, inUse: () => !rec.dead };
      L.bytes = bytesOf(L);
      cachePut(key, L);
      if (current === rec) prerenderAround(id);
    }).catch(() => {});
  }
  if (sh) bakeShafts(sh);
  if (m1) bakeMist(m1, 4111 + id.length, kind === 'fog');
  if (m2) bakeMist(m2, 9277 + id.length * 3, kind === 'fog');
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

// "Painting coming" says itself once per session: four seconds, then it fades
let tagSeen = false;
let tagTimer = 0;
function setTag(on) {
  if (!root) return;
  if (!on) {
    clearTimeout(tagTimer);
    root.dataset.tag = 'off';
    return;
  }
  if (!tagSeen) {
    try { tagSeen = sessionStorage.getItem('sao.paintingTag') === '1'; } catch (e) { /* private window */ }
  }
  if (tagSeen) return;
  tagSeen = true;
  try { sessionStorage.setItem('sao.paintingTag', '1'); } catch (e) { /* private window */ }
  root.dataset.tag = 'on';
  clearTimeout(tagTimer);
  tagTimer = setTimeout(() => { if (root) root.dataset.tag = 'off'; }, 4000);
}

function mountRec(rec) {
  stagesEl.appendChild(rec.stage);
  frontsEl.appendChild(rec.front);
}

function dropRec(rec) {
  if (!rec) return;
  rec.dead = true;
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
  root.dataset.breathe = reduced() ? 'off' : 'on';
}

// The quiet hours: window halos go out one by one, then the land settles on
// the version with most windows dark.
function applyQuiet(on) {
  if (!current) return;
  const groups = current.lightCanvases || [];
  const fast = reduced();
  groups.forEach((c, k) => {
    // one group of windows stays lit; the others go out one after another
    c.style.transitionDelay = fast ? '0ms' : on ? `${k * 1500}ms` : `${k * 300}ms`;
    c.style.opacity = on ? (k === 0 ? '0.6' : '0') : '';
  });
  clearTimeout(quietTimer);
  const delay = on ? groups.length * 1500 + 1400 : 0;
  quietTimer = setTimeout(() => crossfade(fast ? 200 : 2000), fast ? 0 : delay);
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
  // the grade and the haze are baked into each painted layer (see bake), so
  // the full screen overlays stay empty and nothing blends live
  if (gradeEl) gradeEl.style.display = 'none';
  if (hazeEl) hazeEl.style.display = 'none';
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
  tagEl = el('div', 'sv-tag', root);
  tagEl.textContent = 'Painting coming';
  root.dataset.tag = 'off';

  hitEl.addEventListener('click', () => {
    const id = hereId();
    if (onTap && id) onTap(id);
  });
  root.addEventListener('pointermove', onPointer, { passive: true });
  root.addEventListener('pointerleave', onLeave, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fit()).observe(root);
  else window.addEventListener('resize', fit);
  document.addEventListener('visibilitychange', () => {
    if (!root) return;
    root.dataset.paused = document.hidden ? 'on' : 'off';
    if (document.hidden && px.raf) {
      cancelAnimationFrame(px.raf);
      px.raf = 0;
      px.last = 0;
    }
  });
  const motionChanged = () => {
    px.tx = px.ty = px.x = px.y = px.vx = px.vy = 0;
    applyParallax();
    syncLights();
    buildWeather();
  };
  if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', motionChanged);
  if (typeof MutationObserver === 'function') {
    let was = reduced();
    let sheetWas = document.documentElement.classList.contains('has-sheet');
    new MutationObserver(() => {
      const sheetNow = document.documentElement.classList.contains('has-sheet');
      if (sheetNow !== sheetWas) {
        sheetWas = sheetNow;
        fit(true);
      }
      const now = reduced();
      if (now !== was) {
        was = now;
        motionChanged();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
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
  if (heading ? heading === id : current && current.id === id && current.time === amb.time) return;
  const token = ++travelToken;
  // the hit area and its label follow the destination at once, so a tap during
  // the travel opens the place Wahb is going to
  heading = instant ? null : id;
  placeHit();
  const old = current;
  const rec = buildStage(id);
  const fast = reduced();
  if (instant || !old) {
    dropRec(old);
    mountRec(rec);
    current = rec;
    heading = null;
    fit();
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
    if (token !== travelToken) {
      dropRec(rec);
      return;
    }
    current = rec;
    heading = null;
    fit();
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
  // a painted cut: the camera leans into the old view while the new one is
  // painted out of sight, then the new view dissolves in over it and settles
  // back, and only at the very end the old one lets go
  const lean = 'cubic-bezier(.45,0,.75,.4)';
  const settleEase = 'cubic-bezier(.2,.75,.25,1)';
  const leanIn = (node) => animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.028)' }], 520, lean);
  await Promise.all([
    leanIn(old.stage),
    leanIn(old.front),
    animate(crowdEl, [{ opacity: '1' }, { opacity: '0' }], 380, 'cubic-bezier(.4,0,1,1)'),
    rec.ready,
  ]);
  if (token !== travelToken) {
    dropRec(rec);
    return;
  }
  current = rec;
  heading = null;
  fit(true);
  setTag(!rec.image);
  const keepOn = [{ opacity: '1', offset: 0 }, { opacity: '1', offset: 0.7 }, { opacity: '0', offset: 1 }];
  await Promise.all([
    animate(old.stage, [{ transform: 'scale(1.028)' }, { transform: 'scale(1.07)' }], 820, 'cubic-bezier(.3,0,.6,1)'),
    animate(old.front, [{ transform: 'scale(1.028)' }, { transform: 'scale(1.1)' }], 820, 'cubic-bezier(.3,0,.6,1)'),
    animate(old.stage, keepOn, 820, 'linear'),
    animate(old.front, keepOn, 820, 'linear'),
    animate(rec.stage, [{ opacity: '0', transform: 'scale(1.045)' }, { opacity: '1', transform: 'scale(1)' }], 780, settleEase),
    animate(rec.front, [{ opacity: '0', transform: 'scale(1.07)' }, { opacity: '1', transform: 'scale(1)' }], 820, settleEase),
    animate(crowdEl, [{ opacity: '0' }, { opacity: '1' }], 600, settleEase, 380),
  ]);
  dropRec(old);
  if (current === rec) {
    rec.stage.style.transform = '';
    rec.front.style.transform = '';
  }
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
  const id = hereId();
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
  return hereId();
}
