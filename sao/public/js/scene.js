// SAO scene painter. Every place is painted in code as a layered SVG: a
// watercolor and gouache background in the spirit of a hand painted anime
// background (soft edges, broken color, warm light and cool shadow, haze in
// the distance, dark soft foliage framing the corners). It is the placeholder
// until a real painting exists in public/assets/places/<id>-<time>.webp.
//
// paintPlace(placeId, {time, season, weather, width, height, part})
//   part: 'all' (default) | 'sky' | 'clouds' | 'land' | 'lights' | 'front'
//   'sky', 'clouds', 'land', 'lights' and 'front' let the vista stack layers
//   (clouds drift, lights pulse, foliage gets its own parallax). Each part is a
//   full 1600 x 900 SVG with a transparent background except 'sky'.
// Geometry uses a fixed seed per place, so a place looks the same at every
// visit; only light, season and weather change.

import { PLACE } from './places.js';

export const W = 1600;
export const H = 900;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ numbers */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const f1 = (v) => Math.round(v * 10) / 10;
const f2 = (v) => Math.round(v * 100) / 100;

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(a) {
  let s = a >>> 0;
  return function rand() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tools(r) {
  return {
    r,
    R: (a, b) => a + (b - a) * r(),
    RI: (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
    ch: (p) => r() < p,
  };
}

function noise1(r) {
  const v = Array.from({ length: 256 }, () => r());
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = v[i & 255];
    const b = v[(i + 1) & 255];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

function fbm(n, x, oct = 4) {
  let s = 0;
  let a = 0.5;
  let fr = 1;
  let norm = 0;
  for (let k = 0; k < oct; k++) {
    s += a * n(x * fr + k * 31.7);
    norm += a;
    a *= 0.5;
    fr *= 2.03;
  }
  return s / norm;
}

/* ------------------------------------------------------------------- colors */

function rgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex(a) {
  return '#' + a.map((v) => clamp(Math.round(v), 6, 255).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((v, i) => v + (B[i] - v) * clamp(t, 0, 1)));
}
function mul(a, k) {
  return hex(rgb(a).map((v) => v * k));
}

/* ------------------------------------------------------------ time and season */

const TIME = {
  morning: {
    sky: [[0, '#86A6CE'], [0.2, '#A3B9D8'], [0.36, '#CFC8DA'], [0.47, '#EFD2CC'], [0.56, '#F7DCC6'], [0.7, '#F8E2CC']],
    sun: { x: 0.17, y: 0.45, r: 430, c: '#FFF2DE', o: 0.8, disc: 30 },
    light: '#FFE2BC', shade: '#7E7CB0', haze: '#ECD8CC', tone: '#EED8C6', toneK: 0.05,
    litK: 0.36, shadeK: 0.5, expo: 1.0, litSide: -1, frontK: 0.28, shadowLen: 1.5,
    cloudLit: '#FFEEDA', cloudShade: '#ACA6C6', cloudHi: '#FFF6EA', lightY: -0.26,
    line: '#4B4E7A', farHaze: '#D9CCDD', water: ['#E9D6D4', '#A3A9C8'], mist: 1, lit: 0, stars: 0,
  },
  day: {
    sky: [[0, '#4C82C3'], [0.18, '#6596D0'], [0.34, '#93B9E0'], [0.48, '#C4DCEC'], [0.58, '#DCE9EE'], [0.7, '#E5EEEE']],
    sun: { x: 0.08, y: -0.08, r: 700, c: '#FFFBEA', o: 0.4, disc: 0 },
    light: '#FFF2D4', shade: '#5B7DAD', haze: '#CDDDEA', tone: '#FFFFFF', toneK: 0,
    litK: 0.3, shadeK: 0.42, expo: 1.0, litSide: -1, frontK: 0.34, shadowLen: 0.45,
    cloudLit: '#FFF2DC', cloudShade: '#ABA8C4', cloudHi: '#FFF8EA', lightY: -0.28,
    line: '#3B486E', farHaze: '#B9CDE2', water: ['#BFD6E6', '#5F8DB6'], mist: 0, lit: 0, stars: 0,
  },
  sunset: {
    sky: [[0, '#5B5C93'], [0.16, '#8676A6'], [0.31, '#C08FA6'], [0.42, '#E8AA8A'], [0.52, '#F5C783'], [0.6, '#F8D89A'], [0.7, '#F8DFA8']],
    sun: { x: 0.8, y: 0.5, r: 560, c: '#FFD98E', o: 0.95, disc: 38 },
    light: '#FFC06A', shade: '#5A4A86', haze: '#EDBE9C', tone: '#B47C8A', toneK: 0.26,
    litK: 0.5, shadeK: 0.52, expo: 0.86, litSide: 1, frontK: 0.2, shadowLen: 1.7,
    cloudLit: '#FFCF9A', cloudShade: '#8C78A6', cloudHi: '#FFE3B2', lightY: 0.22,
    line: '#4A3460', farHaze: '#B98FA8', water: ['#F2C690', '#7D6E9C'], mist: 0, lit: 0.5, stars: 0,
  },
  night: {
    sky: [[0, '#0B1630'], [0.22, '#112243'], [0.4, '#1A3159'], [0.52, '#25406B'], [0.6, '#2E4B78'], [0.7, '#33507C']],
    sun: { x: 0.79, y: 0.16, r: 300, c: '#9FB7DE', o: 0.4, disc: 0 },
    light: '#A9BFE4', shade: '#0E1930', haze: '#2A3F66', tone: '#16264A', toneK: 0.6,
    litK: 0.24, shadeK: 0.5, expo: 0.95, litSide: 1, frontK: 0.08, shadowLen: 0.75,
    cloudLit: '#5D7198', cloudShade: '#22345A', cloudHi: '#8EA0C4', lightY: -0.3,
    line: '#0E1832', farHaze: '#2B426B', water: ['#2D4873', '#13243F'], mist: 0, lit: 0.78, stars: 1,
  },
};

const SEASON = {
  autumn: {
    grass: ['#A4A85C', '#8F9C52', '#BCA65A', '#76894C', '#C8AE66'],
    leaf: ['#DC8A2E', '#E6A73E', '#C96A2C', '#D9952F', '#B9783A', '#9AA048'],
    leafLight: '#F4C35A', fallen: ['#DE8C34', '#C9692C', '#E9B04A', '#B7652E'],
    flowers: ['#E3A23C', '#C8642E', '#EFD08A', '#B8549A'],
    snow: false, bare: false, blossom: null,
  },
  summer: {
    grass: ['#86B25A', '#71A04F', '#9DBE66', '#5F8E4B', '#AFC76E'],
    leaf: ['#4E8A47', '#68A350', '#3E7445', '#82B35A', '#5B9A4C'],
    leafLight: '#B9D77A', fallen: null,
    flowers: ['#F2E2A0', '#E8A0B8', '#C9A7E8', '#F4C36A'],
    snow: false, bare: false, blossom: null,
  },
  spring: {
    grass: ['#93C46A', '#7DB05C', '#A9D076', '#6A9E55', '#BCD880'],
    leaf: ['#7DB664', '#97C66E', '#5E9B57', '#A9CF78', '#6DAA5C'],
    leafLight: '#CDE38E', fallen: null,
    flowers: ['#F3C7D2', '#F7E7A6', '#E9AFC2', '#FFFFFF'],
    snow: false, bare: false, blossom: ['#F4C9D4', '#F8DDE4', '#EAB1C3', '#FBEFF2'],
  },
  winter: {
    grass: ['#EEF2F6', '#DCE4EE', '#F7F8FA', '#CBD6E6', '#E4EAF2'],
    leaf: ['#3E5E58', '#4A6A60', '#34524D', '#557466', '#2E4A47'],
    leafLight: '#7E9C8A', fallen: null,
    flowers: null,
    snow: true, bare: true, blossom: null,
  },
};

function timeDef(time, weather) {
  const t = JSON.parse(JSON.stringify(TIME[time] || TIME.day));
  t.name = time;
  t.weather = weather || 'clear';
  const grey = time === 'night' ? '#26344C' : time === 'sunset' ? '#A79AA6' : '#AEB8C4';
  let wk = 0;
  if (weather === 'clouds') wk = 0.35;
  if (weather === 'rain') wk = 0.6;
  if (weather === 'snow') wk = 0.5;
  if (weather === 'fog') wk = 0.55;
  t.overcast = wk;
  if (wk) {
    t.sky = t.sky.map(([o, c]) => [o, mix(c, grey, wk)]);
    t.light = mix(t.light, '#E8E6E2', wk * 0.6);
    t.shadowLen *= 1 - wk * 0.7;
    t.sun.o *= 1 - wk * 0.8;
    t.cloudLit = mix(t.cloudLit, grey, wk * 0.5);
    t.cloudShade = mix(t.cloudShade, mix(grey, '#4A5266', 0.4), wk * 0.6);
    t.haze = mix(t.haze, grey, wk * 0.5);
  }
  if (weather === 'fog') t.mist = 1.6;
  return t;
}

/* --------------------------------------------------------------- svg pieces */

const op = (o) => (o != null && o < 0.999 ? ` fill-opacity="${f2(o)}"` : '');
function pg(pts, fill, o, ex = '') {
  return `<polygon points="${pts.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ')}" fill="${fill}"${op(o)}${ex}/>`;
}
function pth(d, fill, o, ex = '') {
  return `<path d="${d}" fill="${fill}"${op(o)}${ex}/>`;
}
function ell(cx, cy, rx, ry, fill, o, rot = 0) {
  const t = rot ? ` transform="rotate(${f1(rot)} ${f1(cx)} ${f1(cy)})"` : '';
  return `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(Math.max(0.2, rx))}" ry="${f1(Math.max(0.2, ry))}" fill="${fill}"${op(o)}${t}/>`;
}
function circ(cx, cy, r, fill, o) {
  return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(Math.max(0.2, r))}" fill="${fill}"${op(o)}/>`;
}
function rect(x, y, w, h, fill, o, ex = '') {
  return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(Math.max(0, w))}" height="${f1(Math.max(0, h))}" fill="${fill}"${op(o)}${ex}/>`;
}
function line(x1, y1, x2, y2, stroke, w = 1, o = 1, ex = '') {
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${stroke}" stroke-width="${f2(w)}"${o < 1 ? ` stroke-opacity="${f2(o)}"` : ''} stroke-linecap="round"${ex}/>`;
}
function spath(d, stroke, w = 1, o = 1, ex = '') {
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${f2(w)}"${o < 1 ? ` stroke-opacity="${f2(o)}"` : ''} stroke-linecap="round" stroke-linejoin="round"${ex}/>`;
}
const g = (inner, attrs = '') => `<g${attrs ? ' ' + attrs : ''}>${inner}</g>`;

function crPath(pts, closed) {
  const n = pts.length;
  if (n < 2) return '';
  const at = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

function crSample(pts, per) {
  const out = [];
  const n = pts.length;
  const at = (i) => pts[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([c(0), c(1)]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

function blobPts(r, cx, cy, rx, ry, j = 0.3, n = 10, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU + (r() - 0.5) * 0.4;
    const k = 1 - j / 2 + j * r();
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
const blob = (r, cx, cy, rx, ry, j, n, rot) => crPath(blobPts(r, cx, cy, rx, ry, j, n, rot), true);

function profile(x0, x1, step, fn) {
  const pts = [];
  for (let x = x0; x <= x1 + 0.01; x += step) pts.push([x, fn(x)]);
  const at = (x) => {
    const t = (x - x0) / step;
    const i = clamp(Math.floor(t), 0, pts.length - 2);
    const fr = clamp(t - i, 0, 1);
    return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * fr;
  };
  return { pts, at };
}
function areaUnder(prof, bottom) {
  const p = prof.pts;
  let d = `M${f1(p[0][0])},${f1(bottom)}`;
  for (const q of p) d += `L${f1(q[0])},${f1(q[1])}`;
  d += `L${f1(p[p.length - 1][0])},${f1(bottom)}Z`;
  return d;
}

/* -------------------------------------------------------------- the context */

function makeCtx(id, time, season, weather, extra) {
  const T = timeDef(time, weather);
  const S = SEASON[season] || SEASON.autumn;
  const seed = hashStr('sao:' + id);
  const key = [id, time, season, weather || 'clear', extra.weekend ? 'w' : '', extra.quiet ? 'q' : ''].join('|');
  const c = {
    id, time, season, weather: weather || 'clear', T, S, seed, extra,
    p: 'sp' + hashStr(key).toString(36),
    gi: 0,
    defs: [],
    sky: [], clouds: [], land: [], lights: [], front: [],
    li: 0,
    ...tools(mulberry(seed)),
  };
  // lighting randomness is separate so geometry is the same at every time
  c.L = tools(mulberry(seed ^ hashStr(time + season + (extra.quiet ? 'q' : ''))));
  c.sub = (k) => tools(mulberry(seed ^ hashStr(String(k))));
  c.P = (col, k = 0, d = 0) => paint(T, col, k, d);
  c.lineCol = mix(T.line, T.shade, 0.25);
  c.lg = (stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false) => {
    const gid = c.p + 'g' + c.gi++;
    c.defs.push(`<linearGradient id="${gid}" x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stops.map(([o, col, a]) => `<stop offset="${f2(o)}" stop-color="${col}"${a != null && a < 1 ? ` stop-opacity="${f2(a)}"` : ''}/>`).join('')}</linearGradient>`);
    return `url(#${gid})`;
  };
  c.rg = (stops, cx = 0.5, cy = 0.5, r = 0.5, fx, fy) => {
    const gid = c.p + 'g' + c.gi++;
    c.defs.push(`<radialGradient id="${gid}" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}"${fx != null ? ` fx="${f2(fx)}" fy="${f2(fy)}"` : ''}>${stops.map(([o, col, a]) => `<stop offset="${f2(o)}" stop-color="${col}"${a != null && a < 1 ? ` stop-opacity="${f2(a)}"` : ''}/>`).join('')}</radialGradient>`);
    return `url(#${gid})`;
  };
  c.clip = (shape) => {
    const gid = c.p + 'c' + c.gi++;
    c.defs.push(`<clipPath id="${gid}">${shape}</clipPath>`);
    return `url(#${gid})`;
  };
  c.f = (name) => `url(#${c.p}${name})`;
  c.glowGrad = c.rg([[0, '#FFE3A6', 0.9], [0.35, '#FFC879', 0.45], [1, '#FFB45E', 0]]);
  c.moonGlow = c.rg([[0, '#DCE6F6', 0.85], [0.4, '#B5C7E6', 0.25], [1, '#9FB4DA', 0]]);
  return c;
}

function paint(T, col, k = 0, d = 0) {
  let x = T.toneK ? mix(col, T.tone, T.toneK) : col;
  if (k > 0) x = mix(x, T.light, k * T.litK);
  else if (k < 0) x = mix(mul(x, 1 + k * 0.22), T.shade, -k * T.shadeK);
  if (T.expo !== 1) x = mul(x, T.expo);
  if (d > 0) x = mix(x, T.haze, d);
  return deepen(x);
}

// No pure black: the darkest darks fall to a deep blue green or a warm brown.
function lum(h) {
  const [r, g2, b] = rgb(h);
  return (0.2126 * r + 0.7152 * g2 + 0.0722 * b) / 255;
}
function deepen(x) {
  const l = lum(x);
  if (l >= 0.13) return x;
  const [r, , b] = rgb(x);
  return mix(x, r > b ? '#3E3230' : '#25373A', (0.13 - l) / 0.13 * 0.7);
}

function filters(c) {
  const s = c.seed % 997;
  const p = c.p;
  const washF = (name, col, seed, bf = '0.0022 0.0045') => {
    const [r0, g0, b0] = rgb(col).map((v) => f2(v / 255));
    return `<filter id="${p}${name}" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="3" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 ${r0} 0 0 0 0 ${g0} 0 0 0 0 ${b0} 1.7 0 0 0 -0.72"/></filter>`;
  };
  return [
    // soft watercolor edge
    `<filter id="${p}wc" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="${s}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    // pigment: wobbly edges plus darker granulation pooling in the wash (never holes)
    `<filter id="${p}pig" x="-6%" y="-10%" width="112%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="4" seed="${s + 1}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="${s + 2}" result="m"/><feColorMatrix in="m" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.8 0 0 0 -0.78" result="ma"/><feColorMatrix in="d" type="matrix" values="0.8 0 0 0 0 0 0.8 0 0 0 0 0 0.84 0 0 0 0 0 1 0" result="dk"/><feComposite in="dk" in2="ma" operator="in" result="dkm"/><feComposite in="dkm" in2="d" operator="in" result="dkc"/><feMerge><feMergeNode in="d"/><feMergeNode in="dkc"/></feMerge></filter>`,
    `<filter id="${p}soft" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="${s + 11}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="5"/></filter>`,
    // wet in wet: broad wash bands whose edges bleed into each other
    `<filter id="${p}wet" x="-10%" y="-40%" width="120%" height="180%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.018" numOctaves="3" seed="${s + 18}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="16 9"/></filter>`,
    // clouds: torn soft edges
    `<filter id="${p}cl" x="-25%" y="-40%" width="150%" height="180%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="${s + 3}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="2.4" result="b"/><feGaussianBlur in="d" stdDeviation="9" result="h"/><feMerge><feMergeNode in="h"/><feMergeNode in="b"/></feMerge></filter>`,
    `<filter id="${p}clsoft" x="-25%" y="-40%" width="150%" height="180%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="3" seed="${s + 4}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="40" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="7"/></filter>`,
    // tiny hand drawn wobble for architecture
    `<filter id="${p}arch" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="${s + 5}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    // foliage dab edges
    `<filter id="${p}leaf" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="${s + 6}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    // foreground foliage, slightly out of focus
    `<filter id="${p}fg" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="${s + 7}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="1.7"/></filter>`,
    `<filter id="${p}b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter>`,
    `<filter id="${p}b4" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>`,
    `<filter id="${p}b10" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>`,
    `<filter id="${p}b24" x="-40%" y="-60%" width="180%" height="220%"><feGaussianBlur stdDeviation="24"/></filter>`,
    // big soft washes that break flat gradients (tinted: one lighter, one cooler)
    washF('washL', mix(c.T.light, '#FFFFFF', 0.35), s + 8),
    washF('washS', c.T.shade, s + 12),
    // smaller blooms for glazes over buildings (wet in wet, pigment pooling)
    washF('bloomL', mix(c.T.light, '#FFF4DC', 0.3), s + 14, '0.011 0.016'),
    washF('bloomS', mix(c.T.shade, '#5E5E9A', 0.3), s + 15, '0.009 0.014'),
    // dry brush: strokes skip over the paper tooth
    `<filter id="${p}dry" x="-5%" y="-30%" width="110%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.018 0.42" numOctaves="2" seed="${s + 13}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3.2 -1.25" result="m"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" result="d"/><feComposite in="d" in2="m" operator="in"/></filter>`,
    // hand drawn architecture: long lines bow gently, then a fine wobble
    `<filter id="${p}archP" x="-4%" y="-6%" width="108%" height="112%"><feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="2" seed="${s + 16}" result="n1"/><feDisplacementMap in="SourceGraphic" in2="n1" scale="7" xChannelSelector="R" yChannelSelector="G" result="d1"/><feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="${s + 17}" result="n2"/><feDisplacementMap in="d1" in2="n2" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    // paper grain
    `<filter id="${p}paper" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${s + 9}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0.3 0 0 0 0 0.24 0 0 0 0 0.2 0 0 -2.2 0 1.25"/></filter>`,
  ].join('');
}

/* --------------------------------------------------------------------- sky */

function sky(c, o = {}) {
  const { T } = c;
  const hz = o.horizon || 420;
  // gradient stops are fractions of the height; squeeze toward the horizon
  const sc = hz / 420;
  const stops = T.sky.map(([of, col]) => [clamp(of * sc, 0, 1), col]);
  c.sky.push(rect(0, 0, W, H, c.lg(stops, 0, 0, 0, H, true)));
  skyBands(c, stops, hz);
  // painted wash: lighter and cooler blooms so the sky is not one flat gradient
  const wk = { morning: 0.5, day: 0.45, sunset: 0.32, night: 0.18 }[c.time] || 0.4;
  c.sky.push(rect(0, 0, W, H * 0.75, '#fff', 1, ` filter="${c.f('washL')}" opacity="${wk}"`));
  c.sky.push(rect(0, 0, W, H * 0.7, '#fff', 1, ` filter="${c.f('washS')}" opacity="${f2(wk * 0.45)}"`));
  // sun glow
  const sx = (o.sunX != null ? o.sunX : T.sun.x) * W;
  const sy = (o.sunY != null ? o.sunY : T.sun.y) * H;
  if (T.sun.o > 0.02) {
    const sg = c.rg([[0, T.sun.c, T.sun.o], [0.35, T.sun.c, T.sun.o * 0.45], [1, T.sun.c, 0]]);
    c.sky.push(circ(sx, sy, T.sun.r, sg));
    if (T.sun.disc && !T.overcast) {
      c.sky.push(g(circ(sx, sy, T.sun.disc, mix(T.sun.c, '#FFFFFF', 0.6), 0.85), `filter="${c.f('b4')}"`));
    }
  }
  if (T.stars) stars(c, hz);
  if (c.time === 'night') moon(c, sx, sy);
  c.horizon = hz;
  c.sunX = sx;
  c.sunY = sy;
}

function skyAt(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      return mix(ca, cb, (t - a) / Math.max(1e-6, b - a));
    }
  }
  return stops[stops.length - 1][1];
}

// The sky as a painter lays it: a few broad horizontal washes, each a little
// off the gradient (warmer near the horizon, cooler and deeper at the top),
// bleeding into each other, then a few big blooms and dry brush drags.
function skyBands(c, stops, hz) {
  const r = c.sub('bands' + c.time);
  const night = c.time === 'night';
  const warm = { morning: '#F7CDB4', day: '#EFE4CC', sunset: '#F8BE78', night: '#3C4C7C' }[c.time] || '#EFE4CC';
  const cool = { morning: '#7686BC', day: '#3A68AE', sunset: '#4A447E', night: '#071026' }[c.time] || '#3A68AE';
  const pink = { morning: '#EBB8BE', day: '#D8C4D0', sunset: '#D88C9E', night: '#2C3A66' }[c.time] || '#D8C4D0';
  let s = '';
  const n = r.RI(4, 5);
  for (let i = 0; i < n; i++) {
    const t = (i + r.R(0.25, 0.75)) / n;
    const y = t * hz * 1.05;
    const hh = (hz / n) * r.R(0.9, 1.5);
    let col = skyAt(stops, y / H);
    col = t > 0.55 ? mix(col, warm, (t - 0.55) * 0.75) : mix(col, cool, (0.55 - t) * 0.42);
    col = mix(col, r.ch(0.5) ? warm : cool, r.R(0, 0.08));
    const tilt = r.R(-26, 26);
    const top = [];
    const bot = [];
    for (let x = -120; x <= W + 120; x += r.R(140, 220)) top.push([x, y - hh / 2 + r.R(-16, 16) + tilt * (x / W - 0.5)]);
    for (let x = W + 120; x >= -120; x -= r.R(140, 220)) bot.push([x, y + hh / 2 + r.R(-16, 16) + tilt * (x / W - 0.5)]);
    s += pth(crPath([...top, ...bot], true), col, r.R(0.32, 0.52));
  }
  // blooms: where a wetter brush let pigment pool or lift
  for (let i = 0; i < 5; i++) {
    const t = r.R(0.05, 0.95);
    const x = r.R(-100, W + 100);
    const y = t * hz;
    const col = i === 4 ? pink : t > 0.6 ? warm : r.ch(0.6) ? cool : mix(skyAt(stops, y / H), '#FFFFFF', 0.25);
    s += ell(x, y, r.R(220, 520), r.R(40, 90), col, (i === 4 ? 0.18 : 0.22) * (night ? 0.7 : 1), r.R(-5, 5));
  }
  c.sky.push(g(s, `filter="${c.f('wet')}"`));
  // two or three long tapered strokes laid with a nearly dry brush:
  // warm cream on the sun side, a cool violet grey on the far side
  let dr = '';
  const sunR = (c.T.sun.x || 0.5) > 0.5;
  const ns = r.RI(2, 3);
  for (let i = 0; i < ns; i++) {
    const warmSide = i % 2 === 0;
    const L = r.R(180, 420);
    const th = r.R(14, 26);
    const onRight = warmSide === sunR;
    const x = onRight ? r.R(W * 0.52, W - L - 20) : r.R(20, W * 0.48 - L * 0.5);
    const y = r.R(hz * 0.16, hz * 0.7);
    const col = night ? '#5C6E9C' : warmSide ? '#F4E9D6' : '#8F9CC0';
    const op = night ? 0.06 : warmSide ? 0.1 : 0.08;
    const sag = r.R(-5, 5);
    // a fat head that drags out into a thin, broken tail
    const d = `M${f1(x)},${f1(y)}C${f1(x + L * 0.08)},${f1(y - th * 0.55)} ${f1(x + L * 0.45)},${f1(y - th * 0.5 + sag)} ${f1(x + L)},${f1(y - th * 0.08 + sag)}C${f1(x + L * 0.55)},${f1(y + th * 0.18 + sag)} ${f1(x + L * 0.12)},${f1(y + th * 0.5)} ${f1(x)},${f1(y)}Z`;
    dr += pth(d, col, op, ` transform="rotate(${f1(r.R(-4, 3))} ${f1(x)} ${f1(y)})"`);
  }
  c.sky.push(g(dr, `filter="${c.f('wc')}"`));
}

function stars(c, hz) {
  const r = c.sub('stars');
  let s = '';
  const n = Math.round(170 * (1 - c.T.overcast));
  for (let i = 0; i < n; i++) {
    const x = r.R(0, W);
    const y = Math.pow(r.r(), 1.6) * (hz - 60);
    const big = r.ch(0.06);
    const rad = big ? r.R(1.3, 2) : r.R(0.5, 1.2);
    const a = r.R(0.3, 0.95) * (1 - y / hz * 0.6);
    s += circ(x, y, rad, r.pick(['#F6F1DE', '#E3EAF8', '#FFF4D6']), a);
    if (big) s += circ(x, y, rad * 4, '#CFDCF0', 0.08);
  }
  c.sky.push(g(s));
}

function moon(c, x, y) {
  c.sky.push(circ(x, y, 150, c.moonGlow, 0.7));
  c.sky.push(circ(x, y, 26, '#F1EEDD', 0.96));
  c.sky.push(circ(x - 6, y - 4, 7, '#D9D8CC', 0.45));
  c.sky.push(circ(x + 8, y + 7, 5, '#D9D8CC', 0.35));
  c.sky.push(circ(x + 3, y - 11, 3.5, '#D9D8CC', 0.3));
}

/* ------------------------------------------------------------------ clouds */

function cumulus(c, cx, by, w, h, o = {}) {
  const { T } = c;
  const r = c.sub('cu' + Math.round(cx) + ':' + Math.round(by));
  const d = o.d || 0;
  const n = Math.max(4, Math.round(w / 44));
  const puffs = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const bump = Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * t)), 0.8);
    const rr = h * (0.18 + 0.4 * bump) * r.R(0.7, 1.15);
    puffs.push([cx - w / 2 + w * t + r.R(-12, 12), by - rr * r.R(0.45, 0.8), rr]);
  }
  const towers = o.towers != null ? o.towers : r.RI(2, 4);
  for (let k = 0; k < towers; k++) {
    const t = r.R(0.28, 0.72);
    const rr = h * r.R(0.3, 0.42) * (1.2 - Math.abs(t - 0.5));
    puffs.push([cx - w / 2 + w * t, by - h * r.R(0.5, 0.85), rr]);
  }
  for (let k = 0; k < 3; k++) {
    const t = r.ch(0.5) ? r.R(0, 0.12) : r.R(0.88, 1);
    puffs.push([cx - w / 2 + w * t, by - h * r.R(0.08, 0.25), h * r.R(0.08, 0.16)]);
  }
  // a few torn lobes hang off the edges so the outline is never a row of balls
  for (let k = 0; k < r.RI(2, 4); k++) {
    const [px, py, pr] = r.pick(puffs);
    const a = r.R(-Math.PI, 0);
    puffs.push([px + Math.cos(a) * pr * 0.9, py + Math.sin(a) * pr * 0.7, pr * r.R(0.25, 0.45)]);
  }
  const shape = puffs.map(([x, y, rr]) => pth(blob(r.r, x, y, rr * r.R(0.95, 1.2), rr * r.R(0.75, 0.95), 0.32, 9, r.R(-0.5, 0.5)), '#fff')).join('') + ell(cx, by - h * 0.12, w * 0.47, h * 0.13, '#fff');
  const sil = c.clip(shape);
  // the base is level in spirit only: it dips, lifts and breaks into lobes
  const bp = [[cx - w, by - h * 2.6], [cx + w, by - h * 2.6]];
  for (let k = 0; k <= 9; k++) {
    const t = 1 - k / 9;
    bp.push([cx - w + 2 * w * t, by + (k === 0 || k === 9 ? 0 : r.R(-h * 0.16, h * 0.07))]);
  }
  const flat = c.clip(pth(crPath(bp, true), '#fff'));
  const below = T.lightY > 0;
  const lit = mix(T.cloudLit, T.haze, d * 0.7);
  const shade = mix(T.cloudShade, T.haze, d);
  const hi = mix(T.cloudHi, T.haze, d * 0.6);
  const top = by - h * 1.05;
  const grad = c.lg(below
    ? [[0, mix(shade, lit, 0.15)], [0.5, mix(shade, lit, 0.5)], [0.82, lit], [1, hi]]
    : [[0, hi], [0.32, lit], [0.72, mix(lit, shade, 0.5)], [1, shade]], 0, top, 0, by, true);
  let s = rect(cx - w, top - h * 1.5, w * 2, by - top + h * 1.5 + 4, grad);
  const lx = T.litSide;
  let core = '';
  for (const [x, y, rr] of puffs) core += circ(x - lx * rr * 0.38, y + rr * (below ? -0.32 : 0.36), rr * 0.7, shade, 0.3);
  let hl = '';
  for (const [x, y, rr] of puffs) hl += circ(x + lx * rr * 0.34, y + rr * (below ? 0.32 : -0.36), rr * 0.48, below ? hi : hi, below ? 0.4 : 0.5);
  s += g(core, `filter="${c.f('b4')}"`) + g(hl, `filter="${c.f('b2')}"`);
  const a = o.op != null ? o.op : 1;
  // lost edge: the shadow side dissolves into the sky, the lit side stays found
  const mid = c.p + 'm' + c.gi++;
  const lose = r.R(0.05, 0.25);
  const mg = c.lg(lx < 0 ? [[0, '#fff', 1], [0.55, '#fff', 1], [1, '#fff', lose]] : [[0, '#fff', lose], [0.45, '#fff', 1], [1, '#fff', 1]], cx - w * 0.6, 0, cx + w * 0.6, 0, true);
  c.defs.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="${f1(cx - w * 1.3)}" y="${f1(by - h * 3.2)}" width="${f1(w * 2.6)}" height="${f1(h * 4)}"><rect x="${f1(cx - w * 1.3)}" y="${f1(by - h * 3.2)}" width="${f1(w * 2.6)}" height="${f1(h * 4)}" fill="${mg}"/></mask>`);
  c.clouds.push(g(g(g(g(s, `clip-path="${sil}"`), `clip-path="${flat}"`), `filter="${c.f('cl')}"`), `mask="url(#${mid})"${a < 1 ? ` opacity="${f2(a)}"` : ''}`));
  // a broken lobe and a wisp trailing off the lost side
  if (w > 200 && o.wisp !== false) {
    streak(c, cx - lx * w * r.R(0.45, 0.6), by - h * r.R(0.1, 0.4), w * r.R(0.35, 0.55), r.R(4, 8), { d: d + 0.1, op: 0.55 });
  }
}

function streak(c, cx, y, w, h, o = {}) {
  const { T } = c;
  const r = c.sub('st' + Math.round(cx) + ':' + Math.round(y));
  let s = '';
  const n = r.RI(3, 6);
  const base = mix(T.cloudShade, T.haze, o.d || 0);
  const lit = mix(T.cloudLit, T.haze, (o.d || 0) * 0.6);
  for (let i = 0; i < n; i++) {
    const x = cx + r.R(-w * 0.35, w * 0.35);
    const ww = w * r.R(0.3, 0.6);
    const yy = y + r.R(-h, h);
    s += ell(x, yy, ww / 2, h * r.R(0.5, 1), base, 0.75);
    s += ell(x + r.R(-10, 10), yy + h * 0.35 * (T.lightY > 0 ? 1 : -1), ww * 0.42, h * 0.38, lit, 0.85);
  }
  c.clouds.push(g(s, `filter="${c.f('clsoft')}" opacity="${f2(o.op || 0.9)}"`));
}

function cloudSky(c, o = {}) {
  const { T } = c;
  const r = c.sub('clouds' + c.time);
  const hz = c.horizon || 420;
  const amount = (o.amount != null ? o.amount : 1) * (1 + T.overcast * 1.5);
  const avoid = o.avoid != null ? o.avoid : (c.subject ? c.subject.cx : null);
  const place = (w) => {
    for (let k = 0; k < 8; k++) {
      const x = r.R(w / 2 + 30, W - w / 2 - 30);
      if (!avoid || Math.abs(x - avoid) > w * 0.45 + 60) return x;
    }
    return r.R(w / 2 + 30, W - w / 2 - 30);
  };
  if (c.time === 'sunset') {
    const n = Math.round(4 * amount);
    for (let i = 0; i < n; i++) streak(c, r.R(150, W - 150), r.R(hz * 0.18, hz * 0.8), r.R(300, 620), r.R(8, 18), { d: 0.1 });
    const big = Math.round(1.5 * amount);
    for (let i = 0; i < big; i++) {
      const w = r.R(320, 520);
      cumulus(c, place(w), r.R(hz * 0.45, hz * 0.7), w, r.R(110, 160), { d: 0.15 });
    }
    return;
  }
  if (c.time === 'night') {
    const n = Math.round(2 * amount);
    for (let i = 0; i < n; i++) streak(c, r.R(200, W - 200), r.R(hz * 0.25, hz * 0.8), r.R(300, 560), r.R(10, 20), { op: 0.7 });
    if (amount > 1.2) {
      const w = r.R(380, 520);
      cumulus(c, place(w), r.R(hz * 0.5, hz * 0.7), w, 130, { op: 0.8 });
    }
    return;
  }
  // morning and day: one or two big cumulus, a few small ones near the horizon
  const big = Math.max(1, Math.round((o.big != null ? o.big : 2) * amount));
  const used = [];
  for (let i = 0; i < big; i++) {
    const w = r.R(380, 620);
    let x = place(w);
    for (let k = 0; k < 6 && used.some((u) => Math.abs(u - x) < w * 0.7); k++) x = place(w);
    used.push(x);
    cumulus(c, x, r.R(hz * 0.42, hz * 0.62), w, r.R(150, 230), { d: 0.05 });
  }
  const small = Math.round(5 * amount);
  for (let i = 0; i < small; i++) {
    const w = r.R(120, 260);
    cumulus(c, r.R(w / 2 + 20, W - w / 2 - 20), r.R(hz * 0.72, hz * 0.95), w, r.R(40, 80), { d: 0.35, towers: r.RI(0, 1), op: 0.9 });
  }
  if (T.overcast > 0.3) {
    for (let i = 0; i < 5; i++) streak(c, r.R(150, W - 150), r.R(40, hz * 0.5), r.R(500, 900), r.R(24, 44), { op: 0.7 });
  }
}

/* --------------------------------------------------------- distant land */

function range(c, o) {
  const { T } = c;
  const r = c.sub('range' + o.base + ':' + (o.key || ''));
  const nz = noise1(r.r);
  const scale = o.scale || 420;
  const prof = profile(-30, W + 30, 8, (x) => {
    const v = fbm(nz, x / scale, 5);
    const ridged = 1 - Math.abs(fbm(nz, x / (scale * 0.6) + 40, 3) * 2 - 1);
    let y = o.base - o.amp * (0.55 * v + 0.45 * ridged);
    if (o.shape) y += o.shape(x);
    return y;
  });
  const d = o.d != null ? o.d : 0.6;
  const col = o.col || '#7F8DB5';
  const fh = T.farHaze || T.haze;
  const top = mix(c.P(col, 0.1, 0), fh, d);
  const bot = mix(c.P(col, -0.1, 0), mix(fh, T.haze, 0.5), Math.min(1, d + 0.25));
  const bottom = o.bottom || o.base + 160;
  let s = pth(areaUnder(prof, bottom), c.lg([[0, top], [0.7, bot], [1, mix(bot, T.haze, 0.5)]]));
  // lit facets running down from the peaks toward the light
  const pts = prof.pts;
  let fac = '';
  for (let i = 3; i < pts.length - 3; i++) {
    const [x, y] = pts[i];
    if (y < pts[i - 1][1] && y < pts[i + 1][1] && y < pts[i - 3][1] && y < pts[i + 3][1]) {
      const len = r.R(60, 140);
      const dir = T.litSide;
      const fx = x + dir * len;
      const fy = prof.at(fx) + r.R(30, 70);
      fac += pg([[x, y], [fx, prof.at(fx) + 2], [fx - dir * len * 0.2, fy], [x + dir * 6, y + (fy - y) * 0.8]], mix(c.P(col, 0.9, 0), fh, d * 0.8), 0.4);
      if (o.snow || c.S.snow) fac += pg([[x, y - 1], [x + dir * len * 0.3, prof.at(x + dir * len * 0.3) + 10], [x + 4, y + r.R(16, 30)], [x - dir * len * 0.25, prof.at(x - dir * len * 0.25) + 8]], mix('#F4F6FA', T.haze, d * 0.6), 0.75);
    }
  }
  s += fac;
  c.land.push(g(s, `filter="${c.f('pig')}"`));
  return prof;
}

function hazeBand(c, y, h, o = 0.55) {
  const { T } = c;
  c.land.push(rect(0, y - h / 2, W, h, c.lg([[0, T.haze, 0], [0.5, T.haze, o], [1, T.haze, 0]])));
}

function mist(c, y, h, o = {}) {
  const { T } = c;
  if (!T.mist && !o.force) return;
  const r = c.sub('mist' + y);
  const col = o.col || mix(T.haze, '#FFF6EE', 0.45);
  let s = '';
  const k = T.mist || 0.6;
  for (let i = 0; i < 6; i++) {
    s += ell(r.R(0, W), y + r.R(-h * 0.3, h * 0.3), r.R(260, 520), h * r.R(0.3, 0.6), col, 0.26 * k);
  }
  s += rect(-50, y - h * 0.25, W + 100, h * 0.5, col, 0.16 * k);
  c.land.push(g(s, `filter="${c.f('b24')}"`));
}

function grassCols(c, d = 0, k = 0) {
  const S = c.S;
  return [c.P(S.grass[0], 0.45 + k, d), c.P(S.grass[1], 0 + k, d), c.P(S.grass[2], 0.25 + k, d), c.P(S.grass[3], -0.5 + k, d), c.P(S.grass[4], 0.45 + k, d), mix(c.P(S.grass[1], -0.4, d), c.T.shade, 0.35)];
}

function dabs(c, prof, o) {
  // broken color in patches: neighboring hues laid side by side, flatter in the distance
  const r = c.sub('dabs' + (o.key || '') + (o.x0 || 0));
  const cols = o.cols;
  const x0 = o.x0 != null ? o.x0 : 0;
  const x1 = o.x1 != null ? o.x1 : W;
  const [s0, s1] = o.size || [4, 12];
  const [o0, o1] = o.op || [0.25, 0.55];
  let s = '';
  let made = 0;
  let guard = 0;
  while (made < o.n && guard++ < o.n * 3) {
    const x = r.R(x0, x1);
    const top = prof ? prof.at(x) : o.y0;
    const span = o.depth || 120;
    const t = Math.pow(r.r(), o.bias || 1);
    const y = top + 3 + t * span;
    const k = o.persp ? clamp((y - o.persp[0]) / (o.persp[1] - o.persp[0]), 0, 1) : 0.5;
    const col = r.pick(cols);
    const m = r.RI(4, 9);
    const spread = lerp(16, 64, k);
    for (let j = 0; j < m; j++) {
      const dx = x + r.R(-spread, spread);
      const dy = y + r.R(-spread * 0.22, spread * 0.22);
      if (prof && dy < prof.at(dx) + 2) continue;
      const rx = r.R(s0, s1) * lerp(0.45, 1.5, k);
      s += ell(dx, dy, rx, rx * lerp(0.2, 0.48, k) * r.R(0.8, 1.25), col, r.R(o0, o1), r.R(-7, 7));
    }
    made += m;
  }
  return s;
}

// A soft edged ground patch (gravel lot, square, yard, sand): a blurred wash
// with a textured core, so it melts into the grass instead of reading as a cut out.
function patch(c, shape, col, o = {}) {
  const r = c.sub('patch' + (o.key || '') + shape.length);
  const base = c.P(col, 0.45);
  const deep = c.P(col, -0.05);
  let s = g(pth(shape, c.lg([[0, base], [1, deep]])), `filter="${c.f('soft')}"`);
  let tex = '';
  const [x0, y0, x1, y1] = o.box;
  for (let i = 0; i < (o.n || 380); i++) {
    const y = r.R(y0, y1);
    const k = (y - y0) / Math.max(1, y1 - y0);
    tex += ell(r.R(x0, x1), y, lerp(1.4, o.big || 6, k) * r.R(0.7, 1.8), lerp(0.6, (o.big || 6) * 0.36, k), c.P(r.pick(o.cols || [col]), r.R(-0.35, 0.7)), r.R(0.35, 0.75));
  }
  const inner = c.clip(pth(shape, '#fff'));
  s += g(g(tex, `clip-path="${inner}"`), `filter="${c.f('soft')}" opacity="0.9"`);
  s += g(g(tex, `clip-path="${inner}"`), `filter="${c.f('arch')}" opacity="0.6"`);
  c.land.push(s);
}

function ground(c, prof, o = {}) {
  const { T } = c;
  const d = o.d || 0;
  const cols = o.cols || grassCols(c, d, o.k || 0);
  const bottom = o.bottom || H + 20;
  const topY = Math.min(prof.at(W * 0.25), prof.at(W * 0.5), prof.at(W * 0.75));
  const top = o.top || cols[0];
  const bot = o.bot || mix(cols[1], cols[3], 0.5);
  const area = o.shape || areaUnder(prof, bottom);
  const r = c.sub('gr' + (o.key || '') + Math.round(topY));
  let s = pth(area, c.lg([[0, top], [0.3, cols[1]], [1, bot]]));
  if (o.dabs !== 0) {
    s += dabs(c, prof, { n: o.dabs || 260, cols, depth: o.depth || (bottom - topY), size: o.size || [4, 13], bias: o.bias || 1.3, key: o.key || 'g', persp: o.persp, op: o.dop || [0.18, 0.45] });
  }
  if (o.leaves && c.S.fallen) {
    s += dabs(c, prof, { n: o.leaves, cols: c.S.fallen.map((x) => c.P(x, 0.25, d)), depth: o.depth || (bottom - topY), size: [1.6, 5], key: (o.key || 'g') + 'lv', op: [0.45, 0.85], persp: o.persp, bias: 1.2 });
  }
  const clipA = c.clip(pth(area, '#fff'));
  // big shapes of light and shadow give the ground its value structure
  let pools = '';
  const span = bottom - topY;
  const np = o.pools != null ? o.pools : 6;
  for (let i = 0; i < np; i++) {
    const t = r.R(0.05, 0.85);
    const y = topY + t * span;
    const litPool = i % 2 === 0;
    pools += ell(r.R(0, W), y, r.R(180, 460) * (0.5 + t), r.R(16, 50) * (0.4 + t * 1.4), litPool ? c.P(c.S.grass[4], 0.95, d) : mix(T.shade, cols[3], 0.35), litPool ? r.R(0.16, 0.3) : r.R(0.22, 0.36));
  }
  const nd = o.nearDark != null ? o.nearDark : 0.5;
  const near = rect(-20, topY, W + 40, bottom - topY, c.lg([[0, T.shade, 0], [0.45, T.shade, 0], [1, mix(T.shade, '#1E2A2A', 0.35), nd]]));
  let strokes = '';
  if (o.strokes) {
    const y0 = Math.max(topY + span * 0.35, o.strokesFrom || 0);
    for (let i = 0; i < o.strokes; i++) {
      const x = r.R(-10, W + 10);
      const y = y0 + Math.pow(r.r(), 0.7) * (bottom - y0);
      if (y < prof.at(x) + 4) continue;
      const k = clamp((y - topY) / span, 0, 1);
      const len = lerp(3, 26, k) * r.R(0.6, 1.3);
      const lean = r.R(-0.4, 0.4) * len;
      strokes += spath(`M${f1(x)},${f1(y)}Q${f1(x + lean * 0.2)},${f1(y - len * 0.6)} ${f1(x + lean)},${f1(y - len)}`, r.pick([cols[0], cols[1], cols[3], cols[4], cols[5]]), lerp(0.7, 2.6, k), r.R(0.45, 0.85));
    }
  }
  const body = o.shape ? g(g(s, `clip-path="${clipA}"`), `filter="${c.f('pig')}"`) : g(s, `filter="${c.f('pig')}"`);
  c.land.push(body + g(g(pools, `filter="${c.f('b24')}"`) + near, `clip-path="${clipA}"`) + (strokes ? (o.shape ? g(g(strokes, `clip-path="${clipA}"`), `filter="${c.f('leaf')}"`) : g(strokes, `filter="${c.f('leaf')}"`)) : ''));
}

function water(c, o) {
  const { T } = c;
  const r = c.sub('water' + o.y0);
  const [top, bot] = T.water;
  const y0 = o.y0;
  const y1 = o.y1;
  const shape = o.shape || `M${o.x0 != null ? o.x0 : -20},${y0}L${o.x1 != null ? o.x1 : W + 20},${y0}L${o.x1 != null ? o.x1 : W + 20},${y1}L${o.x0 != null ? o.x0 : -20},${y1}Z`;
  let s = pth(shape, c.lg([[0, mix(top, T.haze, 0.35)], [0.5, top], [1, bot]], 0, 0, 0, 1));
  // shimmer strokes
  let sh = '';
  const n = o.n || 60;
  const x0 = o.sx0 != null ? o.sx0 : 0;
  const x1 = o.sx1 != null ? o.sx1 : W;
  for (let i = 0; i < n; i++) {
    const y = y0 + Math.pow(r.r(), 0.8) * (y1 - y0);
    const k = (y - y0) / Math.max(1, y1 - y0);
    const x = r.R(x0, x1);
    const w = lerp(8, 50, k) * r.R(0.6, 1.4);
    sh += line(x - w / 2, y, x + w / 2, y, r.ch(0.5) ? mix(T.light, '#FFFFFF', 0.4) : mix(bot, T.shade, 0.4), lerp(0.8, 2.6, k), r.R(0.2, 0.5));
  }
  // long wave bands give the surface its perspective
  for (let i = 0; i < (o.bands || 26); i++) {
    const y = y0 + Math.pow(r.r(), 0.9) * (y1 - y0);
    const k = (y - y0) / Math.max(1, y1 - y0);
    const x = r.R(x0, x1);
    const w = lerp(60, 420, k) * r.R(0.5, 1.3);
    sh += line(x - w / 2, y, x + w / 2, y, r.ch(0.6) ? mix(bot, T.shade, 0.35) : mix(top, '#FFFFFF', 0.25), lerp(1, 5, k), r.R(0.1, 0.24));
  }
  // glitter path under the sun or the moon
  if ((c.time === 'sunset' || c.time === 'night' || c.time === 'morning') && o.glitter !== false && !T.overcast) {
    const gx = c.sunX;
    if (gx > x0 - 100 && gx < x1 + 100) {
      for (let i = 0; i < 40; i++) {
        const y = y0 + Math.pow(r.r(), 1.2) * (y1 - y0);
        const k = (y - y0) / Math.max(1, y1 - y0);
        const spread = lerp(30, 140, k);
        const x = gx + r.R(-spread, spread) * r.R(0.3, 1);
        const w = lerp(10, 46, k) * r.R(0.5, 1.2);
        sh += line(x - w / 2, y, x + w / 2, y, c.time === 'night' ? '#DDE6F4' : '#FFE7B0', lerp(1, 2.4, k), r.R(0.35, 0.8));
      }
    }
  }
  const clipped = o.shape ? g(sh, `clip-path="${c.clip(pth(shape, '#fff'))}"`) : sh;
  c.land.push(g(s, `filter="${c.f('arch')}"`) + clipped);
}

/* ---------------------------------------------------------------- foliage */

function leafCols(c, d = 0) {
  const S = c.S;
  return S.leaf.map((x) => c.P(x, 0, d));
}

const pt = (x, y) => f1(x) + ',' + f1(y);

function leaf(x, y, L, w, ang, fill, o) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (u, v) => pt(x + u * ca - v * sa, y + u * sa + v * ca);
  return `<path d="M${P(0, 0)}Q${P(L * 0.45, -w)} ${P(L, 0)}Q${P(L * 0.45, w)} ${P(0, 0)}Z" fill="${fill}"${op(o)}/>`;
}

// A crown of foliage: clustered masses with a shadow side, a mid tone, lit
// tops toward the light, broken edges and touches of neighboring hues.
function crown(c, r, x, cy, rx, ry, o = {}) {
  const { T, S } = c;
  const d = o.d || 0;
  const pal = o.cols || S.leaf;
  const base = r.pick(pal);
  const lx = T.litSide;
  const n = o.n || Math.round(12 + rx / 4);
  const cl = [];
  for (let k = 0; k < n; k++) {
    const a = r.R(0, TAU);
    const rr = Math.pow(r.r(), 0.5);
    const px = x + Math.cos(a) * rx * 0.78 * rr;
    const py = cy + Math.sin(a) * ry * 0.72 * rr * (Math.sin(a) > 0 ? 0.8 : 1);
    cl.push([px, py, Math.max(rx, ry) * r.R(0.12, 0.21) + 5, r.ch(0.85) ? mix(base, r.pick(pal), r.R(0, 0.3)) : r.pick(pal)]);
  }
  cl.sort((a, b) => a[1] - b[1]);
  const score = (px, py) => ((px - x) * lx) / rx - ((py - cy) / ry) * 1.15;
  let shade = '';
  let mid = '';
  let lit = '';
  let edgeL = '';
  let touch = '';
  shade += pth(blob(r.r, x, cy + ry * 0.04, rx * 0.82, ry * 0.72, 0.25, 11), c.P(base, -0.85, d));
  for (const [px, py, pr, col] of cl) shade += pth(blob(r.r, px, py, pr, pr * 0.85, 0.4, 9), c.P(col, -0.85, d));
  for (const [px, py, pr, col] of cl) {
    const sc = score(px, py);
    if (sc < -0.55) continue;
    mid += pth(blob(r.r, px + lx * pr * 0.22, py - pr * 0.24, pr * 0.8, pr * 0.66, 0.4, 9), c.P(col, sc > 0 ? 0.25 : -0.15, d), 0.95);
  }
  for (const [px, py, pr, col] of cl) {
    const sc = score(px, py);
    if (sc < 0.2) continue;
    lit += pth(blob(r.r, px + lx * pr * 0.42, py - pr * 0.42, pr * 0.5, pr * 0.36, 0.45, 8), c.P(mix(col, S.leafLight || col, 0.5), 0.95, d), 0.9);
  }
  // broken silhouette: loose leaves on the edge
  const ne = o.edgeLeaves != null ? o.edgeLeaves : Math.round(18 + rx / 4);
  for (let k = 0; k < ne; k++) {
    const a = r.R(0, TAU);
    const ex = x + Math.cos(a) * rx * r.R(0.82, 1.02);
    const ey = cy + Math.sin(a) * ry * r.R(0.78, 0.98);
    const sc = score(ex, ey);
    const L = Math.max(3, rx * r.R(0.06, 0.11));
    edgeL += leaf(ex, ey, L, L * 0.38, a + r.R(-0.8, 0.8), c.P(r.pick(pal), sc > 0.3 ? 0.6 : sc > -0.3 ? -0.2 : -0.8, d), 0.95);
  }
  for (let k = 0; k < (o.touches || Math.round(rx / 3)); k++) {
    const a = r.R(0, TAU);
    const rr = Math.sqrt(r.r());
    const tx = x + Math.cos(a) * rx * 0.85 * rr;
    const ty = cy + Math.sin(a) * ry * 0.75 * rr;
    const sc = score(tx, ty);
    const col = S.blossom && r.ch(0.75) ? r.pick(S.blossom) : r.pick(pal);
    touch += ell(tx, ty, rx * r.R(0.03, 0.07), rx * r.R(0.018, 0.035), c.P(col, sc > 0 ? 0.7 : -0.4, d), r.R(0.45, 0.85), r.R(-35, 35));
  }
  let holes = '';
  if (o.holes !== false && rx > 70) {
    for (let k = 0; k < 4; k++) {
      const hx = x + r.R(-rx * 0.6, rx * 0.6);
      const hy = cy + r.R(-ry * 0.3, ry * 0.35);
      holes += ell(hx, hy, rx * r.R(0.03, 0.06), rx * r.R(0.02, 0.04), mix(T.sky[2][1], T.haze, 0.35), 0.55);
    }
  }
  return { shade, mid, lit, edgeL, touch, holes };
}

function tree(c, x, y, s, o = {}) {
  const { T, S } = c;
  const r = c.sub('tree' + Math.round(x) + ':' + Math.round(y));
  const d = o.d || 0;
  const out = o.to || c.land;
  const lx = T.litSide;
  const trunk = c.P(o.trunk || '#5A4334', -0.4, d);
  const trunkLit = c.P(o.trunk || '#8C6C50', 0.6, d);
  const th = s * (o.trunkH || 0.9);
  const tw = s * (o.trunkW || 0.1);
  const cy = y - th - s * 0.42;
  let shadow;
  if (o.dapple) {
    // broken dappled shade: light falls through gaps in the crown
    const sx = x - lx * s * 0.6 * T.shadowLen;
    const sw = s * (0.75 + T.shadowLen * 0.6);
    let sd = '';
    for (let k = 0; k < 11; k++) sd += pth(blob(r.r, sx + r.R(-sw * 0.85, sw * 0.85), y + s * 0.04 + r.R(-s * 0.09, s * 0.1), r.R(s * 0.12, s * 0.32), r.R(s * 0.03, s * 0.07), 0.45, 8), mix(T.shade, '#1A2238', 0.3), r.R(0.18, 0.34) * (1 - d));
    shadow = g(sd, `filter="${c.f('b2')}"`);
  } else shadow = g(ell(x - lx * s * 0.6 * T.shadowLen, y + s * 0.04, s * (0.75 + T.shadowLen * 0.6), s * 0.14, mix(T.shade, '#1A2238', 0.3), 0.36 * (1 - d)), `filter="${c.f('b4')}"`);
  const lean = r.R(-0.08, 0.08) * s;
  let tr = pth(`M${pt(x - tw * 1.7, y + 2)}Q${pt(x - tw * 0.8, y - th * 0.12)} ${pt(x - tw * 0.7 + lean * 0.5, y - th * 0.5)}L${pt(x - tw * 0.42 + lean, y - th - s * 0.1)}L${pt(x + tw * 0.42 + lean, y - th - s * 0.1)}L${pt(x + tw * 0.7 + lean * 0.5, y - th * 0.5)}Q${pt(x + tw * 0.8, y - th * 0.12)} ${pt(x + tw * 1.7, y + 2)}Z`, trunk);
  tr += pth(`M${pt(x + lx * tw * 1.5, y + 1)}Q${pt(x + lx * tw * 0.7, y - th * 0.12)} ${pt(x + lx * tw * 0.6 + lean * 0.5, y - th * 0.5)}L${pt(x + lx * tw * 0.35 + lean, y - th)}L${pt(x + lx * tw * 0.05 + lean, y - th)}L${pt(x + lx * tw * 0.2 + lean * 0.5, y - th * 0.5)}L${pt(x + lx * tw * 0.4, y)}Z`, trunkLit, 0.55);
  let br = '';
  const nb = r.RI(3, 5);
  for (let k = 0; k < nb; k++) {
    const side = k % 2 ? 1 : -1;
    const by = y - th * r.R(0.6, 0.95);
    const ex = x + lean + side * s * r.R(0.25, 0.55);
    const ey = cy + r.R(-s * 0.3, s * 0.1);
    br += spath(`M${pt(x + lean * 0.7, by)}Q${pt(x + side * s * 0.15, by - s * 0.25)} ${pt(ex, ey)}`, trunk, tw * r.R(0.35, 0.6));
  }
  if (S.bare && !o.ever) {
    let bb = '';
    const branch = (bx, by, ang, len, w, depth) => {
      const ex = bx + Math.cos(ang) * len;
      const ey = by + Math.sin(ang) * len;
      bb += spath(`M${pt(bx, by)}Q${pt((bx + ex) / 2 + r.R(-6, 6), (by + ey) / 2)} ${pt(ex, ey)}`, trunk, w, 0.95);
      if (depth > 0) {
        branch(ex, ey, ang - r.R(0.25, 0.6), len * r.R(0.62, 0.78), w * 0.62, depth - 1);
        branch(ex, ey, ang + r.R(0.25, 0.6), len * r.R(0.62, 0.78), w * 0.62, depth - 1);
      } else if (r.ch(0.55)) {
        bb += ell(ex, ey - 1, 3 + s * 0.025, 1.6, c.P('#F5F7FA', 0.4, d), 0.85);
      }
    };
    for (const a of [-0.55, -0.15, 0.25, 0.6]) branch(x + lean, y - th * 0.9, -Math.PI / 2 + a, s * r.R(0.45, 0.6), tw * 0.8, 4);
    const haze = g(ell(x, cy, s * 0.95, s * 0.7, c.P('#8C7A86', -0.2, d), 0.16), `filter="${c.f('b10')}"`);
    out.push(shadow + haze + g(tr + bb, `filter="${c.f('arch')}"`) + (S.snow ? ell(x, y, s * 0.6, s * 0.08, '#F4F6F9', 0.8) : ''));
    return;
  }
  const k = crown(c, r, x + lean, cy, s * (o.wide || 1), s * 0.8, o);
  const w = canopyWash(c, r, x + lean, cy, s * (o.wide || 1), s * 0.8, d);
  out.push(shadow + g(w.back, `filter="${c.f('pig')}"`) + g(tr + br, `filter="${c.f('arch')}"`) + g(w.front, `filter="${c.f('pig')}"`) + g(w.lost, `filter="${c.f('b4')}"`) +
    g(k.lit + k.edgeL + k.touch + k.holes, `filter="${c.f('leaf')}" opacity="0.78"`));
}

// A canopy painted as 3 to 4 overlapping transparent washes: a cool shadow
// wash, the body color, a warm lit wash and a touch of green, each blob a
// different size so the silhouette is never one round ball. One outer
// wash is blurred so part of the edge is lost in the air.
function canopyWash(c, r, x, cy, rx, ry, d = 0) {
  const { T, S } = c;
  const lx = T.litSide;
  const pal = S.leaf;
  const autumn = !!S.fallen;
  const body = autumn ? '#C9772F' : pal[0];
  const lite = autumn ? '#E3A24A' : (S.leafLight || pal[pal.length - 1]);
  const deep = autumn ? '#9C5A2E' : pal[Math.min(1, pal.length - 1)];
  const green = '#7A8F5A';
  const B = (cx, cyy, a, b, j, n) => blob(r.r, cx, cyy, a, b, j, n, r.R(-0.4, 0.4));
  let back = '';
  // opaque underlayer: 6 to 9 wobbly lobes so sky and buildings never read through the crown
  const under = c.P(autumn ? '#8A5A34' : mix(deep, '#2E4A40', 0.25), -0.2, d);
  const nl = 6 + Math.floor(r.r() * 4);
  back += pth(B(x, cy + ry * 0.05, rx * 0.62, ry * 0.56, 0.22, 10), under, 1);
  for (let k = 0; k < nl; k++) {
    const a = (k / nl) * TAU + r.R(-0.3, 0.3);
    const lr = r.R(0.22, 0.34);
    back += pth(B(x + Math.cos(a) * rx * r.R(0.38, 0.52), cy + Math.sin(a) * ry * r.R(0.3, 0.46), rx * lr, ry * lr * r.R(0.8, 1.1), 0.35, 9), under, 1);
  }
  back += pth(B(x - lx * rx * 0.08, cy + ry * 0.08, rx * 0.86, ry * 0.74, 0.32, 11), c.P(mix(deep, '#5E3E2A', 0.35), -0.35, d), 0.9);
  back += pth(B(x - lx * rx * 0.42, cy + ry * 0.22, rx * 0.5, ry * 0.44, 0.38, 9), mix(c.P(deep, -0.5, d), '#4A5A54', 0.3), 0.7);
  let front = '';
  front += pth(B(x + lx * rx * 0.1, cy - ry * 0.12, rx * 0.72, ry * 0.58, 0.36, 10), c.P(body, 0.1, d), 0.62);
  front += pth(B(x - lx * rx * 0.3, cy - ry * 0.02, rx * 0.46, ry * 0.42, 0.4, 9), c.P(mix(body, deep, 0.4), -0.15, d), 0.5);
  front += pth(B(x + lx * rx * 0.32, cy - ry * 0.36, rx * 0.44, ry * 0.32, 0.42, 9), c.P(lite, 0.7, d), 0.6);
  front += pth(B(x + lx * rx * 0.05 + r.R(-rx * 0.2, rx * 0.2), cy + ry * 0.28, rx * 0.3, ry * 0.2, 0.45, 8), c.P(green, -0.1, d), autumn ? 0.3 : 0.18);
  // cool sky reflected into the shadow side
  front += pth(B(x - lx * rx * 0.5, cy + ry * 0.1, rx * 0.34, ry * 0.36, 0.4, 8), mix(T.shade, '#9CA8D0', 0.4), 0.16);
  const lost = pth(B(x + lx * rx * 0.2, cy - ry * 0.3, rx * 0.95, ry * 0.7, 0.3, 10), c.P(lite, 0.6, Math.max(d, 0.35)), 0.18);
  return { back, front, lost };
}

function bush(c, x, y, s, o = {}) {
  const { S } = c;
  const r = c.sub('bush' + Math.round(x) + ':' + Math.round(y));
  const d = o.d || 0;
  const flat = o.flat || 0.7;
  const k = crown(c, r, x, y - s * flat * 0.55, s, s * flat * 0.7, { d, cols: o.cols, n: o.n || 6, edgeLeaves: Math.round(8 + s / 3), touches: Math.round(s / 3), holes: false });
  let snow = '';
  if (S.snow) snow = pth(blob(r.r, x, y - s * flat * 0.95, s * 0.8, s * 0.18, 0.3, 8), c.P('#F5F7FA', 0.5, d), 0.9);
  (o.to || c.land).push(g(k.shade + k.mid + k.lit + k.edgeL + k.touch + snow, `filter="${c.f('leaf')}"`));
}

function pine(c, x, y, h, o = {}) {
  const { T, S } = c;
  const r = c.sub('pine' + Math.round(x) + ':' + Math.round(y));
  const d = o.d || 0;
  const base = c.P(o.col || '#3F6650', 0, d);
  const shade = c.P(o.col || '#3F6650', -0.7, d);
  const lit = c.P(o.col || '#5E8A5E', 0.7, d);
  let s = ell(x - T.litSide * h * 0.25 * T.shadowLen, y, h * 0.22 + T.shadowLen * h * 0.12, h * 0.05, T.shade, 0.25 * (1 - d));
  const tiers = o.tiers || 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const ty = y - h * (0.12 + t * 0.78);
    const w = h * 0.3 * (1 - t * 0.75);
    const th = h * 0.32;
    s += pg([[x, ty - th], [x + w, ty + r.R(-3, 3)], [x - w, ty + r.R(-3, 3)]], shade);
    s += pg([[x, ty - th], [x + T.litSide * w * 0.95, ty], [x + T.litSide * w * 0.1, ty + 2]], lit, 0.75);
    s += pg([[x, ty - th * 0.8], [x - T.litSide * w * 0.5, ty - 2], [x, ty]], base, 0.7);
    if (S.snow) s += pg([[x, ty - th], [x + w * 0.7, ty - th * 0.2], [x - w * 0.7, ty - th * 0.25]], c.P('#F4F7FA', 0.4, d), 0.85);
  }
  (o.to || c.land).push(g(s, `filter="${c.f('leaf')}"`));
}

function treeline(c, x0, x1, yAt, o = {}) {
  const r = c.sub('tl' + x0 + ':' + (o.key || ''));
  let x = x0;
  while (x < x1) {
    const s = r.R(o.min || 16, o.max || 34);
    if (o.pines && r.ch(o.pines)) pine(c, x, yAt(x) + 4, s * 2.2, { d: o.d });
    else bush(c, x, yAt(x) + s * 0.3, s, { d: o.d, flat: o.flat });
    x += s * r.R(0.8, 1.4);
  }
}

/* corners: dark soft foreground foliage (front layer) */
function frame(c, o = {}) {
  const { T, S } = c;
  const r = c.sub('frame');
  const night = c.time === 'night';
  const tint = (x) => (night ? mix(x, '#0B1622', 0.55) : c.time === 'sunset' ? mix(x, '#2E2138', 0.22) : mix(x, T.shade, 0.12));
  const accent = S.snow ? ['#2C3D3E', '#344848'] : S.blossom ? ['#3A5236', '#5A4A50'] : S.fallen ? ['#6A3C22', '#7E4A26', '#57361F'] : ['#2E4A30', '#3A5634'];
  const cols = ['#1C2E27', '#233A2D', '#2C4231', '#35302A', ...accent].map(tint);
  const rim = night ? '#7186AE' : mix(T.light, S.leaf[1], 0.4);
  let s = '';
  const cluster = (cx, cy, size, ang, dense = 1) => {
    let q = '';
    const n = Math.round(r.RI(18, 26) * dense);
    for (let i = 0; i < n; i++) {
      const a = ang + r.R(-1.3, 1.3);
      const L = r.R(16, 30) * (size / 60);
      q += leaf(cx + r.R(-size * 0.25, size * 0.25), cy + r.R(-size * 0.2, size * 0.2), L, L * r.R(0.3, 0.42), a, r.pick(cols), r.R(0.88, 1));
    }
    for (let i = 0; i < 3; i++) {
      const a = ang + r.R(-1, 1);
      const L = r.R(14, 24) * (size / 60);
      q += leaf(cx + r.R(-size * 0.2, size * 0.2), cy + r.R(-size * 0.25, 0), L, L * 0.36, a, rim, r.R(0.22, 0.45));
    }
    if (S.snow) q += ell(cx, cy - size * 0.25, size * 0.45, size * 0.1, '#DDE6EF', night ? 0.35 : 0.7);
    return q;
  };
  const canopy = (side, scale) => {
    const ox = side < 0 ? 0 : W;
    let q = g(pth(blob(r.r, ox, -20, 260 * scale, 150 * scale, 0.45, 12), cols[0], 0.95), `filter="${c.f('b10')}"`);
    // dense core at the corner
    for (let i = 0; i < 16; i++) {
      const a = r.R(0, Math.PI / 2);
      const dist = Math.sqrt(r.r()) * 200 * scale;
      q += cluster(ox - side * Math.cos(a) * dist * 1.3, Math.sin(a) * dist * 0.75, 80 * scale, side < 0 ? 0.6 : Math.PI - 0.6, 1.3);
    }
    const nb = r.RI(3, 4);
    for (let b = 0; b < nb; b++) {
      const ang = side < 0 ? r.R(0.12, 0.8) : Math.PI - r.R(0.12, 0.8);
      const len = r.R(200, 340) * scale;
      const sy = r.R(0, 90) * scale;
      const ex = ox + Math.cos(ang) * len;
      const ey = sy + Math.sin(ang) * len * 0.7;
      const mx = (ox + ex) / 2;
      const my = (sy + ey) / 2 - 24 * scale;
      q += spath(`M${pt(ox, sy)}Q${pt(mx, my)} ${pt(ex, ey)}`, tint('#2E2520'), 5 * scale, 0.95);
      for (let k = 1; k <= 5; k++) {
        const t = k / 5;
        const px = (1 - t) * (1 - t) * ox + 2 * (1 - t) * t * mx + t * t * ex;
        const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ey;
        q += cluster(px, py + 10 * scale, r.R(46, 64) * scale * (1.15 - t * 0.45), Math.PI / 2 + r.R(-0.6, 0.6), 1 - t * 0.3);
      }
    }
    return q;
  };
  const shrub = (side, scale) => {
    const ox = side < 0 ? 0 : W;
    let q = g(pth(blob(r.r, ox, H + 30, 280 * scale, 170 * scale, 0.45, 12), cols[0], 0.95), `filter="${c.f('b10')}"`);
    for (let i = 0; i < 22; i++) {
      const a = r.R(0, Math.PI / 2);
      const dist = Math.sqrt(r.r()) * 250 * scale;
      q += cluster(ox - side * Math.cos(a) * dist * 1.25, H - Math.sin(a) * dist * 0.75, r.R(54, 76) * scale, -Math.PI / 2 + r.R(-0.8, 0.8), 1.2);
    }
    for (let i = 0; i < 30; i++) {
      const bx = ox - side * r.R(0, 380) * scale;
      const by = H + 6;
      const bh = r.R(40, 120) * scale * (1 - Math.abs(bx - ox) / (420 * scale));
      if (bh < 10) continue;
      const lean = r.R(-0.35, 0.35) * bh - side * bh * 0.15;
      const w = r.R(2, 4.5) * scale;
      q += pth(`M${pt(bx - w, by)}Q${pt(bx + lean * 0.3, by - bh * 0.6)} ${pt(bx + lean, by - bh)}Q${pt(bx + lean * 0.3 + w * 0.3, by - bh * 0.55)} ${pt(bx + w, by)}Z`, r.pick(cols), 0.95);
    }
    if (o.flowers !== false && S.flowers && !night) {
      for (let i = 0; i < 9; i++) {
        const bx = ox - side * r.R(30, 300) * scale;
        const by = H - r.R(30, 140) * scale;
        q += circ(bx, by, r.R(2.6, 4.6) * scale, tint(mix(r.pick(S.flowers), '#5A4A50', 0.25)), 0.9);
      }
    }
    return q;
  };
  const sc = o.scale || 1;
  // the top corners: an overhanging bough that dips into the band the laptop
  // layout actually shows (the old corner canopy sat above it, out of view)
  const tl = o.tl !== false ? (o.tl || 1) * sc : 0;
  const tr = o.tr !== false ? (o.tr || 1) * sc : 0;
  const lead = tl === tr ? (hashStr(c.id) % 2 ? -1 : 1) : tl > tr ? -1 : 1;
  if (tl) s += overhang(c, -1, tl, lead === -1);
  if (tr) s += overhang(c, 1, tr, lead === 1);
  if (o.bl !== false) s += shrub(-1, (o.bl || 1) * sc);
  if (o.br !== false) s += shrub(1, (o.br || 1) * sc);
  c.front.push(g(s, `filter="${c.f('fg')}"`));
}

// The scene y where the laptop band starts for this place (vista geometry:
// 60 percent band at 1280x720 and 1440x900, cover scale, subject framing).
function bandTop(c) {
  const sb = c.subject;
  if (!sb) return 200;
  let best = 900;
  for (const [w, h] of [[1280, 432], [1440, 540], [1920, 648]]) {
    const scale = Math.max((w + 44) / W, (h + 44) / H);
    const ch = H * scale;
    const sTop = (sb.y0 / H) * ch;
    const sH = (sb.h / H) * ch;
    const m = Math.min(h * 0.1, 48);
    const slack = Math.max(0, h - sH - m * 2);
    let top = m + slack * 0.3 - sTop;
    top = Math.min(-22, Math.max(h + 22 - ch, top));
    best = Math.min(best, -top / scale);
  }
  return clamp(best, 60, 320);
}

// Near foliage hanging from above: a bough enters from the side edge, a soft
// wash anchors it to the corner, leaves droop below it in deep blue greens and
// olives, a few warm lit leaves on its upper side. Each place gets its own
// tree (broad, maple, needle or willow), the lead side reaches farther.
function overhang(c, side, scale, lead) {
  const { T, S } = c;
  const r = c.sub('overhang' + side);
  const night = c.time === 'night';
  const dusk = c.time === 'sunset';
  const tint = (x) => (night ? mix(x, '#13202E', 0.5) : dusk ? mix(x, '#3A2A3E', 0.18) : x);
  const kinds = ['broad', 'maple', 'needle', 'willow'];
  const kind = kinds[(hashStr(c.id + side) >>> 3) % 4];
  const base = ['#2F4A44', '#3A5240', '#4A5E3A', '#34483F', '#2F4A44'];
  const broken = ['#5E6E3A', '#4A4E66', '#56683E', '#3E5A5A'];
  const fall = S.fallen ? ['#7A4A2A', '#8C5A2E', '#6A4A30'] : S.snow ? ['#5A6A70'] : S.blossom ? ['#7A5A66'] : ['#58703E'];
  const cols = base.map(tint);
  const brk = broken.concat(fall).map(tint);
  const lit = night ? '#5E7090' : mix(T.light, S.fallen ? '#D9934A' : '#C9A85A', 0.5);
  const bt = bandTop(c);
  const ox = side < 0 ? -30 : W + 30;
  // the left corner sits under the status card in the laptop layout, so a
  // left lead bough reaches farther in to be seen past it
  const reach = (lead ? r.R(460, 560) * (side < 0 ? 1.15 : 1) : r.R(200, 300)) * scale;
  const sy = bt + r.R(0, 40) * scale;
  const ex = ox - side * reach;
  const ey = bt + r.R(60, 110) * scale;
  const mx = ox - side * reach * r.R(0.4, 0.55);
  const my = sy - r.R(10, 40) * scale;
  const B = (t) => [(1 - t) * (1 - t) * ox + 2 * (1 - t) * t * mx + t * t * ex, (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ey];
  // the corner mass: leafy clumps (not one disc) climbing from the bough to the
  // top edge, darker toward the corner, their lower edges lost
  let wash = '';
  const nm = lead ? 9 : 5;
  for (let i = 0; i < nm; i++) {
    const t = r.R(0, lead ? 0.7 : 0.8);
    const [px, py] = B(t);
    const cy = r.R(-20, py * 0.9);
    wash += pth(blob(r.r, px + r.R(-30, 30), Math.min(cy, py - 10), r.R(50, 110) * scale, r.R(30, 70) * scale, 0.55, 11, r.R(-0.5, 0.5)), r.pick([cols[0], cols[1], cols[3], tint('#3E4C5E')]), r.R(0.45, 0.7));
  }
  let crownLv = '';
  for (let i = 0; i < (lead ? 160 : 80); i++) {
    const t = r.R(0, 0.85);
    const [px, py] = B(t);
    const y = r.R(-10, py);
    const L = r.R(16, 30) * scale;
    crownLv += leaf(px + r.R(-50, 50) * scale, y, L, L * r.R(0.3, 0.45), r.R(0, TAU), r.ch(0.12) ? r.pick(brk) : r.pick(cols), r.R(0.55, 0.9));
  }
  // the bough itself: a tapered stroke, warm brown, never black, with a twig or two
  let wd = '';
  const N = 14;
  const w0 = (lead ? 16 : 10) * scale;
  let up = '';
  let dn = '';
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [px, py] = B(t);
    const ww = w0 * (1 - t * 0.85) * (0.9 + r.R(0, 0.2));
    up += (i ? 'L' : 'M') + pt(px, py - ww / 2);
    dn = 'L' + pt(px, py + ww / 2) + dn;
  }
  wd += pth(up + dn + 'Z', tint('#3E3226'), 0.92);
  wd += spath(`M${pt(...B(0.05))}Q${pt(...B(0.5))} ${pt(...B(0.9))}`, tint('#6A5440'), 1.4 * scale, 0.5, ' stroke-dasharray="40 18 22 30"');
  for (let k = 0; k < (lead ? 4 : 2); k++) {
    const t = r.R(0.25, 0.85);
    const [px, py] = B(t);
    const tx = px - side * r.R(30, 90) * scale;
    const ty = py + r.R(30, 90) * scale;
    wd += spath(`M${pt(px, py)}Q${pt(px - side * 10, py + 30 * scale)} ${pt(tx, ty)}`, tint('#3E3226'), r.R(2, 3.5) * scale, 0.85);
  }
  // leaves hanging below the bough
  let lv = '';
  let hi = '';
  const clusters = lead ? 20 : 10;
  for (let k = 0; k < clusters; k++) {
    const t = Math.pow(r.r(), 0.8) * 0.98;
    const [px, py] = B(t);
    const drop = r.R(10, 70) * scale * (kind === 'willow' ? 1.8 : 1);
    const size = r.R(38, 64) * scale * (1.15 - t * 0.4);
    const n = Math.round((kind === 'needle' ? 30 : kind === 'willow' ? 20 : 16) * (1.1 - t * 0.4));
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + side * 0.25 + r.R(-1.05, 1.05);
      const lx = px + r.R(-size * 0.5, size * 0.5);
      const ly = py + r.R(-size * 0.25, drop);
      let L = r.R(14, 26) * scale;
      let wf = r.R(0.3, 0.42);
      if (kind === 'maple') { L *= 1.1; wf = r.R(0.45, 0.6); }
      if (kind === 'needle') { L *= 0.8; wf = 0.1; }
      if (kind === 'willow') { L *= 1.5; wf = 0.16; }
      const roll = r.r();
      const col = roll < 0.16 ? r.pick(brk) : r.pick(cols);
      lv += leaf(lx, ly, L, L * wf, kind === 'willow' ? Math.PI / 2 + r.R(-0.3, 0.3) : a, col, r.R(0.6, 0.92));
    }
    // a few warm leaves on the upper side catching the light, and a cool one
    for (let i = 0; i < 3; i++) {
      const L = r.R(12, 20) * scale;
      hi += leaf(px + r.R(-size * 0.4, size * 0.4), py + r.R(-size * 0.3, 0), L, L * 0.38, -Math.PI / 2 + r.R(-1, 1), r.ch(0.78) ? lit : tint('#6E8494'), r.R(0.35, 0.7));
    }
  }
  // two or three loose leaves hanging free below the mass, lost against the sky
  for (let i = 0; i < 5; i++) {
    const [px, py] = B(r.R(0.3, 1));
    const L = r.R(12, 18) * scale;
    lv += leaf(px + r.R(-40, 40), py + r.R(60, 120) * scale, L, L * 0.36, Math.PI / 2 + r.R(-0.8, 0.8), r.pick(cols), r.R(0.4, 0.7));
  }
  const op0 = night ? 0.92 : 0.85;
  return g(g(wash, `filter="${c.f('wet')}"`) + g(crownLv + wd + lv, `filter="${c.f('fg')}"`) + g(hi, `filter="${c.f('fg')}"`), `opacity="${op0}"`);
}

/* ------------------------------------------------------------------- roads */

function road(c, pctPts, o = {}) {
  const { T, S } = c;
  const r = c.sub('road');
  const pts = [[pctPts[0][0] / 100 * W, H + 40], ...pctPts.map((p) => [p[0] / 100 * W, p[1] / 100 * H])];
  const dense = crSample(pts, 12);
  const yEnd = dense[dense.length - 1][1];
  const w0 = o.w0 || 300;
  const w1 = o.w1 || 30;
  const wAt = (y) => w1 + (w0 - w1) * Math.pow(clamp((y - yEnd) / (H - yEnd), 0, 1.2), o.pow || 1.25);
  const L = [];
  const Rr = [];
  for (let i = 0; i < dense.length; i++) {
    const w = wAt(dense[i][1]) / 2;
    L.push([dense[i][0] - w, dense[i][1]]);
    Rr.push([dense[i][0] + w, dense[i][1]]);
  }
  // round the far end
  const end = dense[dense.length - 1];
  const tip = [end[0], end[1] - Math.min(10, w1 * 0.12)];
  const outline = [...L, tip, ...Rr.slice().reverse()];
  const d = crPath(outline, true);
  const base = o.col || (S.snow ? '#E9EDF2' : '#D9C49A');
  const far = c.P(base, 0.5, 0.25);
  const near = c.P(base, 0.1, 0);
  let s = pth(d, c.lg([[0, far], [0.5, c.P(base, 0.35)], [1, near]], 0, 0, 0, 1));
  let tex = '';
  const kind = o.kind || 'dirt';
  const per = (y) => clamp((y - yEnd) / (H - yEnd), 0, 1);
  if (kind === 'dirt' || kind === 'gravel') {
    for (let i = 0; i < (kind === 'gravel' ? 260 : 140); i++) {
      const k = Math.pow(r.r(), 0.8);
      const idx = Math.floor(k * (dense.length - 1));
      const [cx, cy] = dense[idx];
      const w = wAt(cy) / 2;
      const x = cx + r.R(-w * 0.9, w * 0.9);
      const sz = lerp(1.5, kind === 'gravel' ? 5 : 9, per(cy));
      tex += ell(x, cy + r.R(-4, 4), sz * r.R(0.8, 2.2), sz * 0.5, r.pick([c.P(base, 0.85), c.P(base, -0.4), c.P('#B8A27A', 0), c.P('#E6D7B5', 0.6)]), r.R(0.3, 0.7));
    }
    if (kind === 'dirt') {
      // two worn ruts
      for (const side of [-0.28, 0.28]) {
        const rut = dense.map(([x, y]) => [x + side * wAt(y), y]);
        tex += spath(crPath(rut.filter((p, i) => i % 2 === 0), false), c.P(base, -0.35), 3, 0.25);
      }
    }
  } else if (kind === 'stone' || kind === 'cobble') {
    // joints across the walkway, spaced in perspective
    let y = H + 10;
    const base0 = kind === 'stone' ? 56 : 24;
    let step = base0;
    while (y > yEnd + 3) {
      const idx = dense.findIndex((p) => p[1] <= y);
      const [cx] = dense[Math.max(0, idx)] || end;
      const w = wAt(y) / 2;
      tex += line(cx - w * 0.98, y, cx + w * 0.98, y, c.P(base, -0.55), lerp(0.5, 2, per(y)), 0.5);
      // offset joints along
      const cols = kind === 'stone' ? 4 : 9;
      for (let k = 1; k < cols; k++) {
        const xx = cx - w + (2 * w * (k + (Math.round(y / step) % 2) * 0.5)) / cols;
        if (Math.abs(xx - cx) < w * 0.97) tex += line(xx, y, xx + (xx - cx) * 0.06, y - step * 0.9, c.P(base, -0.45), lerp(0.4, 1.5, per(y)), 0.35);
      }
      tex += rect(cx - w * 0.9, y - step * 0.5, w * 1.8 * r.R(0.2, 0.9), step * 0.3, c.P(base, 0.8), 0.08);
      step = base0 * (0.12 + 0.88 * Math.pow(per(y), 1.2));
      y -= Math.max(2.5, step);
    }
  }
  // grass and dabs nibbling the edges
  let edge = '';
  if (o.edges !== false) {
    const gc = grassCols(c, 0);
    for (let i = 0; i < 160; i++) {
      const idx = r.RI(0, dense.length - 1);
      const [cx, cy] = dense[idx];
      const side = r.pick([-1, 1]);
      const w = wAt(cy) / 2;
      const sz = lerp(2, 12, per(cy));
      edge += ell(cx + side * (w + r.R(-sz * 0.8, sz * 0.6)), cy, sz * r.R(0.8, 1.8), sz * 0.45, r.pick(gc), r.R(0.5, 0.9));
    }
  }
  // dappled shadows across the near road (long at morning and sunset)
  let dap = '';
  if (o.dapple !== false && T.shadowLen > 0.6) {
    for (let i = 0; i < 7; i++) {
      const y = H - r.R(10, 250);
      const idx = dense.findIndex((p) => p[1] <= y);
      const [cx] = dense[Math.max(0, idx)] || end;
      dap += ell(cx + r.R(-160, 160), y, r.R(60, 160) * T.shadowLen * 0.7, r.R(14, 28), mix(T.shade, '#1A2238', 0.2), 0.22);
    }
  }
  c.land.push(g(s + tex, `filter="${c.f('pig')}"`) + g(edge, `filter="${c.f('leaf')}"`) + g(dap, `filter="${c.f('b10')}"`));
  return { dense, wAt, yEnd, at: (y) => { const idx = dense.findIndex((p) => p[1] <= y); return (dense[Math.max(0, idx)] || end)[0]; } };
}

/* ------------------------------------------------------------ architecture */

// map a unit square to a face: F(a, b) with a across, b up
function face(o, u, v) {
  return (a, b) => [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b];
}
function quad(F, a0, b0, a1, b1) {
  return [F(a0, b0), F(a1, b0), F(a1, b1), F(a0, b1)];
}

// k for a face whose outward normal points to side s (-1 left, +1 right, 0 front)
function faceK(c, s) {
  if (s === 0) return c.T.frontK;
  return s === c.T.litSide ? 0.75 : -0.6;
}

function edge(c, w = 1) {
  return ` stroke="${c.edgeCol || c.lineCol}" stroke-width="${w}" stroke-opacity="${c.edgeO != null ? c.edgeO : 0.34}" stroke-linejoin="round"`;
}

// A light: emissive core plus halo, in the lights layer (pulses, dims at quiet hours)
function addLight(c, x, y, r, o = {}) {
  // The emissive core is painted in place (so whatever stands in front still
  // covers it); the soft halo goes to the lights layer, which pulses and dims.
  if (!o.always && !(c.time === 'sunset' || c.time === 'night')) return;
  const i = c.li++;
  const halo = o.halo || r * 5;
  if (o.shape) c.land.push(o.shape);
  else if (r > 0) c.land.push(circ(x, y, r, o.col || '#FFE2A0', 0.95));
  const ho = o.haloOp || (c.time === 'night' ? 0.7 : 0.5);
  c.lights.push(`<g class="lw" style="--i:${i}">${circ(x, y, halo, c.glowGrad, ho)}</g>`);
}

// A window on a face. Lit at sunset and night (in the lights layer).
function windowOn(c, F, a0, b0, a1, b1, o = {}) {
  const frame = o.frame || c.P('#EFE6D4', 0.3);
  const wr = c.sub('win' + f1(F(a0, b0)[0]) + ':' + f1(F(a0, b0)[1]));
  const deep = wr.pick(['#3A4A4E', '#4B3F45', '#44504E']);
  let glassDay = o.glass || c.P(deep, 0.1);
  if (lum(glassDay) < 0.27) glassDay = mix(glassDay, c.P(deep, 0.2), 0.75);
  if (o.vary !== false) {
    const da = (a1 - a0) * wr.R(-0.07, 0.07);
    const db = (b1 - b0) * wr.R(-0.08, 0.06);
    a0 -= da / 2; a1 += da / 2; b1 += db;
  }
  const out = o.to || c.land;
  let s = pg(quad(F, a0 - (o.fw || 0.012), b0 - (o.fh || 0.02), a1 + (o.fw || 0.012), b1 + (o.fh || 0.02)), frame);
  const inner = quad(F, a0, b0, a1, b1);
  s += pg(inner, glassDay);
  if (!c.T.lit) {
    // sky reflection
    s += pg([F(a0, b1), F(lerp(a0, a1, 0.55), b1), F(a0, lerp(b0, b1, 0.35))], mix(c.T.sky[3][1], '#FFFFFF', 0.3), 0.35);
  }
  if (o.content) s += o.content(F, a0, b0, a1, b1);
  const mull = (o.mullions != null ? o.mullions : 1);
  if (mull) {
    const am = (a0 + a1) / 2;
    s += line(...F(am, b0), ...F(am, b1), frame, o.mw || 1.4);
    const rows = o.rows || 1;
    for (let k = 1; k <= rows; k++) {
      const bm = lerp(b0, b1, k / (rows + 1));
      s += line(...F(a0, bm), ...F(a1, bm), frame, o.mw || 1.4);
    }
  }
  if (o.sill !== false) s += pg(quad(F, a0 - 0.02, b0 - 0.035, a1 + 0.02, b0 - 0.012), c.P('#E9DEC8', 0.6));
  out.push(s);
  // lit version on top, in the lights layer
  const litP = (o.litP != null ? o.litP : c.T.lit) * (c.extra.quiet && !o.keep ? 0.25 : 1);
  if (litP && c.L.r() < litP) {
    const ctr = F((a0 + a1) / 2, (b0 + b1) / 2);
    const gl = c.lg([[0, '#FFE4A4'], [0.6, '#FFC977'], [1, '#F2A65A']], 0, 0, 0, 1);
    let shape = pg(inner, gl, 0.96);
    if (o.content) shape += o.content(F, a0, b0, a1, b1, true);
    if (mull) {
      const am = (a0 + a1) / 2;
      shape += line(...F(am, b0), ...F(am, b1), mix(frame, '#5A3A2A', 0.5), o.mw || 1.4, 0.8);
      const rows = o.rows || 1;
      for (let k = 1; k <= rows; k++) {
        const bm = lerp(b0, b1, k / (rows + 1));
        shape += line(...F(a0, bm), ...F(a1, bm), mix(frame, '#5A3A2A', 0.5), o.mw || 1.4, 0.8);
      }
    }
    const p0 = F(a0, b0);
    const p1 = F(a1, b1);
    const size = Math.max(Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]));
    addLight(c, ctr[0], ctr[1], 0, { shape, halo: size * 1.6 + 8, always: true });
  }
}

function block(c, o) {
  // o: x (left of front), y (base), w, h, d (depth), side (+1 shows right side, -1 left), wall, roof
  const { x, y, w, h } = o;
  const d = o.d || w * 0.4;
  const side = o.side || 1;
  const dv = [side * d * 0.5, -d * 0.32];
  const dz = o.haze || 0;
  const wall = o.wall || '#E6D6B8';
  const out = o.to || c.land;
  const F = face([x, y], [w, 0], [0, -h]);
  const sx = side > 0 ? x + w : x;
  const S = face([sx, y], dv, [0, -h]);
  let s = '';
  s += pg(quad(F, 0, 0, 1, 1), c.P(wall, faceK(c, 0), dz), 1, edge(c, 1));
  s += pg(quad(S, 0, 0, 1, 1), c.P(wall, faceK(c, side), dz), 1, edge(c, 1));
  // weathering at the foot, light falling off down the wall, plaster touches
  s += pg(quad(F, 0, 0, 1, 1), c.lg([[0, mix(c.T.light, '#FFFFFF', 0.3), 0.22], [0.55, c.T.light, 0], [1, c.T.shade, 0.22]], 0, 0, 0, 1));
  s += pg(quad(F, 0, 0, 1, 0.12), c.P(wall, -0.5, dz), 0.25);
  const rw = c.sub('wall' + Math.round(x) + ':' + Math.round(y));
  s += massLight(c, F, S, side, wall, dz, rw, w, h);
  s += pg([[x - 2, y + 1], [x + w + 2, y + 1], [x + w + 2, y + 4], [x - 2, y + 4]], mix(c.T.shade, '#1A2238', 0.4), 0.38);
  const roofCol = o.roof || '#C77B4A';
  const top = y - h;
  const ov = o.overhang != null ? o.overhang : 6;
  const rh = o.roofH != null ? o.roofH : w * 0.32;
  const kind = o.kind || 'eave';
  if (kind === 'eave') {
    // ridge parallel to the front; we see the front slope and the side gable
    const A = [x - ov, top + 3];
    const B = [x + w + ov, top + 3];
    const Cc = [x + w + dv[0] / 2 + ov * 0.5, top + dv[1] / 2 - rh];
    const D = [x + dv[0] / 2 - ov * 0.5, top + dv[1] / 2 - rh];
    const sideTop = side > 0 ? [x + w, top] : [x, top];
    const back = [sideTop[0] + dv[0], top + dv[1]];
    const apex = side > 0 ? Cc : D;
    s += pg([sideTop, back, [apex[0], apex[1]]], c.P(wall, faceK(c, side) - 0.1, dz), 1, edge(c, 1));
    s += pg([A, B, Cc, D], c.P(roofCol, 0.35, dz), 1, edge(c, 1));
    s += roofTiles(c, A, B, Cc, D, roofCol, dz, o.tiles);
    if (c.S.snow) s += pg([D, Cc, lerpP(Cc, B, 0.45), lerpP(D, A, 0.45)], c.P('#F4F6F9', 0.5, dz), 0.95);
    if (o.lost !== false && dz < 0.3) s += roofLost(c, [A, B, Cc, D], [D, Cc]);
    out.push(s);
    return { F, S, top, ridge: [D, Cc], dv, apex };
  }
  if (kind === 'gable') {
    // gable end faces the viewer
    const apex = [x + w / 2, top - rh];
    s += pg([[x - ov * 0.4, top], [x + w + ov * 0.4, top], apex], c.P(wall, faceK(c, 0) - 0.05, dz), 1, edge(c, 1));
    const e1 = side > 0 ? [x + w + ov, top + 4] : [x - ov, top + 4];
    const e2 = [e1[0] + dv[0], e1[1] + dv[1]];
    const a2 = [apex[0] + dv[0], apex[1] + dv[1] - 2];
    s += pg([[apex[0], apex[1] - 3], e1, e2, a2], c.P(roofCol, side === c.T.litSide ? 0.6 : 0.05, dz), 1, edge(c, 1));
    s += roofTiles(c, e1, e2, a2, apex, roofCol, dz, o.tiles);
    if (o.lost !== false && dz < 0.3) s += roofLost(c, [[apex[0], apex[1] - 3], e1, e2, a2], [[apex[0], apex[1] - 3], a2]);
    if (c.S.snow) s += pg([[apex[0], apex[1] - 4], lerpP(apex, e1, 0.5), lerpP(a2, e2, 0.5), a2], c.P('#F4F6F9', 0.5, dz), 0.95);
    // barge board along the gable
    s += spath(`M${f1(x - ov)},${f1(top + 4)}L${f1(apex[0])},${f1(apex[1] - 3)}L${f1(x + w + ov)},${f1(top + 4)}`, c.P(roofCol, -0.4, dz), 3, 0.9);
    out.push(s);
    return { F, S, top, apex, dv };
  }
  if (kind === 'flat') {
    const T0 = face([x, top], [w, 0], dv);
    s += pg(quad(T0, 0, 0, 1, 1), c.P(o.roofTop || '#B7B2A8', 0.4, dz), 1, edge(c, 1));
    s += pg(quad(F, -0.005, 1, 1.005, 1.06), c.P(o.parapet || wall, 0.3, dz), 1, edge(c, 0.8));
    out.push(s);
    return { F, S, top, dv };
  }
  out.push(s);
  return { F, S, top, dv };
}

// Shared hero building light: a clear sun side, a cool transparent shadow
// side with a wet bloom along the terminator, plaster dabs without outlines.
function massLight(c, F, S, side, wall, dz, rw, w, h) {
  const { T } = c;
  const sh = mix('#8E93A8', T.shade, c.time === 'day' ? 0.12 : 0.3);
  const shadowSide = side !== T.litSide;
  const SF = shadowSide ? S : F;
  const op = shadowSide ? rw.R(0.45, 0.55) : 0.3;
  let q = '';
  q += g(pg(quad(SF, -0.02, -0.02, 1.02, 1.02), sh, op), `style="mix-blend-mode:multiply"`);
  // the terminator is the corner between the faces: pigment pools there
  const cx = side > 0 ? 1 : 0;
  q += g(spath(`M${f1(F(cx, 0)[0])},${f1(F(cx, 0)[1])}L${f1(F(cx, 1)[0])},${f1(F(cx, 1)[1])}`, mix(sh, '#5A5476', 0.35), Math.max(5, w * 0.06), 0.3), `filter="${c.f('soft')}"`);
  // the sun side catches a thin warm glaze
  const LF = shadowSide ? F : S;
  q += pg(quad(LF, 0, 0.1, 1, 1), mix(T.light, '#FFD9A0', 0.4), c.time === 'night' ? 0.04 : 0.16);
  const n = Math.round(6 + (w * h) / 600);
  for (let k = 0; k < n; k++) {
    const onSide = rw.ch(0.3);
    const P = onSide ? S : F;
    q += ell(...P(rw.R(0.04, 0.96), rw.R(0.06, 0.94)), rw.R(3, 9), rw.R(1.2, 3.4), c.P(rw.pick([wall, '#D9C9AE', '#F4EAD8', '#CBBBA0', '#C9B7B0', '#B9BFC4']), rw.R(-0.4, 0.6), dz), rw.R(0.35, 0.45), rw.R(-12, 12));
  }
  return q;
}

// The roof line against the sky loses its edge over about 30 px.
function roofLost(c, poly, ridge) {
  const skyC = mix(c.T.sky[3][1], c.T.light, 0.35);
  return g(g(spath(`M${f1(ridge[0][0])},${f1(ridge[0][1])}L${f1(ridge[1][0])},${f1(ridge[1][1])}`, skyC, 30, 0.6), `filter="${c.f('b10')}"`), `clip-path="${c.clip(pg(poly, '#000'))}"`);
}

function lerpP(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function roofTiles(c, A, B, Cc, D, col, dz, kind) {
  // rows of tiles as broken strokes parallel to the eave
  if (kind === false) return '';
  let s = '';
  const rows = 6;
  for (let i = 1; i < rows; i++) {
    const t = i / rows;
    const p = lerpP(A, D, t);
    const q = lerpP(B, Cc, t);
    s += line(p[0], p[1], q[0], q[1], c.P(col, -0.45, dz), 1, 0.35);
  }
  // irregular touches
  const r = c.sub('tiles' + Math.round(A[0]) + Math.round(A[1]));
  for (let i = 0; i < 14; i++) {
    const t = r.r();
    const u = r.r();
    const p = lerpP(lerpP(A, D, t), lerpP(B, Cc, t), u);
    s += ell(p[0], p[1], r.R(3, 8), r.R(1, 2), c.P(r.pick([col, '#B8643A', '#D99560', '#9E5A3E']), r.R(-0.3, 0.6), dz), 0.5);
  }
  return s;
}

function chimney(c, x, y, w, h, o = {}) {
  const col = o.col || '#B9A58C';
  let s = rect(x, y - h, w, h, c.P(col, faceK(c, 0)), 1, edge(c, 1));
  s += rect(x + (c.T.litSide < 0 ? w * 0.65 : 0), y - h, w * 0.35, h, c.P(col, -0.6), 0.6);
  s += rect(x - 2, y - h - 4, w + 4, 5, c.P(col, 0.4), 1, edge(c, 0.8));
  (o.to || c.land).push(s);
  if (o.smoke !== false) smoke(c, x + w / 2, y - h - 6, o.smokeSize || 1);
}

function smoke(c, x, y, k = 1) {
  const { T } = c;
  const r = c.sub('smoke' + Math.round(x));
  let s = '';
  const col = c.time === 'night' ? '#7D8CAB' : mix(T.cloudLit, T.haze, 0.3);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const sx = x + Math.sin(t * 3 + 1) * 12 * k + t * 60 * k * -T.litSide * 0.6;
    const sy = y - t * 150 * k;
    s += circ(sx, sy, (6 + t * 22) * k, col, 0.42 * (1 - t * 0.8));
  }
  c.land.push(g(s, `filter="${c.f('b4')}"`));
}

function castShadow(c, x0, x1, y, h, o = {}) {
  const { T } = c;
  const dir = -T.litSide;
  const len = h * T.shadowLen * 0.6;
  const dy = Math.min(26, len * 0.12) + 4;
  const pts = [[x0, y], [x1, y], [x1 + dir * len, y + dy], [x0 + dir * len, y + dy]];
  (o.to || c.land).push(g(pg(pts, mix(T.shade, '#1A2238', 0.25), o.op || 0.34), `filter="${c.f('b4')}"`));
}

function lampPost(c, x, y, h, o = {}) {
  const col = o.col || '#3E4656';
  const pole = c.P(col, -0.1);
  const lit = c.P(col, 0.7);
  const w = Math.max(1.3, h * 0.024);
  let s = '';
  s += ell(x - c.T.litSide * h * 0.3 * c.T.shadowLen, y + 1, w * 3 + h * 0.2 * c.T.shadowLen, w * 1.2, c.T.shade, 0.3);
  s += pg([[x - w * 2, y], [x + w * 2, y], [x + w * 1.2, y - h * 0.12], [x - w * 1.2, y - h * 0.12]], pole);
  s += rect(x - w / 2, y - h, w, h, pole);
  s += rect(x + (c.T.litSide < 0 ? -w / 2 : 0), y - h, w / 2, h, lit, 0.5);
  // lantern head
  const hy = y - h;
  const lw = w * 2.4;
  s += pg([[x - lw * 0.7, hy - lw * 0.2], [x + lw * 0.7, hy - lw * 0.2], [x + lw, hy - lw * 1.9], [x - lw, hy - lw * 1.9]], c.P('#3E4A5E', -0.2));
  s += pg([[x - lw * 0.5, hy - lw * 0.35], [x + lw * 0.5, hy - lw * 0.35], [x + lw * 0.75, hy - lw * 1.75], [x - lw * 0.75, hy - lw * 1.75]], c.P('#E8DEC2', 0.2), 0.8);
  s += pg([[x - lw * 1.2, hy - lw * 1.9], [x + lw * 1.2, hy - lw * 1.9], [x, hy - lw * 2.8]], pole);
  s += circ(x, hy - lw * 2.9, w * 0.8, pole);
  (o.to || c.land).push(g(s, `filter="${c.f('arch')}"`));
  addLight(c, x, hy - lw * 1.05, lw * 0.6, { halo: h * 0.42 + 10, shape: pg([[x - lw * 0.5, hy - lw * 0.35], [x + lw * 0.5, hy - lw * 0.35], [x + lw * 0.75, hy - lw * 1.75], [x - lw * 0.75, hy - lw * 1.75]], '#FFE2A0', 0.95) });
  if (c.time === 'sunset' || c.time === 'night') {
    c.lights.push(g(ell(x, y + 2, h * 0.34, h * 0.07, '#FFC879', 0.14), `class="lw" filter="${c.f('b10')}"`));
  }
}

function bench(c, x, y, w, o = {}) {
  const wood = o.col || '#8A6446';
  let s = ell(x - c.T.litSide * w * 0.2, y + 2, w * 0.6, w * 0.08, c.T.shade, 0.3);
  s += rect(x - w / 2, y - w * 0.28, w, w * 0.07, c.P(wood, 0.5), 1, edge(c, 0.6));
  s += rect(x - w / 2, y - w * 0.46, w, w * 0.07, c.P(wood, 0.2), 1, edge(c, 0.6));
  s += rect(x - w * 0.44, y - w * 0.28, w * 0.05, w * 0.28, c.P(wood, -0.5));
  s += rect(x + w * 0.39, y - w * 0.28, w * 0.05, w * 0.28, c.P(wood, -0.5));
  if (c.S.snow) s += rect(x - w / 2, y - w * 0.31, w, w * 0.04, '#F2F5F8', 0.9);
  (o.to || c.land).push(g(s, `filter="${c.f('arch')}"`));
}

function stoneBench(c, x, y, w) {
  const st = '#CFC3AE';
  let s = ell(x - c.T.litSide * w * 0.25, y + 3, w * 0.62, w * 0.09, c.T.shade, 0.32);
  s += rect(x - w / 2, y - w * 0.22, w, w * 0.1, c.P(st, 0.6), 1, edge(c, 0.6));
  s += rect(x - w / 2, y - w * 0.12, w, w * 0.04, c.P(st, -0.5));
  s += rect(x - w * 0.4, y - w * 0.12, w * 0.12, w * 0.12, c.P(st, -0.2));
  s += rect(x + w * 0.28, y - w * 0.12, w * 0.12, w * 0.12, c.P(st, -0.2));
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

function well(c, x, y, rad) {
  const st = '#BFB4A2';
  let s = ell(x - c.T.litSide * rad * 0.6, y + 3, rad * 1.5, rad * 0.35, c.T.shade, 0.32);
  s += rect(x - rad, y - rad * 0.8, rad * 2, rad * 0.8, c.lg([[0, c.P(st, c.T.litSide < 0 ? 0.6 : -0.5)], [0.5, c.P(st, 0.2)], [1, c.P(st, c.T.litSide < 0 ? -0.6 : 0.6)]], 0, 0, 1, 0));
  s += ell(x, y, rad, rad * 0.32, c.P(st, -0.3));
  s += ell(x, y - rad * 0.8, rad, rad * 0.32, c.P(st, 0.5), 1, 0);
  s += ell(x, y - rad * 0.8, rad * 0.78, rad * 0.22, c.P('#2B3A4A', -0.3));
  // stone joints
  for (let i = 0; i < 3; i++) s += line(x - rad, y - rad * (0.25 + i * 0.22), x + rad, y - rad * (0.25 + i * 0.22), c.P(st, -0.6), 0.8, 0.4);
  // little roof on posts
  const wood = '#7A5A40';
  s += rect(x - rad * 0.95, y - rad * 2.3, rad * 0.12, rad * 1.5, c.P(wood, -0.3));
  s += rect(x + rad * 0.83, y - rad * 2.3, rad * 0.12, rad * 1.5, c.P(wood, -0.3));
  s += pg([[x - rad * 1.3, y - rad * 2.2], [x + rad * 1.3, y - rad * 2.2], [x, y - rad * 3]], c.P('#B86F45', 0.3), 1, edge(c, 0.7));
  s += line(x - rad * 0.8, y - rad * 2.0, x + rad * 0.8, y - rad * 2.0, c.P(wood, -0.2), 1.4);
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

function board(c, x, y, w, h, o = {}) {
  const wood = '#8A6446';
  let s = ell(x - c.T.litSide * w * 0.3, y + 2, w * 0.7, w * 0.1, c.T.shade, 0.3);
  s += rect(x - w * 0.45, y - h * 1.4, w * 0.08, h * 1.4, c.P(wood, -0.4));
  s += rect(x + w * 0.37, y - h * 1.4, w * 0.08, h * 1.4, c.P(wood, -0.4));
  s += rect(x - w / 2, y - h * 1.4, w, h, c.P(wood, 0.25), 1, edge(c, 0.8));
  s += pg([[x - w * 0.6, y - h * 1.4], [x + w * 0.6, y - h * 1.4], [x, y - h * 1.75]], c.P('#9A6E48', 0.3), 1, edge(c, 0.6));
  const r = c.sub('board' + Math.round(x));
  const papers = o.papers != null ? o.papers : 4;
  for (let i = 0; i < papers; i++) {
    const px = x - w * 0.4 + r.R(0, w * 0.6);
    const py = y - h * 1.35 + r.R(0, h * 0.55);
    s += rect(px, py, w * 0.2, h * 0.3, c.P(r.pick(['#F3EFE6', '#EAD9B4', '#E8E2D2']), 0.4), 0.95, ` transform="rotate(${f1(r.R(-6, 6))} ${f1(px)} ${f1(py)})"`);
  }
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

function flowerBed(c, pts, o = {}) {
  const r = c.sub('bed' + Math.round(pts[0][0]) + ':' + Math.round(pts[0][1]));
  const cols = o.cols || c.S.flowers || ['#C9C2B0'];
  let s = '';
  for (let i = 0; i < pts.length; i++) {
    const [x, y, sz] = pts[i];
    s += ell(x, y, sz * 1.4, sz * 0.5, c.P(c.S.leaf[2] || '#4E7A45', -0.3), 0.85);
    for (let k = 0; k < 4; k++) s += circ(x + r.R(-sz, sz), y - r.R(0, sz * 0.5), sz * r.R(0.18, 0.3), c.P(r.pick(cols), r.R(0, 0.6)), 0.95);
  }
  c.land.push(g(s, `filter="${c.f('leaf')}"`));
}

function birds(c, list, col) {
  let s = '';
  for (const [x, y, sz] of list) {
    s += spath(`M${f1(x - sz)},${f1(y - sz * 0.3)}Q${f1(x - sz * 0.4)},${f1(y - sz * 0.6)} ${f1(x)},${f1(y)}Q${f1(x + sz * 0.4)},${f1(y - sz * 0.6)} ${f1(x + sz)},${f1(y - sz * 0.35)}`, col || c.P('#4A4E66', -0.2), Math.max(1, sz * 0.18), 0.85);
  }
  c.land.push(s);
}

function vignette(c, o = 0.35) {
  const { T } = c;
  const col = c.time === 'night' ? '#0A1222' : mix(T.shade, '#20263A', 0.4);
  // the lower ground falls into shadow so the lit subject carries the picture
  const y0 = c.subject ? c.subject.y1 - 20 : 560;
  const k = { morning: 0.22, day: 0.16, sunset: 0.42, night: 0.34 }[c.time] || 0.2;
  const sh = c.time === 'sunset' ? '#6E4E7A' : c.time === 'night' ? '#1A2440' : mix(T.shade, '#8A90B0', 0.3);
  c.land.push(rect(0, y0, W, H - y0 + 10, c.lg([[0, sh, 0], [0.5, sh, k * 0.6], [1, sh, k]]), 1, ' style="mix-blend-mode:multiply"'));
  c.land.push(rect(0, 0, W, H, c.rg([[0, col, 0], [0.6, col, 0], [1, col, o]], 0.5, 0.48, 0.75)));
}

function warmLight(c) {
  const { T } = c;
  if (c.time === 'sunset') {
    c.land.push(rect(0, 0, W, H, c.rg([[0, '#FFC370', 0.32], [0.6, '#FFAE60', 0.08], [1, '#FFAE60', 0]], c.sunX / W, c.sunY / H, 0.7), 1, ' style="mix-blend-mode:screen"'));
  } else if (c.time === 'morning') {
    c.land.push(rect(0, 0, W, H, c.rg([[0, '#FFE6CC', 0.3], [0.7, '#FFE6CC', 0.04], [1, '#FFE6CC', 0]], c.sunX / W, c.sunY / H, 0.75), 1, ' style="mix-blend-mode:screen"'));
  } else if (c.time === 'night') {
    c.land.push(rect(0, 0, W, H, c.rg([[0, '#9FB4DA', 0.12], [1, '#9FB4DA', 0]], c.sunX / W, c.sunY / H, 0.8), 1, ' style="mix-blend-mode:screen"'));
  }
  if (T.overcast) c.land.push(rect(0, 0, W, H, mix(T.haze, '#B8BEC8', 0.4), T.overcast * 0.18));
}

function rectOf(place) {
  const s = place.subject;
  return { cx: s.x / 100 * W, cy: s.y / 100 * H, w: s.w / 100 * W, h: s.h / 100 * H, x0: (s.x - s.w / 2) / 100 * W, x1: (s.x + s.w / 2) / 100 * W, y0: (s.y - s.h / 2) / 100 * H, y1: (s.y + s.h / 2) / 100 * H };
}

/* --------------------------------------------------------- shared objects */

function lanterns(c, list) {
  let s = '';
  for (const [x, y] of list) {
    s += line(x, y - 9, x, y - 4, c.P('#4A3A30', -0.2), 0.8);
    s += rect(x - 2.6, y - 4, 5.2, 7.5, c.P('#D9B070', 0.3), 0.95);
    s += rect(x - 3.2, y - 4.6, 6.4, 1.4, c.P('#5A4434', 0));
  }
  c.land.push(s);
  for (const [x, y] of list) addLight(c, x, y, 2.6, { halo: 16, col: '#FFD27E' });
}

function cylinder(c, x, yb, wb, wt, yt, col, o = {}) {
  const { T } = c;
  const L = T.litSide < 0;
  const d = o.d || 0;
  const body = [[x - wb / 2, yb], [x + wb / 2, yb], [x + wt / 2, yt], [x - wt / 2, yt]];
  const [cLit, cMid, cSh] = o.cols || [c.P(col, 0.75, d), c.P(col, 0.02, d), null];
  const sh = mix(o.shadow || '#8E93A8', T.shade, c.time === 'day' ? 0.12 : 0.3);
  // u across the body (0 on the lit side), v up
  const at = (u, v) => {
    const hw = lerp(wb, wt, v) / 2;
    const xx = L ? x - hw + u * 2 * hw : x + hw - u * 2 * hw;
    return [xx, lerp(yb, yt, v)];
  };
  const band = (u0, u1) => [at(u0, -0.02), at(u1, -0.02), at(u1, 1.02), at(u0, 1.02)];
  const cp = c.clip(pg(body, '#000'));
  const r = c.sub('cyl' + Math.round(x) + ':' + Math.round(yt));
  let w = pg(body, cMid);
  // lit wash, the mid wash already lies under it, then the cool shadow third
  w += g(pg(band(-0.1, 0.36), cLit, 0.9) + pg(band(0.3, 0.56), cLit, 0.38), `filter="${c.f('wc')}"`);
  w += g(pg(band(0.64, 1.1), c.P(col, -0.45, d), 0.8), `filter="${c.f('wc')}"`);
  w += g(pg(band(0.66, 1.1), sh, o.shOp || 0.52), `filter="${c.f('wc')}" style="mix-blend-mode:multiply"`);
  // wet bloom along the terminator: pigment pooled where the two washes met
  w += g(spath(`M${f1(at(0.68, -0.02)[0])},${f1(yb)}L${f1(at(0.68, 1.02)[0])},${f1(yt)}`, mix(sh, '#5A5476', 0.35), Math.max(6, wb * 0.09), 0.34), `filter="${c.f('soft')}"`);
  if (cSh) w += g(pg(band(0.8, 1.1), cSh, 0.4), `filter="${c.f('wc')}"`);
  // bounce light from the ground warms the very edge of the shadow side
  w += pg(band(0.93, 1.1), mix(T.light, '#D9A877', 0.5), 0.16);
  // irregular stone or plaster dabs, no outlines
  const nd = o.dabs != null ? o.dabs : Math.round(((wb + wt) / 2) * (yb - yt) / 900);
  const dc = o.dabCols || [mix(col, '#C9C0AE', 0.6), mix(col, '#9E9585', 0.6), mix(col, '#B9A9A0', 0.4), mix(col, '#A9B0BC', 0.4)];
  let dd = '';
  for (let i = 0; i < nd; i++) {
    const u = r.R(0.04, 0.96);
    const v = r.R(0.02, 0.97);
    const [px, py] = at(u, v);
    dd += ell(px, py, r.R(3, 9) * (wb / 90), r.R(1.6, 3.6), c.P(r.pick(dc), u < 0.5 ? 0.3 : -0.4, d), r.R(0.35, 0.45), r.R(-10, 10));
  }
  w += g(dd, `filter="${c.f('pig')}"`);
  // the sky side dissolves: lost edge 30 px wide over the upper body
  if (o.lost !== false) {
    const skyC = mix(T.sky[3][1], T.light, 0.35);
    const [ex, ey] = at(0, 1);
    const lostW = Math.min(30, wb * 0.3);
    const gr = c.lg([[0, skyC, 0.7], [1, skyC, 0]], L ? 0 : 1, 0, L ? 1 : 0, 0);
    w += g(rect(L ? ex - 4 : ex - lostW + 4, ey - 4, lostW, (yb - yt) * 0.55, gr), `filter="${c.f('b4')}"`);
  }
  return g(w, `clip-path="${cp}"`);
}

function footbridge(c, x, y, w, d) {
  const white = c.P('#F4F1E8', 0.5, d);
  const shade = c.P('#F4F1E8', -0.5, d);
  let s = '';
  s += spath(`M${f1(x)},${f1(y + 4)}Q${f1(x + w / 2)},${f1(y - 22)} ${f1(x + w)},${f1(y + 4)}`, white, 3.2);
  s += spath(`M${f1(x)},${f1(y + 8)}Q${f1(x + w / 2)},${f1(y - 16)} ${f1(x + w)},${f1(y + 8)}`, shade, 1.6, 0.7);
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const bx = x + w * t;
    const by = y + 4 - 26 * 4 * t * (1 - t) * 0.5 * 1.7;
    s += line(bx, by, bx, by - 7, white, 0.8, 0.8);
  }
  s += spath(`M${f1(x)},${f1(y - 3)}Q${f1(x + w / 2)},${f1(y - 29)} ${f1(x + w)},${f1(y - 3)}`, white, 1, 0.8);
  // reflection
  s += spath(`M${f1(x + 10)},${f1(y + 12)}Q${f1(x + w / 2)},${f1(y + 30)} ${f1(x + w - 10)},${f1(y + 12)}`, white, 2, 0.25);
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

function tinyHouse(c, x, y, s, o = {}) {
  const r = c.sub('th' + Math.round(x) + ':' + Math.round(y));
  const d = o.d || 0;
  const wall = o.wall || r.pick(['#EADBC0', '#E3CFAE', '#F0E4CC']);
  const roof = o.roof || r.pick(['#C4743F', '#B9653A', '#D08A4E', '#9A6A54']);
  const w = s * r.R(1, 1.5);
  const h = s * r.R(0.6, 0.85);
  let q = rect(x - w / 2, y - h, w, h, c.P(wall, c.T.frontK, d));
  q += pg([[x + w / 2, y], [x + w / 2 + s * 0.35, y - s * 0.2], [x + w / 2 + s * 0.35, y - h - s * 0.2], [x + w / 2, y - h]], c.P(wall, faceK(c, 1), d));
  q += pg([[x - w / 2 - 2, y - h + 1], [x + w / 2 + s * 0.37, y - h - s * 0.2 + 1], [x + w / 2 + s * 0.2, y - h - s * 0.6], [x - w / 2 + s * 0.15, y - h - s * 0.45]], c.P(roof, 0.3, d));
  if (c.S.snow) q += pg([[x - w / 2, y - h - 1], [x + w / 2 + s * 0.3, y - h - s * 0.22], [x + w / 2 + s * 0.2, y - h - s * 0.6], [x - w / 2 + s * 0.15, y - h - s * 0.45]], c.P('#F4F6F9', 0.5, d), 0.9);
  (o.to || c.land).push(q);
  if (c.T.lit && c.L.r() < c.T.lit * 0.8) {
    const wx = x + r.R(-w * 0.3, w * 0.2);
    const wy = y - h * 0.55;
    addLight(c, wx, wy, 0, { shape: rect(wx - s * 0.1, wy - s * 0.1, s * 0.2, s * 0.22, '#FFD58A', 0.95), halo: s * 0.7 + 4, haloOp: 0.5 });
  }
}

function village(c, x0, x1, yAt, o = {}) {
  const r = c.sub('village' + x0);
  let x = x0;
  const list = [];
  while (x < x1) {
    const s = r.R(o.min || 9, o.max || 15);
    list.push([x + r.R(-4, 4), yAt(x) + r.R(-6, 8), s]);
    x += s * r.R(1.4, 2.4);
  }
  list.sort((a, b) => a[1] - b[1]);
  for (const [hx, hy, s] of list) {
    if (r.ch(0.25)) bush(c, hx + s, hy + 2, s * 0.9, { d: o.d });
    tinyHouse(c, hx, hy, s, { d: o.d });
  }
}

function rocks(c, list, o = {}) {
  const { T } = c;
  let s = '';
  for (let [x, y, w, h] of list) {
    const r = c.sub('rock' + Math.round(x) + ':' + Math.round(y));
    const col = mix(o.col || '#A49C9C', r.pick(['#B4A28E', '#9A9AB0', '#A8A08A', '#B9A6A0']), r.R(0.1, 0.45));
    const tilt = r.R(-0.28, 0.28);
    w *= r.R(0.86, 1.14);
    h *= r.R(0.8, 1.2);
    const d = o.d || 0;
    const n = 9;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = Math.PI * t;
      const py = y - Math.sin(a) * h * r.R(0.7, 1.05) * (0.85 + 0.3 * Math.sin(a * 2.3 + r.R(0, 2)));
      pts.push([x - Math.cos(a) * w * 0.5 * r.R(0.9, 1.05) + (y - py) * tilt, py]);
    }
    s += g(ell(x - T.litSide * w * 0.3, y + 2, w * 0.62, h * 0.12, T.shade, 0.32 * (1 - d)), `filter="${c.f('b4')}"`);
    s += pg(pts, c.P(col, -0.55, d));
    // a lit top plane and a lit flank toward the light
    const top = pts.slice(2, 8).map(([px, py]) => [px, py + h * 0.04]);
    const ctr = [x + T.litSide * w * 0.05, y - h * 0.5];
    s += pg([...top, ctr], c.P(col, 0.55, d), 0.9);
    const flank = T.litSide < 0 ? [pts[0], pts[1], pts[2], pts[3], ctr, [x - w * 0.1, y]] : [pts[n], pts[n - 1], pts[n - 2], pts[n - 3], ctr, [x + w * 0.1, y]];
    s += pg(flank, c.P(col, 0.95, d), 0.75);
    // cracks and touches of neighboring greys and ochres
    for (let k = 0; k < 4; k++) {
      const cx = x + r.R(-w * 0.35, w * 0.35);
      const cy = y - r.R(h * 0.1, h * 0.7);
      s += spath(`M${f1(cx)},${f1(cy)}l${f1(r.R(-6, 6))},${f1(r.R(8, 18))}l${f1(r.R(-6, 6))},${f1(r.R(6, 14))}`, c.P(col, -0.9, d), 1.2, 0.5);
    }
    for (let k = 0; k < 10; k++) s += ell(x + r.R(-w * 0.4, w * 0.4), y - r.R(h * 0.1, h * 0.85), r.R(3, 9), r.R(1.5, 4), c.P(r.pick(['#B8A890', '#8E8AA2', '#C4BCB0', '#9A8E7E']), r.R(-0.4, 0.7), d), 0.45);
    if (c.S.snow) s += pg(top, c.P('#F4F6F9', 0.5, d), 0.9);
    else if (o.moss !== false) for (let k = 0; k < 3; k++) s += ell(x + r.R(-w * 0.3, w * 0.3), y - h * r.R(0.6, 0.85), w * r.R(0.08, 0.18), h * 0.06, c.P(c.S.grass[1], 0.4, d), 0.75);
  }
  c.land.push(g(s, `filter="${c.f('pig')}"`));
}

function windowsGrid(c, F, cols, rows, o = {}) {
  const ax0 = o.ax0 != null ? o.ax0 : 0.08;
  const ax1 = o.ax1 != null ? o.ax1 : 0.92;
  const by0 = o.by0 != null ? o.by0 : 0.2;
  const by1 = o.by1 != null ? o.by1 : 0.85;
  const cw = (ax1 - ax0) / cols;
  const rh = (by1 - by0) / rows;
  const fw = o.fill || 0.55;
  const fh = o.fillH || 0.62;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a0 = ax0 + cw * i + cw * (1 - fw) / 2;
      const b0 = by0 + rh * j + rh * (1 - fh) / 2;
      windowOn(c, F, a0, b0, a0 + cw * fw, b0 + rh * fh, o);
    }
  }
}

function door(c, F, a0, a1, b1, o = {}) {
  const wood = o.col || '#6E4A34';
  let s = pg(quad(F, a0 - 0.015, 0, a1 + 0.015, b1 + 0.03), c.P('#D9CCB4', 0.2));
  s += pg(quad(F, a0, 0, a1, b1), c.P(wood, -0.2), 1, edge(c, 0.8));
  for (let k = 1; k < 4; k++) {
    const a = lerp(a0, a1, k / 4);
    s += line(...F(a, 0.01), ...F(a, b1 - 0.01), c.P(wood, -0.6), 0.8, 0.6);
  }
  s += circ(...F(a1 - (a1 - a0) * 0.2, b1 * 0.45), 1.6, c.P('#E8C88E', 0.5));
  (o.to || c.land).push(s);
}

function sail(c, pts, o = {}) {
  const { T } = c;
  const [a, b, d] = pts;
  const mid = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3 + 6];
  const col = '#F6F2EA';
  let s = pth(`M${f1(a[0])},${f1(a[1])}Q${f1((a[0] + b[0]) / 2)},${f1((a[1] + b[1]) / 2 + 8)} ${f1(b[0])},${f1(b[1])}Q${f1((b[0] + d[0]) / 2)},${f1((b[1] + d[1]) / 2 + 6)} ${f1(d[0])},${f1(d[1])}Q${f1((d[0] + a[0]) / 2)},${f1((d[1] + a[1]) / 2 + 6)} ${f1(a[0])},${f1(a[1])}Z`, c.lg([[0, c.P(col, 0.8)], [1, c.P(col, -0.35)]], T.litSide < 0 ? 0 : 1, 0, T.litSide < 0 ? 1 : 0, 1), 0.96, edge(c, 0.6));
  // the belly of the cloth seen from below: cool violet grey, soft edge
  const sag = o.sag || 12;
  s += pth(`M${f1(a[0])},${f1(a[1])}Q${f1(mid[0])},${f1(mid[1] + sag)} ${f1(b[0])},${f1(b[1])}Q${f1((a[0] + b[0]) / 2)},${f1((a[1] + b[1]) / 2 + sag * 0.35)} ${f1(a[0])},${f1(a[1])}Z`, '#B7BCD0', 0.5);
  s += spath(`M${f1(a[0])},${f1(a[1])}Q${f1((a[0] + d[0]) / 2 - 4)},${f1((a[1] + d[1]) / 2 + 3)} ${f1(d[0])},${f1(d[1])}`, mix(c.P(col, 1), '#FFF8E8', 0.4), 1.6, 0.7);
  (o.to || c.land).push(g(s, `filter="${c.f('arch')}"`));
}


/* ------------------------------------------------------- painterly glazes */

// Transparent layered washes over a subject, clipped to its silhouette:
// warm light glaze on the lit side, cool violet glaze on the far side,
// wet in wet blooms, broken color dabs and dry brush on stone or brick.
function glaze(c, shape, box, o = {}) {
  const { T } = c;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  const cp = c.clip(shape);
  const r = c.sub('glaze' + (o.key || '') + Math.round(x0));
  const litL = T.litSide < 0;
  const warm = mix(T.light, '#FFDDA6', 0.45);
  const cool = mix(T.shade, '#6C6CA6', 0.4);
  // evening light is already one warm glaze: keep the overlays thin so lit windows still glow
  const k = (o.k != null ? o.k : 1) * ({ morning: 0.85, day: 1, sunset: 0.5, night: 0.35 }[c.time] || 1);
  let s = '';
  s += rect(x0, y0, w, h, c.lg([[0, warm, 0.34 * k], [0.5, warm, 0.06 * k], [0.62, cool, 0.03 * k], [1, cool, 0.24 * k]], litL ? 0 : 1, 0.1, litL ? 1 : 0, 0.5), 1, ' style="mix-blend-mode:soft-light"');
  // light falls off toward the foot of the wall, the foot picks up ground bounce
  s += rect(x0, y0, w, h, c.lg([[0, warm, 0.16 * k], [0.55, warm, 0], [0.86, cool, 0.12 * k], [1, mix(cool, '#7A6A4A', 0.4), 0.26 * k]]), 1);
  s += rect(x0, y0, w, h, '#FFF', 1, ` filter="${c.f('bloomL')}" opacity="${f2(0.2 * k)}"`);
  s += rect(x0, y0, w, h, '#FFF', 1, ` filter="${c.f('bloomS')}" opacity="${f2(0.42 * k)}" style="mix-blend-mode:multiply"`);
  // broken color: the wall holds yellow, rose, blue and green dabs
  const cols = o.cols || ['#F0CF7A', '#E6A79C', '#9EB0D8', '#B9C98C', '#F4E3C0', '#C99A7A'];
  let d = '';
  const n = o.n || Math.round((w * h) / 700);
  for (let i = 0; i < n; i++) {
    const x = r.R(x0, x1);
    const y = r.R(y0, y1);
    const side = (x - x0) / w;
    const lean = litL ? 1 - side : side;
    const col = r.ch(0.35 + lean * 0.3) ? r.pick(cols.slice(0, 2).concat(cols[4])) : r.pick(cols);
    d += ell(x, y, r.R(4, 15), r.R(2, 6), c.P(col, 0.1), r.R(0.14, 0.32) * Math.min(1, k * 1.3), r.R(-25, 25));
  }
  s += g(d, `filter="${c.f('pig')}"`);
  // dry brush: horizontal strokes catch the tooth of the paper
  if (o.dry !== false) {
    let db = '';
    const m = o.dryN || Math.round(h / 3);
    for (let i = 0; i < m; i++) {
      const y = r.R(y0, y1);
      const xa = r.R(x0 - 20, x1 - 30);
      const len = r.R(30, 160);
      const lean = litL ? 1 - (xa - x0) / w : (xa - x0) / w;
      const light = r.ch(0.35 + lean * 0.35);
      const col = light ? mix(warm, '#FFF6E2', 0.4) : mix(cool, o.dark || '#5A4A4A', 0.3);
      db += spath(`M${f1(xa)},${f1(y)}q${f1(len / 2)},${f1(r.R(-2, 2))} ${f1(len)},${f1(r.R(-1.5, 1.5))}`, col, r.R(1.4, 4), r.R(0.25, 0.55));
    }
    s += g(db, `filter="${c.f('dry')}"`);
  }
  c.land.push(g(s, `clip-path="${cp}"`));
}

// Lost edges: the far side of a subject dissolves into the air.
function loseEdge(c, d, w = 10, o = 0.5) {
  c.land.push(g(spath(d, mix(c.T.haze, c.T.sky[3][1], 0.4), w, o), `filter="${c.f('b4')}"`));
}

// Dappled shade from trees out of frame, falling across lawn and path.
function dapple(c, box, o = {}) {
  const { T } = c;
  const [x0, y0, x1, y1] = box;
  const r = c.sub('dapple' + (o.key || ''));
  const sh = mix(T.shade, '#4E4A86', 0.35);
  const lt = mix(T.light, '#FFE7B8', 0.4);
  let s = '';
  let l = '';
  const n = o.n || 40;
  const ang = -T.litSide * 12;
  for (let i = 0; i < n; i++) {
    const x = r.R(x0, x1);
    const y = r.R(y0, y1);
    const k = 0.5 + (y - y0) / Math.max(1, y1 - y0);
    s += pth(blob(r.r, x, y, r.R(30, 120) * k, r.R(6, 18) * k, 0.5, 9, 0), sh, r.R(0.14, 0.3) * (o.k || 1), ` transform="rotate(${f1(ang)} ${f1(x)} ${f1(y)})"`);
    if (r.ch(0.5) && !T.lit) l += ell(x + r.R(-60, 60), y + r.R(-10, 10), r.R(8, 30) * k, r.R(2, 6) * k, lt, r.R(0.12, 0.3), ang);
  }
  c.land.push(g(s, `filter="${c.f('b4')}" style="mix-blend-mode:multiply"`) + g(l, `filter="${c.f('b2')}"`));
}

// Dark soft foliage close to the lens: a few deep blue green and olive
// washes, the edge feathered, a handful of warm leaves catching the light.
function nearFoliage(c, x, y, rx, ry) {
  const { T } = c;
  const r = c.sub('near' + x);
  const night = c.time === 'night';
  const cols = ['#2F4A44', '#3A5240', '#4A5E3A', '#34483F'].map((q) => (night ? mix(q, '#0B1622', 0.5) : q));
  let s = '';
  for (let i = 0; i < 7; i++) {
    const cx = x + r.R(-rx * 0.45, rx * 0.25);
    const cy = y + r.R(-ry * 0.25, ry * 0.25);
    s += pth(blob(r.r, cx, cy, r.R(rx * 0.4, rx * 0.7), r.R(ry * 0.4, ry * 0.7), 0.45, 10, r.R(-0.6, 0.6)), r.pick(cols), r.R(0.55, 0.8));
  }
  let lv = '';
  for (let i = 0; i < 26; i++) {
    const a = r.R(-2.6, -0.6);
    const L = r.R(14, 28);
    lv += leaf(x + r.R(-rx * 0.9, rx * 0.2), y - r.R(ry * 0.3, ry * 0.9), L, L * 0.36, a, r.ch(0.25) ? mix(T.light, '#C98A3A', 0.5) : r.pick(cols), r.R(0.6, 0.9));
  }
  c.front.push(g(g(s, `filter="${c.f('soft')}"`) + g(lv, `filter="${c.f('fg')}"`), 'opacity="0.9"'));
}

/* ---------------------------------------------------------------- places */

const BUILD = {};

BUILD.campus = (c, pl) => {
  const { T, S } = c;
  // soft warm brown drawing line, half lost, instead of an even dark outline
  c.edgeO = 0.3;
  c.edgeCol = mix(c.lineCol, '#6A4A3A', 0.5);
  sky(c, { horizon: 410 });
  cloudSky(c, { big: 2 });
  range(c, { base: 408, amp: 50, d: 0.66, col: '#8090BA', scale: 600, key: 'far' });
  // modern brick towers, soft in the far distance
  let s = '';
  for (const [x, w, h] of [[96, 50, 92], [160, 38, 64]]) {
    const fh = T.farHaze || T.haze;
    s += rect(x, 418 - h, w, h, mix(c.P('#B47E62', 0.2), fh, 0.66));
    s += rect(x + (T.litSide < 0 ? w * 0.62 : 0), 418 - h, w * 0.38, h, mix(c.P('#B47E62', -0.5), fh, 0.62), 0.8);
    s += rect(x - 2, 418 - h - 3, w + 4, 3, mix(c.P('#B47E62', 0.4), fh, 0.6));
    for (let yy = 418 - h + 7; yy < 412; yy += 7) s += line(x + 4, yy, x + w - 4, yy, mix('#5E6A82', fh, 0.6), 1, 0.3);
    if (T.lit) for (let k = 0; k < 5; k++) s += rect(x + 5 + c.L.R(0, w - 12), 418 - h + c.L.R(6, h - 12), 2.5, 2, '#FFD58A', c.L.R(0.4, 0.8));
  }
  // distant towers stay a pale wash, their tops lost in the haze
  c.land.push(g(s, `filter="${c.f('wc')}" opacity="0.8"`));
  hazeBand(c, 410, 60, 0.6);
  water(c, { y0: 416, y1: 452, shape: 'M-20,418C140,416 380,420 590,430L590,442C390,450 160,452 -20,454Z', n: 40, sx1: 590 });
  footbridge(c, 150, 434, 250, 0.45);
  const tlN = noise1(c.r);
  treeline(c, -20, W + 20, (x) => 446 + fbm(tlN, x / 120) * 8, { d: 0.42, min: 18, max: 32 });
  const lawnN = noise1(c.r);
  const lawn = profile(-20, W + 20, 10, (x) => 458 + fbm(lawnN, x / 200) * 12);
  ground(c, lawn, { d: 0.05, dabs: 700, persp: [458, 900], leaves: 260, key: 'lawn', strokes: 700 });
  mist(c, 456, 50);
  // six course halls, three each side, each with a small seal on the gable
  for (const [x, y, w, side] of [[150, 506, 78, 1], [265, 498, 66, 1], [372, 512, 60, 1], [1200, 512, 62, -1], [1300, 500, 70, -1], [1420, 508, 78, -1]]) {
    const b = block(c, { x, y, w, h: w * 0.55, d: w * 0.5, side, kind: 'gable', roofH: w * 0.42, wall: '#DCC29A', roof: '#8C939C', haze: 0.18 });
    windowsGrid(c, b.F, 2, 1, { by0: 0.25, by1: 0.8, fill: 0.45, glass: c.P('#5C6A80', -0.1, 0.18) });
    c.land.push(circ(x + w / 2, b.top - w * 0.16, w * 0.07, c.P('#E8C88E', 0.5, 0.15)) + circ(x + w / 2, b.top - w * 0.16, w * 0.04, c.P('#B89A62', 0, 0.15)));
  }
  // the body goes down opaque first so nothing behind ever shows through
  c.land.push(g(pth('M468,548L468,366L612,366L800,296L718,296L718,288L722,288A78,74 0 0 1 878,288L882,288L882,296L800,296L988,366L1132,366L1132,548Z', c.P('#E6D3AE', 0)), `filter="${c.f('archP')}"`));
  tabaret(c);
  tabaretGlaze(c);
  // the walk bends in from the right and meets the steps a little left of
  // center, so the hall is seen slightly from the side, not as a flat elevation
  const walk = pl.path.map(([px, py], i) => [px - 3.75 * Math.pow(i / Math.max(1, pl.path.length - 1), 1.3) + (i === 1 ? 1.2 : 0), py]);
  const rd = road(c, walk, { w0: 392, w1: 232, kind: 'stone', col: S.snow ? '#E6EAF0' : '#D9C9A8', pow: 1.1 });
  // warm stone broken with cooler and greyer dabs, larger toward the viewer
  {
    const rw = c.sub('walkdabs');
    let wd = '';
    for (let i = 0; i < 260; i++) {
      const y = rw.R(566, 900);
      const k = (y - 560) / 340;
      const x = rd.at(y) + rw.R(-0.46, 0.46) * rd.wAt(y);
      wd += ell(x, y, rw.R(4, 14) * (0.4 + k), rw.R(1.5, 4) * (0.4 + k), c.P(rw.pick(['#C7B79A', '#C7B79A', '#B7AFC4', '#E6D8B8']), 0), rw.R(0.18, 0.42), rw.R(-8, 8));
    }
    c.land.push(g(wd, `filter="${c.f('pig')}"`));
  }
  stairs(c);
  // shade of the big elm out of frame falls across the walk, broken by light
  dapple(c, [T.litSide < 0 ? 760 : 380, 600, T.litSide < 0 ? 1320 : 940, 900], { n: 34, key: 'walk' });
  // flower beds and red iron lamp posts along the walkway
  for (const side of [-1, 1]) {
    const bed = [];
    for (let y = 600; y < 920; y += 14) {
      const k = (y - 567) / 333;
      bed.push([rd.at(y) + side * (rd.wAt(y) / 2 + 10 + k * 16), y, 3 + k * 9]);
    }
    flowerBed(c, bed, { cols: ['#B8473A', '#C9573F', '#A8433E', '#E09A52'] });
  }
  // uOttawa red lamp posts: three down the west side at uneven spacing, one far on the east
  const lamps = [[616, -1, 0], [722, -1, 8], [884, -1, -16], [590, 1, 4]];
  for (const [y, side, dx] of lamps) {
    const k = rd.wAt(y) / 560;
    lampPost(c, rd.at(y) + side * (rd.wAt(y) / 2 + 34 * k) + dx, y, 250 * k, { col: '#8A3B30' });
  }
  // the forgotten coffee cup on a stone bench
  stoneBench(c, 360, 690, 90);
  c.land.push(rect(388, 664, 8, 9, c.P('#F3EFE6', 0.5)) + rect(388, 664, 8, 2, c.P('#8A5A3B', 0)) + ell(392, 673, 6, 1.5, c.T.shade, 0.3));
  // the logo banner on the first lamp post (blank plate)
  const bx = rd.at(722) - (rd.wAt(722) / 2 + 34 * rd.wAt(722) / 560) + 8;
  const by = 722 - 250 * (rd.wAt(722) / 560) * 0.84;
  c.land.push(g(pg([[bx + 3, by], [bx + 34, by + 3], [bx + 34, by + 78], [bx + 18, by + 70], [bx + 3, by + 78]], c.P('#EFE6D2', 0.4), 1, edge(c, 0.8)) + pg([[bx + 7, by + 6], [bx + 30, by + 8], [bx + 30, by + 62], [bx + 7, by + 62]], 'none', 1, ` stroke="${c.P('#E8C88E', 0.2)}" stroke-width="1.2"`), `filter="${c.f('arch')}"`));
  // an old maple stands off center in front of the west wing, so the facade
  // is never a clean symmetric elevation
  tree(c, 432, 612, 168, { n: 9, touches: 46, wide: 1.15 });
  tree(c, 1450, 820, 210, { n: 10, touches: 50 });
  tree(c, 120, 640, 110, { d: 0.05 });
  warmLight(c);
  vignette(c, 0.32);
  frame(c, { tr: 0.7, tl: 1, bl: 0.9, br: 0.8 });
  nearFoliage(c, 1590, 910, 300, 240);
};

function tabaret(c) {
  const { T, S } = c;
  const sand = '#DDBE8E';
  const copper = '#86B9A2';
  // dome and drum behind
  let s = '';
  s += pg([[724, 384], [876, 384], [876, 296], [724, 296]], c.P(sand, c.T.frontK - 0.1), 1, edge(c, 1));
  for (let i = 0; i < 7; i++) {
    const x = 732 + i * 22.6;
    s += rect(x, 300, 6, 80, c.P(sand, -0.4), 0.5);
    if (i < 6) windowOn(c, face([x + 9, 360], [10, 0], [0, -46]), 0, 0, 1, 1, { mullions: 0, sill: false, glass: c.P('#55627A', -0.2), litP: 0 });
  }
  s += rect(718, 288, 164, 10, c.P(sand, 0.4), 1, edge(c, 0.8));
  const dg = c.rg(T.litSide < 0
    ? [[0, c.P('#B4BCC2', 0.9)], [0.5, c.P('#99A3AB', 0.1)], [1, c.P('#7F8992', -0.7)]]
    : [[0, c.P('#B4BCC2', 0.9)], [0.5, c.P('#99A3AB', 0.1)], [1, c.P('#7F8992', -0.7)]], T.litSide < 0 ? 0.32 : 0.68, 0.3, 0.8);
  s += pth('M722,290A78,74 0 0 1 878,290Z', dg, 1, edge(c, 1));
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const rx = Math.abs(Math.cos(t * Math.PI)) * 78;
    s += spath(`M800,216Q${f1(800 + (t < 0.5 ? -1 : 1) * rx * 1.05)},${f1(240)} ${f1(800 + (t < 0.5 ? -1 : 1) * rx)},290`, c.P('#7F8992', -0.5), 1, 0.5);
  }
  // lantern
  s += rect(789, 196, 22, 22, c.P(sand, 0.3), 1, edge(c, 0.8));
  s += rect(794, 200, 5, 14, c.P('#55627A', -0.2)) + rect(802, 200, 5, 14, c.P('#55627A', -0.2));
  s += pth('M786,197A14,12 0 0 1 814,197Z', c.P('#99A3AB', 0.3), 1, edge(c, 0.8));
  s += line(800, 185, 800, 172, c.P('#99A3AB', 0), 2);
  s += circ(800, 172, 3, c.P('#E8C88E', 0.4));
  c.land.push(g(s, `filter="${c.f('archP')}"`));
  // wings with two rows of tall windows
  for (const [x0, x1] of [[468, 650], [950, 1132]]) {
    const F = face([x0, 548], [x1 - x0, 0], [0, -150]);
    c.land.push(g(pg(quad(F, 0, 0, 1, 1), c.P(sand, c.T.frontK), 1, edge(c, 1)) +
      pg(quad(F, 0, 0, 1, 0.1), c.P(sand, -0.45), 0.6) +
      pg(quad(F, -0.02, 0.97, 1.02, 1.06), c.P(sand, 0.5), 1, edge(c, 0.8)) +
      pg(quad(F, -0.01, 1.06, 1.01, 1.12), c.P(sand, 0.1), 1, edge(c, 0.6)) +
      pg([F(-0.01, 1.12), F(1.01, 1.12), [x1 + (x0 < 800 ? -10 : 10), 548 - 150 * 1.12 - 14], [x0 + (x0 < 800 ? 10 : -10), 548 - 150 * 1.12 - 14]], c.P('#9AA0A6', 0.4), 1, edge(c, 0.6)), `filter="${c.f('archP')}"`));
    // balusters
    let bal = '';
    for (let a = 0.02; a < 1; a += 0.035) bal += line(...F(a, 1.065), ...F(a, 1.115), c.P(sand, -0.4), 1.2, 0.6);
    c.land.push(bal);
    // ground floor: tall arched windows, some with books
    for (let i = 0; i < 4; i++) {
      const a0 = 0.07 + i * 0.235;
      windowOn(c, F, a0, 0.17, a0 + 0.13, 0.5, {
        rows: 2,
        content: (FF, A0, B0, A1, B1, lit) => {
          if ((i + (x0 > 800 ? 1 : 0)) % 2) return '';
          let b = '';
          const cols = ['#8A5A3B', '#5E6E8C', '#A8823E', '#6F8A62', '#9A5848'];
          for (let k = 0; k < 6; k++) {
            const ka = lerp(A0, A1, 0.08 + k * 0.14);
            b += pg(quad(FF, ka, B0 + 0.01, ka + 0.11, B0 + 0.07 + (k % 3) * 0.012), lit ? mix(cols[k % 5], '#FFC879', 0.3) : c.P(cols[k % 5], -0.1), 0.95);
          }
          return b;
        },
      });
    }
    for (let i = 0; i < 4; i++) {
      const a0 = 0.07 + i * 0.235;
      windowOn(c, F, a0, 0.62, a0 + 0.13, 0.88, { rows: 1 });
    }
    // pilasters between bays
    let pil = '';
    for (let i = 0; i <= 4; i++) pil += pg(quad(F, 0.015 + i * 0.235, 0.1, 0.035 + i * 0.235, 0.97), c.P(sand, 0.55), 0.7);
    c.land.push(pil);
    castShadow(c, x0, x1, 552, 40, { op: 0.2 });
  }
  // recessed wall behind the portico
  const R = face([646, 548], [308, 0], [0, -154]);
  c.land.push(pg(quad(R, 0, 0, 1, 1), c.P(sand, -0.55)));
  for (const a of [0.12, 0.42, 0.72]) {
    door(c, R, a, a + 0.14, 0.42, { col: '#5A3E2E' });
    windowOn(c, R, a + 0.015, 0.58, a + 0.125, 0.86, { rows: 1, glass: c.P('#3E4A5E', -0.3) });
  }
  // six columns
  let cols = '';
  const cg = c.lg(T.litSide < 0
    ? [[0, c.P(sand, 0.4)], [0.3, c.P(sand, 0.95)], [0.65, c.P(sand, 0)], [1, c.P(sand, -0.7)]]
    : [[0, c.P(sand, -0.7)], [0.35, c.P(sand, 0)], [0.7, c.P(sand, 0.95)], [1, c.P(sand, 0.4)]], 0, 0, 1, 0);
  for (let i = 0; i < 6; i++) {
    const x = 664 + i * 54.4;
    cols += ell(x - T.litSide * 18 * T.shadowLen, 548, 12 + 14 * T.shadowLen, 3, T.shade, 0.3);
    cols += rect(x - 13, 548 - 8, 26, 8, c.P(sand, 0.3), 1, edge(c, 0.7));
    cols += pg([[x - 11, 540], [x + 11, 540], [x + 9.5, 406], [x - 9.5, 406]], cg, 1, edge(c, 0.8));
    for (const fx of [-4, 0, 4]) cols += line(x + fx, 538, x + fx * 0.86, 408, c.P(sand, -0.3), 0.7, 0.35);
    cols += rect(x - 14, 398, 28, 8, c.P(sand, 0.5), 1, edge(c, 0.7));
    cols += pth(`M${x - 15},398Q${x - 17},392 ${x - 11},392L${x + 11},392Q${x + 17},392 ${x + 15},398Z`, c.P(sand, 0.6), 1, edge(c, 0.6));
  }
  c.land.push(g(cols, `filter="${c.f('archP')}"`));
  // entablature and pediment with its green copper roof
  let pe = '';
  pe += rect(630, 372, 340, 20, c.P(sand, 0.45), 1, edge(c, 1));
  pe += rect(630, 388, 340, 4, c.P(sand, -0.4), 0.6);
  for (let i = 0; i < 28; i++) pe += rect(634 + i * 12, 372, 4, 3, c.P(sand, -0.3), 0.6);
  pe += pg([[618, 372], [982, 372], [800, 312]], c.P(sand, 0.15), 1, edge(c, 1));
  pe += pg([[640, 366], [960, 366], [800, 323]], c.P(sand, -0.25), 0.8);
  // copper roof plane seen from above, behind the raking cornice
  pe += pg([[612, 373], [800, 310], [800, 296], [600, 362]], c.P(copper, 0.55), 1, edge(c, 0.8));
  pe += pg([[988, 373], [800, 310], [800, 296], [1000, 362]], c.P(copper, -0.1), 1, edge(c, 0.8));
  pe += spath('M612,373L800,310L988,373', c.P(copper, 0.2), 5, 0.95);
  pe += spath('M612,375L988,375', c.P(copper, 0.1), 2.2, 0.8);
  // weathered copper streaks
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    pe += line(lerp(612, 800, t), lerp(373, 310, t) - 2, lerp(612, 800, t) - 3, lerp(373, 310, t) - 12, c.P('#B7D8C4', 0.6), 1.2, 0.5);
  }
  // oculus in the tympanum
  pe += circ(800, 350, 9, c.P(sand, -0.6)) + circ(800, 350, 6, c.P('#55627A', -0.2));
  c.land.push(g(pe, `filter="${c.f('archP')}"`));
  if (S.snow) c.land.push(pg([[612, 371], [800, 308], [800, 300], [604, 364]], '#F4F6F9', 0.85) + pg([[988, 371], [800, 308], [800, 300], [996, 364]], '#E4EAF2', 0.85) + pth('M724,290A76,40 0 0 1 876,290L860,282A60,30 0 0 0 740,282Z', '#F4F6F9', 0.8));
}

function tabaretGlaze(c) {
  const { T } = c;
  const shape = '<path d="M468,548L468,366L612,366L800,296L718,296L718,288L722,288A78,74 0 0 1 878,288L882,288L882,296L800,296L988,366L1132,366L1132,548Z"/>';
  const cp = c.clip(shape);
  const k = { morning: 1, day: 1, sunset: 0.55, night: 0.35 }[c.time] || 1;
  const litL = T.litSide < 0;
  let s = '';
  // lit side warm glaze, shadow side cool violet glaze, the foot picks up ground
  s += rect(460, 160, 680, 400, c.lg([[0, '#F2DDB0', 0.25 * k], [0.45, '#F2DDB0', 0.08 * k], [0.6, '#8E86A8', 0], [1, '#8E86A8', 0.22 * k]], litL ? 0 : 1, 0, litL ? 1 : 0, 0), 1, ' style="mix-blend-mode:multiply"');
  s += rect(460, 160, 680, 400, c.lg([[0, '#6E6A5A', 0], [0.72, '#6E6A5A', 0], [1, '#6E6A5A', 0.18 * k]]), 1, ' style="mix-blend-mode:multiply"');
  s += rect(460, 160, 680, 400, '#FFF', 1, ` filter="${c.f('bloomL')}" opacity="${f2(0.16 * k)}"`);
  s += rect(460, 160, 680, 400, '#FFF', 1, ` filter="${c.f('bloomS')}" opacity="${f2(0.22 * k)}" style="mix-blend-mode:multiply"`);
  // broken color dabs and a little dry brush on the wings only, not the colonnade
  const r = c.sub('tabdabs');
  let d = '';
  for (let i = 0; i < 160; i++) {
    const x = r.ch(0.5) ? r.R(470, 640) : r.R(960, 1130);
    const y = r.R(372, 545);
    d += ell(x, y, r.R(4, 12), r.R(2, 5), r.pick(['#F2D27E', '#E9AE98', '#A2B2DA', '#BFCB8E', '#C79A74']), r.R(0.1, 0.24) * k, r.R(-20, 20));
  }
  s += g(d, `filter="${c.f('pig')}"`);
  let db = '';
  for (let i = 0; i < 26; i++) {
    const left = r.ch(0.5);
    const xa = left ? r.R(470, 560) : r.R(960, 1060);
    const y = r.R(380, 540);
    const len = r.R(26, 70);
    db += spath(`M${f1(xa)},${f1(y)}q${f1(len / 2)},${f1(r.R(-1.5, 1.5))} ${f1(len)},${f1(r.R(-1, 1))}`, (left === litL) ? '#FFF2D8' : '#7A7090', r.R(1.2, 3), r.R(0.2, 0.4) * k);
  }
  s += g(db, `filter="${c.f('dry')}"`);
  c.land.push(g(s, `clip-path="${cp}"`));
  // weather stains run down from the cornice; a little green from the copper
  let st = '';
  for (let i = 0; i < 26; i++) {
    const x = r.R(470, 1130);
    if (x > 640 && x < 960) continue;
    const y = r.R(372, 386);
    st += spath(`M${f1(x)},${f1(y)}q${f1(r.R(-2, 2))},${f1(r.R(20, 40))} ${f1(r.R(-3, 3))},${f1(r.R(40, 110))}`, r.pick(['#8A7A62', '#7E9A8A', '#9A8A70']), r.R(2, 6), r.R(0.06, 0.14));
  }
  c.land.push(g(st, `filter="${c.f('soft')}"`));
  // lost and found: only a 40 px feathered strip on the far wing edge melts into the air
  const far = T.litSide < 0 ? 1 : -1;
  const ex = far > 0 ? 1132 : 468;
  c.land.push(g(rect(ex - (far > 0 ? 40 : 0), 362, 40, 190, c.lg([[0, T.haze, far > 0 ? 0 : 0.45], [1, T.haze, far > 0 ? 0.45 : 0]], 0, 0, 1, 0)), `filter="${c.f('b4')}"`));
}

function stairs(c) {
  const sand = '#D8C7A6';
  let s = '';
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const y = 548 + t * 40;
    const hw = 168 + t * 40;
    s += rect(800 - hw, y, hw * 2, 40 / n, c.P(sand, 0.75), 1, edge(c, 0.5));
    s += rect(800 - hw, y + 40 / n * 0.6, hw * 2, 40 / n * 0.4, c.P(sand, -0.35), 0.8);
  }
  // cheek walls
  for (const side of [-1, 1]) {
    const x = 800 + side * 214;
    s += pg([[x - 12, 590], [x + 12, 590], [x + 12 - side * 26, 546], [x - 12 - side * 26, 546]], c.P(sand, side === c.T.litSide ? 0.6 : -0.3), 1, edge(c, 0.8));
  }
  c.land.push(g(s, `filter="${c.f('archP')}"`));
}

BUILD.town = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 430 });
  cloudSky(c, {});
  range(c, { base: 432, amp: 70, d: 0.6, col: '#7E86B0', scale: 480, key: 'far' });
  hazeBand(c, 430, 60, 0.5);
  // the canal and the slim white footbridge in the right background
  water(c, { y0: 436, y1: 470, shape: 'M1010,440C1150,436 1400,434 1620,436L1620,466C1400,470 1180,474 1010,462Z', n: 40, sx0: 1010 });
  footbridge(c, 1240, 450, 210, 0.38);
  const farN = noise1(c.r);
  const farHill = profile(-20, W + 20, 10, (x) => 446 + fbm(farN, x / 220) * 20 + (x > 1000 ? 30 : 0) * clamp((x - 1000) / 60, 0, 1) * clamp((1400 - x) / 40, 0, 1) * 0);
  ground(c, profile(-20, 1010, 10, (x) => 444 + fbm(farN, x / 220) * 18), { d: 0.38, dabs: 160, key: 'far' });
  treeline(c, -20, 1000, (x) => farHill.at(x) + 6, { d: 0.42, min: 14, max: 26 });
  ground(c, profile(1000, W + 20, 10, (x) => 472 + fbm(farN, x / 220) * 10), { d: 0.34, dabs: 120, key: 'farR' });
  treeline(c, 1010, W + 20, (x) => 476 + fbm(farN, x / 140) * 6, { d: 0.36, min: 12, max: 24 });
  mist(c, 470, 50);
  // the town hill
  const hN = noise1(c.r);
  const hill = profile(-20, W + 20, 10, (x) => 486 + Math.pow((x - 900) / 700, 2) * 110 + fbm(hN, x / 160) * 16);
  ground(c, hill, { d: 0.08, dabs: 700, persp: [480, 900], leaves: 220, key: 'hill', strokes: 700 });
  // back row of houses, then the tower and the Memory Tree, then the front row
  const houses = [
    [640, 492, 70, 52, 'eave', 1, '#C8784A'], [712, 486, 64, 58, 'gable', 1, '#D28C52'], [1020, 488, 70, 56, 'gable', -1, '#BD6E44'], [1094, 494, 64, 48, 'eave', -1, '#C8784A'],
    [590, 520, 76, 60, 'gable', 1, '#C26F42'], [1150, 524, 70, 54, 'gable', -1, '#D49456'],
  ];
  for (const [x, y, w, h, kind, side, roof] of houses) {
    const b = block(c, { x, y, w, h, d: w * 0.5, side, kind, roofH: w * 0.38, wall: '#EADBC0', roof, haze: 0.06 });
    windowsGrid(c, b.F, 2, kind === 'gable' ? 2 : 1, { fill: 0.42, fillH: 0.5, by0: 0.2, by1: 0.85 });
    if (kind === 'eave' && c.r() < 0.6) chimney(c, x + w * 0.7, b.top - 12, 9, 18, { smoke: false });
  }
  // the slim white tower with its terracotta roof
  const tx = 966;
  let tw = cylinder(c, tx, 548, 62, 54, 246, '#F1ECE2');
  for (let i = 0; i < 8; i++) tw += line(tx - 28, 520 - i * 34, tx + 28, 520 - i * 34, c.P('#D8D0C2', -0.3), 0.8, 0.35);
  tw += rect(tx - 34, 246, 68, 9, c.P('#F1ECE2', 0.5), 1, edge(c, 0.9));
  for (let i = 0; i < 7; i++) tw += rect(tx - 32 + i * 10, 238, 5, 8, c.P('#F1ECE2', 0.3), 1, edge(c, 0.6));
  c.land.push(g(tw, `filter="${c.f('arch')}"`));
  for (const [y, w2] of [[300, 10], [380, 9], [455, 9]]) windowOn(c, face([tx - w2 / 2, y + 22], [w2, 0], [0, -24]), 0, 0, 1, 1, { mullions: 0, sill: false });
  windowOn(c, face([tx - 13, 280], [26, 0], [0, -20]), 0, 0, 1, 1, { mullions: 1, sill: false, litP: c.T.lit ? 1 : 0 });
  const rg = c.lg(T.litSide < 0 ? [[0, c.P('#C8693E', 0.8)], [0.6, c.P('#B85E38', 0)], [1, c.P('#9E4E32', -0.7)]] : [[0, c.P('#9E4E32', -0.7)], [0.4, c.P('#B85E38', 0)], [1, c.P('#C8693E', 0.8)]], 0, 0, 1, 0);
  c.land.push(g(pg([[tx - 40, 240], [tx + 40, 240], [tx, 168]], rg, 1, edge(c, 1)) + line(tx, 168, tx, 150, c.P('#4A3A30', 0), 1.6) + circ(tx, 150, 2.4, c.P('#E8C88E', 0.5)) + (S.snow ? pg([[tx - 30, 226], [tx + 22, 214], [tx, 170]], '#F4F6F9', 0.85) : ''), `filter="${c.f('arch')}"`));
  castShadow(c, tx - 30, tx + 30, 550, 200, { op: 0.25 });
  // front row
  const front = [
    [624, 556, 92, 70, 'eave', 1, '#C8784A', 'inn'], [730, 552, 58, 54, 'gable', 1, '#D9955A'], [1000, 556, 74, 62, 'eave', -1, '#B8673E'], [1088, 560, 66, 52, 'gable', -1, '#CC8450'],
  ];
  for (const [x, y, w, h, kind, side, roof, tag] of front) {
    const b = block(c, { x, y, w, h, d: w * 0.45, side, kind, roofH: w * 0.36, wall: tag === 'inn' ? '#E8D2AE' : '#EEE0C6', roof });
    if (tag === 'inn') {
      // warm inn window at the plaza corner, lit in the evening
      windowOn(c, b.F, 0.1, 0.18, 0.5, 0.6, { rows: 1, litP: c.T.lit ? 1 : 0, glass: c.P('#6A5546', -0.1) });
      door(c, b.F, 0.62, 0.82, 0.62, { col: '#7A4E36' });
      windowOn(c, b.F, 0.15, 0.72, 0.35, 0.92, { rows: 0 });
      windowOn(c, b.F, 0.6, 0.72, 0.8, 0.92, { rows: 0 });
      c.land.push(rect(b.F(0.1, 0.62)[0], b.F(0.1, 0.62)[1] - 4, 36, 5, c.P('#8A6446', 0)) + rect(b.F(0.12, 0.66)[0], b.F(0.1, 0.66)[1] - 2, 30, 4, c.P(c.S.flowers ? c.S.flowers[0] : '#C9C2B0', 0.3), 0.9));
      // hanging sign, blank
      const [hx, hy] = b.F(1.0, 0.72);
      c.land.push(line(hx, hy, hx + 14, hy, c.P('#3E4656', 0), 1.4) + rect(hx + 6, hy + 2, 14, 11, c.P('#B8925E', 0.3), 1, edge(c, 0.6)));
    } else {
      windowsGrid(c, b.F, 2, 2, { fill: 0.42, fillH: 0.5 });
      // flower boxes
      if (c.S.flowers) {
        const [fx, fy] = b.F(0.12, 0.2);
        c.land.push(rect(fx, fy - 3, w * 0.3, 4, c.P('#8A6446', 0)) + ell(fx + w * 0.15, fy - 4, w * 0.15, 3, c.P(c.S.flowers[1], 0.2), 0.9));
      }
    }
    if (kind === 'eave') chimney(c, x + w * (side > 0 ? 0.75 : 0.2), b.top - 14, 9, 18, { smoke: tag === 'inn', smokeSize: 0.6 });
  }
  // pigeons on the roofs
  let pig = '';
  for (const [x, y] of [[652, 486], [664, 484], [1040, 434], [748, 496], [1110, 448]]) pig += ell(x, y, 3.2, 2.2, c.P('#8C8FA0', 0.2)) + circ(x + 2.5, y - 2, 1.4, c.P('#8C8FA0', 0.3));
  c.land.push(pig);
  // the Memory Tree beside the tower, with small lanterns
  tree(c, 872, 562, 90, { touches: 44, trunkW: 0.17, wide: 1.1 });
  lanterns(c, [[828, 474], [858, 446], [900, 456], [926, 484], [846, 500], [888, 492]]);
  // plaza
  const plaza = blob(c.r, 840, 566, 200, 28, 0.12, 12);
  patch(c, plaza, S.snow ? '#E8ECF2' : '#D6C6A6', { box: [630, 536, 1050, 596], cols: ['#B9A888', '#E2D6BC', '#C8B898'], n: 220, big: 4, key: 'plaza' });
  board(c, 700, 566, 34, 22);
  lampPost(c, 778, 566, 74, {});
  bench(c, 752, 568, 32);
  well(c, 918, 566, 14);
  // the charter stone, tall and upright
  c.land.push(g(ell(948 - T.litSide * 10, 570, 14, 3, T.shade, 0.32) + pth('M940,570L938,532Q944,520 952,522L958,532L957,570Z', c.P('#B4AEA2', 0.1), 1, edge(c, 0.8)) + pth(T.litSide < 0 ? 'M940,570L938,532Q944,520 948,521L947,570Z' : 'M951,570L952,522L958,532L957,570Z', c.P('#B4AEA2', 0.85), 0.7) + line(944, 538, 952, 538, c.P('#8A8478', -0.3), 0.8, 0.6) + line(944, 546, 952, 546, c.P('#8A8478', -0.3), 0.8, 0.6), `filter="${c.f('arch')}"`));
  // low town wall with the gate where the road comes in
  let wall = '';
  const wc = '#CFC2AA';
  for (const [a, b] of [[520, 800], [880, 1260]]) {
    const pts = [];
    for (let x = a; x <= b; x += 10) pts.push([x, 590 + Math.pow((x - 840) / 420, 2) * 26]);
    const top = pts.map(([x, y]) => [x, y - 22]);
    wall += pg([...pts, ...top.slice().reverse()], c.P(wc, c.T.frontK - 0.15), 1, edge(c, 0.8));
    wall += pg([...top, ...top.slice().reverse().map(([x, y]) => [x, y - 6])], c.P(wc, 0.75), 1, edge(c, 0.6));
    const rw = c.sub('wall' + a);
    for (let x = a + 4; x < b - 6; x += rw.R(9, 16)) {
      const y = 590 + Math.pow((x - 840) / 420, 2) * 26;
      for (let row = 0; row < 3; row++) {
        const yy = y - 4 - row * 6.5;
        wall += ell(x + (row % 2) * 5, yy, rw.R(3.5, 6), 2.6, c.P(rw.pick([wc, '#BDAE94', '#D9CDB6', '#B3A58E']), rw.R(-0.4, 0.5)), 0.8);
      }
    }
    wall += pg([...pts.map(([x, y]) => [x, y + 1]), ...pts.slice().reverse().map(([x, y]) => [x, y - 6])], c.P(wc, -0.7), 0.35);
    wall += g(pg([...pts.map(([x, y]) => [x - T.litSide * 30 * T.shadowLen, y + 10]), ...pts.slice().reverse()], T.shade, 0.25), `filter="${c.f('b4')}"`);
  }
  for (const x of [800, 880]) {
    wall += rect(x - 9, 548, 18, 44, c.P(wc, x < 840 ? (T.litSide < 0 ? 0.6 : -0.2) : (T.litSide < 0 ? -0.2 : 0.6)), 1, edge(c, 0.8));
    wall += rect(x - 12, 544, 24, 6, c.P(wc, 0.7), 1, edge(c, 0.6));
    wall += circ(x, 540, 5, c.P(wc, 0.5));
  }
  c.land.push(g(wall, `filter="${c.f('arch')}"`));
  road(c, pl.path, { w0: 300, w1: 60, kind: 'cobble', col: S.snow ? '#E6EAF0' : '#D3C1A0' });
  tree(c, 230, 700, 120, { d: 0.02 });
  tree(c, 1380, 680, 130, { d: 0.02 });
  bush(c, 470, 612, 34, { cols: [c.S.leaf[5] || c.S.leaf[0], c.S.leaf[0]] });
  bush(c, 1290, 618, 40, { cols: [c.S.leaf[5] || c.S.leaf[0], c.S.leaf[1]] });
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 0.9, tr: 0.8, bl: 0.9, br: 1 });
};


BUILD.bobino = (c, pl) => {
  const { T, S } = c;
  c.edgeO = 0.3;
  c.edgeCol = mix(c.lineCol, '#6A4A3A', 0.5);
  sky(c, { horizon: 420 });
  cloudSky(c, { big: 2 });
  range(c, { base: 422, amp: 46, d: 0.66, col: '#8090BA', scale: 520, key: 'far' });
  hazeBand(c, 422, 50, 0.5);
  const n = noise1(c.r);
  ground(c, profile(-20, W + 20, 10, (x) => 440 + fbm(n, x / 180) * 14), { d: 0.3, dabs: 200, key: 'back', nearDark: 0 });
  // tall trees behind the café
  // an uneven stand of old trees, grown where they grew, not planted in a row
  for (const [x, y, sz, d, o] of [[214, 504, 58, 0.2], [372, 486, 112, 0.16], [664, 462, 176, 0.13, { wide: 0.55, trunkH: 1.05 }], [842, 470, 98, 0.16], [1012, 456, 152, 0.12, { wide: 0.9 }], [1318, 492, 84, 0.15, { wide: 1.75, trunkH: 0.55 }], [1512, 508, 70, 0.2]]) tree(c, x, y, sz, { d, ...(o || {}) });
  // the far crowns go pale and blue in the air
  {
    const rh = c.sub('farhaze');
    let hz = '';
    for (const [x, y, rx] of [[214, 444, 54], [372, 392, 80], [842, 404, 70], [1512, 456, 60]]) hz += pth(blob(rh.r, x, y, rx, rx * 0.6, 0.3, 9), '#B9C4D6', 0.45);
    c.land.push(g(hz, `filter="${c.f('b10')}"`));
  }
  mist(c, 480, 60);
  const lot = profile(-20, W + 20, 10, (x) => 516 + fbm(n, x / 260 + 9) * 10);
  ground(c, lot, { d: 0.02, dabs: 520, persp: [516, 900], key: 'lot', strokes: 420, leaves: 140 });
  // an L shaped stone patio: a strip along the front, a leg running out at the right wing
  {
    const rp = c.sub('patio');
    const pav = S.snow ? '#E8ECF2' : '#CDBFA6';
    const L = 'M436,560C600,574 760,586 840,588C960,584 1100,568 1244,552L1252,570C1254,600 1256,630 1250,654L1076,662C1070,640 1068,620 1062,604C960,612 860,614 820,614C700,612 560,600 430,584Z';
    let pv = g(pth(L, c.P(pav, 0.1), 0.5), `filter="${c.f('b4')}"`) + pth(L, c.P(pav, 0.1), 0.42);
    let dots = '';
    for (let i = 0; i < 260; i++) {
      const inLeg = rp.ch(0.4);
      const x = inLeg ? rp.R(1080, 1244) : rp.R(450, 1230);
      const y = inLeg ? rp.R(600, 652) : lerp(rp.R(568, 600), rp.R(570, 590), Math.abs(x - 840) / 420);
      dots += ell(x, y, rp.R(4, 10), rp.R(1.4, 3), c.P(rp.pick(['#B9AC92', '#DCD0B8', '#A99E8A', '#C8BCA8', '#B8B4C0']), rp.R(-0.3, 0.5)), rp.R(0.25, 0.5), rp.R(-8, 8));
    }
    // the curb: a lit top edge and a cool shadow under it
    const curb = 'M430,584C560,600 700,612 820,614C860,614 960,612 1062,604C1068,620 1070,640 1076,662L1250,654';
    let cb = spath(curb, '#8E86A8', 7, 0.25, ' transform="translate(0 4)"');
    cb += spath(curb, c.P('#E6DED0', 0.5), 1.8, 0.4, ' stroke-dasharray="70 14 120 22 40 9"');
    // grass creeping back over the stone edge
    for (let i = 0; i < 70; i++) {
      const x = rp.R(1060, 1256);
      const y = rp.ch(0.5) ? rp.R(648, 664) : rp.R(552, 572);
      cb += ell(x, y, rp.R(3, 9), rp.R(1, 2.4), c.P(rp.pick(S.leaf), rp.R(-0.1, 0.4)), rp.R(0.3, 0.6), rp.R(-20, 20));
    }
    c.land.push(g(pv, `filter="${c.f('wc')}"`) + g(dots, `filter="${c.f('pig')}"`) + g(cb, `filter="${c.f('archP')}"`));
  }
  // the street running down to the trailer wagon
  c.land.push(g(pg([[1180, 590], [1620, 556], [1620, 582], [1240, 614]], c.P(S.snow ? '#E2E7EE' : '#BDB3A0', 0.3)) + line(1240, 603, 1620, 570, c.P('#E9E2D2', 0.5), 1.4, 0.5), `filter="${c.f('pig')}"`));
  trailer(c, 1420, 576, 0.85);
  cafe(c);
  for (const [x, y] of [[1118, 628], [1196, 620], [1162, 650]]) {
    let tb = g(ell(x - T.litSide * 16, y + 4, 24, 5, '#8E86A8', 0.25), `filter="${c.f('b2')}"`);
    tb += line(x, y, x, y - 17, c.P('#2E3638', 0), 1.8) + ell(x, y - 17, 12, 3.6, c.P('#E8E2D6', 0.5));
    for (const sd of [-1, 1]) tb += pg([[x + sd * 20, y + 2], [x + sd * 16, y - 13], [x + sd * 12, y - 13], [x + sd * 14, y + 2]], c.P('#2E3638', 0), 0.9);
    c.land.push(g(tb, `filter="${c.f('arch')}"`));
  }
  road(c, pl.path, { w0: 240, w1: 70, kind: 'gravel', col: S.snow ? '#E6EAF0' : '#D2C6AC', edges: false });
  // bicycles at the rack
  let bk = line(980, 596, 1090, 596, c.P('#5A6270', 0), 2.4) + line(984, 596, 984, 580, c.P('#5A6270', 0), 2) + line(1086, 596, 1086, 580, c.P('#5A6270', 0), 2);
  for (const [x, col] of [[995, '#5E8A9E'], [1030, '#C9A65A'], [1065, '#7F9A6A']]) {
    const fc = c.P(col, 0.2);
    bk += `<circle cx="${x - 9}" cy="600" r="8" fill="none" stroke="${c.P('#3A4250', 0)}" stroke-width="1.4"/><circle cx="${x + 9}" cy="600" r="8" fill="none" stroke="${c.P('#3A4250', 0)}" stroke-width="1.4"/>`;
    bk += spath(`M${x - 9},600L${x - 2},589L${x + 7},589L${x + 9},600M${x - 2},589L${x + 1},600L${x + 7},589M${x - 3},586L${x + 1},586M${x + 7},589L${x + 6},584L${x + 10},584`, fc, 1.6);
  }
  c.land.push(g(ell(1040 - T.litSide * 30 * T.shadowLen, 604, 70, 5, T.shade, 0.3) + bk, `filter="${c.f('arch')}"`));
  // the blank chalkboard by the door
  c.land.push(g(ell(892 - T.litSide * 10, 600, 16, 3, T.shade, 0.3) + pg([[880, 600], [886, 568], [900, 568], [906, 600]], c.P('#6A5240', 0)) + pg([[883, 596], [888, 572], [898, 572], [903, 596]], c.P('#2F3A3A', -0.1)) + line(889, 580, 897, 580, c.P('#E8E2D2', 0.2), 0.8, 0.4), `filter="${c.f('arch')}"`));
  // shade of the street trees crosses the lot and the path
  dapple(c, [360, 600, 1300, 900], { n: 30, key: 'lot', k: 0.9 });
  bush(c, 300, 600, 40, { cols: [S.leaf[5] || S.leaf[0], S.leaf[1]] });
  // a young maple on the left edge of the lot breaks the long low line of the building
  tree(c, 286, 664, 150, { n: 8, touches: 40, wide: 1.1 });
  bush(c, 1330, 612, 44, { cols: [S.leaf[0], S.leaf[5] || S.leaf[2]] });
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 1, tr: 0.85, bl: 0.9, br: 0.9 });
};

function cafe(c) {
  const { T, S } = c;
  // the left face recedes: at its far end the wall stands about 30 percent shorter
  const ctrl = [[452, 522, 66], [560, 537, 76], [680, 553, 94], [762, 564, 116], [812, 569, 132], [862, 568, 134], [922, 563, 131], [1040, 551, 124], [1160, 539, 116], [1226, 532, 111]];
  const base = crSample(ctrl.map(([x, y]) => [x, y]), 6);
  const hs = crSample(ctrl.map(([x, , h]) => [x, h]), 6).map((p) => p[1]);
  const pink = '#C97B6E';
  const frameCol = c.P('#1C2228', -0.1);
  const warmth = { morning: 0.62, day: 0.35, sunset: 0.75, night: 1 }[c.time];
  const lit = c.time === 'sunset' || c.time === 'night';
  let wallS = '';
  let glass = '';
  let glassLit = '';
  let frames = '';
  let brick = '';
  const rb = c.sub('brick');
  for (let i = 0; i < base.length - 1; i++) {
    const [x0, y0] = base[i];
    const [x1, y1] = base[i + 1];
    const h0 = hs[i];
    const h1 = hs[i + 1];
    const m = (y1 - y0) / Math.max(1, x1 - x0);
    const side = m > 0 ? -1 : 1;
    const wgt = clamp(Math.abs(m) * 22, 0, 1);
    const k = lerp(T.frontK, faceK(c, side), wgt);
    const top0 = y0 - h0;
    const top1 = y1 - h1;
    const band0 = y0 - h0 * 0.56;
    const band1 = y1 - h1 * 0.56;
    const g0 = y0 - h0 * 0.16;
    const g1 = y1 - h1 * 0.16;
    // opaque brick: the parapet band above the glass and the knee wall below it
    wallS += pg([[x0, top0], [x1 + 0.6, top1], [x1 + 0.6, band1], [x0, band0]], c.P(pink, k));
    wallS += pg([[x0, g0], [x1 + 0.6, g1], [x1 + 0.6, y1], [x0, y0]], c.P(pink, k - 0.25));
    for (let row = 1; row < 9; row++) {
      const t = row / 9;
      if (rb.ch(0.8)) brick += line(x0, lerp(top0, band0, t), x1, lerp(top1, band1, t), c.P(pink, k - 0.55), 0.6, rb.R(0.2, 0.45));
    }
    for (let row = 1; row < 4; row++) brick += line(x0, lerp(g0, y0, row / 4), x1, lerp(g1, y1, row / 4), c.P(pink, k - 0.7), 0.6, 0.3);
    for (let q = 0; q < 2; q++) {
      const yy = rb.ch(0.75) ? lerp(top0, band0, rb.R(0.05, 0.95)) : lerp(g0, y0, rb.R(0.1, 0.9));
      brick += ell(lerp(x0, x1, rb.r()), yy, rb.R(3, 7), rb.R(1.2, 2.4), c.P(rb.pick(['#B5655C', '#DDA08E', '#B5655C', '#E8B8A0']), k), 0.5);
    }
    // brick piers between the bays
    if (i % 9 === 4) wallS += pg([[x0 - 4, band0], [x0 + 5, band0 + 0.4], [x0 + 5, g0 + 0.4], [x0 - 4, g0]], c.P(pink, k - 0.1));
    const refl = { morning: '#C9C2D0', day: '#AFC3D8', sunset: '#C99A92', night: '#2E3446' }[c.time];
    const wallIn = mix(c.P('#E9C89A', 0.3), refl, lit ? 0 : 0.35);
    const counter = mix(c.P('#6A5040', -0.2), refl, lit ? 0 : 0.25);
    const mid0 = lerp(band0, g0, 0.55);
    const mid1 = lerp(band1, g1, 0.55);
    // near black glass (deep blue green, never pure black), warm room glowing low behind it
    glass += pg([[x0, band0], [x1 + 0.6, band1], [x1 + 0.6, g1], [x0, g0]], c.P('#1F2A30', 0.05), 1);
    glass += pg([[x0, mid0], [x1 + 0.6, mid1], [x1 + 0.6, g1], [x0, g0]], mix(wallIn, '#B07A48', 0.5), lit ? 0.2 : 0.3);
    glass += pg([[x0, lerp(mid0, g0, 0.55)], [x1 + 0.6, lerp(mid1, g1, 0.55)], [x1 + 0.6, g1], [x0, g0]], counter, 0.4);
    if (!lit && i % 11 === 5) glass += pg([[x0, band0], [x1 + 6, band1], [x1 - 10, g1], [x0 - 16, g0]], '#9FB4C8', 0.22);
    if (lit) glassLit += pg([[x0, band0], [x1 + 0.6, band1], [x1 + 0.6, g1], [x0, g0]], c.lg([[0, '#FFE3A2'], [1, '#F2AE62']]), 0.95);
    // sky reflection in the glass during the day
    if (!lit) glass += pg([[x0, band0 + 2], [x1, band1 + 2], [x1, band1 + h1 * 0.12], [x0, band0 + h0 * 0.12]], mix(T.sky[3][1], '#FFFFFF', 0.2), 0.16 * (1 - warmth * 0.5));
    if (i % 3 === 0) frames += line(x0, band0, x0, g0, frameCol, 2.2);
    frames += line(x0, band0 + (g0 - band0) * 0.18, x1, band1 + (g1 - band1) * 0.18, frameCol, 1.3, 0.9);
    // the garage doors on the right wing carry panel lines
    frames += line(x0, band0, x1, band1, frameCol, 2.4);
    frames += line(x0, g0, x1, g1, frameCol, 2.2);
  }
  // regulars as soft silhouettes behind the glass (no faces)
  let people = '';
  if (c.time === 'morning' || c.time === 'day') {
    const rw = c.sub('warm');
    for (let i = 0; i < 8; i++) {
      const idx = rw.RI(2, base.length - 3);
      const [x, y] = base[idx];
      people += circ(x, y - hs[idx] * 0.62, 3, '#FFE2A8', 0.9) + line(x, y - hs[idx] * 0.72, x, y - hs[idx] * 0.64, '#3A3030', 0.8, 0.8);
    }
    const rp = c.sub('people');
    for (let i = 0; i < 7; i++) {
      const idx = rp.RI(3, base.length - 5);
      const [x, y] = base[idx];
      const hh = hs[idx];
      const py = y - hh * 0.3;
      people += circ(x, py - 22, 5, '#C99A6A', 0.45) + ell(x, py - 6, 9, 11, '#8A6046', 0.42);
    }
  }
  // roof seen from above, parapet cap
  const topPts = base.map(([x, y], i) => [x, y - hs[i]]);
  const back = topPts.map(([x, y]) => [x + (x - 830) * 0.02, y - 20]);
  let roof = pg([...topPts, ...back.slice().reverse()], c.P('#B9B4AA', 0.5));
  roof += spath(crPath(topPts, false), c.P(pink, 0.6), 3.2, 0.95);
  const shapeAll = '';
  // bagels in one window
  let bagels = '';
  for (let k = 0; k < 6; k++) {
    const [x, y] = base[8];
    bagels += `<circle cx="${f1(x + 6 + (k % 3) * 9)}" cy="${f1(y - 34 - Math.floor(k / 3) * 8)}" r="3.6" fill="none" stroke="${c.P('#C98E4A', 0.4)}" stroke-width="2.4"/>`;
  }
  // one opaque body under every glaze so nothing behind ever shows through
  const body = pg([...base.map(([x, y]) => [x, y + 1]).reverse(), ...base.map(([x, y], i) => [x, y - hs[i] - 1])], c.P(pink, T.frontK - 0.1));
  c.land.push(g(body, `filter="${c.f('archP')}"`));
  // shade sails and terrace
  c.land.push(g(wallS + brick, `filter="${c.f('archP')}"`) + g(glass + g(people, `filter="${c.f('b2')}"`), `filter="${c.f('archP')}"`));
  cafeGlaze(c, base, hs, lit);
  if (lit) {
    c.land.push(glassLit);
    for (let i = 4; i < base.length - 4; i += 6) {
      const [x, y] = base[i];
      addLight(c, x, y - hs[i] * 0.4, 0, { halo: 70, always: true });
    }
  }
  c.land.push(g(frames + roof + bagels + shapeAll, `filter="${c.f('archP')}"`));
  // the left face turns away from us: a darker rose glaze over brick and glass alike
  {
    const left = base.map((p, i) => [p, hs[i]]).filter(([[x]]) => x <= 836);
    const face = [...left.map(([[x, y], h]) => [x, y - h - 1]), ...left.slice().reverse().map(([[x, y]]) => [x, y + 1])];
    c.land.push(g(pg(face, '#9E6E6A', 0.5), 'style="mix-blend-mode:multiply"'));
  }
  garageDoors(c, base, hs, lit);
  // the corner catches the light: one broken vertical stroke down the turn
  {
    const ci = base.reduce((b, p, i) => (Math.abs(p[0] - 836) < Math.abs(base[b][0] - 836) ? i : b), 0);
    const [cx, cy] = base[ci];
    const rc = c.sub('corner');
    let ed = '';
    let y = cy - hs[ci] + 2;
    while (y < cy - 2) {
      const len = rc.R(10, 34);
      ed += spath(`M${f1(cx + rc.R(-0.8, 0.8))},${f1(y)}L${f1(cx + rc.R(-1, 1))},${f1(Math.min(cy - 2, y + len))}`, '#F4D9C0', rc.R(2.2, 3.4), rc.R(0.55, 0.9));
      y += len + rc.R(3, 11);
    }
    c.land.push(g(ed, `filter="${c.f('dry')}"`));
  }
  // the café sign on the corner: a cream board, a hand brushed mark (a shape, never words)
  {
    const si = 26;
    const [sx, sy] = base[si];
    const top = sy - hs[si] + 7;
    const rs = c.sub('sign');
    let sg = pth(`M${f1(sx - 34)},${f1(top + 1)}Q${f1(sx)},${f1(top - 1.5)} ${f1(sx + 35)},${f1(top + 0.5)}L${f1(sx + 34)},${f1(top + 21)}Q${f1(sx)},${f1(top + 23)} ${f1(sx - 33)},${f1(top + 21.5)}Z`, '#EFE4CC', 0.9);
    sg += spath(`M${f1(sx - 34)},${f1(top + 21)}Q${f1(sx)},${f1(top + 23)} ${f1(sx + 34)},${f1(top + 21)}`, '#8E86A8', 2, 0.35);
    // a round bagel shaped loop, then a run of loose brush marks
    sg += `<ellipse cx="${f1(sx - 22)}" cy="${f1(top + 11)}" rx="5.4" ry="5" fill="none" stroke="#3E3230" stroke-width="2.2" stroke-opacity="0.8"/>`;
    let px = sx - 12;
    let d = '';
    for (let k = 0; k < 6; k++) {
      const w = rs.R(4, 7.5);
      const hi = rs.ch(0.3) ? 9 : 5.5;
      d += `M${f1(px)},${f1(top + 15.5)}q${f1(w * 0.3)},${f1(-hi)} ${f1(w * 0.6)},${f1(-rs.R(0, 1.5))}q${f1(w * 0.25)},${f1(hi * 0.8)} ${f1(w * 0.4)},${f1(rs.R(-0.5, 0.8))}`;
      px += w + rs.R(1, 3);
    }
    sg += spath(d, '#3E3230', 1.6, 0.8);
    sg += spath(`M${f1(sx - 10)},${f1(top + 18.5)}L${f1(px - 3)},${f1(top + 18)}`, '#3E3230', 0.9, 0.5);
    c.land.push(g(g(sg, `transform="rotate(-1.2 ${f1(sx)} ${f1(top + 10)})"`), `filter="${c.f('arch')}"`));
  }
  // chimney with steam
  chimney(c, 1012, 549 - 124 - 12, 10, 22, { col: '#9A9CA2', smokeSize: 0.75 });
  // terrace deck with planters, tables, shade sails
  const deckBack = base.filter(([x]) => x > 470 && x < 745);
  const deckFront = deckBack.map(([x, y]) => [x - 8, y + 36]);
  let dk = pg([...deckBack.map(([x, y]) => [x, y + 2]), ...deckFront.slice().reverse()], c.P('#A57A52', 0.45), 1, edge(c, 0.6));
  for (let t = 0.2; t < 1; t += 0.2) dk += spath(crPath(deckBack.map(([x, y], i) => [lerp(x, deckFront[i][0], t), lerp(y + 2, deckFront[i][1], t)]), false), c.P('#7A5A3E', -0.2), 0.8, 0.6);
  dk += pg([...deckFront, ...deckFront.slice().reverse().map(([x, y]) => [x, y + 7])], c.P('#7A5A3E', -0.4));
  c.land.push(g(dk, `filter="${c.f('arch')}"`));
  for (const [x, y] of [[520, 570], [600, 576], [680, 580]]) {
    let tb = ell(x - T.litSide * 12, y + 2, 20, 4, T.shade, 0.3);
    tb += line(x, y, x, y - 18, c.P('#3A4250', 0), 2);
    tb += ell(x, y - 18, 13, 4, c.P('#ECE6DA', 0.5), 1, 0);
    tb += pg([[x - 22, y + 2], [x - 18, y - 14], [x - 13, y - 14], [x - 15, y + 2]], c.P('#3A4250', 0), 0.9);
    tb += pg([[x + 22, y + 2], [x + 18, y - 14], [x + 13, y - 14], [x + 15, y + 2]], c.P('#3A4250', 0), 0.9);
    c.land.push(g(tb, `filter="${c.f('arch')}"`));
  }
  for (const [x, y] of [[490, 586], [560, 590], [640, 594], [716, 598]]) {
    c.land.push(g(rect(x - 16, y - 12, 32, 12, c.P('#8A6446', 0.2), 1, edge(c, 0.6)), `filter="${c.f('arch')}"`));
    bush(c, x, y - 10, 16, { flat: 0.55, n: 4 });
    if (S.flowers) c.land.push(circ(x - 6, y - 18, 2.2, c.P(S.flowers[0], 0.3)) + circ(x + 5, y - 17, 2, c.P(S.flowers[1], 0.3)));
  }
  let poles = '';
  for (const [x, y] of [[478, 588], [598, 594], [726, 600]]) poles += line(x, y, x, y - 112, c.P('#3A4250', 0.1), 2.2);
  c.land.push(g(poles, `filter="${c.f('arch')}"`));
  sail(c, [[476, 476], [598, 486], [548, 440]], { sag: 20 });
  sail(c, [[598, 482], [728, 492], [664, 448]], { sag: 22 });
  sail(c, [[514, 502], [702, 510], [596, 466]], { sag: 18 });
  if (c.extra.weekend) {
    const [wx, wy] = base[22];
    c.land.push(rect(wx - 8, wy - 50, 16, 11, c.P('#E8C88E', 0.4), 1, edge(c, 0.6)));
  }
  castShadow(c, 452, 1226, 566, 60, { op: 0.22 });
}

// Five tall black glass garage doors on the right wing, each with four
// mullions, set between pink brick piers with mortar dabs.
function garageDoors(c, base, hs, lit) {
  const { T } = c;
  const at = (x) => {
    for (let i = 0; i < base.length - 1; i++) {
      if (x <= base[i + 1][0]) {
        const t = (x - base[i][0]) / Math.max(1, base[i + 1][0] - base[i][0]);
        return [lerp(base[i][1], base[i + 1][1], t), lerp(hs[i], hs[i + 1], t)];
      }
    }
    return [base[base.length - 1][1], hs[hs.length - 1]];
  };
  const r = c.sub('garage');
  const k = faceK(c, -1) * 0.6 + T.frontK * 0.4;
  let piers = '';
  let doors = '';
  let mort = '';
  const x0 = 888;
  const step = 66;
  // hand set doors: widths wander, each hangs a little out of true, one stands half open
  const widths = [1.06, 0.93, 1.02, 0.95, 1.07];
  const tilts = [0.7, -1.2, 0.5, -0.9, 1.4];
  const openJ = 2;
  const pxAt = [x0 - 10];
  for (let j = 0; j < 5; j++) pxAt.push(pxAt[j] + step * widths[j]);
  const P = (x, t) => { const [y, h] = at(x); return [x, y - h * t]; };
  for (let j = 0; j <= 5; j++) {
    const px = pxAt[j];
    const stepJ = j < 5 ? pxAt[j + 1] - pxAt[j] : step;
    const pw = 12;
    piers += pg([P(px, 0.7), P(px + pw, 0.7), P(px + pw, 0), P(px, 0)], c.P(j % 2 ? '#B57A74' : '#C98E86', k));
    for (let q = 0; q < 6; q++) {
      const [mx, my] = P(px + r.R(1, pw - 1), r.R(0.04, 0.66));
      mort += ell(mx, my, r.R(1.5, 3.5), r.R(0.8, 1.4), c.P(r.pick(['#E8D2C4', '#9E6660', '#D8B4A8']), k), r.R(0.3, 0.6));
    }
    if (j === 5) break;
    const da = px + pw;
    const db = px + stepJ;
    const top = 0.66;
    const quadD = [P(da, top), P(db, top), P(db, 0.02), P(da, 0.02)];
    const [bx0, by0] = P((da + db) / 2, 0.02);
    const half = j === openJ;
    let dr = '';
    if (half) {
      // the open door: the panel rolled up into the head, warm room and a regular inside
      const [, yl] = P(da, 0.3);
      dr += pg(quadD, '#5A4636', 1);
      dr += pg([P(da, 0.36), P(db, 0.36), P(db, 0.02), P(da, 0.02)], '#E8C88E', 0.4);
      dr += pg([P(da, 0.36), P(db, 0.36), P(db, 0.02), P(da, 0.02)], '#C98E5A', 0.25);
      const fx = lerp(da, db, 0.42);
      const [, fy] = P(fx, 0.03);
      const fh = (fy - yl) * 0.92;
      dr += ell(fx, fy - 1, fh * 0.32, fh * 0.06, '#8E86A8', 0.3);
      dr += pth(`M${f1(fx - fh * 0.15)},${f1(fy)}Q${f1(fx - fh * 0.2)},${f1(fy - fh * 0.6)} ${f1(fx - fh * 0.05)},${f1(fy - fh * 0.78)}L${f1(fx + fh * 0.1)},${f1(fy - fh * 0.78)}Q${f1(fx + fh * 0.2)},${f1(fy - fh * 0.5)} ${f1(fx + fh * 0.14)},${f1(fy)}Z`, '#4E5A6A', 0.85);
      dr += circ(fx + fh * 0.02, fy - fh * 0.88, fh * 0.1, '#C99A6A', 0.9);
      dr += spath(`M${f1(fx + fh * 0.1)},${f1(fy - fh * 0.62)}l${f1(fh * 0.16)},${f1(fh * 0.08)}`, '#4E5A6A', fh * 0.07, 0.85);
      dr += pg([P(da, top), P(db, top), P(db, 0.4), P(da, 0.4)], c.lg([[0, '#2C3A3C'], [1, '#1E2A2E']], 0, 0, 0, 1));
      dr += pg([P(da, top), P(db, top), P(db, top - 0.08), P(da, top - 0.08)], mix(T.sky[3][1], '#E8EEF4', 0.3), lit ? 0.1 : 0.35);
    } else dr += pg(quadD, lit ? '#E8B878' : c.lg([[0, '#2C3A3C'], [1, '#1E2A2E']], 0, 0, 0, 1));
    if (!lit && !half) {
      // the sky lies on the upper third of the glass in soft broken streaks
      const skyC = mix(T.sky[3][1], '#E4ECF4', 0.35);
      for (let q = 0; q < 5; q++) {
        const t0 = r.R(0.46, 0.64);
        const u0 = r.R(0, 0.7);
        const u1 = clamp(u0 + r.R(0.2, 0.5), 0, 1);
        dr += pg([P(lerp(da, db, u0), t0), P(lerp(da, db, u1), t0 + r.R(-0.02, 0.03)), P(lerp(da, db, u1 - 0.08), t0 - r.R(0.03, 0.07)), P(lerp(da, db, u0 + 0.05), t0 - r.R(0.03, 0.06))], skyC, r.R(0.18, 0.4));
      }
    }
    doors += g(dr, `transform="rotate(${tilts[j]} ${f1(bx0)} ${f1(by0)})"`);
    if (!lit && !half) {
      // a warm slant of the morning across the glass, and the room deep behind
      const s0 = r.R(0.15, 0.5);
      const rot = `transform="rotate(${tilts[j]} ${f1(bx0)} ${f1(by0)})"`;
      doors += g(pg([P(lerp(da, db, s0), top), P(lerp(da, db, s0 + 0.22), top), P(lerp(da, db, s0 - 0.05), 0.02), P(lerp(da, db, s0 - 0.3), 0.02)].map(([x, y]) => [clamp(x, da, db), y]), '#E8C88E', 0.25) + pg([P(da, 0.3), P(db, 0.3), P(db, 0.02), P(da, 0.02)], '#5A4636', 0.35), rot);
    }
    // frame and four horizontal mullions, hand drawn, a little loose
    const fr = lit ? '#3A2E28' : '#1C2426';
    let fm = spath(`M${quadD.map(([x, y]) => `${f1(x + r.R(-0.6, 0.6))},${f1(y + r.R(-0.6, 0.6))}`).join('L')}Z`, fr, r.R(1.6, 2.2), 0.9);
    for (let m = 1; m <= 4; m++) {
      const t = 0.02 + (top - 0.02) * (m / 5);
      if (half && t < 0.4) continue;
      const [ax, ay] = P(da, t);
      const [bx, by] = P(db, t);
      fm += line(ax, ay + r.R(-0.5, 0.5), bx, by + r.R(-0.5, 0.5), fr, r.R(1, 1.6), r.R(0.6, 0.9));
      if (!lit) fm += line(ax, ay - 1.2, bx - r.R(0, 8), by - 1.2, '#8A9AA0', 0.6, 0.35);
    }
    const [hx, hy] = half ? P((da + db) / 2, 0.42) : P((da + db) / 2, 0.06);
    fm += line(hx - 5, hy, hx + 5, hy, '#9AA4A8', 1.2, 0.8);
    doors += g(fm, `transform="rotate(${tilts[j]} ${f1(bx0)} ${f1(by0)})"`);
  }
  c.land.push(g(piers + g(mort, `filter="${c.f('pig')}"`) + doors, `filter="${c.f('archP')}"`));
  if (lit) for (let j = 0; j < 5; j += 2) { const [lx, ly] = P(x0 + j * step + 24, 0.3); addLight(c, lx, ly, 0, { halo: 60, always: true }); }
}

function cafeGlaze(c, base, hs, lit) {
  const { T } = c;
  const P = (t) => base.map(([x, y], i) => [x, y - hs[i] * t]);
  const toD = (pts) => 'M' + pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join('L') + 'Z';
  const top = P(1);
  const band = P(0.56);
  const foot = P(0.16);
  // brick: broken rose, ochre and violet over the pink, dry brush mortar
  glaze(c, `<path d="${toD([...top, ...band.slice().reverse()])}"/>`, [440, 390, 1240, 500], { key: 'brick', cols: ['#DDA08E', '#B5655C', '#A898C8', '#C9A06A', '#F2C8B0', '#B5655C'], dark: '#6E3E38', n: 170, k: 0.8 });
  glaze(c, `<path d="${toD([...foot, ...base.slice().reverse()])}"/>`, [440, 500, 1240, 575], { key: 'knee', cols: ['#DDA08E', '#B5655C', '#9E8CB8', '#C9A06A', '#E8B8A0', '#B5655C'], dark: '#5E3A36', n: 90, k: 0.7 });
  // glass: the trees across the street and the sky reflected, warm room behind
  const gp = [...band, ...foot.slice().reverse()];
  const r = c.sub('reflect');
  let s = '';
  if (!lit) {
    for (let i = 0; i < 26; i++) {
      const k = r.RI(1, base.length - 2);
      const [x, y] = base[k];
      const hh = hs[k];
      s += ell(x + r.R(-10, 10), y - hh * r.R(0.3, 0.55), r.R(10, 30), hh * r.R(0.14, 0.3), r.pick([mix(c.S.leaf[0], '#2E4A4A', 0.5), mix(c.S.leaf[1] || c.S.leaf[0], '#3A4E5A', 0.45), '#3E5A62']), r.R(0.18, 0.36));
    }
    for (let i = 0; i < 3; i++) {
      const k = r.RI(2, base.length - 3);
      const [x, y] = base[k];
      const hh = hs[k];
      const x0 = x + r.R(-6, 6);
      s += pg([[x0, y - hh * 0.56], [x0 + r.R(8, 16), y - hh * 0.56], [x0 - r.R(10, 18), y - hh * 0.16], [x0 - r.R(22, 30), y - hh * 0.16]], mix(T.sky[3][1], '#C8D4E4', 0.5), r.R(0.12, 0.2));
    }
  } else {
    for (let i = 0; i < 18; i++) {
      const k = r.RI(1, base.length - 2);
      const [x, y] = base[k];
      s += ell(x, y - hs[k] * r.R(0.2, 0.5), r.R(12, 34), r.R(8, 20), r.pick(['#FFE2A2', '#FFC27A', '#F7A86A']), r.R(0.12, 0.3));
    }
  }
  c.land.push(g(g(s, `filter="${c.f('soft')}"`), `clip-path="${c.clip(`<path d="${toD(gp)}"/>`)}"`));
  // the far end of the long wall dissolves into the trees
  const far = T.litSide < 0 ? base.length - 1 : 0;
  const [fx, fy] = base[far];
  loseEdge(c, `M${f1(fx)},${f1(fy - hs[far])}L${f1(fx)},${f1(fy - 6)}`, 12, 0.35);
}

function trailer(c, x, y, k = 1) {
  const { T } = c;
  const w = 100 * k;
  const h = 48 * k;
  let s = ell(x - T.litSide * 20 * T.shadowLen, y + 4, w * 0.7, 6 * k, T.shade, 0.32);
  s += line(x - w / 2 - 24 * k, y - 8 * k, x - w / 2, y - 10 * k, c.P('#3A4250', 0), 2.2);
  s += rect(x - w / 2, y - h - 8 * k, w, h, c.P('#F1E6CF', T.frontK + 0.1), 1, ` rx="${8 * k}"${edge(c, 1)}`);
  s += rect(x - w / 2, y - 22 * k, w, 6 * k, c.P('#8FBFAE', 0.2));
  s += rect(x - w * 0.3, y - h - 2 * k, w * 0.5, h * 0.45, c.P('#4D5D74', -0.1), 1, edge(c, 0.6));
  s += pg([[x - w * 0.36, y - h - 4 * k], [x + w * 0.26, y - h - 4 * k], [x + w * 0.3, y - h + 8 * k], [x - w * 0.4, y - h + 8 * k]], c.P('#E8C88E', 0.3), 1, edge(c, 0.6));
  for (const wx of [x - w * 0.25, x + w * 0.25]) s += circ(wx, y - 4 * k, 8 * k, c.P('#2E3440', 0)) + circ(wx, y - 4 * k, 3 * k, c.P('#A9AEB5', 0.3));
  c.land.push(g(s, `filter="${c.f('arch')}"`));
  if (c.time === 'sunset' || c.time === 'night') addLight(c, x - w * 0.05, y - h + 6 * k, 0, { halo: 40 * k, shape: rect(x - w * 0.3, y - h - 2 * k, w * 0.5, h * 0.45, '#FFD58A', 0.9) });
}

BUILD.tower = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 482 });
  cloudSky(c, { big: 2, amount: 1.1 });
  range(c, { base: 478, amp: 130, d: 0.58, col: '#7F8CB6', scale: 360, key: 'far' });
  range(c, { base: 506, amp: 64, d: 0.42, col: '#73879E', scale: 280, key: 'mid' });
  hazeBand(c, 500, 60, 0.45);
  const n = noise1(c.r);
  const valley = profile(-20, W + 20, 10, (x) => 520 + fbm(n, x / 160) * 12);
  ground(c, valley, { d: 0.3, dabs: 300, key: 'valley', nearDark: 0 });
  // three hamlets at three depths, the farthest almost lost in the haze
  village(c, 40, 300, (x) => valley.at(x) + 10, { d: 0.46, min: 6, max: 9 });
  village(c, 380, 640, (x) => valley.at(x) + 26, { d: 0.3, min: 9, max: 13 });
  village(c, 1180, 1560, (x) => valley.at(x) + 40, { d: 0.16, min: 12, max: 18 });
  treeline(c, -20, W + 20, (x) => valley.at(x) + 6, { d: 0.34, min: 10, max: 18, pines: 0.4 });
  mist(c, 545, 60);
  const ridge = profile(-20, W + 20, 8, (x) => {
    const dx = (x - 832) / 520;
    return 552 + Math.max(0, Math.abs(dx) - 0.12) * Math.abs(dx) * 230 + fbm(n, x / 90 + 7) * 22 - 8;
  });
  ground(c, ridge, { d: 0.04, dabs: 650, persp: [552, 900], key: 'ridge', strokes: 600, leaves: 90 });
  rocks(c, [[520, 640, 150, 80], [1150, 646, 170, 86], [690, 596, 70, 38], [990, 600, 80, 42], [330, 724, 190, 96], [1330, 736, 200, 100], [760, 640, 40, 20]]);
  for (const [x, y, h] of [[450, 640, 70], [600, 610, 56], [1060, 612, 60], [1230, 640, 76], [250, 690, 90]]) pine(c, x, y, h, {});
  // the road climbs from the bottom center and bends right to the gate
  const climb = pl.path.map(([px, py], i) => [px + 7 * Math.pow(i / Math.max(1, pl.path.length - 1), 1.3), py]);
  road(c, climb, { w0: 220, w1: 26, kind: 'dirt' });
  const l0 = c.land.length;
  const q0 = c.lights.length;
  watchtower(c);
  // the old tower leans a little on its rock
  const lean = `transform="rotate(1.5 928 556)"`;
  c.land.splice(l0, c.land.length - l0, g(c.land.slice(l0).join(''), lean));
  c.lights.splice(q0, c.lights.length - q0, g(c.lights.slice(q0).join(''), lean));
  if (c.time !== 'night') birds(c, [[930, 196, 7], [952, 178, 6], [905, 160, 5], [1040, 230, 6]], c.P('#3E4A5E', 0));
  frame(c, { tl: 0.9, tr: 0.9, bl: 1, br: 0.9 });
  warmLight(c);
  vignette(c, 0.3);
};

function watchtower(c) {
  const { T, S } = c;
  const x = 928;
  const st = '#B7B3AE';
  let s = '';
  const day = c.time === 'day' || c.time === 'morning';
  s += cylinder(c, x, 556, 106, 90, 244, st, {
    cols: [c.P(day ? '#D9D2C4' : mix('#D9D2C4', T.light, 0.35), day ? 0.25 : 0.9), c.P('#B7B3AE', 0), null],
    shOp: 0.55, dabs: 36, dabCols: ['#C9C0AE', '#9E9585', '#C9C0AE', '#A7A2A6'],
  });
  // stone courses: broken dry brush strokes, never ruled lines
  const r = c.sub('wtstones');
  let cr = '';
  for (let y = 546; y > 252; y -= r.R(10, 17)) {
    const t = (556 - y) / 312;
    const hw = lerp(53, 45, t);
    let xa = x - hw + r.R(0, 10);
    while (xa < x + hw - 8) {
      const len = r.R(12, 34);
      const u = (xa - (x - hw)) / (2 * hw);
      const shadeSide = T.litSide < 0 ? u > 0.6 : u < 0.4;
      if (r.ch(0.7)) cr += spath(`M${f1(xa)},${f1(y + r.R(-1, 1))}l${f1(len)},${f1(r.R(-1.2, 1.2))}`, c.P(shadeSide ? '#6E7088' : '#8E8576', -0.2), r.R(0.8, 1.6), r.R(0.25, 0.45));
      xa += len + r.R(3, 12);
    }
  }
  s += g(cr, `filter="${c.f('dry')}"`);
  // the base is broken: fallen stones and grass growing up into the wall
  let bs = '';
  for (let k = 0; k < 9; k++) {
    const bx = x + r.R(-62, 62);
    bs += ell(bx, 556 + r.R(-3, 5), r.R(5, 12), r.R(3, 6), c.P(r.pick(['#9E9585', '#B7B3AE', '#8E8A9A']), r.R(-0.3, 0.4)), 0.85, r.R(-15, 15));
  }
  for (let k = 0; k < 26; k++) {
    const bx = x + r.R(-66, 66);
    const hh = r.R(6, 22);
    bs += spath(`M${f1(bx)},${f1(558)}q${f1(r.R(-3, 3))},${f1(-hh / 2)} ${f1(r.R(-6, 6))},${f1(-hh)}`, c.P(r.pick(c.S.grass), r.R(-0.2, 0.5)), r.R(1.2, 2.6), 0.8);
  }
  // corbels and parapet with crenels
  for (let i = 0; i < 9; i++) s += rect(x - 50 + i * 12, 238, 6, 9, c.P(st, -0.3), 1, edge(c, 0.5));
  s += cylinder(c, x, 240, 116, 116, 214, st);
  for (let i = 0; i < 7; i++) s += rect(x - 56 + i * 17, 202, 10, 13, c.P(st, (i < 3) === (T.litSide < 0) ? 0.6 : -0.3), 1, edge(c, 0.6));
  // gate
  s += pth(`M${x - 17},556L${x - 17},522A17,17 0 0 1 ${x + 17},522L${x + 17},556Z`, c.P('#3A3030', -0.3), 1, edge(c, 0.8));
  s += pth(`M${x - 13},556L${x - 13},523A13,13 0 0 1 ${x + 13},523L${x + 13},556Z`, c.P('#6E4A34', -0.1));
  for (const dx of [-6, 0, 6]) s += line(x + dx, 512, x + dx, 555, c.P('#4A3426', -0.3), 0.8, 0.7);
  c.land.push(g(s, `filter="${c.f('arch')}"`) + g(bs, `filter="${c.f('leaf')}"`));
  for (const [y, h, w2, dx] of [[472, 24, 9, -2], [398, 18, 7, 3], [334, 21, 8, 0]]) windowOn(c, face([x - w2 / 2 + T.litSide * 12 + dx, y], [w2, 0], [0, -h]), 0, 0, 1, 1, { mullions: 0, sill: false, glass: c.P('#3A4A4E', 0), litP: c.T.lit ? 0.8 : 0 });
  // banners, gold and blue, hanging from the parapet: cloth that sags and folds
  for (const [bx, col, len, sway] of [[x - 28, '#D9AE52', 124, -3], [x + 22, '#5A7DA6', 112, 4]]) {
    const top = 246;
    const bot = top + len;
    const lw = 10;
    const litL = T.litSide < 0;
    let bn = pth(`M${bx - lw},${top}Q${bx - lw - 1},${top + len * 0.5} ${bx - lw + sway},${bot}L${bx + sway},${bot - 13}L${bx + lw + sway + 1},${bot - 2}Q${bx + lw + 1},${top + len * 0.45} ${bx + lw},${top}Z`, c.P(col, 0.15));
    // fold shading: soft valleys running down, a lit ridge between
    const fold = (dx0, w0, colF, op) => pth(`M${bx + dx0},${top + 4}Q${bx + dx0 - 1},${top + len * 0.5} ${bx + dx0 + sway * 0.8},${bot - 9}L${bx + dx0 + w0 + sway * 0.8},${bot - 10}Q${bx + dx0 + w0},${top + len * 0.5} ${bx + dx0 + w0},${top + 4}Z`, colF, op);
    bn += fold(-3, 4, c.P(col, -0.7), 0.45);
    bn += fold(litL ? 5 : -9, 4, c.P(col, -0.55), 0.5);
    bn += fold(litL ? -8 : 4, 3, mix(c.P(col, 0.8), '#FFF4DC', 0.25), 0.55);
    // a worn emblem painted on the cloth
    bn += pth(`M${bx},${top + 18}l6,7l-6,7l-6,-7Z`, 'none', 1, ` stroke="${c.P('#F3EFE6', 0.3)}" stroke-width="1.3" stroke-opacity="0.6"`);
    bn += spath(`M${bx - 12},${top}L${bx + 12},${top + 1}`, c.P('#6E4A34', 0), 2.2, 0.9);
    c.land.push(g(bn, `filter="${c.f('wc')}"`));
  }
  // the wooden roost on the summit with messenger birds
  const wood = '#7A5A40';
  let ro = '';
  for (const px of [x - 30, x + 6]) ro += rect(px, 160, 5, 44, c.P(wood, -0.2));
  ro += rect(x - 34, 178, 46, 4, c.P(wood, 0.3));
  ro += rect(x - 34, 192, 46, 4, c.P(wood, 0.3));
  ro += pg([[x - 42, 162], [x + 20, 162], [x - 11, 140]], c.P('#9A6E48', 0.3), 1, edge(c, 0.7));
  for (const bx of [x - 24, x - 12, x + 2]) ro += ell(bx, 174, 4, 3, c.P('#7C8090', 0.3)) + circ(bx + 3, 171, 2, c.P('#7C8090', 0.4));
  // iron fire basin
  ro += line(x + 30, 204, x + 36, 186, c.P('#3A3F48', 0), 1.6) + line(x + 46, 204, x + 40, 186, c.P('#3A3F48', 0), 1.6);
  ro += pth(`M${x + 26},184L${x + 50},184L${x + 46},192L${x + 30},192Z`, c.P('#3A3F48', 0.2), 1, edge(c, 0.6));
  if (S.snow) ro += pg([[x - 42, 161], [x + 20, 161], [x - 11, 141]], '#F4F6F9', 0.7) + rect(x - 58, 200, 116, 3, '#F4F6F9', 0.9);
  c.land.push(g(ro, `filter="${c.f('arch')}"`));
  if (c.time === 'sunset' || c.time === 'night') {
    addLight(c, x + 38, 178, 0, { halo: 70, shape: pth(`M${x + 30},185Q${x + 32},172 ${x + 38},164Q${x + 40},174 ${x + 44},170Q${x + 48},178 ${x + 46},185Z`, '#FFC46A', 0.95) + pth(`M${x + 35},185Q${x + 37},176 ${x + 39},172Q${x + 42},179 ${x + 42},185Z`, '#FFF0C0', 0.95) });
  } else {
    smoke(c, x + 38, 182, 0.45);
  }
  // notice board and the rack of rolled letters by the door
  board(c, x + 66, 566, 30, 20, { papers: 3 });
  let rack = rect(x - 86, 538, 32, 24, c.P('#7A5A40', 0.1), 1, edge(c, 0.6));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) rack += circ(x - 82 + j * 8, 543 + i * 8, 3, c.P('#EFE6D2', 0.4)) + circ(x - 82 + j * 8, 543 + i * 8, 1.2, c.P('#C9A36A', 0));
  c.land.push(g(rack + ell(x - 70 - T.litSide * 10, 564, 22, 3, T.shade, 0.3), `filter="${c.f('arch')}"`));
  castShadow(c, x - 50, x + 50, 558, 300, { op: 0.28 });
}

BUILD.home = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 412 });
  cloudSky(c, {});
  range(c, { base: 410, amp: 54, d: 0.64, key: 'far' });
  hazeBand(c, 410, 46, 0.5);
  const n = noise1(c.r);
  ground(c, profile(-20, W + 20, 10, (x) => 410 + fbm(n, x / 150) * 8), { d: 0.5, dabs: 120, key: 'shore', nearDark: 0 });
  // the far town tower across the water
  const fx = 300;
  const fh = T.farHaze || T.haze;
  let ft = rect(fx - 4, 380, 8, 36, mix(c.P('#F1ECE2', 0.4), fh, 0.45)) + pg([[fx - 6, 381], [fx + 6, 381], [fx, 368]], mix(c.P('#B85E38', 0.2), fh, 0.45));
  c.land.push(ft);
  for (const [hx, s2] of [[262, 7], [280, 6], [322, 7], [340, 6], [358, 5]]) tinyHouse(c, hx, 416, s2, { d: 0.5 });
  water(c, { y0: 416, y1: 470, shape: 'M-20,416C300,414 800,416 1620,418L1620,452C900,468 300,472 -20,476Z', n: 70 });
  const slope = profile(-20, W + 20, 10, (x) => 486 - (x / W) * 26 + fbm(n, x / 200 + 3) * 14);
  ground(c, slope, { d: 0.04, dabs: 650, persp: [470, 900], key: 'slope', strokes: 650, leaves: 160 });
  treeline(c, -20, 420, (x) => slope.at(x) + 4, { d: 0.12, min: 18, max: 30 });
  mist(c, 470, 40);
  // vegetable garden: rows that follow the slope in curves, uneven gaps, a few missing plants
  let gd = '';
  const rgd = c.sub('garden');
  let gy0 = 594;
  for (let row = 0; row < 4; row++) {
    const y = gy0;
    gy0 += rgd.R(13, 20);
    const x0 = 380 + rgd.R(-10, 14) + row * 4;
    const x1 = 560 + rgd.R(-16, 10) + row * 10;
    const bow = rgd.R(4, 9);
    const yA = (x) => y + Math.sin(((x - x0) / (x1 - x0)) * Math.PI) * -bow + (x - x0) * 0.02;
    const soil = c.P(S.snow ? '#E8ECF2' : rgd.pick(['#7A5A40', '#6E5240', '#86644A']), -0.1);
    gd += spath(`M${pt(x0, yA(x0))}Q${pt((x0 + x1) / 2, yA((x0 + x1) / 2) - bow)} ${pt(x1, yA(x1))}`, soil, rgd.R(7, 10), 0.85);
    for (let x = x0 + rgd.R(2, 10); x < x1 - 4; x += rgd.R(12, 26)) {
      if (rgd.ch(0.12)) continue;
      const big = rgd.R(4, 7.5);
      gd += pth(blob(rgd.r, x, yA(x) - 5, big, big * 0.7, 0.4, 7), c.P(S.snow ? '#F2F5F8' : rgd.pick(['#6FA457', '#8FB860', '#5E9A4E', '#9AAE5A', '#7E8E4E']), rgd.R(0, 0.45)), 0.92);
      if (rgd.ch(0.3)) gd += leaf(x, yA(x) - 7, big * 1.4, big * 0.4, -Math.PI / 2 + rgd.R(-0.7, 0.7), c.P('#A8C470', 0.5), 0.6);
    }
  }
  // the garden fence: uneven posts, a lean here and there, one rail sagging
  let fx0 = 362;
  const fence = [];
  while (fx0 < 612) { fence.push([fx0, rgd.R(-0.12, 0.12), rgd.R(11, 19)]); fx0 += rgd.R(14, 30); }
  for (const [x, lean, hh] of fence) {
    const yb = 666 + (x - 362) * -0.02 + rgd.R(-1.5, 1.5);
    gd += spath(`M${pt(x, yb)}L${pt(x + lean * hh, yb - hh)}`, c.P('#8A6446', rgd.R(-0.3, 0.4)), rgd.R(1.6, 2.6), 0.95);
  }
  gd += spath(`M362,658Q420,661 470,657T612,654`, c.P('#8A6446', 0.2), 1.3, 0.9);
  gd += spath(`M362,652Q440,650 520,652L560,649`, c.P('#8A6446', 0.05), 1.1, 0.7, ' stroke-dasharray="70 16 120 30"');
  c.land.push(g(gd, `filter="${c.f('arch')}"`));
  // the cottage
  const b = block(c, { x: 560, y: 568, w: 290, h: 118, d: 230, side: 1, kind: 'eave', roofH: 96, wall: '#EFE4CF', roof: '#8C8794', tiles: false });
  {
    // the roof in three tones: lit slate, a shadow wash pooling toward the eave, moss dabs;
    // the ridge sags a little and the eave shadow breaks
    const rr = c.sub('homeroof');
    const [D, Cc] = b.ridge;
    const A = [560 - 6, b.top + 3];
    const B = [860 + 6, b.top + 3];
    const rq = `<path d="M${f1(A[0])},${f1(A[1])}L${f1(B[0])},${f1(B[1])}L${f1(Cc[0])},${f1(Cc[1])}L${f1(D[0])},${f1(D[1])}Z"/>`;
    // warm grey slate: broken dry brush courses, a lit ridge, a moss bloom wet in wet
    // near the eave; nothing ruled, each course wanders and breaks
    let rf = '';
    for (let i = 1; i < 11; i++) {
      const t = i / 11 + rr.R(-0.02, 0.02);
      const p = lerpP(A, D, t);
      const q = lerpP(B, Cc, t);
      let u = rr.R(0, 0.12);
      while (u < 0.96) {
        const u2 = Math.min(1, u + rr.R(0.08, 0.3));
        const a1 = lerpP(p, q, u);
        const a2 = lerpP(p, q, u2);
        const dark = rr.ch(0.6);
        rf += spath(`M${pt(a1[0], a1[1] + rr.R(-1, 1))}Q${pt((a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2 + rr.R(-1.6, 1.6))} ${pt(a2[0], a2[1] + rr.R(-1, 1))}`, dark ? '#6F6A7E' : '#CFC3B4', rr.R(1.1, 2.4), dark ? 0.4 : 0.35);
        u = u2 + rr.R(0.02, 0.1);
      }
    }
    // the far half of the slope gets a little more of the sky
    rf += pth(blob(rr.r, ...lerpP(D, Cc, 0.7), 90, 26, 0.4, 9), '#CFC3B4', 0.18);
    let moss = '';
    for (let i = 0; i < 5; i++) {
      const p = lerpP(lerpP(A, D, rr.R(0, 0.22)), lerpP(B, Cc, rr.R(0, 0.22)), rr.R(0.05, 0.8));
      moss += pth(blob(rr.r, p[0], p[1], rr.R(16, 40), rr.R(5, 10), 0.5, 9), '#7E9A62', 0.3);
    }
    for (let i = 0; i < 22; i++) {
      const p = lerpP(lerpP(A, D, rr.R(0, 0.5)), lerpP(B, Cc, rr.R(0, 0.5)), rr.r());
      moss += ell(p[0], p[1], rr.R(2, 6), rr.R(1, 2.6), rr.ch(0.6) ? '#7E9A62' : '#A8A07A', 0.35, rr.R(-12, 8));
    }
    const ridge = `M${f1(D[0])},${f1(D[1])}C${f1(lerp(D[0], Cc[0], 0.33))},${f1(D[1] + 2.6)} ${f1(lerp(D[0], Cc[0], 0.66))},${f1(D[1] + 1.6)} ${f1(Cc[0])},${f1(Cc[1] + 0.8)}`;
    let eave = '';
    for (let x = A[0] + 4; x < B[0] - 10; x += rr.R(18, 46)) eave += spath(`M${f1(x)},${f1(b.top + 6)}l${f1(rr.R(12, 40))},${f1(rr.R(-1, 1.4))}`, '#5E5A70', rr.R(3, 6), rr.R(0.3, 0.5));
    c.land.push(g(g(rf, `filter="${c.f('pig')}"`) + g(moss, `filter="${c.f('wet')}"`), `clip-path="${c.clip(rq)}"`) + g(spath(ridge, c.time === 'night' ? '#B9C0D8' : '#EDE0CC', 3.4, 0.6, ' stroke-dasharray="60 6 90 4 200"') + eave, `filter="${c.f('archP')}"`));
    // the gable side in shade: a cool violet glaze, multiplied
    const gs = [[860, 568], [860 + b.dv[0], 568 + b.dv[1]], [860 + b.dv[0], b.top + b.dv[1]], b.apex, [860, b.top]];
    c.land.push(g(pg(gs, '#6E6A88', 0.3), `filter="${c.f('wet')}" style="mix-blend-mode:multiply"`));
    // a cool lower wash on the wall and lost edges at its corners
    c.land.push(g(pg(quad(b.F, 0, 0, 1, 0.36), '#B8BCCB', 0.3), `filter="${c.f('wet')}"`));
    loseEdge(c, `M${f1(860 + b.dv[0])},${f1(b.top + b.dv[1] + 8)}L${f1(860 + b.dv[0])},${f1(568 + b.dv[1] - 4)}`, 10, 0.35);
  }
  // stone base course
  let stn = '';
  const rs = c.sub('cottage');
  for (let i = 0; i < 26; i++) stn += ell(...b.F(rs.R(0.02, 0.98), rs.R(0.02, 0.2)), rs.R(6, 11), rs.R(3, 5), c.P(rs.pick(['#B9AD9A', '#A89C88', '#CFC4B0']), rs.R(-0.3, 0.5)), 0.85);
  c.land.push(stn);
  windowOn(c, b.F, 0.08, 0.32, 0.36, 0.74, {
    rows: 1, litP: c.T.lit ? 1 : 0, keep: true,
    content: (F, a0, b0, a1, b1, isLit) => {
      // the idea desk and its lamp
      let q = pg(quad(F, a0, b0, a1, b0 + 0.08), isLit ? '#B07A4A' : c.P('#5A4030', -0.2));
      q += pg(quad(F, a0 + 0.16, b0 + 0.08, a0 + 0.18, b0 + 0.22), isLit ? '#7A5030' : c.P('#3A3030', 0));
      q += pg([F(a0 + 0.13, b0 + 0.22), F(a0 + 0.21, b0 + 0.22), F(a0 + 0.19, b0 + 0.28), F(a0 + 0.15, b0 + 0.28)], isLit ? '#FFF2C8' : c.P('#C9A36A', 0));
      return q;
    },
  });
  // the cat on the windowsill
  const [cx0, cy0] = b.F(0.29, 0.32);
  c.land.push(ell(cx0, cy0 - 5, 9, 5.5, '#2E2A30', 0.95) + circ(cx0 + 7, cy0 - 11, 4.4, '#2E2A30', 0.95) + pg([[cx0 + 4, cy0 - 14], [cx0 + 5.5, cy0 - 19], [cx0 + 7.5, cy0 - 15]], '#2E2A30') + pg([[cx0 + 7.5, cy0 - 15], [cx0 + 10, cy0 - 19], [cx0 + 11, cy0 - 13]], '#2E2A30') + spath(`M${f1(cx0 - 8)},${f1(cy0 - 3)}Q${f1(cx0 - 16)},${f1(cy0 + 4)} ${f1(cx0 - 12)},${f1(cy0 + 12)}`, '#2E2A30', 2.2));
  windowOn(c, b.F, 0.44, 0.4, 0.56, 0.74, { rows: 1 });
  door(c, b.F, 0.66, 0.82, 0.66, { col: '#6E4A34' });
  windowOn(c, b.S, 0.3, 0.42, 0.62, 0.72, { rows: 1 });
  if (S.flowers) for (const [a0, a1] of [[0.08, 0.36], [0.44, 0.56]]) {
    const [px, py] = b.F(a0, 0.3);
    const [qx] = b.F(a1, 0.3);
    let fb = rect(px - 2, py - 2, qx - px + 4, 6, c.P('#8A6446', 0.1));
    for (let k = 0; k < 6; k++) fb += circ(lerp(px, qx, k / 5), py - 3, 3, c.P(S.flowers[k % S.flowers.length], 0.3), 0.95);
    c.land.push(fb);
  }
  chimney(c, 790, 432, 16, 34, { col: '#B5A994', smokeSize: 0.9 });
  // lantern on its hook by the door, the bench, the soccer ball
  const [lx, ly] = b.F(0.86, 0.6);
  c.land.push(line(lx - 2, ly - 6, lx + 6, ly - 6, c.P('#3A3F48', 0), 1.4) + rect(lx + 1, ly - 4, 8, 11, c.P('#3E4A5E', 0)) + rect(lx + 2.4, ly - 2.5, 5.2, 8, c.P('#E8DEC2', 0.2), 0.8));
  addLight(c, lx + 5, ly + 1.5, 2.8, { halo: 46, col: '#FFD27E' });
  bench(c, 1080, 590, 50);
  const [bx, by] = b.F(0.6, 0);
  c.land.push(ell(bx - T.litSide * 6, by + 9, 8, 2, T.shade, 0.35) + circ(bx, by + 3, 6.5, c.P('#F3EFE6', 0.4)) + circ(bx - 1.5, by + 2, 2, c.P('#3A3F48', 0)) + circ(bx + 3, by + 5.5, 1.4, c.P('#3A3F48', 0)) + circ(bx + 2.6, by - 1, 1.3, c.P('#3A3F48', 0)));
  castShadow(c, 560, 860, 570, 100, { op: 0.26 });
  // the big seasonal tree beside the cottage
  // it stands close: its crown overlaps the far corner of the cottage a little
  tree(c, 1060, 612, 182, { touches: 70, dapple: true });
  const rd = road(c, pl.path, { w0: 240, w1: 40, kind: 'dirt' });
  // a small wooden gate at the bottom
  const gy = 800;
  const gx = rd.at(gy);
  const gw = rd.wAt(gy) / 2 + 8;
  const wood = '#8A6446';
  let gt = '';
  for (const side of [-1, 1]) {
    const px = gx + side * gw;
    gt += rect(px - 6, gy - 86, 12, 92, c.P(wood, side === T.litSide ? 0.5 : -0.3), 1, edge(c, 0.8));
    gt += pg([[px - 7, gy - 86], [px + 7, gy - 86], [px, gy - 94]], c.P(wood, 0.3));
    const ex = px + side * 260;
    gt += spath(`M${pt(px, gy - 64)}Q${pt((px + ex) / 2, gy - 62)} ${pt(ex, gy - 71)}`, c.P(wood, 0.2), 4);
    gt += spath(`M${pt(px, gy - 30)}Q${pt((px + ex) / 2, gy - 26 + side * 3)} ${pt(ex, gy - 37)}`, c.P(wood, 0), 4);
    const rgt = c.sub('gatefence' + side);
    for (let k = 1; k <= 9; k++) {
      if (k === 6 && side > 0) continue;
      const tx = lerp(px, ex, (k + rgt.R(-0.3, 0.3)) / 9);
      const lean = rgt.R(-4, 4);
      const top0 = gy - 76 - (k / 9) * 6 + rgt.R(-6, 8);
      gt += spath(`M${pt(tx, gy + 2 - (k / 9) * 6)}L${pt(tx + lean, top0)}`, c.P(wood, rgt.R(-0.25, 0.4)), rgt.R(4, 6.5), 1);
    }
  }
  // the gate leaf stands open
  const hx = gx - gw;
  gt += pg([[hx + 6, gy - 70], [hx + 70, gy - 92], [hx + 70, gy - 34], [hx + 6, gy - 20]], 'none', 1, ` stroke="${c.P(wood, 0.4)}" stroke-width="4"`);
  for (let k = 1; k < 5; k++) gt += line(hx + 6 + k * 16, gy - 70 - k * 5.5, hx + 6 + k * 16, gy - 20 - k * 3.5, c.P(wood, 0.2), 3.2);
  c.land.push(g(gt, `filter="${c.f('arch')}"`));
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 1, tr: 0.8, bl: 0.8, br: 0.9 });
  nearFoliage(c, 20, 900, 280, 210);
};

BUILD.kitchen = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 432 });
  cloudSky(c, {});
  range(c, { base: 432, amp: 60, d: 0.62, key: 'far' });
  hazeBand(c, 432, 50, 0.5);
  const n = noise1(c.r);
  const rolling = profile(-20, W + 20, 10, (x) => 452 + fbm(n, x / 140) * 34);
  ground(c, rolling, { d: 0.32, dabs: 220, key: 'roll', nearDark: 0 });
  // orchard rows on the hills
  for (let i = 0; i < 14; i++) {
    const x = 60 + i * 110 + c.R(-20, 20);
    if (x > 520 && x < 1090) continue;
    tree(c, x, rolling.at(x) + 26, c.R(22, 30), { d: 0.28, gaps: false });
  }
  mist(c, 470, 50);
  const yard = profile(-20, W + 20, 10, (x) => 500 + fbm(n, x / 200 + 5) * 12);
  ground(c, yard, { d: 0.03, dabs: 640, persp: [500, 900], key: 'yard', strokes: 620, leaves: 160 });
  // the fieldstone farmhouse kitchen
  const b = block(c, { x: 545, y: 574, w: 510, h: 140, d: 150, side: 1, kind: 'eave', roofH: 78, wall: '#CDBC9F', roof: '#8C6A56' });
  let stn = '';
  const rs = c.sub('fieldstone');
  for (let i = 0; i < 160; i++) {
    const a = rs.R(0.01, 0.99);
    const bb = rs.R(0.02, 0.97);
    stn += ell(...b.F(a, bb), rs.R(6, 13), rs.R(3.5, 6), c.P(rs.pick(['#BBA98C', '#D8C9AE', '#A8957A', '#C6B391', '#B5A794']), rs.R(-0.35, 0.5)), 0.75);
  }
  for (let i = 0; i < 50; i++) stn += ell(...b.S(rs.R(0.05, 0.95), rs.R(0.02, 0.97)), rs.R(5, 9), rs.R(3, 5), c.P(rs.pick(['#BBA98C', '#A8957A']), faceK(c, 1) * 0.7), 0.6);
  c.land.push(g(stn, `filter="${c.f('arch')}"`));
  // timber beams
  const beam = c.P('#5A4030', -0.1);
  let bm = pg(quad(b.F, -0.005, 0.8, 1.005, 0.86), beam, 1, edge(c, 0.6));
  for (const a of [0, 0.995]) bm += pg(quad(b.F, a - 0.008, 0, a + 0.01, 0.8), beam);
  for (let k = 0; k < 9; k++) bm += rect(b.F(0.05 + k * 0.112, 1)[0] - 3, b.top + 4, 7, 7, c.P('#5A4030', 0.2));
  c.land.push(bm);
  windowOn(c, b.F, 0.13, 0.28, 0.43, 0.7, {
    rows: 1, litP: c.T.lit ? 1 : 0, keep: true,
    content: (F, a0, b0, a1, b1, isLit) => {
      let q = pg(quad(F, a0, b0, a1, b0 + 0.1), isLit ? '#B27A4C' : c.P('#6A4A34', -0.2));
      for (const [u, w] of [[0.05, 0.07], [0.15, 0.05]]) q += ell(...F(a0 + u, b0 + 0.13), w * 130, 5, isLit ? '#E9B46E' : c.P('#C99A5E', 0.2));
      const [px, py] = F(a0 + 0.22, b0 + 0.12);
      q += pth(`M${f1(px - 11)},${f1(py)}L${f1(px + 11)},${f1(py)}L${f1(px + 9)},${f1(py - 14)}L${f1(px - 9)},${f1(py - 14)}Z`, isLit ? '#6A4A3A' : c.P('#3A3F48', 0));
      q += spath(`M${f1(px - 3)},${f1(py - 16)}Q${f1(px - 8)},${f1(py - 26)} ${f1(px - 2)},${f1(py - 34)}M${f1(px + 4)},${f1(py - 16)}Q${f1(px)},${f1(py - 28)} ${f1(px + 6)},${f1(py - 38)}`, isLit ? '#FFF4DA' : c.P('#E8E6E2', 0.4), 2, 0.6);
      return q;
    },
  });
  // herb pots on the sill
  for (let k = 0; k < 4; k++) {
    const [px, py] = b.F(0.16 + k * 0.075, 0.27);
    c.land.push(pth(`M${f1(px - 6)},${f1(py - 9)}L${f1(px + 6)},${f1(py - 9)}L${f1(px + 4.5)},${f1(py)}L${f1(px - 4.5)},${f1(py)}Z`, c.P('#C8774A', 0.3)) + ell(px, py - 13, 8, 6, c.P(k % 2 ? '#6FA457' : '#5E9A4E', 0.3)) + ell(px - 2, py - 16, 4, 3, c.P('#9BC46E', 0.7), 0.8));
  }
  windowOn(c, b.F, 0.5, 0.34, 0.62, 0.7, {
    rows: 0, mullions: 0, litP: c.T.lit ? 0.8 : 0,
    content: (F, a0, b0, a1, b1, isLit) => {
      let q = '';
      for (const bb of [0.45, 0.62, 0.78]) {
        q += pg(quad(F, a0, bb, a1, bb + 0.012), isLit ? '#9A6A44' : c.P('#6A4A34', 0));
        for (let k = 0; k < 4; k++) q += pg(quad(F, a0 + 0.01 + k * 0.028, bb + 0.012, a0 + 0.028 + k * 0.028, bb + 0.06 + (k % 2) * 0.02), isLit ? ['#E8C88E', '#C9906A', '#B8C08A', '#E2B060'][k] : c.P(['#C9A36A', '#9A6A54', '#8FA06A', '#B88A4A'][k], 0), 0.95);
      }
      return q;
    },
  });
  door(c, b.F, 0.72, 0.84, 0.7, { col: '#6E4A34' });
  // the meal slate by the door
  const [sx, sy] = b.F(0.665, 0.62);
  let sl = rect(sx - 16, sy, 32, 24, c.P('#7A5A40', 0.1), 1, edge(c, 0.6)) + rect(sx - 13, sy + 3, 26, 18, c.P('#2F3A3A', -0.1));
  for (let k = 0; k < 7; k++) sl += line(sx - 11 + k * 3.7, sy + 6, sx - 11 + k * 3.7, sy + 8, c.P('#E8E2D2', 0.3), 0.8, 0.7);
  c.land.push(sl);
  // baskets of vegetables by the door
  for (const [a, cols] of [[0.88, ['#E08A3A', '#E3A53E', '#8FB860']], [0.95, ['#9A5A7A', '#8FB860', '#E8C35A']]]) {
    const [px, py] = b.F(a, 0);
    let bs = ell(px - T.litSide * 8, py + 6, 18, 3, T.shade, 0.32);
    bs += pth(`M${f1(px - 15)},${f1(py - 12)}L${f1(px + 15)},${f1(py - 12)}L${f1(px + 12)},${f1(py + 4)}L${f1(px - 12)},${f1(py + 4)}Z`, c.P('#A57A52', 0.2), 1, edge(c, 0.6));
    for (let k = 0; k < 6; k++) bs += circ(px - 11 + k * 4.5, py - 14 - (k % 2) * 3, 4, c.P(cols[k % 3], 0.3));
    bs += line(px - 15, py - 6, px + 15, py - 6, c.P('#7A5A3E', -0.2), 0.8, 0.7);
    c.land.push(g(bs, `filter="${c.f('arch')}"`));
  }
  chimney(c, 960, 455, 20, 44, { col: '#B9A58C', smokeSize: 1 });
  castShadow(c, 545, 1055, 576, 110, { op: 0.26 });
  // woodpile under a lean to against the side wall
  let wp = pg([[1062, 520], [1150, 500], [1156, 510], [1066, 532]], c.P('#8C6A56', 0.4), 1, edge(c, 0.7));
  wp += line(1148, 508, 1148, 566, c.P('#5A4030', 0), 3);
  for (let row = 0; row < 3; row++) for (let k = 0; k < 6; k++) {
    const lx = 1076 + k * 12 + (row % 2) * 6;
    const ly = 560 - row * 11 - k * 1.6;
    wp += circ(lx, ly, 5.6, c.P('#9A7050', 0.1)) + circ(lx, ly, 3.4, c.P('#D9B98A', 0.4)) + circ(lx, ly, 1, c.P('#9A7050', -0.2));
  }
  c.land.push(g(ell(1110 - T.litSide * 16, 570, 52, 5, T.shade, 0.3) + wp, `filter="${c.f('arch')}"`));
  // low dry stone walls along the yard
  let dw = '';
  const rw = c.sub('drywall');
  for (const [x0, x1, y0, y1] of [[330, 520, 640, 618], [1110, 1330, 618, 650]]) {
    for (let k = 0; k <= 26; k++) {
      const t = k / 26;
      const x = lerp(x0, x1, t);
      const y = lerp(y0, y1, t);
      for (let row = 0; row < 2; row++) dw += ell(x + (row % 2) * 4, y - 4 - row * 7, rw.R(5, 8), 3.6, c.P(rw.pick(['#BBA98C', '#D8C9AE', '#A8957A', '#C6B391']), row ? 0.6 : 0), 0.95);
    }
  }
  c.land.push(g(dw, `filter="${c.f('arch')}"`));
  tree(c, 250, 650, 140, {});
  well(c, 430, 628, 22);
  tree(c, 1290, 660, 120, {});
  bush(c, 500, 604, 36, {});
  bush(c, 1060, 600, 30, {});
  if (S.flowers) for (const [x, y] of [[700, 590], [1020, 588]]) c.land.push(g(pth(`M${x - 9},${y - 14}L${x + 9},${y - 14}L${x + 7},${y}L${x - 7},${y}Z`, c.P('#C8774A', 0.3)) + circ(x - 4, y - 18, 4, c.P(S.flowers[0], 0.3)) + circ(x + 4, y - 19, 3.6, c.P(S.flowers[1], 0.3)) + ell(x, y - 15, 9, 4, c.P(S.leaf[2] || '#5E9A4E', 0), 0.8), `filter="${c.f('arch')}"`));
  road(c, pl.path, { w0: 230, w1: 50, kind: 'dirt' });
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 1, tr: 1, bl: 0.9, br: 0.8 });
};

BUILD.gym = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 400 });
  cloudSky(c, { big: 1 });
  range(c, { base: 400, amp: 60, d: 0.68, key: 'far' });
  range(c, { base: 474, amp: 240, d: 0.3, col: '#8C88A0', scale: 240, key: 'heights', shape: (x) => -Math.exp(-Math.pow((x - 800) / 520, 2)) * 30 });
  hazeBand(c, 440, 80, 0.3);
  for (const [x, y, h] of [[180, 470, 60], [250, 460, 70], [1320, 456, 66], [1400, 470, 56], [1460, 462, 64]]) pine(c, x, y, h, { d: 0.22 });
  const n = noise1(c.r);
  const field = profile(-20, W + 20, 10, (x) => 482 + fbm(n, x / 200) * 10);
  ground(c, field, { d: 0.04, dabs: 620, persp: [482, 900], key: 'field', strokes: 640, leaves: 120 });
  mist(c, 470, 50);
  fort(c);
  road(c, pl.path, { w0: 250, w1: 70, kind: 'dirt', col: '#D9C49A' });
  rocks(c, [[300, 560, 90, 50], [1320, 570, 110, 56], [200, 700, 160, 80]]);
  tree(c, 160, 640, 100, {});
  tree(c, 1460, 660, 120, {});
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 1, tr: 0.9, bl: 0.9, br: 1 });
};

function fort(c) {
  const { T, S } = c;
  const st = '#B9B2A6';
  // bath house roof behind the wall, with steam
  block(c, { x: 960, y: 420, w: 120, h: 30, d: 60, side: -1, kind: 'gable', roofH: 34, wall: '#D8CDB8', roof: '#8C6A56', haze: 0.05 });
  smoke(c, 1016, 372, 0.6);
  // curtain wall
  const F = face([470, 488], [660, 0], [0, -96]);
  // stone in three washes: the base, a cool wet lower third, then loose block dabs (no outlines)
  let s = pg(quad(F, 0, 0, 1, 1), c.P(st, T.frontK));
  const r = c.sub('fortwall');
  let cool = pth(`M${F(0, 0).map(f1).join(',')}L${F(1, 0).map(f1).join(',')}L${F(1, 0.36).map(f1).join(',')}C${f1(1000)},${f1(F(0, 0.3)[1])} ${f1(700)},${f1(F(0, 0.42)[1])} ${F(0, 0.33).map(f1).join(',')}Z`, '#8E93A8', 0.35);
  let blk = '';
  for (let i = 0; i < 52; i++) blk += pth(blob(r.r, ...F(r.R(0.01, 0.99), r.R(0.05, 0.95)), r.R(6, 13), r.R(3, 6), 0.3, 7), r.pick(['#CFC6B4', '#9E9585']), 0.25);
  let mer = '';
  for (let i = 0; i < 30; i++) {
    if (i === 9 || i === 21) continue;
    const hh = (r.ch(0.2) ? r.R(7, 10) : 12) + r.R(-3, 3);
    const mx = 472 + i * 22 + r.R(-2, 2);
    mer += pg([[mx + r.R(-0.5, 1), 392 - hh + r.R(-0.8, 0.8)], [mx + 13 + r.R(-1, 0.5), 392 - hh + r.R(-1.2, 0.8)], [mx + 13.4, 393], [mx - 0.4, 393]], c.P(st, i % 3 ? 0.55 : 0.35));
  }
  s += g(cool, `filter="${c.f('wet')}"`) + g(blk, `filter="${c.f('pig')}"`) + mer;
  s += pg(quad(F, 0, 0, 1, 0.14), c.P(st, -0.5), 0.3);
  // gate
  s += pth('M762,488L762,452A38,30 0 0 1 838,452L838,488Z', c.P('#3A3434', -0.3), 1, edge(c, 0.9));
  for (let k = 0; k < 6; k++) s += line(768 + k * 12.5, 440, 768 + k * 12.5, 488, c.P('#5A5A60', 0.1), 1.4, 0.8);
  for (let k = 0; k < 3; k++) s += line(764, 452 + k * 12, 836, 452 + k * 12, c.P('#5A5A60', 0.1), 1.2, 0.8);
  c.land.push(g(s, `filter="${c.f('arch')}"`));
  // corner towers
  // the west tower stands full height; the east one is older, a quarter shorter,
  // one merlon fallen out and its foot drowned in ivy
  for (const [x, dy, wd] of [[478, 40, 78], [1132, 20, 84]]) {
    let t = cylinder(c, x, 498, wd, wd - 6, 334 + dy, st);
    t += cylinder(c, x, 338 + dy, wd + 8, wd + 8, 318 + dy, st);
    for (let i = 0; i < 5; i++) {
      if (x > 800 && (i === 1 || i === 3)) continue;
      if (x > 800 && i === 4) { t += pth(blob(c.sub('crumb').r, x - (wd + 8) / 2 + 8 + i * ((wd + 8) / 4.6), 314 + dy, 7, 4, 0.4, 7), c.P(st, -0.1)); continue; }
      t += rect(x - (wd + 8) / 2 + 2 + i * ((wd + 8) / 4.6), 306 + dy + (dy && i === 4 ? 3 : 0), 12, 13 - (dy && i === 4 ? 3 : 0), c.P(st, (i < 2) === (T.litSide < 0) ? 0.6 : -0.2), 1, edge(c, 0.6));
    }
    t += rect(x - 3, 400 + dy * 0.6, 6, 22, c.P('#2E3A3C', 0)) + (x > 800 ? '' : rect(x - 2.5, 462, 5, 16, c.P('#2E3A3C', 0)));
    // the east tower stands farther back: the air comes between
    if (x > 800) t += g(pth(blob(c.sub('towerhaze').r, x, 400, wd * 0.7, 100, 0.3, 9), '#B9C4D6', 0.4), `filter="${c.f('b4')}"`);
    if (S.snow) t += rect(x - 50, 316 + dy, 100, 3, '#F4F6F9', 0.9);
    c.land.push(g(t, `filter="${c.f('arch')}"`));
  }
  {
    const ri = c.sub('ivy');
    let iv = '';
    for (let i = 0; i < 40; i++) {
      const yy = ri.R(370, 498);
      const spread = (yy - 390) / 108;
      iv += pth(blob(ri.r, 1132 + ri.R(-44, 30) * spread + 6, yy, ri.R(6, 16), ri.R(4, 10), 0.45, 8), c.P(ri.pick(['#6F8A5A', '#6F8A5A', '#5E7A4A', '#A0783E']), ri.R(-0.3, 0.4)), 0.6);
    }
    iv += pth('M1104,498C1100,470 1112,440 1128,420C1134,446 1150,470 1172,498Z', c.P('#5E7A4A', -0.2), 0.45);
    c.land.push(g(iv, `filter="${c.f('pig')}"`));
  }
  // light and shade glazed onto the stone: warm on the lit side, cool violet on the other
  {
    const fs = '<path d="M424,498L424,306L516,306L516,380L1088,380L1088,354L1176,354L1176,498Z"/>';
    glaze(c, fs, [420, 300, 1180, 500], { key: 'fortstone', cols: ['#E8D7B8', '#E8D7B8', '#8E86A8', '#B9C08C', '#F2E4C4', '#8E86A8'], dark: '#5A5060', n: 52, k: 0.6, dry: false });
  }
  // the cloth banner over the gate with three round shields (the weekly gym shields)
  const cloth = '#41607E';
  const rb = c.sub('banner');
  // a painted cloth, hanging a little unevenly, its hem sagging, no gloss
  let bn = pth('M733,391L868,393L865,433Q836,441 806,438Q770,445 736,432Z', c.P(cloth, T.litSide < 0 ? 0.15 : -0.1), 0.95, edge(c, 0.6));
  let dab = '';
  for (let i = 0; i < 40; i++) dab += ell(rb.R(738, 862), rb.R(395, 434), rb.R(3, 10), rb.R(1.5, 4), rb.pick(['#365270', '#4E6E8C', '#3A4A6A', '#5A6E86']), rb.R(0.25, 0.5), rb.R(-20, 20));
  for (const fx of [770, 806, 842]) dab += spath(`M${fx},${395}Q${fx + rb.R(-3, 3)},415 ${fx + rb.R(-2, 2)},437`, '#2E4460', rb.R(1.5, 2.5), 0.35);
  bn += g(dab, `filter="${c.f('pig')}"`);
  bn += spath('M737,429Q772,441 806,435Q838,439 863,430', c.P('#E8C88E', 0.2), 1.4, 0.7, ' stroke-dasharray="26 5 40 7 60"');
  // three matte shields: gouache discs with a warm rim, one chipped, one tilted
  const rs2 = c.sub('shields');
  [[764, 413, 0, false], [801, 415, 8, true], [838, 412, -3, false]].forEach(([x, y, tilt, chip], i) => {
    let d = '';
    d += pth(blob(rs2.r, x, y, 12.5, 12, 0.12, 11), c.P('#3E5A7A', i === 1 ? -0.1 : 0.05), 0.9);
    d += pth(blob(rs2.r, x - T.litSide * -2.5, y - 2.5, 7, 6, 0.3, 8), '#5E7A96', 0.35);
    d += spath(`M${x - 11.5},${y + 1}A12,12 0 1 1 ${x + 11},${y + 4}`, '#E8C88E', rs2.R(1.6, 2.2), 0.6);
    d += ell(x, y, 2.6, 2.4, '#E8C88E', 0.5);
    if (chip) d += pth(blob(rs2.r, x + 9, y + 8, 4.5, 3.5, 0.5, 7), c.P(cloth, 0.1), 0.95) + spath(`M${x + 5},${y + 9}l3,-3l2,2`, '#2A3C52', 0.9, 0.6);
    bn += g(d, `transform="rotate(${tilt} ${x} ${y})"`);
  });
  c.land.push(g(bn, `filter="${c.f('arch')}"`));
  // the sandy training yard
  // trodden sand: an uneven yard, scuffed wider where the work happens
  const yard = 'M462,500C560,492 640,498 720,490C850,484 980,494 1090,490C1150,496 1196,522 1188,556C1176,582 1120,590 1052,598C960,612 880,602 790,614C700,620 620,604 540,600C478,596 430,578 428,548C426,524 440,506 462,500Z';
  patch(c, yard, S.snow ? '#EEF1F5' : '#B39C78', { box: [420, 482, 1200, 622], cols: ['#9C8462', '#C9B48E', '#8E7A5E', '#A99070', '#8E8A6A', '#7F8A5A'], n: 420, big: 7, key: 'yard' });
  {
    const ry = c.sub('yardwash');
    let yw = '';
    for (let i = 0; i < 9; i++) yw += pth(blob(ry.r, ry.R(480, 1150), ry.R(510, 600), ry.R(40, 130), ry.R(10, 26), 0.5, 9), ry.ch(0.5) ? '#C9B48E' : '#A8946E', ry.R(0.25, 0.45));
    let fp = '';
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const x = lerp(600, 1010, t) + Math.sin(t * 9) * 30 + ry.R(-14, 14);
      const y = 576 + Math.cos(t * 7) * 14 + ry.R(-5, 5);
      fp += ell(x + (i % 2) * 5, y, 2.4, 1.2, '#7E6A50', ry.R(0.25, 0.45), ry.R(-20, 20));
    }
    // the sand runs out into the grass: tufts lost over its rim
    let tuft = '';
    for (let i = 0; i < 70; i++) {
      const t = ry.r();
      const x = lerp(440, 1180, t);
      const y = (t < 0.5 ? lerp(596, 612, t * 2) : lerp(612, 590, (t - 0.5) * 2)) + ry.R(-10, 10);
      const hh = ry.R(4, 10);
      tuft += spath(`M${pt(x, y)}l${f1(ry.R(-2, 2))},${f1(-hh)}`, ry.pick(['#7F8A5A', '#8E9A5E', '#6E7E4E', '#A8A060']), 1.4, 0.6);
    }
    c.land.push(g(yw, `filter="${c.f('wet')}"`) + g(fp, `filter="${c.f('pig')}"`) + g(spath(yard.replace(/Z$/, ''), '#7F8A5A', 14, 0.28), `filter="${c.f('soft')}"`) + tuft);
  }
  // posts and ropes
  const wood = '#7A5A40';
  let pr = '';
  const posts = [[540, 560], [592, 556], [644, 552]];
  for (const [x, y] of posts) pr += ell(x - T.litSide * 8, y + 2, 10, 2.5, T.shade, 0.3) + rect(x - 3, y - 50, 6, 50, c.P(wood, T.litSide < 0 ? 0.3 : -0.2), 1, edge(c, 0.6));
  for (let i = 0; i < posts.length - 1; i++) {
    const [x0, y0] = posts[i];
    const [x1, y1] = posts[i + 1];
    pr += spath(`M${x0},${y0 - 42}Q${(x0 + x1) / 2},${(y0 + y1) / 2 - 30} ${x1},${y1 - 42}`, c.P('#D9C49A', 0.2), 1.6);
    pr += spath(`M${x0},${y0 - 24}Q${(x0 + x1) / 2},${(y0 + y1) / 2 - 14} ${x1},${y1 - 24}`, c.P('#D9C49A', 0.2), 1.6);
  }
  // training dummy
  pr += ell(712 - T.litSide * 10, 582, 14, 3, T.shade, 0.3) + rect(709, 534, 6, 48, c.P(wood, 0)) + rect(690, 548, 44, 5, c.P(wood, 0.2));
  pr += ell(712, 556, 12, 16, c.P('#D9BE7E', 0.3), 1, 0) + circ(712, 532, 9, c.P('#D9BE7E', 0.4)) + line(702, 556, 722, 556, c.P('#8A6446', 0), 1.2);
  // water barrel
  pr += ell(904 - T.litSide * 10, 590, 16, 3.5, T.shade, 0.3) + rect(892, 562, 24, 28, c.lg(T.litSide < 0 ? [[0, c.P('#8A6446', 0.6)], [1, c.P('#8A6446', -0.6)]] : [[0, c.P('#8A6446', -0.6)], [1, c.P('#8A6446', 0.6)]], 0, 0, 1, 0)) + ell(904, 562, 12, 3, c.P('#4E6A80', 0.3));
  for (const y of [568, 584]) pr += line(892, y, 916, y, c.P('#3A3F48', 0), 1.6);
  c.land.push(g(pr, `filter="${c.f('arch')}"`));
  // the timber roof over the weights
  let sh = '';
  for (const [x, y] of [[960, 568], [1040, 566], [1110, 560]]) sh += rect(x - 3, y - 80, 6, 80, c.P(wood, -0.2));
  sh += pg([[944, 486], [1126, 478], [1140, 462], [958, 470]], c.P('#9A7050', 0.5), 1, edge(c, 0.8));
  sh += pg([[944, 486], [1126, 478], [1126, 484], [944, 492]], c.P(wood, -0.4));
  // racks with weights
  for (const [x, y] of [[990, 550], [1066, 548]]) {
    sh += rect(x - 20, y - 26, 3, 26, c.P('#3A3F48', 0)) + rect(x + 17, y - 26, 3, 26, c.P('#3A3F48', 0));
    sh += line(x - 30, y - 24, x + 30, y - 24, c.P('#5A606A', 0.3), 2.2);
    for (const dx of [-26, -22, 22, 26]) sh += ell(x + dx, y - 24, 2.2, 8, c.P('#3E434C', 0.1));
  }
  if (S.snow) sh += pg([[946, 484], [1124, 476], [1138, 462], [958, 470]], '#F4F6F9', 0.85);
  c.land.push(g(sh, `filter="${c.f('arch')}"`));
}

BUILD.market = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 412 });
  cloudSky(c, { big: 2 });
  range(c, { base: 412, amp: 46, d: 0.66, key: 'far' });
  hazeBand(c, 412, 50, 0.5);
  const n = noise1(c.r);
  const back = profile(-20, W + 20, 10, (x) => 440 + fbm(n, x / 160) * 12);
  ground(c, back, { d: 0.3, dabs: 160, key: 'back', nearDark: 0 });
  village(c, -10, 380, (x) => back.at(x) + 22, { d: 0.24, min: 12, max: 18 });
  village(c, 1220, 1610, (x) => back.at(x) + 22, { d: 0.24, min: 12, max: 18 });
  treeline(c, 380, 1220, (x) => back.at(x) + 10, { d: 0.3, min: 16, max: 26 });
  // the tree line sinks into the blue air
  c.land.push(g(rect(-20, 400, W + 40, 70, c.lg([[0, '#9FB3C4', 0], [0.5, '#9FB3C4', 0.6], [1, '#9FB3C4', 0.15]])), `filter="${c.f('b10')}"`));
  const sq = profile(-20, W + 20, 10, (x) => 486 + fbm(n, x / 220 + 3) * 8);
  ground(c, sq, { d: 0.03, dabs: 560, persp: [486, 900], key: 'sq', strokes: 500, leaves: 100 });
  // the stone square, under the hall that stands right of center
  const p0 = c.land.length;
  // the square: a warm dirt wash, cobbles laid as dabs that thin out toward its edges
  {
    const rd = c.sub('dirt');
    const dirt = S.snow ? '#E6EAF0' : '#C7B08A';
    let dw = pth(crPath([[330, 580], [700, 566], [1180, 572], [1330, 640], [1300, 700], [820, 716], [300, 704], [236, 650]], true), c.P(dirt, 0.2), 0.75);
    dw += pth(crPath([[420, 600], [900, 586], [1200, 620], [1060, 690], [600, 690], [360, 660]], true), c.P('#A99A80', -0.1), 0.25);
    c.land.push(g(dw, `filter="${c.f('wet')}"`));
    let cb = '';
    for (let i = 0; i < 900; i++) {
      const y = rd.R(574, 712);
      const k = (y - 572) / 140;
      const cx0 = lerp(780, 790, k);
      const half = lerp(470, 540, k);
      const u = rd.R(-1, 1);
      const fade = 1 - Math.pow(Math.abs(u), 2.2);
      if (rd.r() > fade) continue;
      const x = cx0 + u * half;
      cb += ell(x, y, lerp(3, 10, k) * rd.R(0.7, 1.3), lerp(1.2, 3.6, k) * rd.R(0.7, 1.2), c.P(rd.pick(['#CDBB9A', '#CDBB9A', '#A99A80', '#B9AA8C', '#9FA2AE']), rd.R(-0.2, 0.5)), 0.4 * fade + 0.1, rd.R(-10, 10));
    }
    c.land.push(g(cb, `filter="${c.f('pig')}"`));
  }
  const sqr = c.land.splice(p0).join('');
  c.land.push(g(sqr, 'transform="translate(80 0)"'));
  // the hall stands off center and to the right, so the square opens on the left
  const n0 = c.land.length;
  c.hallDX = 120;
  // true recession: the right end of the hall stands farther off, so it is drawn
  // in narrow upright strips, each scaled toward the horizon a little more
  const hx0 = 300;
  const hx1 = 1260;
  const hor = 420;
  const sc = (x) => 1 - 0.17 * clamp((x - hx0) / (hx1 - hx0), 0, 1);
  const X = (x) => { const u = clamp(x, hx0, hx1) - hx0; return hx0 + u - (0.17 / (hx1 - hx0)) * u * u * 0.5 + (x > hx1 ? (x - hx1) * sc(hx1) : 0) + (x < hx0 ? x - hx0 : 0); };
  c.hallMap = (x, y) => [X(x) + 120, hor + (y - hor) * sc(x)];
  marketHall(c);
  const hall = c.land.splice(n0).join('');
  c.hallMap = null;
  let strips = '';
  const NS = 18;
  for (let i = 0; i < NS; i++) {
    const xa = i === 0 ? hx0 - 80 : hx0 + ((hx1 - hx0) * i) / NS;
    const xb = i === NS - 1 ? hx1 + 80 : hx0 + ((hx1 - hx0) * (i + 1)) / NS;
    const ca = Math.max(hx0, xa);
    const cb = Math.min(hx1, xb);
    const k = sc((ca + cb) / 2);
    const cp = c.clip(rect(xa - 0.6, 200, xb - xa + 1.2, 560, '#000'));
    strips += g(g(hall, `clip-path="${cp}"`), `transform="translate(${f2(X(ca) - ca * k)} ${f2(hor - hor * k)}) scale(${f2(k)})"`);
  }
  c.land.push(g(strips, 'transform="translate(120 0)"'));
  c.land.push(g(rect(500, 572, 900, 26, c.lg([[0, '#5A4A60', 0.3], [1, '#5A4A60', 0]])), `filter="${c.f('b4')}"`));
  // a loose cluster of shoppers, crates and baskets, never in a row
  const rf = c.sub('folk');
  const folk = [[612, 606, 36, '#6A7E9A'], [636, 614, 22, '#B5654A'], [884, 592, 26, '#7E8A5A'], [1172, 630, 44, '#8C6A86'], [1198, 626, 30, '#C9A15A'], [1214, 632, 18, '#9A5A4A'], [356, 656, 52, '#4E6A78'], [990, 600, 28, '#6A6E8A']];
  for (const [x, y, h, col] of folk) figure(c, x, y, h, col, rf);
  for (const [x, y, w] of [[676, 616, 26], [700, 622, 20], [1236, 640, 30], [1140, 640, 18]]) crate(c, x, y, w, rf);
  road(c, pl.path, { w0: 240, w1: 80, kind: 'dirt', col: S.snow ? '#E6EAF0' : '#CDBB9A', edges: false, dapple: true });
  handCart(c, 520, 660);
  for (const [x, y] of [[1050, 640], [1090, 652], [430, 622]]) {
    c.land.push(g(ell(x - T.litSide * 8, y + 3, 16, 3, T.shade, 0.3) + pth(blob(c.sub('sack' + x).r, x, y - 10, 13, 14, 0.2, 8), c.P('#D8C49A', 0.4)) + line(x - 6, y - 22, x + 6, y - 22, c.P('#8A6446', 0), 1.4), `filter="${c.f('arch')}"`));
  }
  tree(c, 150, 660, 120, {});
  tree(c, 1470, 680, 130, {});
  // the near corner: crates heaped by the trader, half in the foreground shade
  for (const [x, y, w] of [[1280, 772, 64], [1336, 780, 54], [1300, 730, 50], [1384, 770, 46]]) crate(c, x, y, w, rf);
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 1, tr: 1, bl: 0.8, br: 0.8 });
  nearFoliage(c, 10, 910, 260, 200);
};

function marketHall(c) {
  const { T, S } = c;
  const wood = '#8A6446';
  let s = '';
  // dark interior and the stone floor
  s += rect(392, 462, 816, 108, c.P('#4E3E32', -0.6));
  s += rect(384, 566, 832, 12, c.P('#CFC2A6', 0.4), 1, edge(c, 0.6));
  c.land.push(s);
  // stalls with striped awnings, counters and produce
  const awn = ['#C98A4E', '#5E9A8E', '#9A5A4A', '#7FA05A', '#E7C66A', '#D2A256', '#8E9A6A', '#B9876A'];
  const posts = [];
  {
    // bays built one at a time: none the same width
    const bw = [0.94, 1.08, 0.9, 1.1, 1.0, 0.92, 1.1, 0.96];
    const tot = bw.reduce((a, b) => a + b, 0);
    let x = 392;
    posts.push(x);
    for (const w of bw) { x += (816 * w) / tot; posts.push(x); }
  }
  const rr = c.sub('stalls');
  for (let i = 0; i < 8; i++) {
    const x0 = posts[i] + 8;
    const x1 = posts[i + 1] - 8;
    if (i === 3 || i === 4) {
      // the middle bay stays open for the brass scale
      continue;
    }
    const col = awn[i % awn.length];
    const torn = i === 1;
    const rolled = i === 5;
    const wf = [1.12, 0.8, 1, 1, 1, 0.92, 1.18, 0.86][i];
    const sag = [7, 0, 11, 0, 0, 0, 9, 2][i];
    const mx = (x0 + x1) / 2;
    const ax0 = mx - ((x1 - x0) / 2) * wf;
    const ax1 = mx + ((x1 - x0) / 2) * wf;
    const ay = 470 + (i % 3) * 3;
    let a = '';
    // counter
    a += rect(x0 + 2, 528, x1 - x0 - 4, 26, c.P(wood, 0.25), 1, edge(c, 0.6));
    a += rect(x0 + 2, 528, x1 - x0 - 4, 4, c.P(wood, 0.7));
    // produce crates
    for (let k = 0; k < 3; k++) {
      const cx = x0 + 10 + k * ((x1 - x0 - 20) / 3);
      const cw = (x1 - x0 - 26) / 3;
      a += rect(cx, 516, cw, 13, c.P('#B08A5E', 0.3), 1, edge(c, 0.5));
      const fruit = rr.pick([['#E08A3A', '#E8A040'], ['#E8C35A', '#D9B048'], ['#8FB860', '#7FA850'], ['#D9A060', '#C98E50'], ['#9A5A7A', '#8A4E6E']]);
      for (let j = 0; j < 7; j++) a += circ(cx + 3 + (j % 4) * (cw / 4), 515 - Math.floor(j / 4) * 4, 3.4, c.P(fruit[j % 2], 0.35));
    }
    // awning
    const stripes = 6;
    const hem = (t) => 498 + (i % 2) * 4 + sag * Math.sin(Math.PI * t);
    if (rolled) {
      // rolled up tight under the eave, ties hanging
      a += pth(`M${f1(ax0)},${f1(ay - 2)}L${f1(ax1)},${f1(ay - 3)}Q${f1(ax1 + 5)},${f1(ay + 4)} ${f1(ax1)},${f1(ay + 10)}L${f1(ax0)},${f1(ay + 11)}Q${f1(ax0 - 5)},${f1(ay + 4)} ${f1(ax0)},${f1(ay - 2)}Z`, c.P(col, 0.2), 1, edge(c, 0.5));
      for (let k = 1; k < 6; k++) a += line(lerp(ax0, ax1, k / 6), ay - 2, lerp(ax0, ax1, k / 6) + 2, ay + 10, c.P('#EFE6D2', 0.3), 3.4, 0.6);
      for (const t of [0.2, 0.8]) a += spath(`M${f1(lerp(ax0, ax1, t))},${f1(ay + 10)}q2,8 -1,16`, c.P('#6A4E38', 0), 0.9, 0.7);
      a += rect(x0 + 2, 528, x1 - x0 - 4, 4, c.P(wood, 0.7));
      c.land.push(g(a, `filter="${c.f('arch')}"`));
      continue;
    }
    for (let k = 0; k < stripes; k++) {
      if (torn && k === 4) continue;
      const t0 = k / stripes;
      const t1 = (k + 1) / stripes;
      const u0 = lerp(ax0, ax1, t0);
      const u1 = lerp(ax0, ax1, t1);
      a += pg([[u0, ay], [u1, ay], [u1 + (u1 - 800) * 0.02, hem(t1)], [u0 + (u0 - 800) * 0.02, hem(t0)]], k % 2 ? c.P('#EFE6D2', 0.4) : c.P(col, 0.25), 0.92);
    }
    if (torn) {
      // a torn panel hanging loose
      const u0 = lerp(ax0, ax1, 4 / 6);
      a += pth(`M${f1(u0)},${f1(ay)}L${f1(u0 + 20)},${f1(ay)}L${f1(u0 + 14)},${f1(ay + 16)}L${f1(u0 + 18)},${f1(ay + 24)}L${f1(u0 + 9)},${f1(ay + 38)}L${f1(u0 + 4)},${f1(ay + 22)}Z`, c.P(col, 0.1), 0.85);
      // the rip: the cloth belly sags through it, frayed threads
      a += pth(`M${f1(u0 - 14)},${f1(hem(0.5) - 4)}Q${f1(u0 + 4)},${f1(hem(0.5) + 18)} ${f1(u0 + 26)},${f1(hem(0.7) - 2)}`, c.P(col, -0.2), 0.7);
      a += spath(`M${f1(u0 - 6)},${f1(hem(0.5) + 6)}l-1,7M${f1(u0 + 2)},${f1(hem(0.55) + 9)}l1,6M${f1(u0 + 12)},${f1(hem(0.6) + 6)}l-1,8`, c.P(col, -0.4), 0.8, 0.7);
    }
    const nsc = Math.round(5 + wf * 3);
    for (let k = 0; k < nsc; k++) {
      if (torn && k >= Math.round(nsc * 0.62) && k <= Math.round(nsc * 0.84)) continue;
      const t = (k + 0.5) / nsc;
      a += circ(lerp(ax0, ax1, t), hem(t), (ax1 - ax0) / (nsc * 2.1), k % 2 ? c.P('#EFE6D2', 0.2) : c.P(col, 0.05), 0.92);
    }
    // the cloth shadow on the counter below
    a += pth(`M${f1(ax0)},${f1(hem(0) + 6)}Q${f1(mx)},${f1(hem(0.5) + 16)} ${f1(ax1)},${f1(hem(1) + 6)}L${f1(ax1)},${f1(hem(1) + 20)}Q${f1(mx)},${f1(hem(0.5) + 30)} ${f1(ax0)},${f1(hem(0) + 20)}Z`, '#5A4A60', 0.22);
    c.land.push(g(a, `filter="${c.f('arch')}"`));
    if (sag) {
      let db = '';
      for (let k = 0; k < 6; k++) {
        const t0 = rr.R(0, 0.6);
        db += spath(`M${f1(lerp(ax0, ax1, t0))},${f1(ay + rr.R(4, 22))}l${f1(rr.R(20, 50))},${f1(rr.R(-1, 3))}`, rr.ch(0.5) ? '#FFF4DC' : c.P(col, -0.6), rr.R(1.2, 2.6), rr.R(0.25, 0.5));
      }
      c.land.push(g(db, `filter="${c.f('dry')}"`));
    }
  }
  // bread and grain at the open middle bay
  let mid = '';
  for (let k = 0; k < 5; k++) mid += ell(714 + k * 14, 552, 8, 4.5, c.P('#D9A060', 0.5));
  mid += ell(886, 552, 16, 12, c.P('#D8C49A', 0.4));
  c.land.push(g(mid, `filter="${c.f('arch')}"`));
  // timber posts
  let ps = '';
  for (const x of posts) ps += rect(x - 5, 456, 10, 118, c.lg(T.litSide < 0 ? [[0, c.P(wood, 0.6)], [1, c.P(wood, -0.5)]] : [[0, c.P(wood, -0.5)], [1, c.P(wood, 0.6)]], 0, 0, 1, 0), 1, edge(c, 0.6));
  c.land.push(g(ps, `filter="${c.f('arch')}"`));
  // the wide hipped roof
  const roof = '#B06F46';
  let rf = '';
  rf += pg([[370, 460], [560, 370], [322, 446]], c.P(roof, faceK(c, -1) * 0.6), 1, edge(c, 0.8));
  rf += pg([[1230, 460], [1040, 370], [1240, 452]], c.P(roof, faceK(c, 1) * 0.6), 1, edge(c, 0.8));
  const A = [370, 460];
  const B = [1230, 460];
  const Cc = [1040, 370];
  const D = [560, 370];
  rf += pg([A, B, Cc, D], c.lg([[0, c.P(roof, 0.55)], [1, c.P(roof, 0.1)]], 0, 1, 0, 0), 1, edge(c, 1));
  rf += roofTiles(c, A, B, Cc, D, roof, 0);
  for (let k = 1; k < 18; k++) {
    const t = k / 18;
    rf += line(lerp(A[0], B[0], t), 460, lerp(D[0], Cc[0], t), 370, c.P(roof, -0.4), 0.6, 0.25);
  }
  rf += pg([[368, 458], [1232, 458], [1232, 468], [368, 468]], c.P(wood, -0.3), 1, edge(c, 0.6));
  // ridge vent
  rf += pg([[946, 371], [984, 370], [983, 356], [947, 357]], c.P('#D8C9AE', T.frontK - 0.1), 1, edge(c, 0.6)) + pg([[940, 358], [990, 357], [967, 345]], c.P(roof, 0.25), 1, edge(c, 0.6));
  // the roof in two tones: a sun warmed run and a weathered patch, tiles laid in dry brush
  {
    const rt = c.sub('rooftone');
    let tn = pg([[560, 370], [760, 370], [700, 460], [370, 460]], c.P('#C98A5A', 0.3), 0.35);
    tn += pg([[880, 370], [1040, 370], [1230, 460], [980, 460]], c.P('#8E5A46', -0.2), 0.3);
    let dbr = '';
    for (let k = 0; k < 90; k++) {
      const t = rt.R(0.05, 0.98);
      const y = lerp(372, 456, t);
      const xa = lerp(560, 370, t);
      const xb = lerp(1040, 1230, t);
      const x = rt.R(xa, xb - 40);
      dbr += spath(`M${f1(x)},${f1(y)}l${f1(rt.R(20, 70))},${f1(rt.R(-0.6, 0.6))}`, rt.ch(0.5) ? '#E8B48A' : '#6E4434', rt.R(1, 2.4), rt.R(0.2, 0.45));
    }
    rf += tn + g(dbr, `filter="${c.f('dry')}"`);
  }
  if (S.snow) rf += pg([[380, 452], [1220, 452], [1040, 372], [560, 372]], '#F4F6F9', 0.88);
  c.land.push(g(rf, `filter="${c.f('arch')}"`));
  // warm violet shade under the eave, deepening toward the back of the hall
  c.land.push(g(rect(392, 466, 816, 30, '#5A4A60', 0.35) + rect(392, 492, 816, 76, c.lg([[0, '#5A4A60', 0.22], [1, '#5A4A60', 0]]), 1), `filter="${c.f('b4')}"`));
  // a painted sign hung from the beam over the open bay, a little crooked
  {
    let sg = '';
    const rope = c.P('#5A4638', -0.1);
    sg += spath('M772,468q1,9 -1,17M834,468q-1,8 2,19', rope, 1.1, 0.8);
    sg += pth('M752,484L852,488L851,522L753,519Z', c.P('#A87E56', 0.2), 1, edge(c, 0.7));
    sg += pth('M757,488L847,491L846,517L758,515Z', c.P('#E6D6B4', 0.3), 0.95);
    // a pear, a loaf and an ear of wheat, brushed in a few strokes
    sg += pth(blob(c.sub('pear').r, 782, 505, 8, 9, 0.2, 8), c.P('#B9B04E', 0.2)) + circ(783, 496, 5, c.P('#B9B04E', 0.3));
    sg += spath('M784,491l2,-5', c.P('#6A4E38', 0), 1.2);
    sg += ell(806, 506, 12, 6, c.P('#C98E50', 0.2)) + spath('M799,503l3,4M806,502l3,4M813,503l3,4', c.P('#8A5A3A', 0), 1, 0.7);
    sg += spath('M832,514q2,-12 1,-22', c.P('#B98E46', 0), 1.3);
    for (let k = 0; k < 4; k++) sg += ell(830 + (k % 2) * 5, 512 - k * 5, 2.6, 1.4, c.P('#D2A256', 0.3), 1, k % 2 ? 30 : -30);
    sg += line(756, 520, 850, 523, c.P('#5A4638', -0.3), 1.2, 0.5);
    c.land.push(g(sg, `filter="${c.f('arch')}"`));
    // crates and baskets under it instead of an empty stage
    let un = ell(800, 574, 70, 5, '#5A4A60', 0.25);
    un += rect(760, 548, 30, 22, c.P('#B08A5E', 0.2), 1, edge(c, 0.5)) + rect(792, 552, 24, 18, c.P('#9A7450', 0.1), 1, edge(c, 0.5));
    for (let j = 0; j < 6; j++) un += circ(764 + j * 4.5, 546 - (j % 2) * 2, 3.2, c.P(j % 2 ? '#E08A3A' : '#E8A040', 0.35));
    un += ell(842, 562, 14, 9, c.P('#C9A46A', 0.2)) + ell(842, 556, 13, 3, c.P('#8A6446', -0.2), 0.8);
    c.land.push(g(un, `filter="${c.f('arch')}"`));
  }
  if (c.time === 'sunset' || c.time === 'night') {
    for (const x of [494, 698, 902, 1106]) {
      c.land.push(line(x, 468, x, 478, c.P('#3A3F48', 0), 1));
      const [lx, ly] = c.hallMap ? c.hallMap(x, 482) : [x + (c.hallDX || 0), 482];
      addLight(c, lx, ly, 4, { halo: 46, col: '#FFD27E' });
    }
  }
}

// A small person in a big world: a few wet strokes, light on one shoulder.
function figure(c, x, y, h, col, r) {
  const { T } = c;
  const lx = T.litSide;
  const skin = c.P(r.pick(['#E2B48E', '#C68E64', '#9A6A4A']), 0.2);
  const cloth = c.P(col, 0);
  const lean = r.R(-0.08, 0.08) * h;
  let s = ell(x - lx * h * 0.3, y + 1, h * 0.36, h * 0.07, '#5A4A60', 0.3);
  s += spath(`M${f1(x - h * 0.06)},${f1(y)}l${f1(r.R(-2, 1))},${f1(-h * 0.36)}M${f1(x + h * 0.06)},${f1(y)}l${f1(r.R(-1, 2))},${f1(-h * 0.36)}`, c.P('#3E3A48', -0.2), h * 0.08, 0.9);
  s += pth(`M${f1(x - h * 0.17)},${f1(y - h * 0.32)}Q${f1(x - h * 0.2 + lean)},${f1(y - h * 0.7)} ${f1(x - h * 0.08 + lean)},${f1(y - h * 0.8)}L${f1(x + h * 0.1 + lean)},${f1(y - h * 0.8)}Q${f1(x + h * 0.2 + lean)},${f1(y - h * 0.62)} ${f1(x + h * 0.16)},${f1(y - h * 0.3)}Z`, cloth);
  s += pth(`M${f1(x + lx * h * 0.02 + lean)},${f1(y - h * 0.78)}Q${f1(x + lx * h * 0.18 + lean)},${f1(y - h * 0.6)} ${f1(x + lx * h * 0.14)},${f1(y - h * 0.34)}L${f1(x + lx * h * 0.06)},${f1(y - h * 0.36)}Z`, mix(cloth, T.light, 0.45), 0.7);
  s += circ(x + lean * 1.1, y - h * 0.9, h * 0.1, skin);
  if (r.ch(0.5)) s += ell(x + lx * h * 0.24, y - h * 0.4, h * 0.12, h * 0.08, c.P('#C49A5A', 0.2));
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

function crate(c, x, y, w, r) {
  const { T } = c;
  const wood = c.P('#A8845A', 0.2);
  let s = ell(x - T.litSide * w * 0.4, y + 1, w * 0.7, w * 0.12, '#5A4A60', 0.3);
  s += pg([[x - w / 2, y], [x + w / 2, y + r.R(-1, 1)], [x + w / 2, y - w * 0.5], [x - w / 2, y - w * 0.52]], wood, 1, edge(c, 0.5));
  s += line(x - w / 2, y - w * 0.26, x + w / 2, y - w * 0.25, c.P('#6A4A30', -0.2), 1, 0.6);
  for (let j = 0; j < 4; j++) s += circ(x - w * 0.36 + j * w * 0.24 + r.R(-1, 1), y - w * 0.55, w * 0.12, c.P(r.pick(['#E08A3A', '#E8C35A', '#8FB860', '#B5503A']), 0.3));
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

function handCart(c, x, y) {
  const { T } = c;
  const wood = '#8A6446';
  let s = ell(x - T.litSide * 20, y + 4, 60, 6, T.shade, 0.32);
  s += pg([[x - 50, y - 30], [x + 40, y - 30], [x + 36, y - 8], [x - 46, y - 8]], c.P(wood, 0.3), 1, edge(c, 0.7));
  s += line(x + 40, y - 22, x + 92, y - 4, c.P(wood, 0), 3);
  s += line(x + 40, y - 14, x + 92, y + 2, c.P(wood, 0), 3);
  const r = c.sub('cart');
  for (let k = 0; k < 14; k++) s += circ(x - 42 + (k % 7) * 12 + r.R(-2, 2), y - 34 - Math.floor(k / 7) * 7, 5.5, c.P(r.pick(['#E08A3A', '#E8C35A', '#8FB860', '#D9A060', '#9A5A7A']), 0.3));
  s += ell(x - 20, y - 40, 14, 9, c.P('#D8C49A', 0.4));
  for (const wx of [x - 30, x + 20]) s += `<circle cx="${wx}" cy="${y}" r="13" fill="none" stroke="${c.P('#5A4030', 0)}" stroke-width="3"/>` + line(wx - 12, y, wx + 12, y, c.P('#5A4030', 0), 1.4) + line(wx, y - 12, wx, y + 12, c.P('#5A4030', 0), 1.4);
  c.land.push(g(s, `filter="${c.f('arch')}"`));
}

BUILD.vault = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 430 });
  cloudSky(c, { big: 2, amount: 1.25 });
  range(c, { base: 430, amp: 80, d: 0.6, key: 'far' });
  hazeBand(c, 430, 60, 0.5);
  const n = noise1(c.r);
  const back = profile(-20, W + 20, 10, (x) => 470 + fbm(n, x / 170) * 24);
  ground(c, back, { d: 0.3, dabs: 200, key: 'back', nearDark: 0 });
  treeline(c, -20, W + 20, (x) => back.at(x) + 6, { d: 0.34, min: 12, max: 24, pines: 0.6 });
  mist(c, 490, 50);
  const hill = profile(-20, W + 20, 8, (x) => 572 + Math.pow((x - 800) / 560, 2) * 170 + fbm(n, x / 120 + 5) * 18 - 9);
  ground(c, hill, { d: 0.03, dabs: 680, persp: [560, 900], key: 'hill', strokes: 680, leaves: 120 });
  // dark pines that hold the fortress between them
  pine(c, 548, 600, 150, {});
  pine(c, 596, 590, 110, {});
  pine(c, 1080, 596, 140, {});
  pine(c, 1124, 606, 96, {});
  ruins(c);
  stronghold(c);
  // the quiet ring of old stones
  rocks(c, [[640, 640, 34, 70], [560, 664, 30, 56], [470, 700, 40, 74], [1000, 646, 30, 64], [1090, 674, 36, 72], [1190, 712, 44, 84], [360, 760, 56, 96], [1290, 780, 60, 100], [720, 680, 46, 22], [930, 690, 50, 24]], { col: '#A8A2A6' });
  road(c, pl.path, { w0: 220, w1: 40, kind: 'dirt' });
  warmLight(c);
  vignette(c, 0.36);
  frame(c, { tl: 1, tr: 1, bl: 1, br: 1 });
};

function stronghold(c) {
  const { T, S } = c;
  const st = '#A9A398';
  const X0 = 612;
  const X1 = 988;
  const BY = 576;
  const TOP = 404;
  // the single guard tower, behind the right corner
  let tw = cylinder(c, 990, 566, 78, 70, 300, st);
  tw += cylinder(c, 990, 304, 88, 88, 282, st);
  for (let i = 0; i < 4; i++) tw += rect(948 + i * 23, 270, 13, 13, c.P(st, (i < 2) === (T.litSide < 0) ? 0.6 : -0.2), 1, edge(c, 0.6));
  tw += rect(987, 340, 6, 22, c.P('#2E3440', 0)) + rect(987, 410, 6, 20, c.P('#2E3440', 0));
  const rg = c.lg(T.litSide < 0 ? [[0, c.P('#6E7486', 0.7)], [0.6, c.P('#5E6476', 0)], [1, c.P('#4E5466', -0.7)]] : [[0, c.P('#4E5466', -0.7)], [0.4, c.P('#5E6476', 0)], [1, c.P('#6E7486', 0.7)]], 0, 0, 1, 0);
  tw += pg([[938, 272], [1042, 272], [990, 206]], rg, 1, edge(c, 0.9));
  tw += line(990, 206, 990, 190, c.P('#3A3F48', 0), 1.6) + circ(990, 189, 2.4, c.P('#E8C88E', 0.4));
  if (S.snow) tw += pg([[954, 262], [1026, 262], [990, 210]], '#F4F6F9', 0.8);
  c.land.push(g(tw, `filter="${c.f('arch')}"`));
  // thick walls with a battered foot and buttresses
  const b = block(c, { x: X0, y: BY, w: X1 - X0, h: BY - TOP, d: 120, side: 1, kind: 'flat', wall: st, roofTop: '#9A958C' });
  let s = pg([[X0 - 14, BY + 2], [X1 + 14, BY + 2], [X1 + 2, BY - 50], [X0 - 2, BY - 50]], c.P(st, T.frontK - 0.12), 1, edge(c, 0.8));
  const r = c.sub('ashlar');
  for (let row = 0; row < 12; row++) {
    const bb = 0.04 + row * 0.082;
    s += line(...b.F(0, bb), ...b.F(1, bb), c.P(st, -0.6), 0.8, 0.4);
    for (let k = 0; k < 8; k++) {
      const a = (k + (row % 2) * 0.5) / 8;
      s += line(...b.F(a, bb), ...b.F(a, bb + 0.082), c.P(st, -0.6), 0.7, 0.3);
      s += pg(quad(b.F, a + 0.008, bb + 0.008, a + 0.117, bb + 0.074), c.P(r.pick([st, '#B9B3A8', '#9A9488', '#A49A8A']), r.R(-0.35, 0.55)), 0.4);
    }
  }
  // rain streaks under the merlons and patches of moss
  for (let k = 0; k < 14; k++) {
    const a = r.R(0.03, 0.97);
    s += pg([b.F(a, 0.98), b.F(a + 0.012, 0.98), b.F(a + 0.008, r.R(0.55, 0.85)), b.F(a + 0.002, r.R(0.55, 0.85))], c.P('#5E5A58', -0.3), 0.18);
  }
  if (!S.snow) for (let k = 0; k < 10; k++) s += ell(...b.F(r.R(0.02, 0.98), r.R(0.02, 0.35)), r.R(8, 20), r.R(3, 6), c.P(r.pick(['#6F8A52', '#5E7A48', '#8A9A5A']), 0.1), 0.55);
  for (let i = 0; i < 15; i++) s += rect(X0 + 2 + i * 25.4, TOP - 14, 15, 14, c.P(st, 0.5), 1, edge(c, 0.6));
  s += rect(X0, TOP - 2, X1 - X0, 6, c.P(st, -0.6), 0.5);
  for (const bx of [X0 + 70, X1 - 70]) s += pg([[bx - 16, BY + 2], [bx + 16, BY + 2], [bx + 10, BY - 92], [bx - 10, BY - 92]], c.P(st, faceK(c, bx < 800 ? -1 : 1) * 0.5), 1, edge(c, 0.8));
  for (const ax of [X0 + 40, X1 - 40]) s += rect(ax - 3, 450, 6, 24, c.P('#2E3440', 0));
  // the heavy iron bound door with the key on it
  s += pth('M762,578L762,508A38,32 0 0 1 838,508L838,578Z', c.P('#2E2A2A', -0.3), 1, edge(c, 0.9));
  s += pth('M768,578L768,509A32,27 0 0 1 832,509L832,578Z', c.P('#5A4434', -0.1));
  for (let k = 1; k < 5; k++) s += line(768 + k * 12.8, 486, 768 + k * 12.8, 577, c.P('#4A3628', -0.3), 0.8, 0.6);
  for (const y of [518, 542, 566]) s += line(768, y, 832, y, c.P('#3A4048', 0.2), 3.4);
  for (const y of [518, 542, 566]) for (const x of [774, 788, 812, 826]) s += circ(x, y, 1.5, c.P('#A9AEB5', 0.5));
  s += circ(800, 528, 7, 'none', 1, ` stroke="${c.P('#D2AE62', 0.5)}" stroke-width="2.6"`) + line(800, 535, 800, 558, c.P('#D2AE62', 0.5), 2.8) + line(800, 550, 807, 550, c.P('#D2AE62', 0.5), 2.6) + line(800, 556, 806, 556, c.P('#D2AE62', 0.5), 2.6);
  // one small barred window
  s += rect(787, 440, 26, 20, c.P('#2E3440', -0.2), 1, edge(c, 0.6));
  for (const x of [793, 800, 807]) s += line(x, 440, x, 460, c.P('#6A707A', 0.3), 1.7);
  c.land.push(g(s, `filter="${c.f('arch')}"`));
  // lantern by the door
  c.land.push(line(846, 500, 858, 500, c.P('#3A3F48', 0), 1.6) + rect(852, 502, 10, 14, c.P('#3E4A5E', 0)) + rect(853.5, 504, 7, 10, c.P('#E8DEC2', 0.2), 0.8));
  addLight(c, 857, 509, 3.2, { halo: 56, col: '#FFD27E' });
  castShadow(c, X0 - 14, X1 + 14, 578, 150, { op: 0.3 });
}

function ruins(c) {
  const { T, S } = c;
  const st = '#B6AE9E';
  const kl = T.litSide < 0 ? 0.5 : -0.25;
  const kr = T.litSide < 0 ? -0.25 : 0.5;
  let s = '';
  // a broken arch
  s += rect(196, 500, 34, 160, c.P(st, kl), 1, edge(c, 0.8));
  s += rect(230, 500, 8, 160, c.P(st, kr), 0.9);
  s += rect(312, 560, 34, 100, c.P(st, kl), 1, edge(c, 0.8));
  s += rect(346, 560, 8, 100, c.P(st, kr), 0.9);
  s += pth('M196,504Q204,436 270,424L276,442Q222,452 230,506Z', c.P(st, 0.4), 1, edge(c, 0.8));
  s += pg([[188, 496], [240, 496], [240, 506], [188, 506]], c.P(st, 0.6), 1, edge(c, 0.6));
  for (let k = 0; k < 6; k++) s += line(196, 520 + k * 24, 230, 520 + k * 24, c.P(st, -0.5), 0.7, 0.4);
  // a broken wall fragment
  s += pg([[380, 668], [380, 600], [398, 590], [412, 604], [430, 582], [452, 600], [470, 592], [490, 616], [512, 608], [512, 670]], c.P(st, T.frontK - 0.1), 1, edge(c, 0.8));
  for (let k = 0; k < 6; k++) s += line(380, 612 + k * 10, 512, 614 + k * 10, c.P(st, -0.5), 0.7, 0.35);
  // column stumps and fallen blocks
  for (const [x, y, h] of [[140, 676, 46], [540, 680, 30], [270, 690, 20]]) s += ell(x, y - h, 16, 5, c.P(st, 0.6)) + rect(x - 16, y - h, 32, h, c.P(st, 0), 1, edge(c, 0.6));
  s += pg([[420, 690], [470, 684], [478, 702], [424, 708]], c.P(st, 0.3), 1, edge(c, 0.6));
  c.land.push(g(ell(330, 690, 240, 26, T.shade, 0.25) + s, `filter="${c.f('arch')}"`));
  // ivy, and the flowers that grow over dropped projects
  const r = c.sub('ivy');
  let iv = '';
  for (let i = 0; i < 130; i++) {
    const [x, y] = r.pick([[213, r.R(440, 660)], [329, r.R(560, 660)], [r.R(380, 512), r.R(600, 670)], [r.R(120, 560), r.R(660, 700)], [r.R(200, 280), r.R(424, 470)]]);
    iv += ell(x + r.R(-16, 16), y, r.R(3, 8), r.R(2, 4.5), c.P(r.pick([S.snow ? '#3E5E58' : '#5E9A4E', '#4E7A45', '#7FA05A', '#3F6A44']), r.R(-0.45, 0.5)), 0.88);
  }
  if (S.flowers) for (let i = 0; i < 70; i++) iv += circ(r.R(120, 560), r.R(620, 704), r.R(2.2, 4), c.P(r.pick(S.flowers), 0.4), 0.95);
  c.land.push(g(iv, `filter="${c.f('leaf')}"`));
}

BUILD.fields = (c, pl) => {
  const { T, S } = c;
  sky(c, { horizon: 448 });
  cloudSky(c, {});
  range(c, { base: 448, amp: 44, d: 0.66, key: 'far' });
  hazeBand(c, 448, 46, 0.5);
  const n = noise1(c.r);
  const back = profile(-20, W + 20, 10, (x) => 452 + fbm(n, x / 160) * 6);
  ground(c, back, { d: 0.3, dabs: 100, key: 'back', nearDark: 0 });
  treeline(c, -20, 1040, (x) => back.at(x) + 8, { d: 0.32, min: 12, max: 26 });
  village(c, 1040, 1590, (x) => back.at(x) + 12, { d: 0.3, min: 10, max: 16 });
  const field = profile(-20, W + 20, 10, (x) => 466 + fbm(n, x / 260 + 4) * 6);
  ground(c, field, { d: 0.02, dabs: 700, persp: [466, 900], key: 'field', strokes: 700, size: [3, 10] });
  mist(c, 470, 40);
  // the pitch: two loose wet washes of green with sun dabs, chalk lines broken by wear
  const FL = [520, 484];
  const FR = [1080, 484];
  const NR = [1190, 604];
  const NL = [410, 604];
  const P = (u, v) => [lerp(lerp(FL[0], FR[0], u), lerp(NL[0], NR[0], u), v), lerp(FL[1], NL[1], v)];
  {
    const rw = c.sub('pitchwash');
    let pw = '';
    pw += pth(crPath([[440, 600], [520, 488], [760, 480], [1060, 490], [1180, 598], [900, 616], [640, 612]], true), c.P('#7E9A5A', 0), 0.35);
    pw += pth(crPath([[600, 520], [700, 486], [980, 494], [1120, 560], [1010, 590], [760, 572]], true), c.P('#A3B56A', 0.2), 0.35);
    c.land.push(g(pw, `filter="${c.f('wet')}"`));
    let sd = '';
    for (let i = 0; i < 70; i++) {
      const u = rw.R(0, 1);
      const v = rw.R(0, 1);
      const [x, y] = P(u, v);
      sd += ell(x + rw.R(-30, 30), y, lerp(6, 20, v) * rw.R(0.6, 1.4), lerp(1.4, 4, v), c.P(rw.ch(0.75) ? '#E3CF8A' : '#C9C27A', 0.3), rw.R(0.18, 0.4), rw.R(-8, 8));
    }
    c.land.push(g(sd, `filter="${c.f('pig')}"`));
  }
  const rc = c.sub('chalk');
  const chalkCol = c.P('#EDE6D2', 0.3);
  let ch = '';
  // a stroke along a polyline: dabs of chalk with gaps every 40 to 90 px, lost in the far third
  const chalk = (pts, wk = 1) => {
    let acc = 0;
    let next = rc.R(40, 90);
    let on = true;
    let d = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(L / 6));
      for (let k = 0; k < steps; k++) {
        const ax = lerp(x0, x1, k / steps);
        const ay = lerp(y0, y1, k / steps);
        const bx = lerp(x0, x1, (k + 1) / steps);
        const by = lerp(y0, y1, (k + 1) / steps);
        acc += L / steps;
        if (acc > next) {
          acc = 0;
          on = !on;
          next = on ? rc.R(40, 90) : rc.R(4, 14);
        }
        const v = clamp((ay - 484) / 120, 0, 1);
        if (!on || (v < 0.33 && rc.ch(0.5 - v))) continue;
        d += `M${f1(ax)},${f1(ay + rc.R(-0.4, 0.4))}L${f1(bx)},${f1(by + rc.R(-0.4, 0.4))}`;
      }
    }
    ch += spath(d, chalkCol, 3 * wk, 0.55);
  };
  const along = (fn, n = 12) => {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(fn(i / n));
    return out;
  };
  chalk(along((t) => P(t, 0)));
  chalk(along((t) => P(1, t)));
  chalk(along((t) => P(1 - t, 1)));
  chalk(along((t) => P(0, 1 - t)));
  chalk(along((t) => P(0.5, t)));
  chalk(along((t) => [800 + Math.cos(t * TAU) * 64, lerp(484, 604, 0.48) + Math.sin(t * TAU) * 18], 28), 0.9);
  for (const u of [0, 1]) {
    const du = u ? -0.12 : 0.12;
    chalk([P(u, 0.25), P(u + du, 0.25), P(u + du, 0.75), P(u, 0.75)], 0.8);
  }
  c.land.push(g(ch, `filter="${c.f('dry')}"`));
  let gl = '';
  for (const u of [0, 1]) {
    const [gx, gy] = P(u, 0.5);
    const sx = u ? 8 : -8;
    gl += spath(`M${pt(gx, gy - 2)}L${pt(gx + 0.6, gy - 32)}L${pt(gx + sx, gy - 29)}L${pt(gx + sx + 0.8, gy + 2)}`, c.P('#EDE6D2', 0.5), 2, 0.85);
    gl += spath(`M${pt(gx + 1, gy - 30)}L${pt(gx + sx * 1.6, gy - 8)}`, c.P('#EDE6D2', 0), 0.8, 0.4);
  }
  c.land.push(g(gl, `filter="${c.f('arch')}"`));
  // a run club warming up along the left touchline
  {
    const rr = c.sub('runclub');
    const kit = ['#B5654A', '#4E6A78', '#C9A15A', '#7E8A5A', '#8C6A86', '#D8C49A', '#5E7A9A'];
    for (let i = 0; i < 8; i++) {
      const v = 0.18 + i * 0.09 + rr.R(-0.03, 0.03);
      const [x, y] = P(0, v);
      figure(c, x - 18 - rr.R(0, 26) * v, y + 2, lerp(11, 17, v) * rr.R(0.9, 1.1), rr.pick(kit), rr);
    }
  }
  // string lights on three crooked poles at uneven spacing; each span sags its own way
  const poles = [[468, 498, 98], [742, 482, 114], [1150, 494, 86]];
  let sl = '';
  for (const [x, y, ph] of poles) {
    sl += pth(`M${f1(x - 2.8)},${f1(y)}L${f1(x - 1.6 + 2)},${f1(y - ph)}L${f1(x + 1.6 + 2)},${f1(y - ph)}L${f1(x + 2.8)},${f1(y)}Z`, c.P('#7A5A40', T.litSide < 0 ? 0.3 : -0.1));
    sl += line(x + 2 - 7, y - ph + 6, x + 2 + 7, y - ph + 4, c.P('#6A4E38', 0), 1.4, 0.8);
  }
  const bulbs = [];
  const sags = [46, 30];
  for (let i = 0; i < poles.length - 1; i++) {
    const [x0, y0, h0] = poles[i];
    const [x1, y1, h1] = poles[i + 1];
    const ax = x0 + 2;
    const ay = y0 - h0 + 5;
    const bx2 = x1 + 2;
    const by2 = y1 - h1 + 5;
    const mx = lerp(ax, bx2, i ? 0.6 : 0.42);
    const my = Math.max(ay, by2) + sags[i];
    sl += spath(`M${f1(ax)},${f1(ay)}Q${f1(mx)},${f1(my)} ${f1(bx2)},${f1(by2)}`, c.P('#3A3F48', 0), 1, 0.7);
    const nb = Math.round((bx2 - ax) / 30);
    for (let k = 1; k < nb; k++) {
      const t = k / nb + rc.R(-0.01, 0.01);
      const bx = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx2;
      const by = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by2;
      bulbs.push([bx, by + 3]);
      sl += circ(bx, by + 3, 2.2, c.P('#F3E6C4', 0.4), 0.9);
    }
  }
  c.land.push(g(sl, `filter="${c.f('arch')}"`));
  for (const [bx, by] of bulbs) addLight(c, bx, by, 2.2, { halo: 14, col: '#FFE2A0' });
  // the small wooden stage
  const wood = '#A57A52';
  const st = block(c, { x: 236, y: 532, w: 180, h: 26, d: 70, side: 1, kind: 'flat', wall: wood, roofTop: '#C49A6C' });
  for (let k = 1; k < 8; k++) c.land.push(line(...st.F(k / 8, 0), ...st.F(k / 8, 1), c.P(wood, -0.5), 0.8, 0.4));
  let stg = '';
  for (const x of [250, 402]) stg += rect(x - 3, 420, 6, 90, c.P('#7A5A40', 0));
  stg += pg([[240, 424], [412, 424], [432, 412], [262, 412]], c.P('#8C6A56', 0.4), 1, edge(c, 0.7));
  stg += pg([[256, 430], [398, 430], [398, 502], [256, 502]], c.P('#E9DFC8', 0.2), 0.95, edge(c, 0.6));
  for (let k = 0; k < 6; k++) stg += line(262 + k * 26, 432, 262 + k * 26, 500, c.P('#C9BCA0', -0.2), 0.8, 0.5);
  c.land.push(g(stg, `filter="${c.f('arch')}"`));
  // café kiosk
  const k = block(c, { x: 1236, y: 612, w: 132, h: 74, d: 64, side: -1, kind: 'gable', roofH: 46, wall: '#B08A5E', roof: '#8C6A56' });
  windowOn(c, k.F, 0.15, 0.3, 0.85, 0.75, { rows: 0, mullions: 0, glass: c.P('#3A3030', -0.3), litP: c.T.lit ? 1 : 0, keep: true });
  let aw = '';
  for (let i = 0; i < 6; i++) {
    const [ax0, ay0] = k.F(0.1 + i * 0.133, 0.8);
    const [ax1] = k.F(0.1 + (i + 1) * 0.133, 0.8);
    aw += pg([[ax0, ay0], [ax1, ay0], [ax1 + 2, ay0 + 12], [ax0 + 2, ay0 + 12]], i % 2 ? c.P('#EFE6D2', 0.4) : c.P('#5E9A8E', 0.3));
  }
  c.land.push(g(aw, `filter="${c.f('arch')}"`));
  board(c, 1176, 618, 40, 26, { papers: 5 });
  bench(c, 352, 664, 64);
  bench(c, 1090, 640, 50);
  // the flower meadow along the edge (it blooms when an idea is approved)
  if (S.flowers) {
    const rf = c.sub('meadow');
    let fl = '';
    for (let i = 0; i < 360; i++) {
      const side = rf.ch(0.5);
      const x = side ? rf.R(0, 420) : rf.R(1180, 1600);
      const y = rf.R(600, 860);
      const kk = (y - 600) / 260;
      fl += circ(x, y, lerp(1.6, 4.2, kk) * rf.R(0.7, 1.2), c.P(rf.pick(S.flowers), rf.R(0, 0.6)), rf.R(0.6, 0.95));
    }
    c.land.push(g(fl, `filter="${c.f('leaf')}"`));
  }
  road(c, pl.path, { w0: 180, w1: 30, kind: 'dirt' });
  tree(c, 104, 612, 128, {});
  tree(c, 1452, 566, 84, {});
  warmLight(c);
  vignette(c, 0.3);
  frame(c, { tl: 1, tr: 0.55, bl: 0.4, br: 0.95 });
  nearFoliage(c, 1590, 930, 300, 230);
};

BUILD.lighthouse = (c, pl) => {
  const { T, S } = c;
  if (c.time === 'sunset' || c.time === 'night') T.litSide = -1;
  sky(c, { horizon: 394, sunX: c.time === 'sunset' ? 0.22 : c.time === 'night' ? 0.24 : undefined });
  cloudSky(c, { amount: 0.8 });
  // the far headland and the open sea
  const fh = T.farHaze || T.haze;
  c.land.push(g(pth('M-20,396C60,384 160,380 260,388C300,392 320,396 340,398L-20,398Z', mix(c.P('#7F8DB5', 0), fh, 0.55)), `filter="${c.f('pig')}"`));
  water(c, { y0: 396, y1: 900, n: 160 });
  {
    // the sea in broken horizontal washes, paler and bluer toward the horizon
    const rs = c.sub('seabands');
    let sb = '';
    for (const [ya, yb, col, op, n] of [[398, 450, '#8FA9C4', 0.4, 7], [440, 560, '#6F8FB0', 0.35, 8], [540, 760, '#5F7FA4', 0.3, 7]]) {
      for (let i = 0; i < n; i++) {
        const y = rs.R(ya, yb);
        const x = rs.R(-120, 1500);
        const w = rs.R(260, 760);
        const hh = rs.R(5, 16) * (y / 420);
        sb += pth(`M${f1(x)},${f1(y)}q${f1(w * 0.3)},${f1(-hh * 0.6)} ${f1(w * 0.6)},${f1(-hh * 0.2)}t${f1(w * 0.4)},${f1(hh * 0.3)}l0,${f1(hh)}q${f1(-w * 0.5)},${f1(hh * 0.5)} ${f1(-w)},0Z`, c.P(col, 0, 0), op);
      }
    }
    c.land.push(g(sb, `filter="${c.f('wet')}"`));
    // sparkle dabs on the water under the sun
    const sx = (c.sunX != null ? c.sunX : 300);
    let sp = '';
    for (let i = 0; i < 70; i++) {
      const y = 404 + Math.pow(rs.r(), 1.3) * 300;
      const k = (y - 400) / 300;
      const x = sx + rs.R(-1, 1) * lerp(60, 260, k) + rs.R(-40, 40);
      sp += ell(x, y, lerp(3, 12, k) * rs.R(0.5, 1.4), lerp(0.8, 2, k), c.time === 'sunset' ? '#FFE3B0' : '#A7C0D0', rs.R(0.35, 0.75));
      if (rs.ch(0.3)) sp += ell(x + rs.R(-4, 4), y, lerp(1.5, 4, k), 0.8, '#FFFBEF', rs.R(0.4, 0.8));
    }
    c.land.push(g(sp, `filter="${c.f('pig')}"`));
  }
  hazeBand(c, 398, 34, 0.62);
  // sailing boats far out
  let bt = '';
  for (const [x, y, s2] of [[180, 418, 1], [420, 410, 0.8], [1380, 406, 0.7], [640, 430, 1.1]]) {
    const sc = mix(c.P('#F3EFE6', 0.5), fh, 0.3);
    bt += pg([[x, y - 22 * s2], [x, y - 2 * s2], [x + 13 * s2, y - 3 * s2]], sc) + pg([[x - 2, y - 18 * s2], [x - 2, y - 3 * s2], [x - 10 * s2, y - 4 * s2]], mix(sc, fh, 0.3)) + pg([[x - 12 * s2, y - 1], [x + 15 * s2, y - 1], [x + 11 * s2, y + 3 * s2], [x - 9 * s2, y + 3 * s2]], mix(c.P('#5A4434', 0), fh, 0.3)) + line(x - 10 * s2, y + 5 * s2, x + 12 * s2, y + 5 * s2, mix(T.light, '#FFFFFF', 0.4), 1, 0.4);
  }
  c.land.push(g(bt, `filter="${c.f('arch')}"`));
  // the headland: cliff face dropping to a small sandy cove
  const edgeP = [[560, 606], [522, 662], [474, 742], [428, 830], [398, 920]];
  const baseP = edgeP.map(([x, y], i) => [x - lerp(150, 70, i / 4), y + lerp(70, 20, i / 4)]);
  const cove = 'M30,724C90,676 250,664 410,690C450,720 440,780 400,812C300,850 120,846 60,812C20,786 10,750 30,724Z';
  patch(c, cove, S.snow ? '#EEF1F5' : '#E6D2A6', { box: [10, 664, 460, 850], cols: ['#F3E6C8', '#C9B08A', '#D9C49A'], n: 260, big: 5, key: 'cove' });
  let foam = '';
  for (let k = 0; k < 3; k++) foam += spath(`M${30 - k * 10},${724 - k * 9}C${90 - k * 8},${676 - k * 10} ${250},${664 - k * 11} ${410 + k * 6},${690 - k * 8}`, mix(T.light, '#FFFFFF', 0.5), 2.6 - k * 0.7, 0.55 - k * 0.15);
  c.land.push(g(foam, `filter="${c.f('arch')}"`));
  const rk = c.sub('cliff');
  const face = [...edgeP, ...baseP.slice().reverse()];
  let cf = pth(crPath(face, true), c.lg([[0, c.P('#8E8290', -0.5)], [0.6, c.P('#A8988A', faceK(c, -1) * 0.8)], [1, c.P('#B8A894', 0.6)]], 0, 0, 1, 0));
  for (let i = 0; i < 70; i++) {
    const t = rk.r();
    const e = lerpP(edgeP[Math.floor(t * 3.99)], edgeP[Math.floor(t * 3.99) + 1], (t * 4) % 1);
    const bb = lerpP(baseP[Math.floor(t * 3.99)], baseP[Math.floor(t * 3.99) + 1], (t * 4) % 1);
    const u = rk.r();
    const [x, y] = lerpP(e, bb, u);
    cf += line(x, y, x - rk.R(2, 10), y + rk.R(14, 40), c.P('#5E5266', -0.4), rk.R(1, 3), 0.45);
    cf += ell(x + rk.R(-6, 6), y, rk.R(6, 16), rk.R(3, 7), c.P(rk.pick(['#C4B29A', '#B0A08E', '#D2C2A6']), faceK(c, -1) * 0.9), 0.45);
  }
  cf += spath(crPath(baseP, false), mix(T.light, '#FFFFFF', 0.5), 3, 0.5);
  c.land.push(g(cf, `filter="${c.f('pig')}"`));
  const topPts = [[560, 606], [640, 590], [760, 568], [900, 554], [1060, 546], [1260, 540], [1620, 532]];
  const land = `${crPath(topPts, false)}L1620,920L398,920L428,830L474,742L522,662Z`;
  const prof = profile(380, 1620, 10, (x) => {
    for (let i = 0; i < topPts.length - 1; i++) if (x <= topPts[i + 1][0]) return lerp(topPts[i][1], topPts[i + 1][1], (x - topPts[i][0]) / (topPts[i + 1][0] - topPts[i][0]));
    return 532;
  });
  ground(c, prof, { shape: land, d: 0.02, dabs: 560, persp: [540, 900], key: 'cliff', strokes: 560, x0: 400 });
  lighthouseTower(c);
  // the timber cottage studio at the base
  const k = block(c, { x: 990, y: 570, w: 136, h: 58, d: 70, side: 1, kind: 'gable', roofH: 44, wall: '#B39070', roof: '#6E6476' });
  for (let i = 1; i < 9; i++) c.land.push(line(...k.F(0, i / 9), ...k.F(1, i / 9), c.P('#7A5A40', -0.4), 0.7, 0.4));
  windowOn(c, k.F, 0.12, 0.34, 0.46, 0.8, {
    rows: 0, mullions: 0, litP: c.T.lit ? 1 : 0, keep: true,
    content: (F, a0, b0, a1, b1, isLit) => {
      let q = '';
      for (const [u, v, rr] of [[0.25, 0.6, 7], [0.62, 0.55, 8.5]]) {
        const [px, py] = F(lerp(a0, a1, u), lerp(b0, b1, v));
        q += `<circle cx="${f1(px)}" cy="${f1(py)}" r="${rr}" fill="none" stroke="${isLit ? '#7A5030' : c.P('#2E3440', 0)}" stroke-width="2"/>` + circ(px, py, 1.6, isLit ? '#7A5030' : c.P('#2E3440', 0));
      }
      return q;
    },
  });
  door(c, k.F, 0.6, 0.78, 0.74, { col: '#5A4030' });
  // style board pinned on the wall
  const [bx, by] = k.F(0.84, 0.75);
  c.land.push(rect(bx, by, 16, 18, c.P('#EFE6D2', 0.3), 1, edge(c, 0.5)) + rect(bx + 2, by + 3, 5, 5, c.P('#C9A7E8', 0.2)) + rect(bx + 9, by + 3, 5, 5, c.P('#E8C35A', 0.2)) + rect(bx + 2, by + 10, 5, 5, c.P('#8FB4E8', 0.2)) + rect(bx + 9, by + 10, 5, 5, c.P('#F0A9A3', 0.2)));
  // easel by the door
  const ex = 1150;
  const ey = 590;
  let es = ell(ex - T.litSide * 10, ey + 3, 18, 3, T.shade, 0.32);
  es += line(ex - 12, ey, ex, ey - 46, c.P('#7A5A40', 0), 2) + line(ex + 12, ey, ex, ey - 46, c.P('#7A5A40', 0), 2) + line(ex, ey - 40, ex + 4, ey, c.P('#7A5A40', 0), 1.6);
  es += rect(ex - 13, ey - 44, 26, 22, c.P('#F3EFE6', 0.5), 1, edge(c, 0.6));
  es += ell(ex - 4, ey - 34, 6, 3, c.P('#8FB4E8', 0.3), 0.8) + ell(ex + 5, ey - 30, 5, 3, c.P('#E9A86B', 0.3), 0.8);
  c.land.push(g(es, `filter="${c.f('arch')}"`));
  road(c, pl.path, { w0: 200, w1: 28, kind: 'dirt' });
  bush(c, 680, 600, 30, {});
  bush(c, 1300, 590, 40, {});
  bush(c, 1450, 600, 52, {});
  if (c.time !== 'night') birds(c, [[700, 230, 8], [740, 210, 6], [560, 260, 7], [1180, 190, 6], [1210, 214, 5]], c.P('#F3EFE6', -0.2));
  warmLight(c);
  vignette(c, 0.32);
  frame(c, { tl: 0.9, tr: 0.75, bl: 0.6, br: 1 });
};

function lighthouseTower(c) {
  const { T, S } = c;
  const x = 930;
  const white = '#F2EBDD';
  let s = cylinder(c, x, 556, 92, 62, 264, white, {
    cols: [c.P(white, 0.6), c.P(mix(white, '#D8D2C6', 0.5), 0), null],
    shadow: '#A9B3CC', shOp: 0.5, dabs: 22, dabCols: ['#E6DCC8', '#D4CCBE', '#C9CCD6', '#EFE3CC'],
  });
  // two red bands laid with a dry brush: the paper shows through in breaks
  const rb = c.sub('lhbands');
  for (const [y0, y1] of [[452, 432], [372, 354]]) {
    const hw0 = lerp(46, 31, (556 - y0) / 292);
    const hw1 = lerp(46, 31, (556 - y1) / 292);
    let band = '';
    for (let yy = y0; yy > y1; yy -= 2.4) {
      const t = (y0 - yy) / (y0 - y1);
      const hw = lerp(hw0, hw1, t);
      let xa = x - hw;
      while (xa < x + hw) {
        const len = rb.R(14, 40);
        const u = (xa - (x - hw)) / (2 * hw);
        const shade = T.litSide < 0 ? u : 1 - u;
        if (rb.ch(0.86)) band += spath(`M${f1(xa)},${f1(yy)}l${f1(Math.min(len, x + hw - xa))},${f1(rb.R(-0.6, 0.6))}`, c.P('#B9574A', shade > 0.62 ? -0.6 : shade < 0.3 ? 0.4 : 0), rb.R(2.2, 3.4), rb.R(0.7, 0.95));
        xa += len + rb.R(1, 6);
      }
    }
    // the body of the band is one transparent wash, its edges wobble
    const shL = T.litSide < 0;
    const red = c.lg([[0, c.P('#B9574A', shL ? 0.5 : -0.7)], [0.5, c.P('#B9574A', 0)], [1, c.P('#B9574A', shL ? -0.7 : 0.5)]], 0, 0, 1, 0);
    const wash = pg([[x - hw0, y0], [x + hw0, y0], [x + hw1, y1], [x - hw1, y1]], red, 0.82);
    s += g(wash, `filter="${c.f('wc')}"`) + g(band, `filter="${c.f('dry')}"`);
  }
  s += pth(`M${x - 11},556L${x - 11},530A11,11 0 0 1 ${x + 11},530L${x + 11},556Z`, c.P('#5A4434', -0.2), 1, edge(c, 0.8));
  // gallery and railing
  s += rect(x - 52, 254, 104, 10, c.P('#3E5A66', 0.3), 1, edge(c, 0.8));
  for (let i = 0; i <= 10; i++) s += line(x - 48 + i * 9.6, 254, x - 48 + i * 9.6, 238, c.P('#3E4A56', 0), 1.2);
  s += line(x - 50, 238, x + 50, 238, c.P('#3E4A56', 0), 1.6);
  // lamp room frame
  s += rect(x - 28, 206, 56, 48, c.P('#2E3E4E', -0.2), 1, edge(c, 0.8));
  s += pth(`M${x - 34},208A34,22 0 0 1 ${x + 34},208Z`, c.P('#3E5A66', 0.4), 1, edge(c, 0.8));
  s += line(x, 186, x, 176, c.P('#3E4A56', 0), 2) + circ(x, 174, 4, c.P('#3E5A66', 0.4));
  if (S.snow) s += pth(`M${x - 30},204A30,16 0 0 1 ${x + 30},204Z`, '#F4F6F9', 0.8);
  c.land.push(g(s, `filter="${c.f('arch')}"`));
  for (const [y, w2] of [[350, 8], [470, 9]]) windowOn(c, face([x - w2 / 2 + T.litSide * 6, y + 20], [w2, 0], [0, -20]), 0, 0, 1, 1, { mullions: 0, sill: false, litP: c.T.lit ? 0.7 : 0 });
  const lampLit = c.time === 'night' || c.time === 'sunset';
  let glass = '';
  for (let i = 0; i < 4; i++) glass += rect(x - 24 + i * 12.5, 212, 10, 38, lampLit ? '#FFF2C8' : mix(T.sky[2][1], '#FFFFFF', 0.3), lampLit ? 0.95 : 0.6);
  c.land.push(glass);
  if (lampLit) {
    const i = c.li++;
    const beam = c.lg([[0, '#FFF0C0', 0.42], [1, '#FFF0C0', 0]], 1, 0, 0, 0);
    const beamR = c.lg([[0, '#FFF0C0', 0.36], [1, '#FFF0C0', 0]], 0, 0, 1, 0);
    c.lights.push(`<g class="lw beam" style="--i:${i}">${g(pg([[x, 226], [-40, 120], [-40, 330]], beam) + pg([[x, 228], [1640, 180], [1640, 300]], beamR), `filter="${c.f('b10')}"`)}${circ(x, 230, 90, c.glowGrad, 0.9)}</g>`);
  }
  castShadow(c, x - 46, x + 46, 558, 280, { op: 0.26 });
}

/* ------------------------------------------------------------- generic */

function generic(c, pl) {
  sky(c, { horizon: 430 });
  cloudSky(c, {});
  range(c, { base: 432, amp: 70, d: 0.6, key: 'far' });
  hazeBand(c, 430, 60, 0.5);
  const n = noise1(c.r);
  ground(c, profile(-20, W + 20, 10, (x) => 480 + fbm(n, x / 200) * 30), { dabs: 500, persp: [480, 900] });
  road(c, pl.path, {});
  vignette(c);
  frame(c, {});
}

/* -------------------------------------------------------------- export */

const CACHE = new Map();
const CACHE_MAX = 24;

function build(id, time, season, weather, extra) {
  const key = [id, time, season, weather, extra.weekend ? 'w' : '', extra.quiet ? 'q' : ''].join('|');
  if (CACHE.has(key)) return CACHE.get(key);
  let w = weather;
  if (id === 'vault' && (w === 'clear' || !w) && (time === 'day' || time === 'morning')) w = 'clouds';
  const c = makeCtx(id, time, season, w, extra);
  c.subject = rectOf(PLACE[id]);
  (BUILD[id] || generic)(c, PLACE[id]);
  const out = {
    defs: filters(c) + c.defs.join(''),
    sky: c.sky.join(''),
    clouds: c.clouds.join(''),
    land: c.land.join(''),
    lights: c.lights.join(''),
    front: c.front.join(''),
    p: c.p,
    paper: `<rect width="${W}" height="${H}" filter="${c.f('paper')}" opacity="0.16" style="mix-blend-mode:multiply"/>`,
    lightCount: c.li,
  };
  CACHE.set(key, out);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return out;
}

function svgWrap(inner, defs, o) {
  const w = o.width || W;
  const h = o.height || H;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${defs}</defs>${inner}</svg>`;
}

export function paintPlace(placeId, opts = {}) {
  const id = PLACE[placeId] ? placeId : 'town';
  const time = TIME[opts.time] ? opts.time : 'day';
  const season = SEASON[opts.season] ? opts.season : 'autumn';
  const wk = opts.weather && typeof opts.weather === 'object' ? opts.weather.kind : opts.weather;
  const weather = ['clear', 'clouds', 'rain', 'snow', 'fog'].includes(wk) ? wk : 'clear';
  const part = opts.part || 'all';
  try {
    const b = build(id, time, season, weather, { weekend: !!opts.weekend, quiet: !!opts.quiet });
    let inner;
    if (part === 'sky') inner = b.sky;
    else if (part === 'clouds') inner = b.clouds;
    else if (part === 'land') inner = b.land + b.paper;
    else if (part === 'lights') inner = b.lights;
    else if (part === 'front') inner = b.front;
    else if (part === 'back') inner = b.sky + b.clouds + b.land + b.paper;
    else inner = b.sky + b.clouds + b.land + `<g style="mix-blend-mode:screen">${b.lights}</g>` + b.front + b.paper;
    return svgWrap(inner, b.defs, opts);
  } catch (e) {
    const T = TIME[time];
    const stops = T.sky.map(([o, col]) => `<stop offset="${o}" stop-color="${col}"/>`).join('');
    return svgWrap(`<rect width="${W}" height="${H}" fill="url(#fallsky)"/><rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="${paint(T, '#8F9C52', 0)}"/>`, `<linearGradient id="fallsky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`, opts);
  }
}

// Number of light points painted for a place (used by the vista for quiet hours).
export function lightCount(placeId, opts = {}) {
  try {
    const time = TIME[opts.time] ? opts.time : 'day';
    const season = SEASON[opts.season] ? opts.season : 'autumn';
    return build(PLACE[placeId] ? placeId : 'town', time, season, 'clear', {}).lightCount;
  } catch (e) {
    return 0;
  }
}
