// SAO map: the parchment travel journal map of the island.
// Inline SVG, hand inked, painted with light watercolor washes. One sheet,
// drawn once; updateMap only touches status lanterns, bot dots, the trailer
// wagon, the gym shields and the gold ring of the current place.
//
// World coordinates follow places.js: viewBox 0 0 1000 1300 for the island.
// The paper and the sea extend past that box so the map can fill any band;
// when the container is too small for readable labels (13 px or more) the
// sheet pans instead of shrinking (drag, wheel, or keyboard focus).

import { PLACES, PLACE, MAP, SUBS } from './places.js';
import { BOT, STATES } from './bots.js';
import { season as clockSeason, period as clockPeriod } from './clock.js';

const NS = 'http://www.w3.org/2000/svg';
const W0 = 1000;
const H0 = 1300;
const S_MIN = 0.55; // never draw smaller than this: keeps labels at 13 px or more
const PAD = 30; // world units of sea kept around the island when panning

const FONT = "'Times New Roman', Times, Georgia, serif";
const INK = '#3A2A1F';
const INK_SOFT = '#5C4330';
const SEPIA = '#6B4A2E';
const PAPER = '#EADCBC';
const PAPER_HI = '#F2E7CD';
const GOLD = '#E8C88E';
const GOLD_DEEP = '#C08A2E';
const WATER = '#8DB4B2';
const WATER_DEEP = '#5F8E96';
const SHADE = '#8E92B4'; // cool violet shadow
const STONE = '#EFE4CA';
const STONE_DK = '#D2C29C';
const ROOF = '#C2744B';
const ROOF_DK = '#9C5A3C';
const COPPER = '#8DB59E';
const DOME = '#9AA3AA';
const LEAF = '#7E9A5C';
const PINE = '#4E6B58';

// Icons that sit slightly off their data point (home is on the canal bank).
const NUDGE = { home: [24, 2], kitchen: [8, 0] };
// Region labels: small hand placed offsets so they never sit on a town.
const REGION_NUDGE = {
  'The Northern Heights': [150, -5],
  'The Lake': [10, -14],
  'The Centre': [-70, 40],
  'The Eastern Village': [20, -65],
  'The Quiet Slope': [-10, 20],
  'The Southern Meadows': [0, 20],
  'The Coast': [-40, -152],
  'The Old Wall': [60, 90],
  'The Deep Forest': [40, 160],
};
const REGION_CROSSES_COAST = { 'The Coast': true };
const MEMORY_TREE = [-44, -2];
const WAGON_SPOT = { bobino: [64, -2], town: [-70, 40], market: [-70, -6], fields: [0, 64] };
const BENCH = [-104, -16]; // where sleeping bots nap, relative to town

// ------------------------------------------------------------------ helpers

const f = (n) => (Math.round(n * 10) / 10).toString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// per glyph tilt so a label reads as lettered by hand, never as set type
function wobble(text, amp = 2.4) {
  const r = rng(hash(String(text)) + 7);
  const out = [];
  let a = 0;
  for (let i = 0; i < String(text).length; i++) {
    a = a * 0.45 + (r() - 0.5) * amp * 1.6;
    out.push(f(a));
  }
  return out.join(' ');
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function bez(p0, c1, c2, p1, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
}
function crSegments(pts, closed) {
  const n = pts.length;
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    segs.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
  }
  return segs;
}
function smoothD(pts, closed) {
  const segs = crSegments(pts, closed);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (const s of segs) d += `C${f(s[1][0])},${f(s[1][1])} ${f(s[2][0])},${f(s[2][1])} ${f(s[3][0])},${f(s[3][1])}`;
  return closed ? d + 'Z' : d;
}
function sampleSmooth(pts, closed, per = 10) {
  const out = [];
  for (const s of crSegments(pts, closed)) for (let i = 0; i < per; i++) out.push(bez(s[0], s[1], s[2], s[3], i / per));
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}
function polyD(pts) {
  return 'M' + pts.map((p) => `${f(p[0])},${f(p[1])}`).join('L');
}
function withLengths(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, L, total: L[L.length - 1] };
}
function pointAt(g, dist) {
  const d = Math.max(0, Math.min(g.total, dist));
  let i = 1;
  while (i < g.L.length - 1 && g.L[i] < d) i++;
  const a = g.pts[i - 1];
  const b = g.pts[i];
  const seg = g.L[i] - g.L[i - 1] || 1;
  const t = (d - g.L[i - 1]) / seg;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function distSeg(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy || 1;
  let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
function distPoly(x, y, pts, closed) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) m = Math.min(m, distSeg(x, y, pts[i - 1], pts[i]));
  if (closed) m = Math.min(m, distSeg(x, y, pts[pts.length - 1], pts[0]));
  return m;
}
function offsetLine(pts, widthAt) {
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const w = widthAt(i / (pts.length - 1));
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  return { left, right };
}

// ------------------------------------------------------------------ geography

function anchor(id) {
  if (id === 'bridge') return [MAP.bridge.x, MAP.bridge.y];
  const p = PLACE[id];
  if (!p) return null;
  const n = NUDGE[id] || [0, 0];
  return [p.map.x + n[0], p.map.y + n[1]];
}

const COAST_BASE = [
  [420, 96], [470, 74], [530, 64], [574, 90], [608, 126], [650, 100], [720, 94], [782, 128], [830, 188],
  [852, 258], [852, 330], [872, 398], [904, 450], [912, 518], [884, 572], [892, 622], [926, 662], [944, 720],
  [950, 774], [934, 812], [904, 840], [882, 900], [900, 958], [928, 1008], [936, 1052], [912, 1092],
  [870, 1130], [812, 1158], [744, 1170], [692, 1198], [640, 1238], [580, 1254], [526, 1228], [472, 1196],
  [420, 1202], [376, 1232], [318, 1250], [258, 1236], [200, 1200], [160, 1150], [130, 1090], [106, 1020],
  [92, 950], [98, 884], [70, 842], [48, 790], [56, 732], [88, 698], [94, 650], [70, 600], [58, 540],
  [80, 480], [102, 420], [120, 352], [138, 290], [146, 232], [174, 180], [226, 150], [282, 138], [332, 118], [380, 104],
];

function buildCoast() {
  const r = rng(41);
  const pts = [];
  const n = COAST_BASE.length;
  for (let i = 0; i < n; i++) {
    const a = COAST_BASE[i];
    const b = COAST_BASE[(i + 1) % n];
    pts.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    for (const t of [0.34, 0.68]) {
      const j = (r() - 0.5) * Math.min(22, len * 0.22);
      pts.push([a[0] + (b[0] - a[0]) * t + nx * j, a[1] + (b[1] - a[1]) * t + ny * j]);
    }
  }
  return { pts, d: smoothD(pts, true), poly: sampleSmooth(pts, true, 6) };
}

function buildLake() {
  const r = rng(7);
  const { x, y, rx, ry } = MAP.lake;
  const pts = [];
  const N = 22;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = 1 + (r() - 0.5) * 0.12 + Math.sin(a * 3 + 1.2) * 0.04;
    pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
  }
  return { pts, d: smoothD(pts, true), poly: sampleSmooth(pts, true, 6) };
}

function buildCanal() {
  const pts = sampleSmooth(MAP.canal.map((p) => [p[0], p[1]]), false, 14);
  const { left, right } = offsetLine(pts, (t) => 4.5 + t * 6.5);
  return { pts, left, right, fill: polyD(left) + 'L' + right.slice().reverse().map((p) => `${f(p[0])},${f(p[1])}`).join('L') + 'Z' };
}

function buildRoads() {
  const centers = PLACES.map((p) => [p.id, anchor(p.id)]);
  return MAP.roads.map((rd, i) => {
    const a = anchor(rd.from);
    const b = anchor(rd.to);
    const via = rd.via ? [anchor(rd.via)] : [];
    const chain = [a, ...via, b];
    const r = rng(hash(rd.from + rd.to) + i);
    const base = chain.slice(1).map(() => (r() - 0.5) * 0.22);
    const others = centers.filter(([id]) => id !== rd.from && id !== rd.to).map((c) => c[1]);
    const build = (extra) => {
      const pts = [chain[0]];
      for (let k = 1; k < chain.length; k++) {
        const p = chain[k - 1];
        const q = chain[k];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const nx = -(q[1] - p[1]) / len;
        const ny = (q[0] - p[0]) / len;
        const bend = (base[k - 1] + extra) * len;
        pts.push([(p[0] + q[0]) / 2 + nx * bend, (p[1] + q[1]) / 2 + ny * bend]);
        pts.push(q);
      }
      return withLengths(sampleSmooth(pts, false, 16));
    };
    // bend the road around any town it would otherwise run through
    let g = build(0);
    for (const extra of [0.12, -0.12, 0.22, -0.22, 0.32, -0.32]) {
      const clash = g.pts.some((q) => others.some((o) => Math.hypot(q[0] - o[0], (q[1] - (o[1] - 26)) * 1.2) < 58));
      if (!clash) break;
      g = build(extra);
    }
    // the drawn road stops at the doorstep instead of running through the icon
    const trim = withLengths(g.pts.filter((q) => Math.hypot(q[0] - a[0], q[1] - a[1]) > 16 && Math.hypot(q[0] - b[0], q[1] - b[1]) > 16));
    return { ...rd, g, d: polyD(trim.pts.length > 1 ? trim.pts : g.pts) };
  });
}

// Region names are placed once for the smallest scale (the largest names in
// world units), so they stay clear of every town at any size. Long names stack
// on two lines like an old chart. Start at the hand placed spot, then step aside.
const FR_W = 13.5 / S_MIN;
const LS_W = 3 / S_MIN;
const FL_W = 14 / S_MIN;
function townBoxes() {
  const out = [];
  for (const p of PLACES) {
    const a = anchor(p.id);
    const lw = (p.name.length * 0.45 * FL_W) / 2 + 34;
    out.push([a[0] - 48, a[1] - 92, a[0] + 48, a[1] + 8]);
    out.push([a[0] - lw, a[1] + 8, a[0] + lw, a[1] + 16 + FL_W * 1.15]);
  }
  return out;
}
function regionLayout(coast) {
  const towns = townBoxes();
  const placed = [];
  const steps = [[0, 0]];
  for (let r = 1; r <= 3; r++) for (const [a, b] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) steps.push([a * r * 14, b * r * 10]);
  return MAP.regions.map((rg) => {
    const words = rg.name.split(' ');
    const lines = words.length >= 3 && rg.name.length > 12 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [rg.name];
    const cw = FR_W * 0.56 + LS_W;
    const w = Math.max(...lines.map((l) => l.length)) * cw + 8;
    const lh = FR_W * 1.1;
    const n = REGION_NUDGE[rg.name] || [0, 0];
    const boxAt = (x, y) => [x - w / 2, y - FR_W * 0.78, x + w / 2, y + (lines.length - 1) * lh + 6];
    let best = null;
    let bestScore = Infinity;
    for (const st of steps) {
      const x = rg.x + n[0] + st[0];
      const y = rg.y + n[1] + st[1];
      const b = boxAt(x, y);
      let score = 0;
      for (const o of towns.concat(placed)) {
        const ix = Math.min(b[2], o[2]) - Math.max(b[0], o[0]);
        const iy = Math.min(b[3], o[3]) - Math.max(b[1], o[1]);
        if (ix > 0 && iy > 0) score += ix * iy;
      }
      if (!REGION_CROSSES_COAST[rg.name]) for (const c of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) if (!inPoly(c[0], c[1], coast.poly) || distPoly(c[0], c[1], coast.poly, true) < 6) score += 4000;
      score += Math.hypot(st[0], st[1]) * 4;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    const box = boxAt(best.x, best.y);
    placed.push(box);
    return { name: rg.name, x: best.x, y: best.y, lines, box };
  });
}

// ------------------------------------------------------------------ glyph kit

const sh = (d, fill, w = 1.5, op = 1) => `<path d="${d}" fill="${fill}"${op < 1 ? ` fill-opacity="${op}"` : ''} stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
const ln = (d, w = 1.4, col = INK, op = 1) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"${op < 1 ? ` stroke-opacity="${op}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
const wa = (d, fill, op = 0.5) => `<path d="${d}" fill="${fill}" fill-opacity="${op}"/>`;
const dot = (x, y, r, fill, w = 0.9) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${w}"/>`;

function blob(cx, cy, r, bumps, seed) {
  const rr = rng(seed);
  const pts = [];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    const k = 0.86 + rr() * 0.22;
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k * 0.92]);
  }
  return smoothD(pts, true);
}

function house(x, y, w, h, roof, seed = 1) {
  const r = rng(seed);
  const rh = h * (0.7 + r() * 0.3);
  return (
    sh(`M${x},${y}L${x},${y - h}L${x + w},${y - h}L${x + w},${y}Z`, STONE, 1.3) +
    wa(`M${x + w * 0.62},${y}L${x + w * 0.62},${y - h}L${x + w},${y - h}L${x + w},${y}Z`, SHADE, 0.32) +
    sh(`M${x - 2},${y - h + 0.5}L${x + w / 2},${y - h - rh}L${x + w + 2},${y - h + 0.5}Z`, roof, 1.3) +
    wa(`M${x + w / 2},${y - h - rh}L${x + w + 2},${y - h + 0.5}L${x + w / 2},${y - h + 0.5}Z`, ROOF_DK, 0.45) +
    `<rect x="${f(x + w * 0.3)}" y="${f(y - h * 0.62)}" width="${f(w * 0.24)}" height="${f(h * 0.26)}" fill="${GOLD}" stroke="${INK}" stroke-width="0.9"/>`
  );
}

function treeGlyph(x, y, s, kind, seas, seed) {
  const r = rng(seed);
  if (kind === 'pine') {
    const h = 16 * s;
    const w = 10 * s;
    const lean = (r() - 0.5) * 2 * s;
    let out =
      ln(`M${f(x)},${f(y)}L${f(x)},${f(y - 3 * s)}`, 1.1) +
      sh(`M${f(x + lean)},${f(y - h)}Q${f(x + w * 0.22)},${f(y - h * 0.55)} ${f(x + w / 2)},${f(y - 3 * s)}L${f(x - w / 2)},${f(y - 3 * s)}Q${f(x - w * 0.22)},${f(y - h * 0.55)} ${f(x + lean)},${f(y - h)}Z`, PINE, 1.1, 0.82) +
      wa(`M${f(x + lean)},${f(y - h)}Q${f(x + w * 0.22)},${f(y - h * 0.55)} ${f(x + w / 2)},${f(y - 3 * s)}L${f(x + 0.5)},${f(y - 3 * s)}Z`, '#2F4A48', 0.35);
    if (seas === 'winter') out += wa(`M${f(x + lean)},${f(y - h)}L${f(x + w * 0.2)},${f(y - h * 0.62)}L${f(x - w * 0.2)},${f(y - h * 0.62)}Z`, '#FBF8F0', 0.95);
    return out;
  }
  const rr = 6.2 * s;
  const cy = y - 4 * s - rr;
  const trunk = ln(`M${f(x)},${f(y)}L${f(x)},${f(cy + rr * 0.4)}`, 1.2);
  if (seas === 'winter') {
    return trunk + ln(`M${f(x)},${f(cy + 2)}L${f(x - rr * 0.7)},${f(cy - rr * 0.6)}M${f(x)},${f(cy)}L${f(x + rr * 0.6)},${f(cy - rr * 0.8)}M${f(x)},${f(cy - 1)}L${f(x + 0.6)},${f(cy - rr)}`, 0.9, INK_SOFT);
  }
  const palette = {
    autumn: ['#D58A3A', '#C46C33', '#CFA243', '#B97A3C', '#D9963F', '#8F9B57'],
    summer: ['#7E9C5A', '#6D8F5A', '#93A863', '#86A35E'],
    spring: ['#93AE66', '#A3B872', '#89A75F'],
  }[seas] || ['#7E9C5A'];
  const col = palette[Math.floor(r() * palette.length)];
  let out = trunk + sh(blob(x, cy, rr, 7, seed), col, 1.1, 0.85) + wa(`M${f(x + rr * 0.1)},${f(cy - rr)}A${f(rr)},${f(rr)} 0 0 1 ${f(x + rr * 0.2)},${f(cy + rr * 0.9)}Z`, SHADE, 0.32);
  if (seas === 'spring') for (let i = 0; i < 3; i++) out += `<circle cx="${f(x + (r() - 0.5) * rr * 1.2)}" cy="${f(cy + (r() - 0.5) * rr * 1.1)}" r="${f(1.4 * s)}" fill="#EBB9C6"/>`;
  return out;
}

function mountainGlyph(x, y, h, w, seas, seed) {
  const r = rng(seed);
  const px = x + (r() - 0.5) * w * 0.18;
  const py = y - h;
  const l = [x - w / 2, y];
  const rt = [x + w / 2, y];
  const sh1 = [x - w * 0.22, y - h * 0.5 + (r() - 0.5) * 4];
  const sh2 = [x + w * 0.24, y - h * 0.46 + (r() - 0.5) * 4];
  const out = [];
  out.push(wa(`M${f(l[0])},${f(l[1])}L${f(sh1[0])},${f(sh1[1])}L${f(px)},${f(py)}L${f(sh2[0])},${f(sh2[1])}L${f(rt[0])},${f(rt[1])}Z`, '#EAD7AE', 0.85));
  out.push(wa(`M${f(px)},${f(py)}L${f(sh2[0])},${f(sh2[1])}L${f(rt[0])},${f(rt[1])}L${f(px + w * 0.06)},${f(y)}Z`, SHADE, 0.55));
  if (seas === 'winter') out.push(wa(`M${f(px)},${f(py)}L${f(px + w * 0.15)},${f(py + h * 0.3)}L${f(px + w * 0.04)},${f(py + h * 0.24)}L${f(px - w * 0.06)},${f(py + h * 0.33)}L${f(px - w * 0.13)},${f(py + h * 0.27)}Z`, '#FBF8F0', 0.95));
  out.push(ln(`M${f(l[0])},${f(l[1])}L${f(sh1[0])},${f(sh1[1])}L${f(px)},${f(py)}L${f(sh2[0])},${f(sh2[1])}L${f(rt[0])},${f(rt[1])}`, 1.6));
  // shading hatches on the shadow face
  const n = 3 + Math.floor(h / 14);
  let hd = '';
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const ax = px + (rt[0] - px) * t;
    const ay = py + (rt[1] - py) * t;
    hd += `M${f(ax)},${f(ay)}L${f(ax - w * 0.1)},${f(ay + h * 0.2)}`;
  }
  out.push(ln(hd, 0.9, INK_SOFT, 0.75));
  out.push(ln(`M${f(px)},${f(py + 3)}L${f(px + w * 0.05)},${f(y - h * 0.18)}`, 0.9, INK_SOFT, 0.6));
  return out.join('');
}

function hillGlyph(x, y, w, h, seed) {
  const r = rng(seed);
  const out = wa(`M${f(x - w / 2)},${f(y)}Q${f(x)},${f(y - h * 2)} ${f(x + w / 2)},${f(y)}Z`, '#B9B97E', 0.35) + ln(`M${f(x - w / 2)},${f(y)}Q${f(x)},${f(y - h * 2)} ${f(x + w / 2)},${f(y)}`, 1.3);
  let hd = '';
  for (let i = 0; i < 3; i++) {
    const t = 0.58 + i * 0.12 + r() * 0.04;
    const ax = x - w / 2 + w * t;
    const ay = y - h * 2 * 2 * t * (1 - t) * 0.98;
    hd += `M${f(ax)},${f(ay + 1.5)}L${f(ax - 2)},${f(y - 1)}`;
  }
  return out + ln(hd, 0.8, INK_SOFT, 0.7);
}

// ------------------------------------------------------------------ town icons
// Local coordinates: ground center at 0,0; icons rise to about y -85.

const ICONS = {
  town(seas) {
    const tree = MEMORY_TREE;
    const canopy = seas === 'winter' ? '#D8D2C2' : seas === 'autumn' ? '#D0923F' : '#86A35E';
    return (
      wa('M-58,4Q0,14 52,4Q0,-8 -58,4Z', '#A9B47E', 0.45) +
      // the Memory Tree with its lanterns
      ln(`M${tree[0]},${tree[1]}L${tree[0]},${tree[1] - 16}M${tree[0]},${tree[1] - 12}L${tree[0] - 6},${tree[1] - 20}`, 1.8) +
      sh(blob(tree[0], tree[1] - 28, 15, 9, 77), canopy, 1.3, 0.9) +
      wa(`M${tree[0] + 2},${tree[1] - 43}A15,15 0 0 1 ${tree[0] + 3},${tree[1] - 14}Z`, SHADE, 0.3) +
      dot(tree[0] - 8, tree[1] - 24, 2.2, '#F4D58A', 0.8) +
      dot(tree[0] + 6, tree[1] - 30, 2.2, '#F4D58A', 0.8) +
      dot(tree[0] - 2, tree[1] - 37, 2.2, '#F4D58A', 0.8) +
      dot(tree[0] + 8, tree[1] - 20, 2, '#F4D58A', 0.8) +
      // houses inside the wall
      house(-26, -4, 14, 12, ROOF, 3) +
      house(-12, -7, 15, 15, '#C98A4A', 4) +
      house(22, -5, 14, 11, ROOF, 5) +
      // the slim white tower
      sh('M3,-5L5,-64L15,-64L17,-5Z', '#F6F1E4', 1.4) +
      wa('M10.5,-64L15,-64L17,-5L11,-5Z', SHADE, 0.3) +
      sh('M2,-63L10,-86L18,-63Z', ROOF, 1.4) +
      wa('M10,-86L18,-63L11,-63Z', ROOF_DK, 0.5) +
      ln('M10,-52L10,-46M10,-34L10,-29', 1.4) +
      ln('M10,-86L10,-95', 1.1) +
      sh('M10,-95L19,-93L10,-90Z', '#E2B04B', 0.9) +
      // the low wall around it
      sh('M-36,3Q0,10 42,3L42,-6Q0,1 -36,-6Z', '#E6D6AE', 1.4) +
      ln('M-30,-5.5L-30,-9M-20,-3.5L-20,-7M-10,-2.5L-10,-6M0,-2L0,-5.5M10,-2.5L10,-6M20,-3L20,-6.5M30,-4L30,-7.5M38,-5.5L38,-9', 1.3) +
      sh('M4,7.8L4,2Q8,-3 12,2L12,7.6Z', '#6E5038', 1.1)
    );
  },
  campus() {
    let cols = '';
    for (let i = 0; i < 6; i++) {
      const x = -22 + i * 8.8;
      cols += sh(`M${f(x - 1.6)},-8L${f(x - 1.6)},-33L${f(x + 1.6)},-33L${f(x + 1.6)},-8Z`, '#F3E9D0', 1);
    }
    return (
      // dome behind
      sh('M-11,-50L-11,-60L11,-60L11,-50Z', STONE_DK, 1.3) +
      sh('M-13,-60Q-13,-79 0,-80Q13,-79 13,-60Z', DOME, 1.4) +
      wa('M2,-80Q13,-79 13,-60L4,-60Z', SHADE, 0.45) +
      ln('M-6,-62Q-5,-74 0,-78M6,-62Q5,-74 1,-78', 0.8, INK_SOFT) +
      sh('M-2.5,-80L-2.5,-86L2.5,-86L2.5,-80Z', DOME, 1) +
      // wings
      sh('M-46,-4L-46,-27L-28,-27L-28,-4Z', '#E7CF9F', 1.3) +
      sh('M28,-4L28,-27L46,-27L46,-4Z', '#E7CF9F', 1.3) +
      wa('M38,-4L38,-27L46,-27L46,-4Z', SHADE, 0.35) +
      ln('M-42,-21L-42,-11M-37,-21L-37,-11M-32,-21L-32,-11M32,-21L32,-11M37,-21L37,-11M42,-21L42,-11', 1.6, INK_SOFT) +
      sh('M-48,-27L-46,-31L-28,-31L-28,-27ZM28,-27L28,-31L46,-31L48,-27Z', ROOF_DK, 1.1, 0.8) +
      // hall body behind the columns
      sh('M-28,-6L-28,-36L28,-36L28,-6Z', '#E9D3A4', 1.3) +
      wa('M8,-6L8,-36L28,-36L28,-6Z', SHADE, 0.3) +
      cols +
      // entablature and the green copper pediment
      sh('M-30,-33L30,-33L30,-38L-30,-38Z', '#EBDDBC', 1.2) +
      sh('M-32,-38L0,-52L32,-38Z', COPPER, 1.4) +
      wa('M0,-52L32,-38L2,-38Z', '#4F7E6E', 0.35) +
      // wide staircase
      sh('M-36,-8L36,-8L40,0L-40,0Z', '#E3D3AE', 1.3) +
      ln('M-38,-4L38,-4', 0.9, INK_SOFT)
    );
  },
  bobino() {
    return (
      // white shade sails over the terrace
      ln('M-62,0L-62,-28M-44,0L-44,-30', 1.3) +
      sh('M-63,-27L-43,-31L-50,-20Z', '#FBF7EE', 1.1) +
      sh('M-60,-23L-44,-29L-47,-17Z', '#F5EEDF', 1.1) +
      dot(-56, -6, 2.6, '#D9C7A0', 0.9) +
      dot(-50, -4, 2.6, '#D9C7A0', 0.9) +
      // chimney and steam
      sh('M14,-30L14,-38L20,-38L20,-30Z', '#C98E7E', 1.1) +
      ln('M17,-41Q13,-46 18,-50Q23,-54 18,-59', 1.1, INK_SOFT, 0.8) +
      // the curved corner building
      sh('M-38,0L-38,-29L22,-29Q38,-29 38,-14L38,0Z', '#EFE2C8', 1.5) +
      sh('M-38,-29L22,-29Q38,-29 38,-14L38,-12Q36,-21 22,-21L-38,-21Z', '#D99A8E', 1.3) +
      ln('M-30,-25L-26,-25M-18,-26L-14,-26M-6,-24L-2,-24M6,-26L10,-26M18,-25L22,-25M29,-21L32,-19', 0.8, '#8A4F44') +
      // glass garage doors with warm light inside
      sh('M-34,0L-34,-17L-21,-17L-21,0ZM-18,0L-18,-17L-5,-17L-5,0ZM-2,0L-2,-17L11,-17L11,0Z', '#2F4A4E', 1.4) +
      wa('M-33,-1L-33,-9L-22,-9L-22,-1ZM-17,-1L-17,-11L-6,-11L-6,-1ZM-1,-1L-1,-8L10,-8L10,-1Z', '#F0C878', 0.75) +
      ln('M-34,-8.5L-21,-8.5M-18,-8.5L-5,-8.5M-2,-8.5L11,-8.5M-27.5,-17L-27.5,0M-11.5,-17L-11.5,0M4.5,-17L4.5,0', 0.9) +
      sh('M15,0L15,-17Q30,-17 34,-6L34,0Z', '#2F4A4E', 1.3) +
      wa('M16,-1L16,-10Q27,-10 32,-4L32,-1Z', '#F0C878', 0.7) +
      wa('M22,0L22,-29Q38,-29 38,-14L38,0Z', SHADE, 0.22) +
      ln('M-38,-29L22,-29Q38,-29 38,-14', 2)
    );
  },
  tower() {
    return (
      // rocky ridge
      sh('M-34,6Q-30,-6 -18,-8Q-10,-14 0,-10Q12,-15 22,-7Q32,-4 34,6Z', '#D9CBA8', 1.4) +
      wa('M2,-10Q12,-15 22,-7Q32,-4 34,6L6,6Z', SHADE, 0.5) +
      ln('M-20,0L-14,-4M-6,2L0,-3M14,0L20,-4', 0.9, INK_SOFT) +
      // tapered watchtower
      sh('M-11,-8L-7,-70L7,-70L11,-8Z', '#D6D2C8', 1.5) +
      wa('M1,-70L7,-70L11,-8L2,-8Z', SHADE, 0.45) +
      ln('M-10,-24L10,-24M-9,-42L9,-42M-8,-58L8,-58', 0.8, INK_SOFT, 0.7) +
      sh('M-4,-8L-4,-16Q0,-21 4,-16L4,-8Z', '#6E5038', 1.1) +
      ln('M0,-33L0,-28M0,-52L0,-47', 1.6) +
      // crenellated top
      sh('M-12,-70L12,-70L12,-78L9,-78L9,-75L5,-75L5,-78L2,-78L2,-75L-2,-75L-2,-78L-5,-78L-5,-75L-9,-75L-9,-78L-12,-78Z', '#DCD7CC', 1.3) +
      // signal fire basin
      `<ellipse cx="-6" cy="-83" rx="7" ry="5" fill="#F2C35E" fill-opacity="0.35"/>` +
      ln('M-6,-78L-6,-80', 1.3) +
      sh('M-9,-81Q-6,-91 -3,-81Z', '#E9A44E', 1) +
      // banner pole with gold and blue cloth
      ln('M7,-78L7,-98', 1.3) +
      sh('M7,-97L20,-94L16,-91L20,-88L7,-88Z', '#E2B04B', 1.1) +
      wa('M7,-91L18,-90L20,-88L7,-88Z', '#6F87A8', 0.85)
    );
  },
  home(seas) {
    const canopy = seas === 'winter' ? null : seas === 'autumn' ? '#D2843A' : seas === 'spring' ? '#9DB46C' : '#7E9C5A';
    let tree = ln('M24,2L24,-24M24,-14L17,-22M24,-18L31,-27', 2);
    if (canopy) tree += sh(blob(24, -34, 15, 9, 31), canopy, 1.3, 0.9) + wa('M26,-49A15,15 0 0 1 27,-20Z', SHADE, 0.3);
    else tree += ln('M24,-24L18,-38M24,-26L30,-40M24,-24L25,-44', 1.2, INK_SOFT);
    return (
      wa('M-34,4Q0,12 40,4Q0,-6 -34,4Z', '#A9B47E', 0.45) +
      // chimney and smoke
      sh('M2,-30L2,-40L8,-40L8,-27Z', '#CDBB98', 1.1) +
      ln('M5,-43Q1,-48 6,-52Q11,-56 6,-61', 1.1, INK_SOFT, 0.8) +
      // cottage
      sh('M-24,0L-24,-20L8,-20L8,0Z', '#F1E6CC', 1.4) +
      wa('M-2,0L-2,-20L8,-20L8,0Z', SHADE, 0.3) +
      sh('M-28,-19L-8,-38L12,-19Z', '#A8613F', 1.4) +
      wa('M-8,-38L12,-19L-6,-19Z', ROOF_DK, 0.5) +
      // reading window with the lamp lit
      sh('M-19,-14L-19,-6L-11,-6L-11,-14Z', '#F2C870', 1.1) +
      ln('M-15,-14L-15,-6M-19,-10L-11,-10', 0.8) +
      sh('M-3,0L-3,-11L3,-11L3,0Z', '#7A5A40', 1.1) +
      tree +
      // little gate and fence
      ln('M-34,6L-34,-2M-30,6L-30,-2M-36,0L-26,0', 1)
    );
  },
  kitchen() {
    return (
      wa('M-40,4Q0,12 40,4Q0,-6 -40,4Z', '#A9B47E', 0.45) +
      sh('M14,-32L14,-44L21,-44L21,-26Z', '#BFAE8A', 1.1) +
      ln('M17,-47Q13,-52 18,-56Q23,-60 18,-65', 1.1, INK_SOFT, 0.8) +
      ln('M20,-46Q24,-50 21,-54', 0.9, INK_SOFT, 0.6) +
      // fieldstone farmhouse
      sh('M-30,0L-30,-22L30,-22L30,0Z', '#E4D6B6', 1.5) +
      wa('M8,0L8,-22L30,-22L30,0Z', SHADE, 0.3) +
      ln('M-26,-4Q-24,-6 -22,-4M-14,-15Q-12,-17 -10,-15M18,-6Q20,-8 22,-6M-24,-17Q-22,-19 -20,-17M22,-16Q24,-18 26,-16M-6,-4Q-4,-6 -2,-4', 0.8, INK_SOFT) +
      sh('M-34,-21L0,-44L34,-21Z', '#B98B4E', 1.5) +
      wa('M0,-44L34,-21L2,-21Z', ROOF_DK, 0.45) +
      ln('M-20,-30L20,-30M-12,-36L12,-36', 0.9, '#6E4C2C') +
      // window with a steaming pot, herb pots on the sill
      sh('M-20,-16L-20,-7L-8,-7L-8,-16Z', '#F2C870', 1.1) +
      ln('M-14,-16L-14,-7', 0.8) +
      dot(-18, -8.5, 1.8, '#7FA05E', 0.7) +
      dot(-10, -8.5, 1.8, '#7FA05E', 0.7) +
      sh('M2,0L2,-13L10,-13L10,0Z', '#7A5A40', 1.1) +
      // the meal slate by the door
      sh('M14,-4L14,-14L22,-14L22,-4Z', '#4D5A5C', 1) +
      // basket of vegetables
      sh('M-40,0L-38,-6L-31,-6L-29,0Z', '#C9A065', 1) +
      dot(-36, -7, 1.8, '#E19A47', 0.7) +
      dot(-33, -7.5, 1.8, '#8FAA5E', 0.7)
    );
  },
  gym() {
    return (
      // bath house steam behind
      sh('M24,-26L24,-36L40,-36L40,-26Z', '#DCCBA6', 1.1) +
      sh('M22,-35L32,-42L42,-35Z', ROOF, 1.1) +
      ln('M28,-45Q24,-50 29,-54M35,-46Q39,-51 35,-56', 1, INK_SOFT, 0.75) +
      // fort walls
      sh('M-40,0L-40,-24L40,-24L40,0Z', '#D9D0BC', 1.5) +
      wa('M12,0L12,-24L40,-24L40,0Z', SHADE, 0.35) +
      ln('M-36,-24L-36,-28L-30,-28L-30,-24M-22,-24L-22,-28L-16,-28L-16,-24M16,-24L16,-28L22,-28L22,-24M30,-24L30,-28L36,-28L36,-24', 1.3) +
      // corner towers
      sh('M-48,2L-48,-34L-34,-34L-34,2Z', '#E1D8C4', 1.5) +
      sh('M-50,-34L-50,-40L-46,-40L-46,-37L-43,-37L-43,-40L-39,-40L-39,-37L-36,-37L-36,-40L-32,-40L-32,-34Z', '#E1D8C4', 1.2) +
      sh('M34,2L34,-34L48,-34L48,2Z', '#D3C9B3', 1.5) +
      wa('M41,2L41,-34L48,-34L48,2Z', SHADE, 0.4) +
      sh('M32,-34L32,-40L36,-40L36,-37L39,-37L39,-40L43,-40L43,-37L46,-37L46,-40L50,-40L50,-34Z', '#D3C9B3', 1.2) +
      ln('M-41,-22L-41,-16M41,-22L41,-16', 1.6) +
      // gate with the banner of three shields
      sh('M-8,0L-8,-13Q0,-21 8,-13L8,0Z', '#6E5038', 1.3) +
      sh('M-17,-23L17,-23L15,-15L-15,-15Z', '#A7B8C9', 1, 0.9) +
      `<g class="sm-shields">` +
      [-10, 0, 10].map((x, i) => `<circle class="sm-shield" data-i="${i}" cx="${x}" cy="-19" r="3.6" fill="${PAPER_HI}" stroke="${INK}" stroke-width="1"/>`).join('') +
      `</g>` +
      // training dummy in the yard
      ln('M-58,2L-58,-14M-63,-10L-53,-10', 1.4) +
      dot(-58, -17, 3, '#D9C39A', 1)
    );
  },
  market() {
    let stripes = '';
    for (let i = 0; i < 8; i++) {
      const x = -40 + i * 10;
      stripes += wa(`M${x},-20L${x + 10},-20L${x + 10},-14Q${x + 5},-11 ${x},-14Z`, i % 2 ? '#F1E6CF' : '#C9743F', 0.95);
    }
    return (
      wa('M-50,4Q0,12 50,4Q0,-6 -50,4Z', '#BDB389', 0.4) +
      // posts
      ln('M-38,0L-38,-20M-13,0L-13,-20M13,0L13,-20M38,0L38,-20', 1.5) +
      // crates with fruit, bread and grain
      sh('M-34,0L-34,-7L-20,-7L-20,0Z', '#C9A065', 1) +
      dot(-31, -8.5, 2, '#E39A45', 0.7) + dot(-27, -9, 2, '#D9B24A', 0.7) + dot(-23, -8.5, 2, '#9DB05E', 0.7) +
      sh('M-8,0L-8,-8L8,-8L8,0Z', '#C9A065', 1) +
      dot(-4, -9.5, 2.2, '#D7A65A', 0.7) + dot(1, -10, 2.2, '#D7A65A', 0.7) +
      sh('M20,0Q18,-9 25,-10Q32,-9 30,0Z', '#E3D1A4', 1) +
      // big brass scale
      ln('M34,-2L34,-12M28,-12L40,-12', 1.1) +
      ln('M28,-12L27,-8M40,-12L41,-8', 0.8) +
      // the wide timber roof
      sh('M-48,-19L-28,-38L28,-38L48,-19Z', '#B9875A', 1.6) +
      wa('M8,-38L28,-38L48,-19L14,-19Z', ROOF_DK, 0.4) +
      ln('M-38,-28L38,-28M-20,-38L-24,-19M0,-38L0,-19M20,-38L24,-19', 0.8, '#6E4C2C', 0.8) +
      stripes +
      ln('M-40,-20L40,-20', 1.4) +
      // loaded hand cart
      sh('M44,-2L44,-8L56,-8L56,-2Z', '#C9A065', 1) +
      dot(48, 0, 3, 'none', 1.1) +
      ln('M56,-6L62,-10', 1.1)
    );
  },
  vault() {
    return (
      wa('M-42,4Q0,12 42,4Q0,-6 -42,4Z', '#B1AE88', 0.45) +
      // guard tower
      sh('M14,0L14,-44L30,-44L30,0Z', '#C9C5BA', 1.5) +
      wa('M22,0L22,-44L30,-44L30,0Z', SHADE, 0.45) +
      sh('M12,-44L12,-50L16,-50L16,-47L20,-47L20,-50L24,-50L24,-47L28,-47L28,-50L32,-50L32,-44Z', '#C9C5BA', 1.2) +
      ln('M22,-36L22,-30', 1.6) +
      // thick battered walls
      sh('M-32,0L-28,-28L18,-28L20,0Z', '#D4D0C4', 1.7) +
      wa('M4,0L4,-28L18,-28L20,0Z', SHADE, 0.32) +
      ln('M-30,-14L19,-14M-29,-21L18,-21M-18,-28L-18,-21M-4,-21L-4,-14M10,-14L10,0M-20,-14L-20,-7', 0.8, INK_SOFT, 0.6) +
      // small barred window
      sh('M6,-25L6,-19L12,-19L12,-25Z', '#3E4B4F', 1) +
      ln('M8,-25L8,-19M10,-25L10,-19', 0.7, '#D4D0C4') +
      // heavy iron bound door with a key
      sh('M-17,0L-17,-14Q-9,-23 -1,-14L-1,0Z', '#6A4E36', 1.5) +
      ln('M-17,-7L-1,-7', 1.1) +
      `<circle cx="-9" cy="-12" r="2.2" fill="none" stroke="${GOLD}" stroke-width="1.3"/>` +
      ln('M-9,-10L-9,-3M-9,-5L-7,-5', 1.3, GOLD) +
      // lantern by the door
      ln('M-22,-18L-22,-10', 0.9) +
      dot(-22, -9, 2.2, '#F2C870', 0.9)
    );
  },
  fields() {
    let lights = '';
    for (const [a, b] of [[-46, -6], [-6, 34]]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([a + (b - a) * t, -30 + Math.sin(Math.PI * t) * 7]);
      }
      lights += ln(`M${a},-30Q${(a + b) / 2},-16 ${b},-30`, 0.8);
      for (let i = 1; i < 6; i++) lights += `<circle cx="${f(pts[i][0])}" cy="${f(pts[i][1] + 0.5)}" r="1.9" fill="#F4D07A" stroke="${INK}" stroke-width="0.6"/>`;
    }
    return (
      // soccer field in gentle perspective
      sh('M-52,6L-40,-12L44,-12L56,6Z', '#A9BD7C', 1.4, 0.8) +
      ln('M2,6L2,-12', 1, '#F6F1E4') +
      `<ellipse cx="2" cy="-3" rx="8" ry="3.4" fill="none" stroke="#F6F1E4" stroke-width="1"/>` +
      ln('M-49,1L-41,1L-38,-7L-44,-7M53,1L45,1L42,-7L48,-7', 0.9, '#F6F1E4') +
      // poles and string lights
      ln('M-46,-12L-46,-32M-6,-12L-6,-32M34,-12L34,-32', 1.4) +
      lights +
      // little wooden stage
      sh('M38,-12L38,-18L58,-18L58,-12Z', '#B98B58', 1.2) +
      sh('M40,-18L40,-30L56,-30L56,-18', 'none', 1.1) +
      sh('M37,-30L48,-36L59,-30Z', ROOF, 1.1) +
      // café kiosk
      sh('M-66,-2L-66,-14L-54,-14L-54,-2Z', '#E9DAB8', 1.1) +
      sh('M-68,-14L-60,-19L-52,-14Z', '#C9743F', 1) +
      // flower patch
      dot(-30, 9, 1.6, '#E6B4C2', 0.6) + dot(-24, 10.5, 1.6, '#F2D07A', 0.6) + dot(-18, 9, 1.6, '#C9A7E8', 0.6)
    );
  },
  lighthouse() {
    return (
      // grassy cliff
      sh('M-30,6Q-26,-4 -12,-6L22,-6Q30,-2 30,6Z', '#B9B67E', 1.4) +
      wa('M8,-6L22,-6Q30,-2 30,6L10,6Z', SHADE, 0.45) +
      // light beam
      wa('M6,-70L44,-82L44,-62Z', '#F4D07A', 0.35) +
      wa('M-6,-70L-40,-84L-40,-60Z', '#F4D07A', 0.22) +
      // white tower with ochre bands
      sh('M-8,-6L-5,-62L5,-62L8,-6Z', '#F8F4EA', 1.5) +
      wa('M-7.2,-24L7.2,-24L6.8,-32L-6.8,-32ZM-6.1,-44L6.1,-44L5.7,-51L-5.7,-51Z', '#D69A55', 0.8) +
      wa('M1,-62L5,-62L8,-6L2,-6Z', SHADE, 0.3) +
      ln('M0,-16L0,-12', 1.4) +
      // gallery and lamp room
      ln('M-9,-62L9,-62', 1.8) +
      sh('M-5,-63L-5,-71L5,-71L5,-63Z', '#F2C870', 1.3) +
      ln('M0,-63L0,-71', 0.8) +
      sh('M-7,-71Q0,-80 7,-71Z', '#5E6E70', 1.3) +
      ln('M0,-78L0,-82', 1.1) +
      // timber studio cottage with an easel
      sh('M-28,-6L-28,-18L-12,-18L-12,-6Z', '#D9B58A', 1.2) +
      sh('M-31,-17L-20,-26L-9,-17Z', ROOF_DK, 1.2) +
      sh('M-24,-15L-24,-10L-18,-10L-18,-15Z', '#F2C870', 0.9) +
      ln('M-36,-6L-33,-16L-30,-6M-36,-14L-30,-14', 0.9)
    );
  },
};

const SYMBOLS = {
  compass: () => `<circle cx="0" cy="0" r="6" fill="none" stroke="${INK}" stroke-width="1.1"/>` + sh('M0,-5L1.6,0L0,5L-1.6,0Z', GOLD_DEEP, 0.7),
  book: () => sh('M0,-3Q-4,-6 -7,-4L-7,5Q-4,3 0,6Q4,3 7,5L7,-4Q4,-6 0,-3Z', PAPER_HI, 1) + ln('M0,-3L0,6', 0.9),
  cup: () => sh('M-5,-2L5,-2L4,5L-4,5Z', PAPER_HI, 1) + ln('M5,0Q8,1 4.6,3.6', 1) + ln('M-1,-4Q-3,-6 -1,-8M2,-4Q0,-6 2,-8', 0.8),
  scroll: () => sh('M-6,-4L5,-4L5,4L-6,4Z', PAPER_HI, 1) + `<circle cx="-6" cy="0" r="2.4" fill="${PAPER_HI}" stroke="${INK}" stroke-width="1"/><circle cx="6" cy="0" r="2.4" fill="${PAPER_HI}" stroke="${INK}" stroke-width="1"/>`,
  moon: () => sh('M2,-6A6,6 0 1 0 6,3A5,5 0 0 1 2,-6Z', '#F2D899', 1),
  pot: () => sh('M-6,-2L6,-2L5,5L-5,5Z', '#B98B58', 1) + ln('M-6,0L-8,0M6,0L8,0M-3,-4L3,-4', 1),
  shield: () => sh('M-5,-6L5,-6L5,0Q5,5 0,7Q-5,5 -5,0Z', '#A7B8C9', 1) + ln('M0,-6L0,7', 0.8),
  basket: () => sh('M-7,-1L7,-1L5,6L-5,6Z', '#C9A065', 1) + ln('M-5,-1Q0,-9 5,-1', 1),
  key: () => `<circle cx="-3.5" cy="0" r="3" fill="none" stroke="${INK}" stroke-width="1.2"/>` + ln('M-0.5,0L7,0M5,0L5,3M3,0L3,2.5', 1.2),
  flag: () => ln('M-4,7L-4,-7', 1.2) + sh('M-4,-7L6,-4.5L-4,-1Z', '#D69A55', 1),
  lamp: () => sh('M-3,-3L3,-3L4,4L-4,4Z', '#F2C870', 1) + ln('M-2,-3L0,-6L2,-3M-7,0L-5.5,0M5.5,0L7,0M-5.5,-4.5L-4.5,-3.5M5.5,-4.5L4.5,-3.5', 0.9),
};

const EXTRAS = {
  wagon: () =>
    wa('M-18,3Q0,7 18,3Q0,-1 -18,3Z', '#7C6A50', 0.3) +
    sh('M-14,-5L14,-5L14,-13L-14,-13Z', '#A8774C', 1.3) +
    sh('M-13,-13Q-13,-28 0,-29Q13,-28 13,-13Z', '#F3EADA', 1.3) +
    ln('M-6,-14Q-6,-25 0,-28M6,-14Q6,-25 0,-28', 0.8, INK_SOFT) +
    ln('M-14,-9L14,-9', 0.9, GOLD_DEEP) +
    `<circle cx="-8" cy="-3" r="4.5" fill="${PAPER_HI}" stroke="${INK}" stroke-width="1.2"/><circle cx="8" cy="-3" r="4.5" fill="${PAPER_HI}" stroke="${INK}" stroke-width="1.2"/>` +
    ln('M-8,-7.5L-8,1.5M-12.5,-3L-3.5,-3M8,-7.5L8,1.5M3.5,-3L12.5,-3', 0.7) +
    ln('M14,-7L24,-3', 1.2),
  workshop: () =>
    // the odd little Idea Workshop: a crooked hut, a round window, a pinwheel
    wa('M-26,4Q0,10 26,4Q0,-4 -26,4Z', '#A9B47E', 0.4) +
    sh('M-14,0L-16,-20L10,-23L13,0Z', '#E8D2A6', 1.4) +
    wa('M2,0L2,-22L10,-23L13,0Z', SHADE, 0.32) +
    sh('M-20,-18L-4,-38L14,-21Z', '#9D7BB0', 1.4, 0.85) +
    `<circle cx="-4" cy="-11" r="4" fill="#F2C870" stroke="${INK}" stroke-width="1.1"/>` +
    ln('M-4,-15L-4,-7M-8,-11L0,-11', 0.7) +
    sh('M5,0L5,-8L10,-8L10,0Z', '#7A5A40', 1) +
    ln('M8,-30L9,-36Q11,-41 7,-43Q3,-45 4,-49Q5,-52 9,-52', 1.1, INK_SOFT, 0.8) +
    ln('M-4,-38L-5,-46', 1) +
    sh('M-5,-46L-1,-52L-3,-46Z M-5,-46L1,-44L-5,-44Z M-5,-46L-9,-40L-7,-46Z M-5,-46L-11,-48L-5,-48Z', '#E2B04B', 0.8),
  ruins: () =>
    wa('M-34,4Q0,10 34,4Q0,-4 -34,4Z', '#A9B47E', 0.4) +
    sh('M-24,2L-24,-22L-16,-22L-16,2Z', '#D8D2C2', 1.3) +
    sh('M-26,-22L-14,-22L-14,-26L-26,-26Z', '#D8D2C2', 1.1) +
    sh('M-16,-18Q-6,-30 6,-22L6,-17Q-5,-24 -16,-13Z', '#D8D2C2', 1.2) +
    sh('M8,2L8,-12L11,-15L14,-11L15,2Z', '#D8D2C2', 1.3) +
    wa('M11,2L11,-14L14,-11L15,2Z', SHADE, 0.4) +
    sh('M20,2L22,-3L29,-3L30,2Z', '#D8D2C2', 1) +
    sh('M-6,2L-4,-2L2,-1L2,2Z', '#D8D2C2', 0.9) +
    ln('M-20,-8L-20,-4M-22,-15L-18,-15', 0.7, INK_SOFT) +
    dot(-28, 4, 1.7, '#E6B4C2', 0.6) + dot(-11, 4, 1.7, '#F2D07A', 0.6) + dot(4, 5, 1.7, '#C9A7E8', 0.6) + dot(18, 4, 1.7, '#E6B4C2', 0.6) + dot(26, 6, 1.7, '#F2D07A', 0.6),
  lantern: () =>
    ln('M0,4L0,-30M0,-28L9,-28', 1.4) +
    ln('M8,-28L8,-24', 0.9) +
    `<circle class="sm-glow" cx="8" cy="-18" r="13" fill="url(#sm-lamp)"/>` +
    sh('M5,-24L11,-24L12.5,-15L8,-12L3.5,-15Z', '#F4C866', 1.1) +
    ln('M5,-24L8,-26.5L11,-24', 0.9),
};

// ------------------------------------------------------------------ static art

function defsSVG() {
  return `<defs>
  <filter id="sm-paper" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.0042" numOctaves="4" seed="11" result="st"/>
    <feColorMatrix in="st" type="matrix" values="0 0 0 0 0.56  0 0 0 0 0.40  0 0 0 0 0.22  1.4 0 0 0 -0.62" result="stain"/>
    <feTurbulence type="turbulence" baseFrequency="0.035" numOctaves="3" seed="5" result="fa"/>
    <feColorMatrix in="fa" type="matrix" values="0 0 0 0 0.99  0 0 0 0 0.96  0 0 0 0 0.88  -4 0 0 0 0.55" result="fibA"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.14 0.03" numOctaves="2" seed="9" result="fb"/>
    <feColorMatrix in="fb" type="matrix" values="0 0 0 0 0.52  0 0 0 0 0.40  0 0 0 0 0.27  1.6 0 0 0 -1.05" result="fibB"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="2" result="gr"/>
    <feColorMatrix in="gr" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.27  0 0 0 0 0.18  0.55 0 0 0 -0.2" result="grain"/>
    <feMerge result="m"><feMergeNode in="SourceGraphic"/><feMergeNode in="stain"/><feMergeNode in="fibA"/><feMergeNode in="grain"/></feMerge>
    <feComposite in="m" in2="SourceAlpha" operator="in"/>
  </filter>
  <filter id="sm-ink" x="-3%" y="-3%" width="106%" height="106%">
    <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="sm-inkS" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="12" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.9 0 0 0 1.32" result="ga"/>
    <feComposite in="d" in2="ga" operator="in"/>
  </filter>
  <filter id="sm-wash" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="21" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" seed="8" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.1 0 0 0 1.4" result="ga"/>
    <feComposite in="d" in2="ga" operator="in"/>
  </filter>
  <filter id="sm-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="34"/></filter>
  <filter id="sm-blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  <radialGradient id="sm-halo"><stop offset="0" stop-color="#FFF6DD" stop-opacity="0.95"/><stop offset="0.55" stop-color="#F6E3B2" stop-opacity="0.5"/><stop offset="1" stop-color="#F6E3B2" stop-opacity="0"/></radialGradient>
  <radialGradient id="sm-lamp"><stop offset="0" stop-color="#FFE7A6" stop-opacity="0.95"/><stop offset="0.5" stop-color="#F4C866" stop-opacity="0.45"/><stop offset="1" stop-color="#F4C866" stop-opacity="0"/></radialGradient>
  <radialGradient id="sm-dotlit" cx="0.38" cy="0.3" r="0.75"><stop offset="0" stop-color="#FFF7E4" stop-opacity="0.85"/><stop offset="0.45" stop-color="#FFF7E4" stop-opacity="0"/><stop offset="1" stop-color="#3D4F7A" stop-opacity="0.45"/></radialGradient>
</defs>`;
}

function styleSVG() {
  return `<style>
.sm-town{cursor:pointer;outline:none}
.sm-town .sm-lift{transition:transform 150ms cubic-bezier(.2,.8,.3,1.25)}
.sm-town:hover .sm-lift,.sm-town:focus-visible .sm-lift{transform:translateY(var(--sm-lift))}
.sm-halo{opacity:0;transition:opacity 150ms ease-out;pointer-events:none}
.sm-town:hover .sm-halo,.sm-town:focus-visible .sm-halo{opacity:.42}
.sm-press{transform-box:fill-box;transform-origin:50% 100%}
.sm-focus{opacity:0;pointer-events:none}
.sm-town:focus-visible .sm-focus,.sm-bot:focus-visible .sm-focus{opacity:1}
.sm-ring{opacity:0;transition:opacity 400ms ease-out;pointer-events:none}
.sm-town.is-current .sm-ring{opacity:1}
.sm-lantern{display:none}
.sm-town.is-waiting .sm-lantern{display:inline}
.sm-label{font-family:${FONT};font-style:italic;font-size:var(--sm-fl);fill:${INK};paint-order:stroke;stroke:${PAPER_HI};stroke-opacity:.9;stroke-width:var(--sm-fls);stroke-linejoin:round}
.sm-town.is-current .sm-label{fill:#2A1D14}
.sm-region{font-family:${FONT};font-variant:small-caps;font-size:var(--sm-fr);letter-spacing:var(--sm-ls);fill:${SEPIA};paint-order:stroke;stroke:${PAPER};stroke-opacity:.85;stroke-width:var(--sm-frs);stroke-linejoin:round;pointer-events:none}
.sm-minor{font-family:${FONT};font-style:italic;font-size:var(--sm-fm);fill:${INK_SOFT};paint-order:stroke;stroke:${PAPER_HI};stroke-opacity:.85;stroke-width:var(--sm-fms);stroke-linejoin:round;pointer-events:none}
.sm-mark{font-family:${FONT};font-weight:700;font-size:var(--sm-fk);paint-order:stroke;stroke:${INK};stroke-width:var(--sm-fks);stroke-linejoin:round}
.sm-bot{cursor:pointer;outline:none}
.sm-bot .sm-bob{animation:sm-bob 5.5s cubic-bezier(.45,0,.55,1) infinite}
.sm-bot:hover .sm-body{stroke-width:var(--sm-dw2)}
@keyframes sm-bob{0%,100%{transform:translateY(0)}45%{transform:translateY(var(--sm-bobY))}55%{transform:translateY(var(--sm-bobY))}}
.sm-pulse .sm-glow{animation:sm-glow 4s ease-in-out infinite}
@keyframes sm-glow{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){
 .sm-town .sm-lift{transition:none}
 .sm-town:hover .sm-lift,.sm-town:focus-visible .sm-lift{transform:none}
 .sm-halo{transition:opacity 200ms linear}
 .sm-bot .sm-bob,.sm-pulse .sm-glow{animation:none}
}
</style>`;
}

function buildStatic(geo, seas) {
  const { coast, lake, canal, roads } = geo;
  const out = [];

  // island washes: warm ground, meadows, cool heights, autumn ochre east
  const patches = [
    [520, 660, 520, '#E2C995', 0.32],
    [260, 330, 210, '#A7A6C6', 0.35],
    [470, 980, 230, '#A9BC7E', 0.32],
    [760, 980, 200, '#B5BE82', 0.28],
    [780, 620, 200, seas === 'autumn' ? '#D9A55E' : '#B9C27F', 0.26],
    [200, 680, 170, '#7E9670', 0.3],
    [590, 330, 230, '#C7D3B6', 0.22],
  ];
  out.push(`<clipPath id="sm-island"><path d="${coast.d}"/></clipPath>`);
  out.push(`<g clip-path="url(#sm-island)"><g filter="url(#sm-soft)">${patches.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="${p[3]}" fill-opacity="${p[4]}"/>`).join('')}</g></g>`);

  // coastline in ink, and a darker inner edge wash
  out.push(`<g clip-path="url(#sm-island)"><path d="${coast.d}" fill="none" stroke="#9C8156" stroke-opacity="0.28" stroke-width="22" filter="url(#sm-blur6)"/></g>`);
  out.push(`<path d="${coast.d}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" filter="url(#sm-ink)"/>`);

  // the lake
  out.push(`<g filter="url(#sm-wash)"><path d="${lake.d}" fill="${WATER}" fill-opacity="0.62"/></g>`);
  out.push(`<clipPath id="sm-lakeclip"><path d="${lake.d}"/></clipPath>`);
  out.push(`<g clip-path="url(#sm-lakeclip)"><path d="${lake.d}" fill="none" stroke="${WATER_DEEP}" stroke-opacity="0.5" stroke-width="26" filter="url(#sm-blur6)"/></g>`);
  // inner ripple rings: drawn as thin offset lines using masks
  out.push(`<mask id="sm-lakerings" maskUnits="userSpaceOnUse" x="0" y="0" width="${W0}" height="${H0}">` +
    [11, 22].map((d) => `<path d="${lake.d}" fill="none" stroke="#fff" stroke-width="${2 * d + 1.2}"/><path d="${lake.d}" fill="none" stroke="#000" stroke-width="${2 * d - 1.2}"/>`).join('') +
    `<path d="${lake.d}" fill="none" stroke="#000" stroke-width="0"/></mask>`);
  out.push(`<g clip-path="url(#sm-lakeclip)"><rect x="300" y="150" width="600" height="400" fill="${INK}" fill-opacity="0.32" mask="url(#sm-lakerings)"/></g>`);
  out.push(`<path d="${lake.d}" fill="none" stroke="${INK}" stroke-width="2" filter="url(#sm-ink)"/>`);
  // the castle islet in the lake, and its causeway to the south shore
  const c = anchor('campus');
  const islet = blob(c[0], c[1] - 8, 66, 12, 404);
  out.push(`<g filter="url(#sm-wash)"><path d="${islet}" fill="#E3D2A6" fill-opacity="0.95"/></g>`);
  out.push(`<path d="${islet}" fill="none" stroke="${INK}" stroke-width="1.8" filter="url(#sm-ink)"/>`);

  // the canal
  out.push(`<g filter="url(#sm-wash)"><path d="${canal.fill}" fill="${WATER}" fill-opacity="0.75"/></g>`);
  out.push(`<g filter="url(#sm-ink)">${ln(polyD(canal.left), 1.6)}${ln(polyD(canal.right), 1.6)}</g>`);
  let ripples = '';
  for (let i = 8; i < canal.pts.length - 4; i += 7) {
    const p = canal.pts[i];
    const q = canal.pts[i + 2];
    ripples += `M${f(p[0])},${f(p[1])}L${f(q[0])},${f(q[1])}`;
  }
  out.push(ln(ripples, 0.9, '#F4F1E6', 0.8));

  // terrain: mountains, hills, forests, the ruins and the Idea Workshop
  out.push(`<g class="sm-terrain" filter="url(#sm-inkS)">${buildTerrain(geo, seas)}</g>`);

  // roads: a trodden underlay, then ink
  let under = '';
  let ink = '';
  for (const r of roads) {
    under += `<path d="${r.d}" fill="none" stroke="#F3E6C6" stroke-opacity="0.75" stroke-width="${r.solid ? 9 : 6}" stroke-linecap="round"/>`;
    ink += r.solid
      ? `<path d="${r.d}" fill="none" stroke="${INK_SOFT}" stroke-width="2.3" stroke-linecap="round"/>`
      : `<path d="${r.d}" fill="none" stroke="${INK_SOFT}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 9"/>`;
  }
  out.push(`<g class="sm-roads">${under}<g filter="url(#sm-ink)">${ink}</g></g>`);

  // the slim white footbridge over the canal
  let bi = 0;
  let bd = Infinity;
  canal.pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - MAP.bridge.x, p[1] - MAP.bridge.y);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  const pa = canal.pts[Math.max(0, bi - 1)];
  const pb = canal.pts[Math.min(canal.pts.length - 1, bi + 1)];
  const ang = (Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180) / Math.PI + 90;
  out.push(`<g transform="translate(${MAP.bridge.x} ${MAP.bridge.y}) rotate(${f(ang)})" filter="url(#sm-inkS)">` +
    `<ellipse cx="2" cy="3" rx="22" ry="5" fill="#3D5560" fill-opacity="0.22"/>` +
    sh('M-21,-4Q0,-8 21,-4L21,4Q0,0 -21,4Z', '#FBF8F1', 1.5) +
    ln('M-17,-5L-17,-9M-9,-6.5L-9,-10.5M-1,-7L-1,-11M7,-6.8L7,-10.8M15,-5.6L15,-9.6M-18,-9Q0,-12.5 17,-9.6', 1) +
    `</g>`);
  return out.join('');
}

function buildTerrain(geo, seas) {
  const { coast, lake, canal, roads } = geo;
  const items = [];
  const placed = [];
  const blocks = [];
  // keep clear of towns and their labels
  for (const p of PLACES) {
    const a = anchor(p.id);
    const lw = Math.max(70, (p.name.length * 11.5) / 2 + 30);
    blocks.push([a[0] - lw, a[1] - 100, a[0] + lw, a[1] + 56]);
  }
  for (const r of geo.regions) blocks.push([r.box[0] - 6, r.box[1] - 2, r.box[2] + 6, r.box[3] + 4]);
  for (const [x, y] of [[MAP.workshop.x, MAP.workshop.y], [MAP.ruins.x, MAP.ruins.y]]) blocks.push([x - 50, y - 64, x + 60, y + 40]);
  const b = anchor('bridge');
  blocks.push([b[0] - 40, b[1] - 30, b[0] + 40, b[1] + 30]);

  const free = (x, y, r, overlap = 1) => {
    if (!inPoly(x, y, coast.poly) || distPoly(x, y, coast.poly, true) < r + 10) return false;
    const { x: lx, y: ly, rx, ry } = MAP.lake;
    if (((x - lx) / (rx + r + 14)) ** 2 + ((y - ly) / (ry + r + 14)) ** 2 < 1) return false;
    if (distPoly(x, y, canal.pts, false) < r + 16) return false;
    for (const rd of roads) if (distPoly(x, y, rd.g.pts, false) < r + 7) return false;
    for (const bx of blocks) if (x + r > bx[0] && x - r < bx[2] && y + r * 0.4 > bx[1] && y - r * 1.4 < bx[3]) return false;
    for (const q of placed) if (Math.hypot(q[0] - x, (q[1] - y) * 1.5) < (q[2] + r) * Math.min(overlap, q[3] || 1)) return false;
    return true;
  };
  const add = (x, y, r, svg, overlap = 1) => {
    placed.push([x, y, r, overlap]);
    items.push([y, svg]);
  };
  const R = rng(1300);

  // the northern heights: overlapping ranges, tallest in the far north
  for (let i = 0; i < 2600 && placed.length < 90; i++) {
    const x = 110 + R() * 400;
    const y = 130 + Math.pow(R(), 1.25) * 440;
    const north = 1 - (y - 130) / 440;
    const h = 14 + north * 26 + R() * 9;
    const w = h * (1.25 + R() * 0.35);
    if (free(x, y, w * 0.48, 0.62)) add(x, y, w * 0.48, mountainGlyph(x, y, h, w, seas, i + 5), 0.62);
  }
  // far peaks east of the lake
  for (let i = 0; i < 400; i++) {
    const x = 760 + R() * 100;
    const y = 200 + R() * 200;
    const h = 13 + R() * 11;
    const w = h * 1.35;
    if (free(x, y, w * 0.48, 0.66)) add(x, y, w * 0.48, mountainGlyph(x, y, h, w, seas, i + 600), 0.66);
  }
  // hills
  // hills in small rolling clusters
  const hillZones = [[640, 1150, 7], [500, 1180, 5], [700, 1040, 6], [330, 830, 6], [600, 840, 4], [260, 1160, 4], [380, 1060, 4], [880, 470, 3], [700, 760, 3]];
  let k = 0;
  for (const [zx, zy, n] of hillZones) {
    let got = 0;
    for (let i = 0; i < 300 && got < n; i++) {
      const x = zx + (R() - 0.5) * 150;
      const y = zy + (R() - 0.5) * 80;
      const w = 20 + R() * 22;
      if (free(x, y, w * 0.5, 0.55)) {
        add(x, y, w * 0.5, hillGlyph(x, y, w, w * (0.26 + R() * 0.12), k++), 0.55);
        got++;
      }
    }
  }
  // forests: the deep forest in the west, and groves elsewhere
  const groves = [
    [190, 660, 140, 210, 260, 0.82],
    [400, 260, 50, 60, 18, 0.5],
    [760, 400, 50, 50, 18, 0.3],
    [640, 470, 50, 30, 12, 0.2],
    [860, 560, 50, 60, 20, 0.3],
    [640, 960, 60, 50, 22, 0.15],
    [880, 1000, 30, 50, 10, 0.2],
    [560, 1110, 80, 50, 26, 0.3],
    [330, 1100, 70, 50, 22, 0.4],
    [340, 560, 40, 40, 14, 0.6],
    [660, 760, 40, 40, 14, 0.2],
    [400, 470, 40, 30, 10, 0.5],
  ];
  let t = 0;
  for (const [gx, gy, rx, ry, n, pineShare] of groves) {
    let got = 0;
    for (let i = 0; i < n * 30 && got < n; i++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R());
      const x = gx + Math.cos(a) * rx * d;
      const y = gy + Math.sin(a) * ry * d;
      const s = 0.85 + R() * 0.45;
      const kind = R() < pineShare ? 'pine' : 'leaf';
      if (free(x, y, 5.2 * s)) {
        add(x, y, 5.2 * s, treeGlyph(x, y, s, kind, seas, 9000 + t++));
        got++;
      }
    }
  }
  items.push([MAP.workshop.y, `<g transform="translate(${MAP.workshop.x} ${MAP.workshop.y})">${EXTRAS.workshop()}</g>`]);
  items.push([MAP.ruins.y, `<g transform="translate(${MAP.ruins.x} ${MAP.ruins.y})">${EXTRAS.ruins()}</g>`]);
  items.sort((p, q) => p[0] - q[0]);
  return items.map((i) => i[1]).join('');
}

// far islets, only seen when the band is wide; unnamed, small, a bigger world
const ISLETS = [
  [-330, 360, 74, 1], [1330, 980, 62, 2], [-250, 1060, 44, 3], [1270, 300, 40, 4], [1190, 640, 22, 5], [-140, 780, 18, 6],
  [-560, 820, 52, 7], [1560, 560, 56, 8], [1580, 1180, 30, 9], [-600, 200, 34, 10],
];

function isletSVG(x, y, r, seed, seas) {
  const R = rng(seed * 97);
  const pts = [];
  const n = 9 + Math.floor(r / 10);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.72 + R() * 0.5;
    pts.push([x + Math.cos(a) * r * k * 1.15, y + Math.sin(a) * r * k * 0.8]);
  }
  const d = smoothD(pts, true);
  let art = '';
  const count = Math.round(r / 9);
  const items = [];
  for (let i = 0; i < count * 6 && items.length < count; i++) {
    const tx = x + (R() - 0.5) * r * 1.3;
    const ty = y + (R() - 0.5) * r * 0.8;
    if (!inPoly(tx, ty, pts) || distPoly(tx, ty, pts, true) < 9) continue;
    if (items.some((q) => Math.hypot(q[0] - tx, q[1] - ty) < 11)) continue;
    items.push([tx, ty]);
  }
  items.sort((a, b) => a[1] - b[1]);
  items.forEach((q, i) => {
    art += r > 40 && i === 0 ? mountainGlyph(q[0], q[1], 18 + R() * 8, 26, seas, seed + i) : treeGlyph(q[0], q[1], 0.9, R() < 0.5 ? 'pine' : 'leaf', seas, seed * 31 + i);
  });
  return (
    `<path d="${d}" fill="none" stroke="${WATER}" stroke-opacity="0.45" stroke-width="44" filter="url(#sm-blur6)"/>` +
    `<path d="${d}" fill="#E4CF9E" fill-opacity="0.7"/>` +
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2" filter="url(#sm-ink)"/>` +
    `<g filter="url(#sm-inkS)">${art}</g>`
  );
}

function cartoucheSVG(x, y, k) {
  // a hand lettered title scroll, drawn by the captain; scaled so its text stays 13 px or more
  return (
    `<g transform="translate(${x} ${y}) scale(${f(k)})">` +
    `<g filter="url(#sm-inkS)">` +
    sh('M-150,-44Q0,-58 150,-44L150,40Q0,26 -150,40Z', PAPER_HI, 1.8, 0.92) +
    sh('M-150,-44Q-176,-40 -170,-14Q-166,6 -150,4', '#E3D3AE', 1.6) +
    sh('M150,40Q176,36 170,10Q166,-10 150,-8', '#E3D3AE', 1.6) +
    ln('M-136,-34Q0,-46 136,-34M-136,30Q0,18 136,30', 0.9, INK_SOFT, 0.7) +
    `</g>` +
    `<text x="0" y="-4" text-anchor="middle" font-family="${FONT}" font-variant="small-caps" font-size="34" letter-spacing="4" fill="${SEPIA}">The Island</text>` +
    `<text x="0" y="22" text-anchor="middle" font-family="${FONT}" font-style="italic" font-size="19" fill="${INK_SOFT}">as walked and drawn by ICON</text>` +
    `</g>`
  );
}

function scaleBarSVG(x, y, k) {
  let d = '';
  for (let i = 0; i < 4; i++) d += i % 2 ? '' : `M${i * 40},0L${(i + 1) * 40},0`;
  return (
    `<g transform="translate(${x} ${y}) scale(${f(k)})">` +
    `<g filter="url(#sm-inkS)"><path d="M0,-4L160,-4L160,4L0,4Z" fill="${PAPER_HI}" stroke="${INK}" stroke-width="1.2"/>` +
    `<path d="${d}" stroke="${INK_SOFT}" stroke-width="8"/></g>` +
    `<text x="80" y="30" text-anchor="middle" font-family="${FONT}" font-style="italic" font-size="19" fill="${INK_SOFT}">one morning's walk</text>` +
    `</g>`
  );
}

function buildSea(vb, coast, s, seas) {
  // wave strokes on a fixed world grid so they never shift when the band resizes
  const k = Math.max(1, 0.85 / s);
  const cell = Math.round(64 * k);
  let d = '';
  const x0 = Math.floor(vb.x / cell) - 1;
  const x1 = Math.ceil((vb.x + vb.w) / cell) + 1;
  const y0 = Math.floor(vb.y / cell) - 1;
  const y1 = Math.ceil((vb.y + vb.h) / cell) + 1;
  const far = (x, y) => ISLETS.every(([ix, iy, ir]) => Math.hypot((x - ix) / 1.15, (y - iy) / 0.8) > ir + 40);
  for (let gx = x0; gx < x1; gx++) {
    for (let gy = y0; gy < y1; gy++) {
      const r = rng(hash(`${gx}:${gy}:${cell}`));
      if (r() < 0.65) continue; // about half as many wave marks as before
      const x = gx * cell + r() * cell * 0.8;
      const y = gy * cell + r() * cell * 0.8;
      if (inPoly(x, y, coast.poly) || distPoly(x, y, coast.poly, true) < 50 || !far(x, y)) continue;
      const w = (6 + r() * 4) * k;
      d += `M${f(x)},${f(y)}q${f(w / 2)},${f(-w * 0.5)} ${f(w)},0q${f(w / 2)},${f(-w * 0.5)} ${f(w)},0`;
      if (r() < 0.4) d += `M${f(x + w * 0.6)},${f(y + 6 * k)}q${f(w / 2)},${f(-w * 0.45)} ${f(w)},0`;
    }
  }
  const rings = [10, 20, 33];
  const mask = `<mask id="sm-searings" maskUnits="userSpaceOnUse" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}">` +
    rings.map((r) => `<path d="${coast.d}" fill="none" stroke="#fff" stroke-width="${2 * r + 1.3}"/><path d="${coast.d}" fill="none" stroke="#000" stroke-width="${2 * r - 1.3}"/>`).join('') +
    `<path d="${coast.d}" fill="#000"/></mask>`;
  const tintMask = `<mask id="sm-seaout" maskUnits="userSpaceOnUse" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}"><rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#fff"/><path d="${coast.d}" fill="#000"/></mask>`;
  const boats = [[60, 330, 1], [952, 1190, -1], [40, 1060, 1], [-420, 980, 1], [1420, 760, -1], [1180, 1160, 1], [-200, 240, -1]].map(([x, y, dir]) =>
    `<g transform="translate(${x} ${y}) scale(${f(dir * k)} ${f(k)})" filter="url(#sm-inkS)">${sh('M-9,0L9,0L6,4L-6,4Z', '#A8774C', 1.1)}${ln('M0,0L0,-16', 1)}${sh('M1,-15L9,-2L1,-2Z', PAPER_HI, 1)}${sh('M-1,-12L-7,-2L-1,-2Z', '#F1E3C2', 0.9)}${ln('M-14,6q3,-2 6,0q3,-2 6,0', 0.8, INK_SOFT, 0.6)}</g>`,
  ).join('');
  const wide = vb.w > W0 + 2 * PAD + 10;
  let isles = '';
  if (wide) {
    for (const [x, y, r, seed] of ISLETS) if (x + r * 1.2 > vb.x && x - r * 1.2 < vb.x + vb.w) isles += isletSVG(x, y, r, seed, seas);
    const tk = Math.max(1, 13.5 / (19 * s));
    if (vb.x + vb.w > 1420) isles += scaleBarSVG(1180, 1060, tk);
  }
  return (
    `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${PAPER}" filter="url(#sm-paper)"/>` +
    coffeeSVG(972, 640, k) +
    mask + tintMask +
    `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${WATER}" fill-opacity="0.16" mask="url(#sm-seaout)"/>` +
    `<g mask="url(#sm-seaout)"><path d="${coast.d}" fill="none" stroke="${WATER}" stroke-opacity="0.42" stroke-width="84" filter="url(#sm-blur6)"/></g>` +
    `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${WATER_DEEP}" fill-opacity="0.55" mask="url(#sm-searings)"/>` +
    `<path d="${d}" fill="none" stroke="${INK_SOFT}" stroke-opacity="0.72" stroke-width="${f(1.35 * k)}" stroke-linecap="round"/>` +
    isles + boats
  );
}

// a mug was set down here once, east of Bobino Village, and the ring stayed
function coffeeSVG(x, y, k) {
  const C = '#8A6236';
  const r = rng(hash('coffee'));
  let rim = '';
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = 38 + (r() - 0.5) * 3.2 + (i > 6 && i < 11 ? 2.2 : 0);
    rim += `${i ? 'L' : 'M'}${f(x + Math.cos(a) * rr)},${f(y + Math.sin(a) * rr * 0.96)}`;
  }
  return (
    `<g aria-hidden="true">` +
    `<circle cx="${x}" cy="${y}" r="36" fill="${C}" fill-opacity="0.07"/>` +
    `<path d="${rim}Z" fill="none" stroke="${C}" stroke-opacity="0.3" stroke-width="7" filter="url(#sm-blur6)"/>` +
    `<path d="${rim}Z" fill="none" stroke="${C}" stroke-opacity="0.42" stroke-width="1.7"/>` +
    `<path d="M${x - 30},${y + 34}A40 39 0 0 1 ${x - 44},${y - 12}" fill="none" stroke="${C}" stroke-opacity="0.32" stroke-width="1.3"/>` +
    `<circle cx="${x + 46}" cy="${y + 26}" r="2.6" fill="${C}" fill-opacity="0.22"/><circle cx="${x + 53}" cy="${y + 33}" r="1.5" fill="${C}" fill-opacity="0.2"/>` +
    `<g transform="translate(${x + 4} ${y - 58}) rotate(-6) scale(${f(k)})">` +
    `<text x="0" y="0" text-anchor="middle" font-family="${FONT}" font-style="italic" font-size="17" fill="${INK_SOFT}" fill-opacity="0.85" rotate="${wobble('best bagels')}">best bagels</text>` +
    `<path d="M-46,4q-14,2 -26,10m0,0l7,-1m-7,1l2,-7" fill="none" stroke="${INK_SOFT}" stroke-opacity="0.8" stroke-width="1.1" stroke-linecap="round"/>` +
    `</g></g>`
  );
}

// the title scroll, pinned to the frame in the clear sea west of the island
function cartoucheFrame(cx, cy, scale) {
  return `<g class="sm-cart" transform="translate(${f(cx)} ${f(cy)}) rotate(-1.6)">` +
    `<ellipse rx="${f(190 * scale)}" ry="${f(64 * scale)}" fill="${PAPER}" fill-opacity="0.75" filter="url(#sm-blur6)"/>` +
    cartoucheSVG(0, 0, scale) + `</g>`;
}

function compassSVG(size) {
  const r = size / 2;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const long = i % 2 === 0;
    const L = long ? r * 0.92 : r * 0.55;
    const w = long ? r * 0.16 : r * 0.12;
    const tip = [Math.cos(a) * L, Math.sin(a) * L];
    const lft = [Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w];
    const rgt = [Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w];
    pts.push({ tip, lft, rgt, long, i });
  }
  let s = `<circle r="${f(r * 0.7)}" fill="${PAPER_HI}" fill-opacity="0.5" stroke="${INK}" stroke-width="1"/><circle r="${f(r * 0.62)}" fill="none" stroke="${INK}" stroke-width="0.6"/>`;
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16;
    const a1 = r * 0.62;
    const a2 = r * (i % 4 === 0 ? 0.52 : 0.57);
    s += `<path d="M${f(Math.cos(a) * a1)},${f(Math.sin(a) * a1)}L${f(Math.cos(a) * a2)},${f(Math.sin(a) * a2)}" stroke="${INK}" stroke-width="0.6"/>`;
  }
  for (const p of pts.filter((q) => !q.long).concat(pts.filter((q) => q.long))) {
    const fillA = p.long ? (p.i === 0 ? GOLD_DEEP : INK_SOFT) : '#9C8156';
    s += `<path d="M0,0L${f(p.lft[0])},${f(p.lft[1])}L${f(p.tip[0])},${f(p.tip[1])}Z" fill="${fillA}" stroke="${INK}" stroke-width="0.8" stroke-linejoin="round"/>`;
    s += `<path d="M0,0L${f(p.rgt[0])},${f(p.rgt[1])}L${f(p.tip[0])},${f(p.tip[1])}Z" fill="${PAPER_HI}" stroke="${INK}" stroke-width="0.8" stroke-linejoin="round"/>`;
  }
  s += `<circle r="${f(r * 0.07)}" fill="${GOLD}" stroke="${INK}" stroke-width="0.8"/>`;
  s += `<text x="0" y="${f(-r * 0.98)}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${INK}" paint-order="stroke" stroke="${PAPER_HI}" stroke-width="3">N</text>`;
  return s;
}

// ------------------------------------------------------------------ module state

let M = null;

function reducedMotion() {
  try {
    if (document.documentElement.classList.contains('reduce-motion')) return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function townAria(p, info) {
  let s = `${p.name}, ${p.specialty}`;
  if (info.waiting) s += ', waiting on you';
  if (info.wagon) s += ', the trailer wagon is here';
  if (info.current) s += ', you are here';
  return s;
}

export function mountMap(host, { onTravel, onBotTap } = {}) {
  if (!host) return;
  if (M && M.host === host) {
    M.onTravel = onTravel;
    M.onBotTap = onBotTap;
    return;
  }
  if (M) unmount();
  let seas = 'autumn';
  let per = 'day';
  try {
    seas = clockSeason();
    per = clockPeriod();
  } catch (e) { /* keep defaults */ }

  const coast = buildCoast();
  const geo = { coast, lake: buildLake(), canal: buildCanal(), roads: buildRoads(), regions: regionLayout(coast) };
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'sao-map';
  root.style.cssText = `position:relative;width:100%;height:100%;overflow:hidden;background:${PAPER};touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;contain:layout paint`;
  host.appendChild(root);

  const svg = el('svg', { xmlns: NS, role: 'group', 'aria-label': 'Map of the island. Choose a place to travel there.', overflow: 'hidden' });
  svg.style.cssText = 'position:absolute;left:0;top:0;display:block;will-change:transform;transform-origin:0 0';
  if (per === 'sunset' || per === 'night') svg.classList.add('sm-pulse');
  svg.innerHTML =
    styleSVG() + defsSVG() +
    `<g class="sm-sea" aria-hidden="true"></g>` +
    `<g class="sm-land" aria-hidden="true">${buildStatic(geo, seas)}</g>` +
    `<g class="sm-regions" aria-hidden="true"></g>` +
    `<g class="sm-minors" aria-hidden="true"></g>` +
    `<g class="sm-wagon" aria-hidden="true" style="display:none">${EXTRAS.wagon()}</g>` +
    `<g class="sm-towns"></g>` +
    `<g class="sm-bots"></g>`;
  const tint = document.createElement('div');
  tint.className = 'sm-tint';
  tint.setAttribute('aria-hidden', 'true');
  tint.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;mix-blend-mode:multiply;opacity:0;transition:opacity 2400ms ease-in-out';
  root.appendChild(tint);
  root.appendChild(svg);

  // region names and minor labels
  const regions = svg.querySelector('.sm-regions');
  for (const r of geo.regions) {
    const t = el('text', { class: 'sm-region', x: f(r.x), y: f(r.y), 'text-anchor': 'middle' }, regions);
    r.lines.forEach((line, i) => {
      const ts = el('tspan', { x: f(r.x), dy: i ? '1.1em' : '0', rotate: wobble(line, 1.8) }, t);
      ts.textContent = line;
    });
  }
  const minors = svg.querySelector('.sm-minors');
  el('text', { class: 'sm-minor', x: MAP.workshop.x + 6, y: MAP.workshop.y + 26, 'text-anchor': 'middle', rotate: wobble(SUBS.workshop.name) }, minors).textContent = SUBS.workshop.name;
  el('text', { class: 'sm-minor', x: MAP.ruins.x, y: MAP.ruins.y + 26, 'text-anchor': 'middle', rotate: wobble(SUBS.ruins.name) }, minors).textContent = SUBS.ruins.name;

  // towns
  const townsG = svg.querySelector('.sm-towns');
  const towns = {};
  for (const p of PLACES) {
    const a = anchor(p.id);
    const g = el('g', { class: 'sm-town', 'data-id': p.id, transform: `translate(${f(a[0])} ${f(a[1])})`, tabindex: '0', role: 'button', 'aria-label': townAria(p, {}) }, townsG);
    const art = ICONS[p.id] ? ICONS[p.id](seas) : '';
    const sym = SYMBOLS[p.symbol] ? SYMBOLS[p.symbol]() : '';
    g.innerHTML =
      `<circle class="sm-hit" cx="0" cy="-26" r="46" fill="${PAPER}" fill-opacity="0"/>` +
      `<circle class="sm-halo" cx="0" cy="-30" r="62" fill="url(#sm-halo)"/>` +
      `<g class="sm-ring"><circle class="sm-ring-a" cx="0" cy="-28" r="50" fill="none" stroke="${INK}"/><circle class="sm-ring-b" cx="0" cy="-28" r="50" fill="none" stroke="${GOLD_DEEP}"/><circle class="sm-ring-c" cx="0" cy="-28" r="50" fill="none" stroke="${GOLD}"/>` +
      [0, 90, 270].map((d) => `<path class="sm-tick" transform="rotate(${d} 0 -28)" d="M0,-84L-3.5,-75L3.5,-75Z" fill="${GOLD_DEEP}" stroke="${INK}" stroke-width="0.9"/>`).join('') +
      `</g>` +
      `<g class="sm-lift"><g class="sm-press" filter="url(#sm-inkS)">${art}</g></g>` +
      `<g class="sm-lantern" transform="translate(${p.id === 'fields' ? 66 : p.id === 'market' ? 58 : 48} 2) scale(1.3)">${EXTRAS.lantern()}</g>` +
      `<g class="sm-labelg"><g class="sm-sym" filter="url(#sm-inkS)">${sym}</g><text class="sm-label" x="0" y="30" text-anchor="middle" rotate="${wobble(p.name)}">${esc(p.name)}</text></g>` +
      `<rect class="sm-focus sm-focus-a" fill="none" stroke="${INK}"/><rect class="sm-focus sm-focus-b" fill="none" stroke="${GOLD}"/>`;
    const title = el('title', {}, g);
    title.textContent = `${p.name}, ${p.specialty}`;
    towns[p.id] = g;
  }

  // the burnt edges and the compass rose stay fixed to the frame
  const frame = el('svg', { xmlns: NS, 'aria-hidden': 'true', focusable: 'false' });
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible';
  frame.innerHTML = `<defs>
    <filter id="sm-burn" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="9"/></filter>
    <filter id="sm-burn2" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="19" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="2.2"/></filter>
  </defs>
  <g class="sm-cartg"></g>
  <path class="sm-burn-a" fill="#7A5232" fill-opacity="0.22" fill-rule="evenodd" filter="url(#sm-burn)"/>
  <path class="sm-burn-b" fill="#4B301D" fill-opacity="0.46" fill-rule="evenodd" filter="url(#sm-burn2)"/>
  <circle class="sm-compbg" fill="${PAPER}" fill-opacity="0.82" filter="url(#sm-blur6)"/>
  <g class="sm-compass" filter="url(#sm-inkS)"></g>`;
  root.appendChild(frame);

  M = {
    host, root, svg, frame, tint, geo, towns, seas, onTravel, onBotTap, per: null,
    s: 1, W: 0, H: 0, vb: null, tx: 0, ty: 0,
    current: null, state: null, drag: null, suppressClick: false, ro: null,
  };

  // interaction: travel
  const travel = (g) => {
    const id = g.getAttribute('data-id');
    press(g);
    if (typeof M.onTravel === 'function') M.onTravel(id);
  };
  svg.addEventListener('click', (e) => {
    if (M.suppressClick) {
      M.suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const bot = e.target.closest && e.target.closest('.sm-bot');
    if (bot) {
      if (typeof M.onBotTap === 'function') M.onBotTap(bot.getAttribute('data-id'));
      return;
    }
    const g = e.target.closest && e.target.closest('.sm-town');
    if (g) travel(g);
  });
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const bot = e.target.closest && e.target.closest('.sm-bot');
    if (bot) {
      e.preventDefault();
      if (typeof M.onBotTap === 'function') M.onBotTap(bot.getAttribute('data-id'));
      return;
    }
    const g = e.target.closest && e.target.closest('.sm-town');
    if (g) {
      e.preventDefault();
      travel(g);
    }
  });
  svg.addEventListener('focusin', (e) => {
    const g = e.target.closest && (e.target.closest('.sm-town') || e.target.closest('.sm-bot'));
    if (!g) return;
    const id = g.getAttribute('data-id');
    const pt = g.classList.contains('sm-town') ? anchor(id) : [Number(g.getAttribute('data-x')), Number(g.getAttribute('data-y'))];
    if (pt) ensureVisible(pt[0], pt[1] - 20, 90);
  });

  // interaction: pan by dragging or with the wheel
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    M.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: M.tx, ty: M.ty, moved: false };
  });
  root.addEventListener('pointermove', (e) => {
    const d = M.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) {
      d.moved = true;
      try {
        root.setPointerCapture(e.pointerId);
      } catch (err) { /* ignore */ }
      root.style.cursor = 'grabbing';
    }
    setPan(d.tx + dx, d.ty + dy, false);
  });
  const end = (e) => {
    const d = M.drag;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) {
      M.suppressClick = true;
      setTimeout(() => {
        if (M) M.suppressClick = false;
      }, 0);
    }
    M.drag = null;
    root.style.cursor = 'grab';
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => {
    if (!M.vb) return;
    const canY = M.vb.h * M.s > M.H + 1;
    const canX = M.vb.w * M.s > M.W + 1;
    if (!canX && !canY) return;
    const scale = e.deltaMode === 1 ? 16 : 1;
    let dx = (e.shiftKey ? e.deltaY : e.deltaX) * scale;
    let dy = (e.shiftKey ? 0 : e.deltaY) * scale;
    if (!canY && canX && !dx) {
      dx = dy;
      dy = 0;
    }
    const before = [M.tx, M.ty];
    setPan(M.tx - dx, M.ty - dy, false);
    if (before[0] !== M.tx || before[1] !== M.ty) e.preventDefault();
  }, { passive: false });

  if (typeof ResizeObserver !== 'undefined') {
    M.ro = new ResizeObserver(() => layout());
    M.ro.observe(root);
  } else {
    window.addEventListener('resize', layout);
  }
  applyTint();
  layout();
}

// the paper takes the hour: a cool wash at night, a warm one at sunset
const TINTS = { night: ['#2A3550', 0.25], sunset: ['#E8B07A', 0.12], morning: ['#F2D9B0', 0.06] };
function applyTint() {
  if (!M || !M.tint) return;
  let per = 'day';
  try {
    per = clockPeriod();
  } catch (e) { /* keep day */ }
  if (per === M.per) return;
  const first = M.per == null;
  M.per = per;
  const t = TINTS[per];
  M.tint.style.transition = first || reducedMotion() ? 'none' : 'opacity 2400ms ease-in-out';
  if (t) M.tint.style.background = t[0];
  M.tint.style.opacity = t ? String(t[1]) : '0';
  M.svg.classList.toggle('sm-pulse', per === 'sunset' || per === 'night');
}

function unmount() {
  if (!M) return;
  try {
    if (M.ro) M.ro.disconnect();
  } catch (e) { /* ignore */ }
  M.host.innerHTML = '';
  M = null;
}

function press(g) {
  const p = g.querySelector('.sm-press');
  if (!p || !p.animate) return;
  if (reducedMotion()) return;
  p.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.07, 0.88)', offset: 0.3 },
      { transform: 'scale(0.96, 1.06)', offset: 0.62 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 380, easing: 'cubic-bezier(.3,.6,.4,1)' },
  );
}

function setPan(tx, ty, animate) {
  if (!M || !M.vb) return;
  const sw = M.vb.w * M.s;
  const shh = M.vb.h * M.s;
  const minX = Math.min(0, M.W - sw);
  const minY = Math.min(0, M.H - shh);
  M.tx = sw <= M.W ? (M.W - sw) / 2 : Math.max(minX, Math.min(0, tx));
  M.ty = shh <= M.H ? (M.H - shh) / 2 : Math.max(minY, Math.min(0, ty));
  const st = M.svg.style;
  st.transition = animate && !reducedMotion() ? 'transform 720ms cubic-bezier(.22,.8,.24,1)' : 'none';
  st.transform = `translate3d(${f(M.tx)}px, ${f(M.ty)}px, 0)`;
  if (M.pic) {
    M.pic.style.transition = st.transition;
    M.pic.style.transform = st.transform;
  }
}

function centerOn(x, y, animate) {
  if (!M || !M.vb) return;
  setPan(M.W / 2 - (x - M.vb.x) * M.s, M.H / 2 - (y - M.vb.y) * M.s, animate);
}

function ensureVisible(x, y, margin) {
  if (!M || !M.vb) return;
  const sx = (x - M.vb.x) * M.s + M.tx;
  const sy = (y - M.vb.y) * M.s + M.ty;
  const m = Math.min(margin, M.W / 3, M.H / 3);
  if (sx < m || sx > M.W - m || sy < m || sy > M.H - m) centerOn(x, y, true);
  // the browser may also scroll the root on focus; keep it pinned
  M.root.scrollLeft = 0;
  M.root.scrollTop = 0;
}

function layout() {
  if (!M) return;
  const W = M.root.clientWidth;
  const H = M.root.clientHeight;
  if (!W || !H) return;
  if (W === M.W && H === M.H && M.vb) return;
  const s = Math.max(Math.min(W / W0, H / H0), S_MIN);
  const vbW = W / s < W0 ? W0 + 2 * PAD : W / s;
  const vbH = H / s < H0 ? H0 + 2 * PAD : H / s;
  const vb = { x: W0 / 2 - vbW / 2, y: H0 / 2 - vbH / 2, w: vbW, h: vbH };
  M.W = W;
  M.H = H;
  M.s = s;
  M.vb = vb;
  const svg = M.svg;
  svg.setAttribute('viewBox', `${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}`);
  svg.setAttribute('width', f(vb.w * s));
  svg.setAttribute('height', f(vb.h * s));
  svg.querySelector('.sm-sea').innerHTML = buildSea(vb, M.geo.coast, s, M.seas);

  // sizes in world units that keep rendered sizes honest
  const u = (px) => px / s;
  const fl = Math.max(19, u(14));
  const fr = Math.max(17, u(13.5));
  const fm = Math.max(15, u(13.5));
  const fk = Math.max(13, u(13.5));
  const vars = {
    '--sm-fl': `${f(fl)}px`, '--sm-fls': `${f(fl * 0.3)}px`,
    '--sm-fr': `${f(fr)}px`, '--sm-frs': `${f(fr * 0.3)}px`, '--sm-ls': `${f(u(3))}px`,
    '--sm-fm': `${f(fm)}px`, '--sm-fms': `${f(fm * 0.3)}px`,
    '--sm-fk': `${f(fk)}px`, '--sm-fks': `${f(u(2.6))}px`,
    '--sm-lift': `${f(-u(3))}px`, '--sm-bobY': `${f(-u(2))}px`, '--sm-dw2': `${f(u(2.2))}px`,
  };
  for (const k in vars) svg.style.setProperty(k, vars[k]);
  M.vars = vars;
  showLive();

  const hitR = Math.max(46, u(23));
  const symScale = Math.max(1, fl / 19);
  M.boxes = [];
  for (const id in M.towns) {
    const g = M.towns[id];
    g.querySelector('.sm-hit').setAttribute('r', f(hitR));
    const ringR = Math.max(50, hitR + 2);
    g.querySelector('.sm-ring-a').setAttribute('r', f(ringR));
    g.querySelector('.sm-ring-a').setAttribute('stroke-width', f(u(6)));
    g.querySelector('.sm-ring-b').setAttribute('r', f(ringR));
    g.querySelector('.sm-ring-b').setAttribute('stroke-width', f(u(4)));
    g.querySelector('.sm-ring-c').setAttribute('r', f(ringR));
    g.querySelector('.sm-ring-c').setAttribute('stroke-width', f(u(1.6)));
    g.querySelectorAll('.sm-tick').forEach((t) => {
      t.setAttribute('d', `M0,${f(-28 - ringR - u(5))}L${f(-u(4))},${f(-28 - ringR + u(4))}L${f(u(4))},${f(-28 - ringR + u(4))}Z`);
      t.setAttribute('stroke-width', f(u(1)));
    });
    const text = g.querySelector('.sm-label');
    const ty = 24 + fl * 0.86;
    text.setAttribute('y', f(ty));
    let tw = PLACE[id].name.length * fl * 0.43;
    try {
      const m = text.getComputedTextLength();
      if (m > 0) tw = m;
    } catch (e) { /* estimate */ }
    g.querySelector('.sm-sym').setAttribute('transform', `translate(${f(-tw / 2 - 10 * symScale)} ${f(ty - fl * 0.32)}) scale(${f(symScale)})`);
    const a = anchor(id);
    const fx0 = Math.min(-ringR - u(6), -tw / 2 - 22 * symScale);
    const fx1 = Math.max(ringR + u(6), tw / 2 + 8);
    for (const [cls, sw] of [['.sm-focus-a', 4.5], ['.sm-focus-b', 2]]) {
      const rc = g.querySelector(cls);
      rc.setAttribute('x', f(fx0));
      rc.setAttribute('y', f(-28 - ringR - u(6)));
      rc.setAttribute('width', f(fx1 - fx0));
      rc.setAttribute('height', f(ty + fl * 0.35 + u(6) + 28 + ringR + u(6)));
      rc.setAttribute('rx', f(u(10)));
      rc.setAttribute('stroke-width', f(u(sw)));
    }
    M.boxes.push([a[0] - tw / 2 - 20 * symScale, a[1] + ty - fl, a[0] + tw / 2 + 4, a[1] + ty + fl * 0.3]);
    M.boxes.push([a[0] - 44, a[1] - 84, a[0] + 44, a[1] + 8]);
  }
  const comp = M.frame.querySelector('.sm-compass');
  const cs = Math.min(84, Math.max(64, Math.min(W, H) * 0.16));
  // on a phone the sheet's bottom bar covers the lower corner, so the rose goes up top
  const cx = W - cs / 2 - 26;
  const cy = W < 600 && H > 500 ? cs / 2 + 30 : H - cs / 2 - 24;
  comp.setAttribute('transform', `translate(${f(cx)} ${f(cy)})`);
  comp.innerHTML = compassSVG(cs);
  const cbg = M.frame.querySelector('.sm-compbg');
  cbg.setAttribute('cx', f(cx));
  cbg.setAttribute('cy', f(cy));
  cbg.setAttribute('r', f(cs * 0.72));
  // the title scroll lives in the frame, so the band can never crop it
  let cart = '';
  if (vb.w * s <= W + 1) {
    let minX = Infinity;
    for (const q of M.geo.coast.poly) minX = Math.min(minX, q[0]);
    const sea = (minX - vb.x) * s;
    const k = Math.min(0.92, (sea - 40) / 340);
    if (k >= 0.72 && H >= 200) cart = cartoucheFrame(sea / 2 - 4, 30 + 56 * k, k);
  }
  M.frame.querySelector('.sm-cartg').innerHTML = cart;
  const ring = (inset, rx) => `M0,0H${W}V${H}H0Z M${inset + rx},${inset}H${W - inset - rx}Q${W - inset},${inset} ${W - inset},${inset + rx}V${H - inset - rx}Q${W - inset},${H - inset} ${W - inset - rx},${H - inset}H${inset + rx}Q${inset},${H - inset} ${inset},${H - inset - rx}V${inset + rx}Q${inset},${inset} ${inset + rx},${inset}Z`;
  M.frame.querySelector('.sm-burn-a').setAttribute('d', `M-60,-60H${W + 60}V${H + 60}H-60Z ` + ring(22, 30).split('Z ')[1]);
  M.frame.querySelector('.sm-burn-b').setAttribute('d', `M-60,-60H${W + 60}V${H + 60}H-60Z ` + ring(5, 12).split('Z ')[1]);

  bake();
  renderBots();
  const c = M.current && anchor(M.current);
  const target = c || anchor('town');
  centerOn(target[0], target[1] - 30, false);
}

// The paper, the sea, the land and the burnt frame never change between
// layouts, but their ink and paper filters are costly to draw. They go in as
// images, so the browser rasterizes them once instead of on every bob of a dot
// or pulse of a lantern. If anything fails, the live groups keep showing.
function svgBlob(markup) {
  try {
    if (typeof Blob !== 'function' || !URL.createObjectURL) return null;
    return URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  } catch (e) {
    return null;
  }
}

function swapIn(img, url, hideNodes) {
  const old = img.getAttribute('data-url');
  img.setAttribute('data-url', url);
  const done = () => {
    if (img.getAttribute('data-url') !== url) return;
    for (const n of hideNodes) if (n) n.style.display = 'none';
    img.style.visibility = 'visible';
  };
  img.addEventListener('load', done, { once: true });
  if (img instanceof HTMLImageElement) img.src = url;
  else img.setAttribute('href', url);
  if (old) setTimeout(() => { try { URL.revokeObjectURL(old); } catch (e) { /* gone */ } }, 4000);
}

// Everything static (paper, sea, land, forests, roads, region names, town art
// and labels) is painted once into one canvas at device pixel ratio; the live
// SVG on top keeps only small interactive parts (hit areas, rings, lanterns,
// bot dots, the wagon). Redrawn only on resize, season or gym shield change.
function staticNodes() {
  if (!M) return [];
  const { svg } = M;
  const out = [svg.querySelector('.sm-sea'), svg.querySelector('.sm-land'), svg.querySelector('.sm-regions'), svg.querySelector('.sm-minors')];
  for (const id in M.towns) out.push(M.towns[id].querySelector('.sm-lift'), M.towns[id].querySelector('.sm-labelg'));
  return out.filter(Boolean);
}

function showLive() {
  for (const n of staticNodes()) n.style.display = '';
}

let bakeToken = 0;
function bake() {
  if (!M || !M.vb || typeof XMLSerializer !== 'function') return;
  const token = ++bakeToken;
  try {
    const ser = new XMLSerializer();
    const out = (n) => {
      if (!n) return '';
      const c = n.cloneNode(true);
      c.removeAttribute('style');
      return ser.serializeToString(c);
    };
    const { svg, vb, s, frame, W, H } = M;
    let towns = '';
    for (const id in M.towns) {
      const g = M.towns[id];
      towns += `<g transform="${g.getAttribute('transform')}">${out(g.querySelector('.sm-lift'))}${out(g.querySelector('.sm-labelg'))}</g>`;
    }
    const vars = Object.entries(M.vars || {}).map(([k, v]) => `${k}:${v}`).join(';');
    const pw = vb.w * s;
    const ph = vb.h * s;
    const base = `<svg xmlns="${NS}" viewBox="${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}" width="${f(pw)}" height="${f(ph)}" style="${vars}">${out(svg.querySelector('style'))}${out(svg.querySelector('defs'))}${out(svg.querySelector('.sm-sea'))}${out(svg.querySelector('.sm-land'))}${out(svg.querySelector('.sm-regions'))}${out(svg.querySelector('.sm-minors'))}${towns}</svg>`;
    const u1 = svgBlob(base);
    if (u1) {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => {
        setTimeout(() => { try { URL.revokeObjectURL(u1); } catch (e) { /* gone */ } }, 0);
        if (!M || token !== bakeToken) return;
        const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
        let cv = M.pic;
        if (!cv) {
          cv = document.createElement('canvas');
          cv.className = 'sm-raster';
          cv.setAttribute('aria-hidden', 'true');
          cv.style.cssText = 'position:absolute;left:0;top:0;display:block;transform-origin:0 0;pointer-events:none';
          M.root.insertBefore(cv, M.tint || M.svg);
          M.pic = cv;
        }
        cv.width = Math.round(pw * dpr);
        cv.height = Math.round(ph * dpr);
        cv.style.width = `${f(pw)}px`;
        cv.style.height = `${f(ph)}px`;
        cv.style.transform = M.svg.style.transform;
        const x = cv.getContext('2d');
        if (!x) return;
        x.drawImage(im, 0, 0, cv.width, cv.height);
        for (const n of staticNodes()) n.style.display = 'none';
      };
      im.onerror = () => { try { URL.revokeObjectURL(u1); } catch (e) { /* gone */ } };
      im.src = u1;
    }
    const edge = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" overflow="visible">${out(svg.querySelector('defs'))}${Array.from(frame.childNodes).map((n) => (n.nodeType === 1 ? ser.serializeToString(n) : '')).join('')}</svg>`;
    const u2 = svgBlob(edge);
    if (u2) {
      let pic = M.root.querySelector('.sm-frame-pic');
      if (!pic) {
        pic = document.createElement('img');
        pic.className = 'sm-frame-pic';
        pic.alt = '';
        pic.setAttribute('aria-hidden', 'true');
        pic.decoding = 'async';
        pic.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;visibility:hidden';
        M.root.appendChild(pic);
      }
      frame.style.display = '';
      swapIn(pic, u2, [frame]);
    }
  } catch (e) { /* the live groups keep showing */ }
}

// ------------------------------------------------------------------ live layer

function roadFor(id) {
  const roads = M.geo.roads;
  if (id === 'town') {
    const r = roads.find((q) => (q.from === 'town' && q.to === 'campus') || (q.to === 'town' && q.from === 'campus'));
    return r ? { r, fromStart: r.from === 'town' } : null;
  }
  const withTown = roads.find((q) => (q.from === id && q.to === 'town') || (q.to === id && q.from === 'town'));
  const any = withTown || roads.find((q) => q.from === id || q.to === id);
  return any ? { r: any, fromStart: any.from === id } : null;
}

function botMarker(kind, color, y) {
  if (kind === 'diamond') return `<path d="M0,${f(y - 7)}L5.5,${f(y)}L0,${f(y + 7)}L-5.5,${f(y)}Z" fill="${color}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`;
  if (kind === 'question') return `<text class="sm-mark" x="0" y="${f(y + 5)}" text-anchor="middle" fill="${color}">?</text>`;
  if (kind === 'z') return `<text class="sm-mark" x="0" y="${f(y + 4)}" text-anchor="middle" font-style="italic" fill="${color}">z</text>`;
  return '';
}

function renderBots() {
  if (!M) return;
  const layer = M.svg.querySelector('.sm-bots');
  const st = M.state;
  const bots = st && Array.isArray(st.bots) ? st.bots : [];
  const s = M.s;
  const u = (px) => px / s;
  const hitR = Math.max(46, u(23));
  const dotR = Math.max(7, u(6));
  const bHit = u(22);
  const reduced = reducedMotion();
  const perPlace = {};
  const taken = [];
  let napping = 0;
  let html = '';
  for (const b of bots) {
    if (!b || typeof b !== 'object') continue;
    const core = BOT[b.core] || BOT[b.id];
    if (!core) continue;
    const color = core.color;
    const stateKey = STATES[b.state] ? b.state : 'working';
    const marker = STATES[stateKey].marker;
    const placeId = PLACE[b.place] ? b.place : 'town';
    let x;
    let y;
    let motion = '';
    if (stateKey === 'sleeping' || stateKey === 'done') {
      const a = anchor('town');
      x = a[0] + BENCH[0] - napping * (dotR * 2 + u(6));
      y = a[1] + BENCH[1];
      napping++;
    } else {
      const rf = roadFor(placeId);
      const i = perPlace[placeId] || 0;
      perPlace[placeId] = i + 1;
      if (rf) {
        const g = rf.r.g;
        // walk out along the road until clear of icons, labels and the bots already placed
        const pad = dotR + u(4);
        let dist = hitR * 0.8 + i * u(6);
        let pt = pointAt(g, rf.fromStart ? dist : g.total - dist);
        const top = dotR + u(11) + 9;
        const blocked = (q) =>
          (M.boxes || []).some((bx) => q[0] + pad > bx[0] && q[0] - pad < bx[2] && q[1] + pad > bx[1] && q[1] - top < bx[3]) ||
          taken.some((t) => Math.hypot(t[0] - q[0], t[1] - q[1]) < u(26));
        while (dist < g.total * 0.6 && blocked(pt)) {
          dist += u(4);
          pt = pointAt(g, rf.fromStart ? dist : g.total - dist);
        }
        taken.push(pt);
        x = pt[0];
        y = pt[1];
        if (stateKey === 'traveling' && !reduced) {
          // walks the road to the place and back, with a slow ease at each end
          const a = Math.max(0.02, Math.min(0.98, (rf.fromStart ? dist : g.total - dist) / g.total));
          const b2 = rf.fromStart ? 0.82 : 0.18;
          const dur = 15 + (hash(b.id || core.id) % 10);
          motion = `<animateMotion dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keyPoints="${f(b2)};${f(a)};${f(b2)}" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" path="${rf.r.d}"/>`;
        }
      } else {
        const a = anchor(placeId);
        x = a[0] + 40;
        y = a[1] + 10;
      }
    }
    const label = `${b.name || core.name}, ${STATES[stateKey].label.toLowerCase()}, at ${PLACE[placeId].name}`;
    const pos = motion ? '' : ` transform="translate(${f(x)} ${f(y)})"`;
    const mk = botMarker(marker, color, -dotR - u(11));
    html +=
      `<g class="sm-bot" data-id="${esc(b.id || core.id)}" data-x="${f(x)}" data-y="${f(y)}" role="button" tabindex="0" aria-label="${esc(label)}"${pos}>` +
      motion +
      `<title>${esc(label)}</title>` +
      `<circle cx="0" cy="0" r="${f(bHit)}" fill="${PAPER}" fill-opacity="0"/>` +
      `<ellipse cx="0" cy="${f(dotR * 0.9)}" rx="${f(dotR * 1.1)}" ry="${f(dotR * 0.35)}" fill="#2E3B4F" fill-opacity="0.3"/>` +
      `<g class="${stateKey === 'working' && !motion ? 'sm-bob' : ''}">` +
      `<circle class="sm-body" cx="0" cy="0" r="${f(dotR)}" fill="${color}" stroke="${INK}" stroke-width="${f(u(1.4))}"/>` +
      `<circle cx="0" cy="0" r="${f(dotR)}" fill="url(#sm-dotlit)"/>` +
      mk +
      `</g>` +
      `<circle class="sm-focus sm-focus-a" r="${f(bHit)}" fill="none" stroke="${INK}" stroke-width="${f(u(4.5))}"/><circle class="sm-focus sm-focus-b" r="${f(bHit)}" fill="none" stroke="${GOLD}" stroke-width="${f(u(2))}"/>` +
      `</g>`;
  }
  if (napping) {
    const a = anchor('town');
    const x1 = a[0] + BENCH[0] + dotR + u(4);
    const x0 = a[0] + BENCH[0] - (napping - 1) * (dotR * 2 + u(6)) - dotR - u(4);
    const y = a[1] + BENCH[1] + dotR * 0.7;
    html = `<g aria-hidden="true"><path d="M${f(x0)},${f(y)}L${f(x1)},${f(y)}M${f(x0 + 3)},${f(y)}L${f(x0 + 3)},${f(y + 7)}M${f(x1 - 3)},${f(y)}L${f(x1 - 3)},${f(y + 7)}" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M${f(x0)},${f(y - 1)}L${f(x1)},${f(y - 1)}" stroke="#A8774C" stroke-width="1.4"/></g>` + html;
  }
  layer.innerHTML = html;
}

export function updateMap(state, { current } = {}) {
  if (!M) return;
  M.state = state && typeof state === 'object' ? state : {};
  const st = M.state;
  const places = st.places && typeof st.places === 'object' ? st.places : {};
  const wagonAt = st.trailer && PLACE[st.trailer.at] ? st.trailer.at : null;
  const prev = M.current;
  if (current !== undefined) M.current = PLACE[current] ? current : null;

  for (const p of PLACES) {
    const g = M.towns[p.id];
    const info = places[p.id] || {};
    const status = typeof info.status === 'string' ? info.status : '';
    const waiting = status === 'waiting';
    g.classList.toggle('is-waiting', waiting);
    g.classList.toggle('is-current', M.current === p.id);
    g.setAttribute('data-status', status);
    if (M.current === p.id) g.setAttribute('aria-current', 'location');
    else g.removeAttribute('aria-current');
    g.setAttribute('aria-label', townAria(p, { waiting, wagon: wagonAt === p.id, current: M.current === p.id }));
  }

  // the three gym shields fill as the week's sessions are done
  const gym = st.growth && st.growth.gym;
  const done = gym && Number.isFinite(Number(gym.done)) ? Number(gym.done) : 0;
  let shieldsChanged = false;
  M.svg.querySelectorAll('.sm-shield').forEach((c, i) => {
    const fill = i < done ? ['#E2B04B', '#C9A7E8', '#8FC79A'][i] : PAPER_HI;
    if (c.getAttribute('fill') !== fill) shieldsChanged = true;
    c.setAttribute('fill', fill);
  });
  if (shieldsChanged) bake();

  // the trailer wagon, parked down the street from wherever it is
  const wg = M.svg.querySelector('.sm-wagon');
  if (wagonAt) {
    const a = anchor(wagonAt);
    const o = WAGON_SPOT[wagonAt] || [60, -4];
    wg.setAttribute('transform', `translate(${f(a[0] + o[0])} ${f(a[1] + o[1])})`);
    wg.style.display = '';
  } else {
    wg.style.display = 'none';
  }

  applyTint();
  renderBots();
  if (M.current && M.current !== prev) {
    const a = anchor(M.current);
    centerOn(a[0], a[1] - 30, prev != null);
  }
}
