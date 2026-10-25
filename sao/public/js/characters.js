// SAO characters: ICON and the 7 core bots as painted SVG sprites, and the
// small crowd that lives on the vista.
//
//   spriteSVG(id, {state, size, facing, marker, shadow, lite}) -> SVG string
//   markerSVG(state, color)                                   -> SVG string
//   mountCrowd(layerEl, {onBotTap})
//   setScene(placeId, bots, {quiet, reduced})
//
// Look (World Bible): simple round bodies, dot eyes, one prop, warm cream top
// light and a cool blue underside, soft contact shadow, thin warm dark lines,
// no pure black. Expressive through motion: squash and stretch with weight,
// anticipation before a step, a settle after it.

import { PLACE } from './places.js';
import { BOT, ICON, STATES, MAX_ACTIVE } from './bots.js';
import { period } from './clock.js';

// Paint
const INK = '#5A4638B3';    // warm brown ink at 0.7, never black (lite sprites only)
const INK_SOLID = '#4E3A30';  // the pen: warm dark brown
const INK_PRESS = '#3E3230';  // where the pen pressed (shadow side)
const SHADE = '#6E7490';    // the one cool shadow tone, laid on with multiply (gouache glaze, not a gradient)
const MUL = ' style="mix-blend-mode:multiply"';
const RIM = '#E8D8B0';      // warm rim light on the sun side
const BOUNCE = '#C9B48E';   // warm light bounced up from the ground
const CONTACT = '#3A3A30';  // soft contact shadow, warm dark earth (multiply)
const EYE = '#22303A';      // deep blue green, never black
const CREAM = '#FFF3DC';    // top light
const COOL = '#5B76A6';     // cool underside for cool colors
const VIOLET = '#8E6F9C';   // violet underside for warm colors (no mud)
const DEEP = '#3E4A52';     // pigment pooling at edges (deep blue green)
const BLUSH = '#EE9E8C';
const GOLD = '#E8C88E';
const BRASS = '#D9AE57';
const PAPER = '#FBF3E3';
const SKIN = '#EBCFB2';
const HAIR = '#3E2D28';
const FONT = "'Times New Roman', Times, Georgia, serif";

// The scene light the bots stand in. dir is where the light comes from
// (1: from the left, -1: from the right). rim is the lit edge, far the cool
// turned away edge, grade a gouache glaze over the whole figure (null: none),
// shadow the cast shadow on the ground (offset and stretch in shadow widths).
const LIGHTS = {
  day: { dir: 1, rim: '#E8D8B0', rimOp: 0.62, far: '#8A90B0', farOp: 0.3, bounce: 0.24, grade: null, sh: { x: 9, s: 1.08, o: 1 }, css: ['-1px', '-.6px', 'rgba(244,226,190,.5)'] },
  sunset: { dir: -1, rim: '#F0C48C', rimOp: 0.7, far: '#7E7FA8', farOp: 0.38, bounce: 0.3, grade: '0.98 0.06 0.02 0 0.03 0.02 0.93 0.02 0 0.015 0.02 0.04 0.9 0 0.01 0 0 0 1 0', sh: { x: -34, s: 1.75, o: 0.82 }, css: ['1.2px', '-.3px', 'rgba(240,188,128,.55)'] },
  night: { dir: 1, rim: '#B8C6E0', rimOp: 0.42, far: '#4E5A84', farOp: 0.42, bounce: 0.1, grade: '0.56 0.1 0.04 0 0.01 0.06 0.6 0.08 0 0.02 0.08 0.12 0.66 0 0.05 0 0 0 1 0', sh: { x: 5, s: 1.02, o: 0.55 }, css: ['-.6px', '-.8px', 'rgba(184,198,224,.34)'] },
};
LIGHTS.morning = { ...LIGHTS.day, grade: '1 0.02 0 0 0.01 0 0.97 0.02 0 0.01 0 0 0.92 0 0.02 0 0 0 1 0' };
let LIGHT = 'day';
function sceneLight() {
  try {
    const p = period();
    return LIGHTS[p] ? p : 'day';
  } catch {
    return 'day';
  }
}

// Neighboring color touches, broken into the body like impressionist dabs.
const DABS = {
  scholar: ['#B6A6E2', '#9FD0C6', '#F3DDB4'],
  scout: ['#F2B36A', '#C8CF7C', '#FFF0C2'],
  baker: ['#F5C79C', '#D8A7D2', '#FFE6D6'],
  keeper: ['#C9DA8A', '#86BFC2', '#F0E3B8'],
  steward: ['#B8B2CC', '#C4C2A8', '#E9E4DA'],
  bard: ['#D9B0B8', '#A8B8C8', '#EFE4D6'],
  herald: ['#F2C76A', '#E9A08C', '#FFE3BE'],
  icon: ['#F1DDB8', '#D9DDEC', '#FBEFD9'],
};

// Where the marker sits (viewBox units, center) for each sprite.
const MARK_Y = { scholar: 24, scout: 30, baker: 10, keeper: 27, steward: 19, bard: 29, herald: 22, icon: 11 };

// Dustier, less synthetic body colors where the UI token reads as AI pastel.
const BODY_TONE = { bard: '#B9A3CF', scholar: '#93B0D6', steward: '#A8ABAE' };
// Pigment, not screen pastel: every body color loses about a fifth of its
// saturation and leans a touch toward the warm paper.
function desat(h, k = 0.2) {
  const c = rgb(h);
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return mix(hex(c.map((v) => v + (l - v) * k)), '#E9DCC0', 0.05);
}
const TONES = {};
const tone = (id) => TONES[id] || (TONES[id] = desat(BODY_TONE[id] || BOT[id].color));

let uid = 0;

// ---------------------------------------------------------------- helpers

const r2 = (n) => Math.round(n * 100) / 100;
function rgb(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function hex(c) {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
}
function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function smoothClosed(pts) {
  const n = pts.length;
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d + 'Z';
}
// A slightly irregular egg: wider at the bottom, hand drawn wobble.
function blob(cx, cy, rx, ry, { egg = 0.07, wob = 0.012, seed = 1, n = 12 } = {}) {
  const rnd = seeded(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = Math.sin(a);
    const w = 1 + (rnd() - 0.5) * 2 * wob;
    pts.push([cx + rx * Math.cos(a) * (1 + egg * s) * w, cy + ry * s * w]);
  }
  return smoothClosed(pts);
}
// Mirror an absolute path (M L C Q Z only) around x = 50.
function mirror(d) {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (m) => (i++ % 2 === 0 ? r2(100 - parseFloat(m)) : m));
}
// Shadow hue: warm colors fall into violet, cool colors into blue.
function shadeOf(color) {
  const [r, , b] = rgb(color);
  return r > b + 12 ? VIOLET : COOL;
}
const org = (x, y) => `style="transform-box:view-box;transform-origin:${x}px ${y}px"`;

function makeCtx(lite, pose = {}, light = LIGHT) {
  const k = 'sao' + (++uid).toString(36);
  const defs = [];
  let n = 0;
  return {
    lite,
    pose,
    L: LIGHTS[light] || LIGHTS.day,
    sw: lite ? 2.5 : 1.35,
    defs,
    inkN: 0,
    blurId: '',
    blur(sd = 1.1) {
      const key = 'b' + String(sd).replace('.', '_');
      if (!this[key]) {
        this[key] = this.id('bl');
        defs.push(`<filter id="${this[key]}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
      }
      return this[key];
    },
    id(p) {
      return `${k}${p}${n++}`;
    },
    // Gouache: a flat body of color, very slightly warmed, no gloss.
    paint(color) {
      return mix(color, CREAM, 0.06);
    },
  };
}

// Hand inked outline: a thin main line plus a second, offset, lighter pass
// broken into strokes, so the line thickens on the shadow side (lower right)
// and thins on the lit side, like a brush that pressed where the form turns.
// Hand inked line, not a sticker outline: a light warm brown pen line that
// is lost on about a quarter of the contour (the breaks fall in a different
// place on every shape), plus a few heavier pressed strokes nudged toward
// the shadow side, so the weight changes along the form.
const LOST = ['17 3.2 26 5.4 9 4 21 6.4', '23 5 12 3.4 30 6 8 4.6', '14 4.4 19 6 27 3.6 11 5'];
const PRESS = ['0 8 13 21 7 29', '0 15 9 24 16 18', '0 5 18 27 6 22'];
function ink(ctx, d, w = 1) {
  if (ctx.lite) {
    const k = ctx.inkN++;
    return (
      `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${r2(ctx.sw * w * 0.72)}" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="${INK_PRESS}" stroke-opacity="0.5" stroke-width="${r2(ctx.sw * w * 1.05)}" stroke-linecap="round" stroke-dasharray="${PRESS[k % 3]}" stroke-dashoffset="${(k * 23 + 7) % 41}" transform="translate(${r2(0.7 * ctx.L.dir)} 0.8)"/>`
    );
  }
  const k = ctx.inkN++;
  const a = r2(ctx.sw * w * 0.9);
  const off = (k * 37 + 11) % 61;
  return (
    `<path d="${d}" fill="none" stroke="${INK_SOLID}" stroke-opacity="0.46" stroke-width="${a}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${LOST[k % 3]}" stroke-dashoffset="${off}"/>` +
    `<path d="${d}" fill="none" stroke="${INK_PRESS}" stroke-opacity="0.36" stroke-width="${r2(a * 1.3)}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${PRESS[k % 3]}" stroke-dashoffset="${r2(off * 1.7)}" transform="translate(${r2(0.5 * ctx.L.dir)} 0.6)"/>`
  );
}
// A crescent of light along one side of a shape: the shape minus a copy of
// itself nudged by (dx, dy). Used for the rim light and the ground bounce.
function crescent(ctx, d, dx, dy, color, op, soft = 0) {
  const m = ctx.id('m');
  const f = soft ? ` filter="url(#${ctx.blur(soft)})"` : '';
  ctx.defs.push(`<mask id="${m}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><path d="${d}" fill="#fff"/><path d="${d}" fill="#000" transform="translate(${dx} ${dy})"${f}/></mask>`);
  return `<path d="${d}" fill="${color}" opacity="${op}" mask="url(#${m})"/>`;
}

function shape(ctx, d, color, { line = 1, op = 1, cls = '', flat = false } = {}) {
  const fill = flat ? color : ctx.paint(color);
  const o = op < 1 ? ` opacity="${op}"` : '';
  const c = cls ? ` class="${cls}"` : '';
  return `<g${c}${o}><path d="${d}" fill="${fill}"/>${line ? ink(ctx, d, line) : ''}</g>`;
}
function ellipsePath(cx, cy, rx, ry) {
  return `M${r2(cx - rx)} ${cy}A${rx} ${ry} 0 1 0 ${r2(cx + rx)} ${cy}A${rx} ${ry} 0 1 0 ${r2(cx - rx)} ${cy}Z`;
}
function ellipse(ctx, cx, cy, rx, ry, color, { line = 1, rot = 0, op = 1, flat = false } = {}) {
  const fill = flat ? color : ctx.paint(color);
  const t = rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : '';
  const o = op < 1 ? ` opacity="${op}"` : '';
  let s = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
  // a small cool underside on round parts (feet, paws, buns): one tone, hard edge
  if (!ctx.lite && !flat && rx > 2.2) s += `<ellipse cx="${r2(cx + rx * 0.16 * ctx.L.dir)}" cy="${r2(cy + ry * 0.34)}" rx="${r2(rx * 0.8)}" ry="${r2(ry * 0.6)}" fill="${SHADE}" opacity="0.42"${MUL}/>`;
  if (line) s += ink(ctx, ellipsePath(cx, cy, rx, ry), line);
  return `<g${t}${o}>${s}</g>`;
}
// A stroked line with an ink outline (for handles, straps, tubes).
function rod(ctx, d, color, w) {
  const out = w + ctx.sw * (ctx.lite ? 1.5 : 1.2);
  return (
    `<path d="${d}" fill="none" stroke="${ctx.lite ? INK : INK_SOLID}" stroke-opacity="${ctx.lite ? 1 : 0.55}" stroke-width="${r2(out)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${ctx.paint(color)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}
// Union of circles with one outer outline (puffy cap, crest).
function puffs(ctx, circles, color) {
  const out = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r2(r + ctx.sw / 2)}"/>`).join('');
  const fill = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ctx.paint(color)}"/>`).join('');
  let shade = '';
  if (!ctx.lite) shade = circles.map(([x, y, r]) => `<circle cx="${r2(x + r * 0.22 * ctx.L.dir)}" cy="${r2(y + r * 0.36)}" r="${r2(r * 0.7)}" fill="${SHADE}" opacity="0.34"${MUL}/>`).join('');
  const line = ctx.lite ? `<g fill="${INK}">${out}</g>` : `<g fill="${INK_SOLID}" opacity="0.5">${out}</g>`;
  return `${line}${fill}${shade}`;
}

// The main body, built like a gouache cel: a flat wash, ONE cool shadow
// shape on the lower right with a pooled hard edge, a broad warm light wash
// on the top left (not a gloss spot), broken color dabs, darker pigment
// pooled where the wash dried at the rim, then the ink.
function body(ctx, id, d, color, box, coolOp = 0.42) {
  const clip = ctx.id('c');
  const top = box.cy - box.ry;
  ctx.defs.push(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
  let s = `<path d="${d}" fill="${ctx.paint(color)}"/>`;
  s += `<g clip-path="url(#${clip})">`;
  // shadow = everything outside a lit egg pushed up and left
  const L = ctx.L;
  const dir = L.dir;
  const lit = blob(box.cx - box.rx * 0.2 * dir, box.cy - box.ry * 0.2, box.rx * 1.02, box.ry * 0.97, { wob: ctx.lite ? 0 : 0.035, seed: top * 3 + 5, n: 10 });
  const x0 = box.cx - box.rx - 6;
  const x1 = box.cx + box.rx + 6;
  const R = `M${r2(x0)} ${r2(top - 6)}H${r2(x1)}V${r2(box.cy + box.ry + 6)}H${r2(x0)}Z`;
  const shOp = r2(Math.min(0.56, coolOp + 0.1));
  s += `<path d="${R}${lit}" fill-rule="evenodd" fill="${SHADE}" opacity="${shOp}"${MUL}/>`;
  if (!ctx.lite) {
    const dab = (DABS[id] || DABS.icon).map((c) => desat(c, 0.25));
    // wet edge: the shadow wash dried with a darker rim, broken like a real wash
    s += `<path d="${lit}" fill="none" stroke="${mix(SHADE, DEEP, 0.35)}" stroke-width="1.3" opacity="0.34" stroke-dasharray="11 2.6 18 3.4 7 2"/>`;
    // a wet in wet bloom where a cooler drop ran into the shadow
    s += `<ellipse cx="${r2(box.cx + box.rx * 0.42 * dir)}" cy="${r2(box.cy + box.ry * 0.5)}" rx="${r2(box.rx * 0.34)}" ry="${r2(box.ry * 0.2)}" fill="${mix(SHADE, '#7F9BB8', 0.5)}" opacity="0.22" filter="url(#${ctx.blur(1.6)})"/>`;
    s += `<path d="${blob(box.cx - box.rx * 0.32 * dir, box.cy - box.ry * 0.5, box.rx * 0.62, box.ry * 0.34, { wob: 0.16, seed: top * 7 })}" fill="${dir < 0 ? L.rim : CREAM}" opacity="0.2"/>`;
    const ax = r2(box.cx + box.rx * 0.5);
    const ay = r2(box.cy - box.ry * 0.05);
    s += `<ellipse cx="${ax}" cy="${ay}" rx="4.2" ry="3" fill="${dab[0]}" opacity="0.3" transform="rotate(-18 ${ax} ${ay})"/>`;
    s += `<ellipse cx="${r2(box.cx - box.rx * 0.58)}" cy="${r2(box.cy + box.ry * 0.38)}" rx="3.6" ry="2.4" fill="${dab[1]}" opacity="0.28"/>`;
    s += `<ellipse cx="${r2(box.cx + box.rx * 0.18)}" cy="${r2(box.cy + box.ry * 0.66)}" rx="4.6" ry="2" fill="${dab[2]}" opacity="0.24"/>`;
    // pigment pooled at the rim as the wash dried: a soft band, then a crisp edge
    s += `<path d="${d}" fill="none" stroke="${mix(color, DEEP, 0.5)}" stroke-width="6" opacity="0.16" filter="url(#${ctx.blur(1.4)})"/>`;
    s += `<path d="${d}" fill="none" stroke="${mix(color, DEEP, 0.45)}" stroke-width="2.2" opacity="0.3"/>`;
  }
  s += `</g>`;
  if (ctx.lite) s += crescent(ctx, d, r2(2.6 * dir), 2.4, L.rim, Math.min(0.8, L.rimOp + 0.12));
  if (!ctx.lite) {
    // rim light on the side the light comes from, a cool band on the turned
    // away side, and warm light bounced up from the ground underneath
    s += crescent(ctx, d, r2(2.3 * dir), dir < 0 ? 1.2 : 2.5, L.rim, L.rimOp);
    s += crescent(ctx, d, r2(-3 * dir), -0.8, L.far, L.farOp, 0.9);
    s += crescent(ctx, d, 0.4, -3.2, BOUNCE, L.bounce, 0.8);
  }
  s += ink(ctx, d, 1);
  return s;
}

// Baked step frames for the raster crowd: pose.step 1 lifts the left foot,
// -1 the right one (drawn on twos, like a hand animated walk).
function lift(ctx, side) {
  const st = ctx.pose.step || 0;
  return (side < 0 && st > 0) || (side > 0 && st < 0) ? ' transform="translate(0 -2.8)"' : '';
}
function feet(ctx, color, xs = [41, 59], y = 92.4, rx = 6.4) {
  const c = mix(color, DEEP, 0.28);
  return (
    `<g class="p-fl" ${org(xs[0], y)}${lift(ctx, -1)}>${ellipse(ctx, xs[0], y, rx, 3.5, c)}</g>` +
    `<g class="p-fr" ${org(xs[1], y)}${lift(ctx, 1)}>${ellipse(ctx, xs[1], y, rx, 3.5, c)}</g>`
  );
}

function eyes(ctx, xs, y, r, state) {
  const R = ctx.lite ? r * 1.35 : r;
  let inner = '';
  if (state === 'sleeping') {
    const w = ctx.lite ? 2.3 : 1.4;
    inner = xs
      .map((x) => `<path d="M${r2(x - R * 1.3)} ${r2(y - 0.4)}Q${x} ${r2(y + R * 1.5)} ${r2(x + R * 1.3)} ${r2(y - 0.4)}" fill="none" stroke="${EYE}" stroke-width="${w}" stroke-linecap="round"/>`)
      .join('');
  } else if (state === 'done') {
    const w = ctx.lite ? 2.3 : 1.5;
    inner = xs
      .map((x) => `<path d="M${r2(x - R * 1.2)} ${r2(y + R * 0.6)}Q${x} ${r2(y - R * 1.5)} ${r2(x + R * 1.2)} ${r2(y + R * 0.6)}" fill="none" stroke="${EYE}" stroke-width="${w}" stroke-linecap="round"/>`)
      .join('');
  } else {
    inner = xs.map((x) => `<circle cx="${x}" cy="${y}" r="${r2(R)}" fill="${EYE}"/>`).join('');
    // a soft painted catchlight, off center, not a glossy spot
    if (!ctx.lite) inner += xs.map((x) => `<circle cx="${r2(x - R * 0.3)}" cy="${r2(y - R * 0.34)}" r="${r2(R * 0.26)}" fill="#F6EBD6" opacity="0.85"/>`).join('');
  }
  const bl = ctx.pose.blink && state !== 'sleeping' && state !== 'done' ? ` transform="translate(0 ${r2(y * 0.88)}) scale(1 0.12)"` : '';
  return `<g class="p-eyes" ${org(50, y)}${bl}>${inner}</g>`;
}
function blush(ctx, xs, y, rx = 3.6) {
  if (ctx.lite) return '';
  return xs.map((x) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${r2(rx * 0.55)}" fill="${BLUSH}" opacity="0.34"/>`).join('');
}
function nub(ctx, x, y, color, rot = 0, rx = 4.6, ry = 6) {
  return ellipse(ctx, x, y, rx, ry, color, { rot });
}

// ---------------------------------------------------------------- the bots

const STD = { cx: 50, cy: 66, rx: 25, ry: 26 };

function drawScholar(ctx, st, back) {
  const c = tone('scholar');
  const d = blob(50, 66, 25, 26, { seed: 11 });
  const tuftL = 'M32.6 49.6C29.4 46.6 27.2 42.6 26.2 37.8C29.4 39.2 31.4 40 32.8 39.8C33.6 41.2 36.8 42.4 40.8 43.6Z';
  let s = feet(ctx, c);
  s += shape(ctx, tuftL, c) + shape(ctx, mirror(tuftL), c);
  s += body(ctx, 'scholar', d, c, STD);
  if (back) {
    // Seen from behind: the book's corner pokes out past the right side,
    // a crown tuft on top, a darker cap over the back of the head, two
    // folded wings with feather tips, and a little three feather tail.
    const dir = ctx.L.dir;
    const book = 'M66.8 74.2L78.6 71.6L80.2 82.6L68.4 85.6Z';
    s = shape(ctx, book, '#8A5A3B') + shape(ctx, 'M68.2 75.6L77.4 73.6L78.4 81.6L69.4 84Z', PAPER, { line: 0.6, flat: true }) + s;
    const tail = 'M44.6 86.4C45.4 90.6 47.2 93.6 49 94.4C49.6 92.4 50.4 92.4 51 94.4C52.8 93.6 54.6 90.6 55.4 86.4Z';
    s = shape(ctx, tail, mix(c, DEEP, 0.3)) + s;
    const cap = 'M28.4 56.6C30.2 46.4 38.6 40.2 50 40.2C61.4 40.2 69.8 46.4 71.6 56.6C64.4 53.4 57.6 52.2 50 52.4C42.4 52.2 35.6 53.4 28.4 56.6Z';
    s += shape(ctx, cap, mix(c, DEEP, 0.2), { line: 0, op: 0.75 });
    const tuft = 'M46.6 41.6C45.6 37.4 46.8 34 49.4 32.2C49 35 50.2 36.4 51.2 37C51.6 34.8 53.4 33.6 55.4 33.6C53.6 35.6 53.4 38.6 53.6 41.4Z';
    s += shape(ctx, tuft, mix(c, DEEP, 0.15), { line: 0.8 });
    const wingL = 'M32.8 60.6C29.8 67 30.4 75.6 34.6 81.4C37.2 84.8 40.6 86.2 43.2 85.4C41.8 80.6 41.4 74.8 42 69.2C42.4 64.8 41 61 38.2 59.4C36.4 58.8 34.2 59.2 32.8 60.6Z';
    const wingR = mirror(wingL);
    const wc = mix(c, COOL, 0.22);
    // the wing away from the light sits a step deeper in shadow
    s += shape(ctx, wingL, dir > 0 ? wc : mix(wc, DEEP, 0.18));
    s += shape(ctx, wingR, dir > 0 ? mix(wc, DEEP, 0.18) : wc);
    if (!ctx.lite) {
      const tip = mix(c, DEEP, 0.4);
      const lit = mix(c, CREAM, 0.5);
      // the bare back between the wings catches a soft warm wash
      s += `<path d="${blob(50 - 3 * dir, 70, 6.5, 12, { wob: 0.08, seed: 23 })}" fill="${mix(c, CREAM, 0.4)}" opacity="0.3"/>`;
      // feather tips along the trailing edge of each wing, and a lit edge
      s += `<path d="M36 80.4Q38.4 82.6 41.4 82.2M33.6 74.6Q36.6 77.2 41 76.4M33 68Q36.4 70.6 41.2 70" fill="none" stroke="${tip}" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>`;
      s += `<path d="${mirror('M36 80.4Q38.4 82.6 41.4 82.2M33.6 74.6Q36.6 77.2 41 76.4M33 68Q36.4 70.6 41.2 70')}" fill="none" stroke="${tip}" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>`;
      s += `<path d="${dir > 0 ? 'M33.4 62.4C31.4 67 31.6 72.4 33.6 77' : mirror('M33.4 62.4C31.4 67 31.6 72.4 33.6 77')}" fill="none" stroke="${lit}" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>`;
      // the spine line where the wings meet, lost in the middle
      s += `<path d="M50 56.4C49.6 64 50.4 74 50 84" fill="none" stroke="${mix(c, DEEP, 0.45)}" stroke-width="0.9" stroke-dasharray="6 3 9 4" opacity="0.5"/>`;
      // scalloped cap feathers
      s += [[38, 50.4], [44, 48.6], [50, 48], [56, 48.6], [62, 50.4]]
        .map(([x, y]) => `<path d="M${x - 2.6} ${y}Q${x} ${y + 2.4} ${x + 2.6} ${y}" fill="none" stroke="${mix(c, CREAM, 0.35)}" stroke-width="1" stroke-linecap="round" opacity="0.6"/>`)
        .join('');
    }
    s += nub(ctx, 25.5, 73, c, 12) + nub(ctx, 74.5, 76, c, -24, 4.3, 5.6);
    return s;
  }
  if (!ctx.lite) {
    const disc = mix(c, CREAM, 0.62);
    s += `<circle cx="42" cy="60.5" r="8" fill="${disc}" opacity="0.6"/><circle cx="58" cy="60.5" r="8" fill="${disc}" opacity="0.6"/>`;
  }
  s += blush(ctx, [36.5, 63.5], 66.5, 3);
  s += eyes(ctx, [42, 58], st === 'working' ? 61 : 60.5, 3.1, st);
  s += shape(ctx, 'M47.6 64.4L52.4 64.4L50 68.4Z', '#E3B867', { line: 0.8 });
  // the book, open
  s += shape(ctx, 'M33.5 73.4L50 76.6L66.5 73.4L67 84.4L50 88L33 84.4Z', '#8A5A3B');
  const pageR = 'M50 77.6L64.8 74.6L64.8 83.3L50 86.4Z';
  s += shape(ctx, 'M35.2 74.6L50 77.6L50 86.4L35.2 83.3Z', PAPER, { line: 0.8, flat: true });
  s += shape(ctx, pageR, PAPER, { line: 0.8, flat: true });
  if (!ctx.lite) {
    const ln = '#9AA9C2';
    s += `<path d="M38 77.4L47.6 79.3M38 79.8L47.6 81.7M38 82.2L44.6 83.6M52.4 79.3L62 77.4M52.4 81.7L62 79.8M52.4 84.1L59 82.7" stroke="${ln}" stroke-width="0.8" stroke-linecap="round" opacity="0.85"/>`;
  }
  s += `<g class="p-page" ${org(50, 80)}>${shape(ctx, pageR, PAPER, { line: 0.8, flat: true })}</g>`;
  s += nub(ctx, 33.6, 80.5, c, 18, 4.3, 5.4) + nub(ctx, 66.4, 80.5, c, -18, 4.3, 5.4);
  return s;
}

function drawScout(ctx, st, back) {
  const c = tone('scout');
  const cape = '#B98A48';
  const capeDeep = mix(cape, DEEP, 0.3);
  const d = blob(50, 67, 25, 25, { seed: 23 });
  const box = { cx: 50, cy: 67, rx: 25, ry: 25 };
  const wing = 'M34 54C23.5 55 17 64 17.2 82.5C19.4 80.4 21 81.2 22.6 84.4C24.2 81.3 26.2 81.6 28 85.2C29.6 82.3 31.6 82.6 33.4 85.4Z';
  const glass = () => {
    let g = `<g class="p-prop" ${org(66, 76)}><g transform="rotate(-38 66 76)">`;
    g += shape(ctx, 'M61.5 73.6L66 73.6L66 78.4L61.5 78.4Z', mix(BRASS, DEEP, 0.2), { line: 0.8 });
    g += shape(ctx, 'M65.5 72.9L83 72.9L83 79.1L65.5 79.1Z', BRASS, { line: 0.9 });
    g += shape(ctx, 'M82.5 71.2L90.4 70.4L90.4 81.6L82.5 80.8Z', mix(BRASS, '#8A5A3B', 0.35), { line: 0.9 });
    g += `<path d="M71 73.2L71 78.8M76.5 73.2L76.5 78.8" stroke="${mix(BRASS, DEEP, 0.4)}" stroke-width="${ctx.lite ? 1.6 : 1.1}"/>`;
    g += ellipse(ctx, 90.6, 76, 1.9, 5.4, '#3E5D6E', { line: 0.8, flat: true });
    if (!ctx.lite) g += `<ellipse cx="90.4" cy="74.2" rx="0.6" ry="1.6" fill="#DDE8F0"/>`;
    g += `</g></g>`;
    return g;
  };
  let s = feet(ctx, c);
  if (back) {
    s += glass();
    s += body(ctx, 'scout', d, c, box);
    const capeBack =
      'M25.6 61Q50 47 74.4 61L77.5 83.6C75.6 81.8 73.6 82.4 72 86C70.2 83 68 83.2 66.4 86.6C64.6 83.6 62 83.6 60.4 87C58.6 84 56 84 54.4 87.4C52.6 84.4 47.4 84.4 45.6 87.4C44 84 41.4 84 39.6 87C38 83.6 35.4 83.6 33.6 86.6C32 83.2 29.8 83 28 86C26.4 82.4 24.4 81.8 23 83.6Z';
    s += shape(ctx, capeBack, cape);
    if (!ctx.lite) {
      s += `<path d="M30 67.5Q33.2 71.6 36.4 67.5Q39.6 71.6 42.8 67.5Q46 71.6 49.2 67.5Q52.4 71.6 55.6 67.5Q58.8 71.6 62 67.5Q65.2 71.6 68.4 67.5Q70 70 71.4 68.4M28.6 74.5Q32 78.6 35.4 74.5Q38.8 78.6 42.2 74.5Q45.6 78.6 49 74.5Q52.4 78.6 55.8 74.5Q59.2 78.6 62.6 74.5Q66 78.6 69.4 74.5Q71.4 77 73 75.4" stroke="${capeDeep}" stroke-width="1.1" fill="none" opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    s += `<path d="M25.6 61Q50 47 74.4 61" fill="none" stroke="${mix(cape, CREAM, 0.4)}" stroke-width="1.4" opacity="0.8"/>`;
    s += nub(ctx, 24.8, 74, c, 14);
    return s;
  }
  s += shape(ctx, wing, cape) + shape(ctx, mirror(wing), cape);
  if (!ctx.lite) {
    s += `<path d="M21.5 68C23.4 72.5 25.6 77 27.6 81M27 62C28.2 67 30 73 32 79M78.5 68C76.6 72.5 74.4 77 72.4 81M73 62C71.8 67 70 73 68 79" stroke="${capeDeep}" stroke-width="1" fill="none" opacity="0.6" stroke-linecap="round"/>`;
  }
  s += body(ctx, 'scout', d, c, box);
  s += shape(ctx, 'M25.4 66.6Q50 82.6 74.6 66.6L75.2 72Q50 89.4 24.8 72Z', cape);
  s += ellipse(ctx, 50, 78.4, 2.7, 2.7, '#E3B867', { line: 0.8 });
  s += blush(ctx, [36.5, 63.5], 64.5, 3);
  s += eyes(ctx, [42, 58], 59.6, 3.1, st);
  if (!ctx.lite) {
    s += `<path d="M40.6 63.6Q39.8 66.4 41.2 68.6M59.4 63.6Q60.2 66.4 58.8 68.6" stroke="${capeDeep}" stroke-width="1.7" fill="none" stroke-linecap="round" opacity="0.75"/>`;
  }
  s += shape(ctx, 'M47.8 63.2Q50 62.4 52.2 63.2Q51.8 66.4 50 67.8Q48.6 66 47.8 63.2Z', '#E3B867', { line: 0.8 });
  s += nub(ctx, 25.6, 75, c, 14);
  s += glass();
  s += `<g class="p-prop-hand">${nub(ctx, 66.5, 77, c, -20, 4.4, 5.2)}</g>`;
  return s;
}

function drawBaker(ctx, st, back) {
  const c = tone('baker');
  const capC = '#FBF6EC';
  const d = blob(50, 67, 25, 25, { seed: 31 });
  const box = { cx: 50, cy: 67, rx: 25, ry: 25 };
  const tray = () => {
    let g = `<g class="p-tray" ${org(74, 56)}>`;
    g += nub(ctx, 74, 57.5, c, 24, 4.2, 6.4);
    g += shape(ctx, 'M57.8 49.2L90.2 49.2Q91.4 52.6 88.4 53.2L59.6 53.2Q56.6 52.6 57.8 49.2Z', '#C08A55', { line: 0.9 });
    for (const [x, y] of [[65, 46.4], [74, 45.7], [83, 46.4]]) {
      g += ellipse(ctx, x, y, 4.6, 3.1, '#D9A066', { line: 0.8 });
      g += `<ellipse cx="${x}" cy="${y - 0.2}" rx="1.5" ry="0.75" fill="#8A5A3B"/>`;
      if (!ctx.lite) g += `<circle cx="${x - 2.4}" cy="${y - 1}" r="0.45" fill="${PAPER}"/><circle cx="${x + 2.2}" cy="${y - 1.3}" r="0.45" fill="${PAPER}"/><circle cx="${x + 0.4}" cy="${y + 1.5}" r="0.45" fill="${PAPER}"/>`;
    }
    return g + `</g>`;
  };
  const cap = () => {
    let g = puffs(ctx, [[41, 33.4, 7.8], [50, 28.8, 9.2], [59, 33.4, 7.8]], capC);
    g += shape(ctx, 'M36.8 37Q50 34.4 63.2 37L63.6 45.2Q50 42.6 36.4 45.2Z', capC);
    if (!ctx.lite) g += `<path d="M45.2 30.5L46 36.6M54.8 30.5L54 36.6" stroke="${mix(capC, COOL, 0.4)}" stroke-width="1" stroke-linecap="round" opacity="0.7"/>`;
    return g;
  };
  let s = feet(ctx, c);
  s += body(ctx, 'baker', d, c, box);
  if (back) {
    s += `<path d="M26.4 74Q50 79.6 73.6 74" fill="none" stroke="${INK}" stroke-width="${r2(2.4 + ctx.sw * 1.6)}" stroke-linecap="round"/>`;
    s += `<path d="M26.4 74Q50 79.6 73.6 74" fill="none" stroke="${PAPER}" stroke-width="2.4" stroke-linecap="round"/>`;
    const loop = 'M50 77C45 72.4 40.6 74.2 42.6 77.8C44.4 79.6 47.8 78.6 50 77Z';
    s += shape(ctx, loop, PAPER, { line: 0.8, flat: true }) + shape(ctx, mirror(loop), PAPER, { line: 0.8, flat: true });
    s += rod(ctx, 'M49 78L46.6 83.6', PAPER, 1.6) + rod(ctx, 'M51 78L53.4 83.6', PAPER, 1.6);
    s += ellipse(ctx, 50, 77, 1.9, 1.9, PAPER, { line: 0.8, flat: true });
    s += cap();
    s += nub(ctx, 25.5, 73, c, 12);
    s += tray();
    return s;
  }
  s += shape(ctx, 'M35 71.2Q50 74.2 65 71.2L66.6 87.2Q50 92.6 33.4 87.2Z', PAPER, { line: 0.8 });
  if (!ctx.lite) s += `<path d="M45 79.4L55 79.4L54.4 84.2Q50 85.6 45.6 84.2Z" fill="none" stroke="${mix(PAPER, COOL, 0.45)}" stroke-width="1"/>`;
  s += cap();
  s += blush(ctx, [36.5, 63.5], 66, 3.2);
  s += eyes(ctx, [42, 58], 61.4, 3.1, st);
  if (!ctx.lite && st !== 'sleeping') s += `<path d="M47.8 66.2Q50 67.8 52.2 66.2" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`;
  s += tray();
  s += nub(ctx, 25.8, 73.4, c, 14);
  s += `<g class="p-cloth" ${org(26, 72)}>${shape(ctx, 'M21.6 70.2Q26.6 68 31.2 70.2L30.6 80.4Q28.6 82.4 27 79.6Q25 82.4 23.2 79.2Z', PAPER, { line: 0.9 })}`;
  if (!ctx.lite) s += `<path d="M22.3 75.2L30.9 75.2" stroke="${GOLD}" stroke-width="1.2"/>`;
  s += `</g>`;
  return s;
}

function drawKeeper(ctx, st, back) {
  const c = tone('keeper');
  const d = blob(50, 68, 29, 24, { seed: 43, egg: 0.05 });
  const box = { cx: 50, cy: 68, rx: 29, ry: 24 };
  const wick = '#C4935A';
  const basket = () => {
    let g = `<g class="p-prop" ${org(23, 66)}>`;
    g += rod(ctx, 'M13.2 76.6Q22.4 59 31.4 76.6', wick, 2.2);
    g += shape(ctx, 'M17.2 75.6C15 69 17.6 65.4 20 64.2C21.2 68.2 20.8 72 19.8 75.8Z', '#5E9A6A', { line: 0.8 });
    g += shape(ctx, 'M23.4 75.8L29.4 64.8Q31 65 30.8 66.6L26.8 76.2Z', '#E9934A', { line: 0.8 });
    g += `<path d="M30 65.2L31.6 62M30.2 65.4L33 63.6" stroke="#5E9A6A" stroke-width="1.3" stroke-linecap="round"/>`;
    g += shape(ctx, 'M11.8 76.2L32.6 76.2L30 89.2Q22.2 91.6 14.4 89.2Z', wick);
    if (!ctx.lite) g += `<path d="M13.4 80.6Q22.2 82.2 31.2 80.6M14.2 84.8Q22.2 86.4 30.4 84.8M17.6 77L18.4 89.6M22.2 77L22.2 90.4M26.8 77L26 89.6" stroke="${mix(wick, DEEP, 0.35)}" stroke-width="0.9" fill="none" opacity="0.7"/>`;
    g += ellipse(ctx, 22.2, 76.2, 10.8, 2.3, mix(wick, CREAM, 0.25), { line: 0.9 });
    return g + `</g>`;
  };
  let s = feet(ctx, c, [39, 61], 92.4, 7);
  s += ellipse(ctx, 30.4, 48, 7.6, 7.6, c) + ellipse(ctx, 69.6, 48, 7.6, 7.6, c);
  if (back) {
    s += basket();
    s += body(ctx, 'keeper', d, c, box);
    s += ellipse(ctx, 50, 84, 4.6, 4.2, mix(c, CREAM, 0.45));
    s += nub(ctx, 77.6, 74, c, -14) + nub(ctx, 22.4, 74, c, 14);
    return s;
  }
  s += `<circle cx="30.4" cy="48" r="3.6" fill="${mix(c, '#F2C9A8', 0.6)}"/><circle cx="69.6" cy="48" r="3.6" fill="${mix(c, '#F2C9A8', 0.6)}"/>`;
  s += body(ctx, 'keeper', d, c, box);
  s += blush(ctx, [34, 66], 67, 3.4);
  s += eyes(ctx, [40.6, 59.4], 60.4, 3.1, st);
  s += ellipse(ctx, 50, 69, 9, 6.2, mix(c, CREAM, 0.62), { line: 0.7 });
  s += shape(ctx, 'M47.4 66.2Q50 65 52.6 66.2Q51.8 68.6 50 69Q48.2 68.6 47.4 66.2Z', EYE, { line: 0, flat: true });
  if (!ctx.lite && st !== 'sleeping') s += `<path d="M50 69L50 70.8M47.6 71.2Q50 72.6 52.4 71.2" fill="none" stroke="${INK}" stroke-width="0.9" stroke-linecap="round"/>`;
  s += nub(ctx, 78, 74.6, c, -14);
  s += basket();
  s += nub(ctx, 24, 68.6, c, 10, 4.4, 5.4);
  return s;
}

function drawSteward(ctx, st, back) {
  const c = tone('steward');
  const d = blob(50, 63, 21, 29, { seed: 59, egg: 0.04 });
  const box = { cx: 50, cy: 63, rx: 21, ry: 29 };
  const navy = '#3F5470';
  const ledger = () => {
    let g = `<g class="p-ledger" transform="rotate(-10 27 72)">`;
    g += shape(ctx, 'M20 61L32 61L32 82L20 82Z', navy, { line: 0.9 });
    g += `<rect x="30.4" y="62" width="2" height="19" fill="${PAPER}"/>`;
    g += `<path d="M20 61L24 61L20 65Z" fill="${GOLD}"/>`;
    if (!ctx.lite) g += `<rect x="22.6" y="66" width="6" height="3" rx="0.6" fill="${PAPER}" opacity="0.85"/>`;
    return g + `</g>`;
  };
  const curl = 'M45.6 36C45 31 48.6 28.4 52.2 29.4C55.2 30.4 55.2 33.6 52.8 34.6C52.6 32.6 50.6 32 49.6 33.2C48.6 34.4 48.6 35.6 49 36.6Z';
  let s = feet(ctx, c, [43, 57], 92.4, 5.8);
  s += body(ctx, 'steward', d, c, box);
  s += shape(ctx, curl, c, { line: 0.9 });
  if (back) {
    s += `<path d="M34.6 56.4Q50 61.2 65.4 56.4" fill="none" stroke="${navy}" stroke-width="1.8" stroke-linecap="round"/>`;
    s += ledger();
    s += nub(ctx, 30, 71, c, 10) + nub(ctx, 71.4, 72, c, -10);
    return s;
  }
  s += blush(ctx, [38.6, 61.4], 57.4, 3);
  s += eyes(ctx, [44, 56], 52, 2.9, st);
  if (!ctx.lite) {
    s += `<g fill="none" stroke="#B8924E" stroke-width="1"><circle cx="44" cy="52" r="4.7"/><circle cx="56" cy="52" r="4.7"/><path d="M48.7 51.6Q50 50.4 51.3 51.6"/></g>`;
  }
  s += `<path d="M37 58Q43 64.4 50 67.2Q57 64.4 63 58" fill="none" stroke="${navy}" stroke-width="1.8" stroke-linecap="round"/>`;
  let k = `<g class="p-key" ${org(50, 68)}>`;
  k += `<circle cx="50" cy="70" r="3.1" fill="none" stroke="${INK}" stroke-width="${r2(2.2 + ctx.sw * 1.4)}"/><circle cx="50" cy="70" r="3.1" fill="none" stroke="#E2B865" stroke-width="2.2"/>`;
  k += rod(ctx, 'M50 73.2L50 83.2', '#E2B865', 2.1);
  k += rod(ctx, 'M50.6 79.4L53.6 79.4M50.6 82.4L52.8 82.4', '#E2B865', 1.6);
  k += `</g>`;
  s += k;
  s += ledger();
  s += nub(ctx, 30.4, 71, c, 12);
  s += nub(ctx, 71.6, 72, c, -10);
  return s;
}

function drawBard(ctx, st, back) {
  const c = tone('bard');
  const d = blob(50, 67, 25, 25, { seed: 41 });
  const box = { cx: 50, cy: 67, rx: 25, ry: 25 };
  const tail = (dx = 0) => {
    let g = `<g class="p-tail" ${org(66 + dx, 84)}>${dx ? `<g transform="translate(${dx} 1)">` : ''}`;
    // painted in two washes, not a gradient: the fox color, then a cream tip laid over it
    const td = 'M63.6 87C80 93.4 96.4 78 92.2 58C90.2 47.4 84.2 42 78.8 44C82.8 50 84 58 81.6 66C78.6 74 72 79 63 80Z';
    g += `<path d="${td}" fill="${ctx.paint(c)}"/>`;
    g += `<path d="M78.8 44C84.2 42 90.2 47.4 92.2 58C92.7 60.6 92.9 63.2 92.7 65.6C90.4 62.6 87.6 61.4 84.6 62.4C83.6 61.2 82.6 61 82 61.4C83.4 55.6 82.4 49.6 78.8 44Z" fill="${PAPER}" opacity="0.95"/>`;
    if (!ctx.lite) g += `<path d="M66 85.6C76 87.6 85.4 82 89.4 72.6C84 79.4 76 82.6 66.4 82.4Z" fill="${SHADE}" opacity="0.4"/>`;
    g += ink(ctx, td, 1);
    if (!ctx.lite) g += `<path d="M86 64Q88.6 70 86.4 76M89 56Q91 60 90.4 64M80 80Q84.6 79.6 87.6 76" fill="none" stroke="${mix(c, DEEP, 0.3)}" stroke-width="0.9" stroke-linecap="round" opacity="0.5"/>`;
    return g + (dx ? '</g>' : '') + `</g>`;
  };
  const brush = () => {
    let g = `<g class="p-prop" ${org(27, 76)}>`;
    g += rod(ctx, 'M27 77L19.6 52', '#A9774E', 2.2);
    g += rod(ctx, 'M19.6 52L18.4 47.8', '#C9CDD3', 2.8);
    g += shape(ctx, 'M17.2 48.6C15.4 45 16 41.4 17.6 38.8C19.6 41.4 20.8 44.6 19.8 47.9Z', '#E8B85A', { line: 0.9 });
    return g + `</g>`;
  };
  let s = feet(ctx, c);
  if (back) {
    s += brush();
    s += body(ctx, 'bard', d, c, box);
    s += nub(ctx, 25.6, 74, c, 14) + nub(ctx, 74.4, 74, c, -14);
    s += tail(-13);
    return s;
  }
  s += tail();
  s += body(ctx, 'bard', d, c, box);
  s += blush(ctx, [36.5, 63.5], 65.6, 3.2);
  s += eyes(ctx, [42, 58], 61, 3.1, st);
  if (!ctx.lite) s += `<circle cx="64.4" cy="68.6" r="1.3" fill="#E8B85A" opacity="0.95"/><circle cx="66.2" cy="70.4" r="0.7" fill="#E8B85A" opacity="0.8"/>`;
  if (!ctx.lite && st !== 'sleeping') s += `<path d="M47.6 66.2Q50 68.2 52.4 66.2" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`;
  s += nub(ctx, 74.4, 74.4, c, -14);
  s += brush();
  s += nub(ctx, 27.2, 76.4, c, 16, 4.4, 5.4);
  return s;
}

function drawHerald(ctx, st, back) {
  const c = tone('herald');
  const crest = '#D2702F';
  const d = blob(50, 67, 25, 25, { seed: 53 });
  const box = { cx: 50, cy: 67, rx: 25, ry: 25 };
  const horn = () => {
    let g = `<g class="p-prop" ${org(65, 75)}>`;
    g += rod(ctx, 'M64 76C70 76 76 70 80 62.6', BRASS, 2.8);
    g += shape(ctx, 'M78.4 64L83.8 52.6Q90.6 52.8 92.2 58.6L81.2 65Z', BRASS, { line: 0.9 });
    g += `<ellipse cx="88.4" cy="55.6" rx="4.4" ry="1.9" transform="rotate(32 88.4 55.6)" fill="${mix(BRASS, DEEP, 0.4)}"/>`;
    g += shape(ctx, 'M69.6 74.4L77.2 68.6L78.8 79.2L75 83.4L71.2 79.6Z', PAPER, { line: 0.9 });
    g += `<path d="M71.2 79.6L75 83.4L78.8 79.2" fill="none" stroke="${GOLD}" stroke-width="1.2"/>`;
    if (!ctx.lite) g += `<path d="M74.4 73.6L76.2 75.8L74.6 78L72.8 75.8Z" fill="${crest}"/>`;
    g += `<g class="p-toot" opacity="0"><path d="M94.6 49.4Q97.6 51.6 96.8 56M97 45.6Q101.4 48.8 100.4 55" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/></g>`;
    return g + `</g>`;
  };
  let s = feet(ctx, c);
  s += puffs(ctx, [[43.4, 40.6, 5.2], [50, 35.6, 6.4], [56.6, 40.6, 5.2]], crest);
  if (back) {
    s += horn();
    s += body(ctx, 'herald', d, c, box);
    s += nub(ctx, 25.6, 74, c, 14) + nub(ctx, 74.4, 74, c, -14);
    return s;
  }
  s += body(ctx, 'herald', d, c, box);
  s += blush(ctx, [36.5, 63.5], 65.6, 3.2);
  s += eyes(ctx, [42, 58], 60.6, 3.1, st);
  s += shape(ctx, 'M47.4 64L52.6 64L50 68.6Z', '#E9C35E', { line: 0.8 });
  s += nub(ctx, 25.6, 74.6, c, 14);
  s += horn();
  s += nub(ctx, 65.4, 76.6, c, -18, 4.4, 5.2);
  return s;
}

function drawIcon(ctx, st, back) {
  const coatC = ICON.coat;
  const trim = ICON.trim;
  const navy = '#34495A';
  const coat = 'M42.6 47.4C37.4 48 34 51 33 56.4C31 68 28 80 25.6 89.6Q50 95.4 74.4 89.6C72 80 69 68 67 56.4C66 51 62.6 48 57.4 47.4Z';
  const box = { cx: 50, cy: 70, rx: 24, ry: 23 };
  const reading = st === 'reading';
  const gw = ctx.lite ? 2.4 : 1.6;
  const cape = 'M39.6 48.2C34.2 49.2 30.4 53 29.4 60Q50 70 70.6 60C69.6 53 65.8 49.2 60.4 48.2Z';
  const collar = 'M40.6 47.6Q50 52.6 59.4 47.6L61.4 51.6Q50 56.8 38.6 51.6Z';
  const sleeveHang = 'M31 58C29.6 64 29 71 29.6 77.2L35.6 77.8C35.8 71 36.6 65 37.8 60Z';
  const sleeveRead = 'M30.8 58C29.2 65 32 72.4 39.6 76.4L43.4 72.8C38.8 69.8 36.8 65 37.6 60Z';
  const satchel = (flip) => {
    const m = flip ? mirror : (x) => x;
    let g = rod(ctx, m('M63.6 75L61.6 66.8'), PAPER, 3) + rod(ctx, m('M68.2 75L69.8 66.4'), PAPER, 3);
    if (!ctx.lite) g += rod(ctx, m('M62.2 69.4L62.4 69.3M69.4 69.2L69.6 69.3'), GOLD, 1.2);
    g += shape(ctx, m('M61 74.6L75 74.6Q76 82 74.6 87.6Q68 89.2 61.4 87.6Q60 82 61 74.6Z'), ICON.satchel);
    g += shape(ctx, m('M60.8 74.6L75.2 74.6L74.6 80.2Q68 82.2 61.4 80.2Z'), mix(ICON.satchel, DEEP, 0.2), { line: 0.9 });
    g += `<rect x="${flip ? r2(100 - 69.3) : 66.7}" y="79.6" width="2.6" height="2.4" rx="0.5" fill="${GOLD}" stroke="${INK}" stroke-width="0.6"/>`;
    return g;
  };
  const capelet = () =>
    shape(ctx, cape, coatC) +
    `<path d="M29.8 59.4Q50 69.2 70.2 59.4" fill="none" stroke="${trim}" stroke-width="${gw + 0.3}" stroke-linecap="round"/>` +
    (ctx.lite ? '' : `<path d="M36 53.6Q35 57.6 35.6 62.4M64 53.6Q65 57.6 64.4 62.4" fill="none" stroke="${COOL}" stroke-width="1" opacity="0.25" stroke-linecap="round"/>`);
  const boots =
    `<g class="p-fl" ${org(44.6, 92.6)}${lift(ctx, -1)}>${ellipse(ctx, 44.6, 92.6, 5.2, 3.1, '#6A4A38')}</g>` +
    `<g class="p-fr" ${org(55.4, 92.6)}${lift(ctx, 1)}>${ellipse(ctx, 55.4, 92.6, 5.2, 3.1, '#6A4A38')}</g>`;
  let s = boots;
  s += body(ctx, 'icon', coat, coatC, box, 0.2);
  s += `<path d="M26 88.6Q50 94.2 74 88.6" fill="none" stroke="${trim}" stroke-width="${gw + 0.4}" stroke-linecap="round"/>`;
  if (back) {
    if (!ctx.lite) {
      const fold = mix(SHADE, VIOLET, 0.3);
      s += `<path d="M49 64Q48.4 78 47.6 92L52.6 92Q51.8 78 51 64Z" fill="${fold}" opacity="0.22"/>`;
      s += `<path d="M60 66Q62.6 78 66 89.4L70.4 88.6Q66 77.6 62.4 64.6Z" fill="${fold}" opacity="0.26"/>`;
      s += `<path d="M40 66Q38.6 78 37 88M60 66Q61.4 78 63 88" fill="none" stroke="${INK_SOLID}" stroke-width="0.8" opacity="0.26" stroke-dasharray="7 3 12 4" stroke-linecap="round"/>`;
    }
    s += satchel(true);
    s += shape(ctx, sleeveHang, coatC) + shape(ctx, mirror(sleeveHang), coatC);
    s += `<path d="M29.7 75.8L35.6 76.4M70.3 75.8L64.4 76.4" stroke="${trim}" stroke-width="${gw}" stroke-linecap="round"/>`;
    s += ellipse(ctx, 32.6, 79.6, 2.7, 2.7, SKIN, { line: 0.8 }) + ellipse(ctx, 67.4, 79.6, 2.7, 2.7, SKIN, { line: 0.8 });
    s += capelet();
    s += rod(ctx, 'M61.6 52L44 64.6', '#7A4E36', 2.2);
    s += shape(ctx, collar, coatC);
    s += ellipse(ctx, 50, 36.6, 12.3, 12.3, SKIN);
    s += shape(ctx, 'M37.8 37C37 26 43 22.4 50 22.4C57 22.4 63 26 62.2 37C62 43.4 57 48.4 50 48.4C43 48.4 38 43.4 37.8 37Z', HAIR);
    if (!ctx.lite) s += `<path d="M42.4 27.4Q50 24 57.6 27.4M44 33Q50 31 56 33" fill="none" stroke="#8A7A72" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>`;
    return s;
  }
  s += `<path d="M47.6 93.6L50 81L52.4 93.6Z" fill="${navy}"/>`;
  s += `<path d="M50 66L50 81M47.6 93.4L50 81L52.4 93.4" fill="none" stroke="${trim}" stroke-width="${gw}" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (!ctx.lite) {
    // the coat hangs: cool folds between the lit panels, a heavier one on the shadow side
    const fold = mix(SHADE, VIOLET, 0.3);
    s += `<path d="M41.2 66.6Q39 77 35.8 89.2L40.2 90.2Q41.2 78.4 42.4 67.4Z" fill="${fold}" opacity="0.2"/>`;
    s += `<path d="M59.2 66.4Q62.4 77 66.4 88.8L70.8 88.2Q66.2 77.6 62.6 64.8Z" fill="${fold}" opacity="0.28"/>`;
    s += `<path d="M54.6 72Q55.8 81 57.2 91.2L59.6 91Q58 80.6 56 71.4Z" fill="${fold}" opacity="0.16"/>`;
    s += `<path d="M40 67Q38.6 78 37 88M60.6 67Q62 78 63.4 88" fill="none" stroke="${INK_SOLID}" stroke-width="0.8" opacity="0.28" stroke-dasharray="7 3 12 4" stroke-linecap="round"/>`;
  }
  s += rod(ctx, 'M56 65L66 78.6', '#7A4E36', 2.2);
  s += satchel(false);
  if (reading) s += shape(ctx, sleeveRead, coatC) + shape(ctx, mirror(sleeveRead), coatC);
  else {
    s += shape(ctx, sleeveHang, coatC) + shape(ctx, mirror(sleeveHang), coatC);
    s += `<path d="M29.7 75.8L35.6 76.4M70.3 75.8L64.4 76.4" stroke="${trim}" stroke-width="${gw}" stroke-linecap="round"/>`;
    s += ellipse(ctx, 32.6, 79.6, 2.7, 2.7, SKIN, { line: 0.8 }) + ellipse(ctx, 67.4, 79.6, 2.7, 2.7, SKIN, { line: 0.8 });
  }
  s += capelet();
  s += shape(ctx, collar, coatC);
  s += `<path d="M38.6 51.6Q50 56.8 61.4 51.6" fill="none" stroke="${trim}" stroke-width="${gw}" stroke-linecap="round"/>`;
  // the compass emblem, worn as the cape clasp
  s += ellipse(ctx, 50, 59.6, ctx.lite ? 3.8 : 3.4, ctx.lite ? 3.8 : 3.4, GOLD, { line: 0.8 });
  if (!ctx.lite) {
    s += `<circle cx="50" cy="59.6" r="2.2" fill="${PAPER}"/>`;
    s += `<path d="M50 57.2L50.7 59.6L50 62L49.3 59.6Z" fill="${navy}"/><path d="M47.6 59.6L50 59L52.4 59.6L50 60.2Z" fill="${mix(navy, CREAM, 0.45)}"/>`;
  }
  if (reading) {
    let p = `<g class="p-scroll" ${org(50, 74)}><g transform="rotate(-3 50 70)">`;
    p += shape(ctx, 'M41.6 64.6L58.4 64.6L58 76L42 76Z', '#F6ECD5', { line: 0.9, flat: true });
    if (!ctx.lite) p += `<path d="M44.2 67.6L55.8 67.6M44.2 70L55.8 70M44.2 72.4L52.4 72.4" stroke="#9AA9C2" stroke-width="0.8" stroke-linecap="round"/>`;
    p += `</g></g>`;
    s += p;
    s += ellipse(ctx, 42, 74.4, 2.6, 2.6, SKIN, { line: 0.8 }) + ellipse(ctx, 58, 74.4, 2.6, 2.6, SKIN, { line: 0.8 });
  }
  s += ellipse(ctx, 50, 36.6, 12.3, 12.3, SKIN);
  s += shape(ctx, 'M37.6 37.6C36.8 26 43 22.4 50 22.4C57.4 22.4 63.6 26.4 62.5 37C60.8 32.6 57 30 53 31.2C50 29.6 46.6 30 44 31.6C41.4 32.6 39.2 34.6 37.6 37.6Z', HAIR);
  if (!ctx.lite) s += `<path d="M43.6 26.6Q50 24.4 56.4 26.6" fill="none" stroke="#8A7A72" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>`;
  s += blush(ctx, [43, 57], 42.6, 2.4);
  s += eyes(ctx, [45.4, 54.6], reading ? 39.4 : 38.4, 1.9, reading ? 'working' : st);
  return s;
}

const DRAW = {
  scholar: drawScholar,
  scout: drawScout,
  baker: drawBaker,
  keeper: drawKeeper,
  steward: drawSteward,
  bard: drawBard,
  herald: drawHerald,
  icon: drawIcon,
};

// ---------------------------------------------------------------- markers

function markerKind(state) {
  if (state === 'working' || state === 'traveling') return 'diamond';
  if (state === 'waiting') return 'question';
  if (state === 'sleeping') return 'z';
  return null;
}
// Marker drawn in a 40 by 40 box, centered on (20, 20).
function markerInner(kind, color, lite) {
  const sw = lite ? 2.6 : 1.7;
  if (kind === 'diamond') {
    const h = lite ? 12 : 10;
    const w = lite ? 8.4 : 7;
    let g = `<g class="sao-mk sao-mk-diamond"><g class="mk-gem">`;
    g += `<path d="M20 ${20 - h}L${r2(20 + w)} ${lite ? 20 : 20.6}L20 ${20 + h}L${r2(20 - w)} 20Z" fill="${color}" stroke="${lite ? INK : INK_SOLID}" stroke-opacity="${lite ? 1 : 0.62}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    g += `<path d="M20 ${20 - h + 1.6}L20 20L${20 - w + 1.4} 20Z" fill="${CREAM}" opacity="0.55"/>`;
    g += `<path d="M20 ${20 + h - 1.6}L${20 + w - 1.4} 20L20 20Z" fill="${mix(color, COOL, 0.45)}" opacity="0.65"/>`;
    return g + `</g></g>`;
  }
  const txt = (t, x, y, size, italic, cls = '') =>
    `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="700"${italic ? ' font-style="italic"' : ''} fill="${color}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke">${t}</text>`;
  if (kind === 'question') return `<g class="sao-mk sao-mk-question">${txt('?', 20, lite ? 31 : 29, lite ? 34 : 28, false)}</g>`;
  if (kind === 'z') {
    if (lite) return `<g class="sao-mk sao-mk-z">${txt('z', 20, 30, 32, true, 'mk-z1')}</g>`;
    return `<g class="sao-mk sao-mk-z">${txt('z', 14, 30, 16, true, 'mk-z1')}${txt('z', 25, 19, 22, true, 'mk-z2')}</g>`;
  }
  return '';
}
function roleColor(id) {
  return id === 'icon' ? GOLD : BOT[id] ? tone(id) : GOLD;
}

export function markerSVG(state, color = GOLD, { lite = false } = {}) {
  const kind = markerKind(state);
  if (!kind) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" class="sao-marker-svg" aria-hidden="true" focusable="false" overflow="visible">${markerInner(kind, color, lite)}</svg>`;
}

// ---------------------------------------------------------------- sprite

export function spriteSVG(id, opts = {}) {
  const key = DRAW[id] ? id : 'scholar';
  const size = opts.size || 96;
  const state = opts.state || (key === 'icon' ? 'reading' : 'working');
  const facing = opts.facing === 'back' ? 'back' : 'front';
  const lite = opts.lite ?? size < 40;
  const showMarker = opts.marker !== false;
  const showShadow = opts.shadow !== false;
  const light = LIGHTS[opts.light] ? opts.light : LIGHT;
  const ctx = makeCtx(lite, opts.pose || {}, light);
  const L = ctx.L;
  const look = state === 'traveling' ? 'working' : state;
  const art = DRAW[key](ctx, look, facing === 'back');

  let shadow = '';
  if (showShadow) {
    const sh = ctx.id('s');
    ctx.defs.push(`<filter id="${sh}" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="1.3"/></filter>`);
    const rx = key === 'icon' ? 19 : key === 'keeper' ? 24 : 20;
    // soft contact shadow cast away from the light: short by day, long and
    // thin at sunset, faint under the moon; a dark core right under the feet
    const cx = r2(50 + (L.sh.x / 100) * rx * 2 * 0.5);
    const lx = r2(rx * L.sh.s);
    shadow =
      `<g class="p-shadow" filter="url(#${sh})" opacity="${L.sh.o}"${MUL}>` +
      `<ellipse cx="${cx}" cy="94.4" rx="${lx}" ry="${L.sh.s > 1.3 ? 2.8 : 3.8}" fill="${CONTACT}" opacity="0.35"/>` +
      `<ellipse cx="${r2(50 + 1.4 * L.dir)}" cy="93.9" rx="${r2(rx * 0.62)}" ry="1.9" fill="${CONTACT}" opacity="0.3"/></g>`;
  }
  let mk = '';
  const kind = showMarker ? markerKind(state) : null;
  if (kind) {
    const sc = lite ? 0.95 : 0.78;
    const my = MARK_Y[key];
    mk = `<g transform="translate(${r2(50 - 20 * sc)} ${r2(my - 20 * sc)}) scale(${sc})">${markerInner(kind, roleColor(key), lite)}</g>`;
  }
  const name = key === 'icon' ? ICON.name : BOT[key].name;
  // Hand made: a faint wobble on every edge and paper grain in the wash.
  let paper = '';
  if (!lite) {
    const f = ctx.id('f');
    const sd = (key.length * 7 + (facing === 'back' ? 3 : 0)) % 97;
    ctx.defs.push(
      `<filter id="${f}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="turbulence" baseFrequency="0.07" numOctaves="2" seed="${sd}" result="w"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="w" scale="1.5" xChannelSelector="R" yChannelSelector="G" result="d"/>` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="3" seed="${sd + 11}" result="n"/>` +
        `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42 0 0 0 0 0.33 0 0 0 0 0.3 0.46 0 0 0 -0.25" result="g"/>` +
        `<feComposite in="g" in2="d" operator="in" result="gi"/>` +
        `<feMerge><feMergeNode in="d"/><feMergeNode in="gi"/></feMerge></filter>`,
    );
    paper = ` filter="url(#${f})"`;
  }
  // the scene light glazes the whole figure (sunset warms it, the moon cools it)
  let glaze = '';
  if (L.grade) {
    const g = ctx.id('g');
    ctx.defs.push(`<filter id="${g}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${L.grade}"/></filter>`);
    glaze = ` filter="url(#${g})"`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" class="sao-sprite-svg" data-sprite="${key}" aria-hidden="true" focusable="false" overflow="visible">` +
    `<title>${name}</title><defs>${ctx.defs.join('')}</defs>` +
    shadow +
    `<g class="p-all" ${org(50, 93)}><g${glaze}><g${paper}>${art}</g></g></g>` +
    mk +
    `</svg>`
  );
}

// ---------------------------------------------------------------- crowd

const CSS = `
.sao-crowd{position:absolute;inset:0;pointer-events:none;overflow:hidden;opacity:1;transition:opacity 420ms ease-out;--q:1}
.sao-crowd.is-entering{opacity:0;transition:none}
.sao-crowd.is-reduced{transition:opacity 200ms linear}
.sao-bot{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;cursor:pointer;pointer-events:auto;border-radius:16px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;will-change:transform;color:inherit;font:inherit}
.sao-bot:focus{outline:none}
.sao-bot:focus-visible{outline:2px solid #E8C88E;outline-offset:2px}
.sao-bot .sao-body{position:absolute;left:50%;bottom:0;transform-origin:50% 94%;will-change:transform;pointer-events:none}
.sao-bot .sao-body svg,.sao-bot .sao-body img{display:block;width:100%;height:100%;user-select:none;-webkit-user-drag:none}
.sao-bot .sao-shadow{position:absolute;left:50%;bottom:0;border-radius:52% 46% 50% 47%;background:radial-gradient(closest-side,rgba(58,58,48,.35),rgba(58,58,48,.3) 50%,rgba(58,58,48,.12) 80%,rgba(58,58,48,0));opacity:var(--sho,1);pointer-events:none;mix-blend-mode:multiply}
.sao-bot .sao-shadow::after{content:"";position:absolute;left:26%;right:20%;top:20%;bottom:26%;border-radius:50%;background:radial-gradient(closest-side,rgba(58,52,40,.3),rgba(58,52,40,0))}
.sao-bot .sao-mark{position:absolute;left:50%;bottom:0;pointer-events:none}
.sao-bot .sao-mark svg{display:block;width:100%;height:100%}
.sao-sprite-svg g,.sao-marker-svg g,.sao-marker-svg text{transform-box:view-box}
.sao-mk-diamond{animation:sao-mk-float calc(3.2s * var(--q,1)) cubic-bezier(.45,0,.55,1) infinite;transform-origin:20px 20px}
.sao-mk-diamond .mk-gem{animation:sao-mk-turn calc(7s * var(--q,1)) cubic-bezier(.5,0,.3,1) infinite;transform-origin:20px 20px}
.sao-mk-question{animation:sao-mk-tilt calc(4.6s * var(--q,1)) infinite;transform-origin:20px 34px}
.sao-mk-z .mk-z1{animation:sao-mk-z calc(3.4s * var(--q,1)) cubic-bezier(.2,.6,.4,1) infinite;transform-origin:14px 26px}
.sao-mk-z .mk-z2{animation:sao-mk-z calc(3.4s * var(--q,1)) cubic-bezier(.2,.6,.4,1) calc(1.7s * var(--q,1)) infinite;transform-origin:25px 14px}
@keyframes sao-mk-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.6px)}}
@keyframes sao-mk-turn{0%,82%{transform:scaleX(1)}88%{transform:scaleX(.12)}94%{transform:scaleX(1.08)}100%{transform:scaleX(1)}}
@keyframes sao-mk-tilt{0%,80%{transform:rotate(0)}84%{transform:rotate(-13deg)}89%{transform:rotate(9deg)}93%{transform:rotate(-4deg)}97%,100%{transform:rotate(0)}}
@keyframes sao-mk-z{0%{opacity:0;transform:translate(-2px,5px) scale(.6)}22%{opacity:1}68%{opacity:1}100%{opacity:0;transform:translate(5px,-9px) scale(1.1)}}

.sao-bot.is-idle .p-page{animation:sao-page calc(1.2s * var(--q,1)) cubic-bezier(.3,0,.2,1) both}
.sao-bot.is-idle.k-scholar .p-all{animation:sao-nod calc(1.2s * var(--q,1)) cubic-bezier(.3,0,.3,1) both}
@keyframes sao-page{0%,14%{transform:none;opacity:1}62%{transform:scaleX(-1);opacity:1}84%{transform:scaleX(-1);opacity:1}100%{transform:scaleX(-1);opacity:0}}
@keyframes sao-nod{0%{transform:none}22%{transform:translateY(.8px) rotate(-2.5deg)}60%{transform:translateY(.4px) rotate(1.5deg)}100%{transform:none}}

.sao-bot.is-idle.k-scout .p-prop{animation:sao-glass calc(2.8s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-scout .p-prop-hand{animation:sao-glass-hand calc(2.8s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-scout .p-all{animation:sao-scan calc(2.8s * var(--q,1)) cubic-bezier(.45,0,.3,1) both}
@keyframes sao-glass{0%{transform:none}10%{transform:translate(1px,2px)}24%,80%{transform:translate(-3px,-14px) rotate(16deg)}100%{transform:none}}
@keyframes sao-glass-hand{0%{transform:none}10%{transform:translate(1px,2px)}24%,80%{transform:translate(-4px,-11px)}100%{transform:none}}
@keyframes sao-scan{0%,22%{transform:none}40%{transform:rotate(-5deg)}62%{transform:rotate(5deg)}80%{transform:rotate(-1deg)}100%{transform:none}}

.sao-bot.is-idle.k-baker .p-tray{animation:sao-tray calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-baker .p-all{animation:sao-heave calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
@keyframes sao-tray{0%{transform:none}14%{transform:translate(0,2.6px) rotate(3deg)}32%{transform:translate(-1px,-10px) rotate(-5deg)}42%{transform:translate(-1px,-8px) rotate(-2deg)}68%{transform:translate(-1px,-8.6px) rotate(-3deg)}84%{transform:translate(0,1.4px) rotate(1.5deg)}100%{transform:none}}
@keyframes sao-heave{0%{transform:none}14%{transform:scale(1.06,.92)}32%{transform:scale(.96,1.06) translateY(-1px)}46%{transform:scale(1.01,.99)}70%{transform:none}84%{transform:scale(1.04,.95)}100%{transform:none}}

.sao-bot.is-idle.k-keeper .p-all{animation:sao-tidy calc(2.1s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
.sao-bot.is-idle.k-keeper .p-prop{animation:sao-swing calc(2.1s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
@keyframes sao-tidy{0%{transform:none}12%{transform:scale(1.07,.9)}28%{transform:translateX(-2px) rotate(-8deg) scale(1.04,.94)}46%{transform:translateX(2px) rotate(7deg) scale(1.04,.94)}63%{transform:translateX(-1.5px) rotate(-6deg) scale(1.03,.95)}80%{transform:rotate(1.5deg) scale(.97,1.04)}100%{transform:none}}
@keyframes sao-swing{0%,12%{transform:none}28%{transform:translateY(2px) rotate(-16deg)}46%{transform:translateY(2px) rotate(14deg)}63%{transform:translateY(1px) rotate(-10deg)}80%{transform:rotate(3deg)}100%{transform:none}}

.sao-bot.is-idle.k-steward .p-key{animation:sao-key calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-steward .p-all{animation:sao-peer calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
@keyframes sao-peer{0%{transform:none}10%{transform:scale(1.03,.96)}22%,62%{transform:rotate(-4deg) translateY(.6px)}80%{transform:rotate(1.5deg)}100%{transform:none}}
@keyframes sao-key{0%{transform:none}14%,64%{transform:translateY(-3px)}24%{transform:translateY(-3px) rotate(80deg)}34%{transform:translateY(-3px)}46%{transform:translateY(-3px) rotate(80deg)}56%{transform:translateY(-3px)}82%{transform:translateY(.6px)}100%{transform:none}}

.sao-bot.is-idle.k-bard .p-tail{animation:sao-tail calc(2.3s * var(--q,1)) cubic-bezier(.45,0,.3,1) both}
.sao-bot.is-idle.k-bard .p-prop{animation:sao-brush calc(2.3s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-bard .p-all{animation:sao-dab calc(2.3s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
@keyframes sao-dab{0%{transform:none}12%{transform:rotate(3.5deg) scale(1.02,.97)}28%{transform:rotate(-4deg) scale(.98,1.03)}40%{transform:rotate(-1deg)}54%{transform:rotate(-3.5deg)}76%{transform:rotate(1deg)}100%{transform:none}}
@keyframes sao-tail{0%{transform:none}22%{transform:rotate(-9deg)}46%{transform:rotate(8deg)}70%{transform:rotate(-4deg)}100%{transform:none}}
@keyframes sao-brush{0%{transform:none}14%{transform:rotate(-14deg)}28%{transform:rotate(20deg)}40%{transform:rotate(-6deg)}54%{transform:rotate(18deg)}76%{transform:rotate(0)}100%{transform:none}}

.sao-bot.is-idle.k-herald .p-all{animation:sao-blow calc(2s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
.sao-bot.is-idle.k-herald .p-prop{animation:sao-horn calc(2s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-herald .p-toot{animation:sao-toot calc(2s * var(--q,1)) linear both}
@keyframes sao-blow{0%{transform:none}22%{transform:scale(.95,1.07)}40%{transform:scale(1.07,.93)}52%{transform:scale(1.03,.97)}64%{transform:scale(1.06,.94)}80%,100%{transform:none}}
@keyframes sao-horn{0%{transform:none}20%,70%{transform:translate(-3px,-5px) rotate(-18deg)}100%{transform:none}}
@keyframes sao-toot{0%,36%{opacity:0;transform:none}44%{opacity:.85}60%{opacity:.85;transform:translate(2px,-1px)}70%,100%{opacity:0;transform:translate(3px,-2px)}}

.sao-bot.is-idle.k-icon .p-scroll{animation:sao-read calc(1.8s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
@keyframes sao-read{0%{transform:none}30%{transform:translateY(-1.6px) rotate(-3deg)}62%{transform:translateY(-.8px) rotate(1.5deg)}100%{transform:none}}

.sao-crowd.is-paused *,.sao-crowd.is-paused *::before{animation-play-state:paused!important}
.sao-crowd.is-reduced *{animation:none!important}
@media (prefers-reduced-motion: reduce){.sao-crowd *{animation:none!important}}
`;

const IDLE_MS = { scholar: 1200, scout: 2800, baker: 1900, keeper: 2100, steward: 1900, bard: 2300, herald: 2000, icon: 1800 };

// Spots in ICON's town (percent of the vista). The scene paints the notice
// board and the bench under the lamp at these spots.
export const TOWN_SPOTS = {
  icon: [39, 70],
  bench: [[63, 73.5], [69, 74.5], [75, 73.5], [66, 79]],
};
const REST_T = [0.34, 0.62, 0.84];
const LANES = [-4.5, 4.5, 0];
const ACTIVE = new Set(['working', 'traveling', 'waiting']);

let crowd = null;
let pending = null;

function injectCSS() {
  if (typeof document === 'undefined' || document.getElementById('sao-characters-css')) return;
  const s = document.createElement('style');
  s.id = 'sao-characters-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nowS = () => performance.now() / 1000;

// Arc length parametrized, smoothed path through PLACE[id].path.
function buildPath(raw) {
  const pts = raw && raw.length >= 2 ? raw : [[50, 98], [50, 62]];
  const dense = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < 16; j++) {
      const t = j / 16;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(pts[n - 1]);
  const len = [0];
  for (let i = 1; i < dense.length; i++) {
    len.push(len[i - 1] + Math.hypot((dense[i][0] - dense[i - 1][0]) * 1.78, dense[i][1] - dense[i - 1][1]));
  }
  const total = len[len.length - 1] || 1;
  const yBot = Math.max(...pts.map((p) => p[1]));
  const yTop = Math.min(...pts.map((p) => p[1]));
  return {
    yBot,
    yTop,
    at(t) {
      const L = clamp(t, 0, 1) * total;
      let i = 1;
      while (i < len.length - 1 && len[i] < L) i++;
      const a = dense[i - 1];
      const b = dense[i];
      const f = (L - len[i - 1]) / (len[i] - len[i - 1] || 1);
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx: b[0] - a[0], dy: b[1] - a[1] };
    },
  };
}

function persp(y) {
  const p = crowd.path;
  const span = p.yBot - p.yTop || 1;
  return 0.45 + 0.55 * clamp((y - p.yTop) / span, 0, 1);
}

function labelFor(a) {
  if (a.kind === 'icon') return 'ICON, reading the notice board';
  const st = STATES[a.state] ? STATES[a.state].label.toLowerCase() : a.state;
  return a.task ? `${a.name}, ${st}: ${a.task}` : `${a.name}, ${st}`;
}

function visualState(a) {
  if (a.kind === 'icon') return 'reading';
  if (a.mode === 'nap') return 'sleeping';
  if (a.state === 'done') return 'done';
  if (a.state === 'traveling') return 'working';
  return a.state;
}

// Each sprite is painted once per state, facing, size and pose frame, then
// baked to pixels, so the crowd costs one <img> per bot instead of hundreds
// of SVG nodes with a paper filter. The live SVG only comes back while an
// idle habit plays (those animate parts of the drawing).
const RASTER = new Map();
function rasterURL(core, st, facing, lite, size, blink, stepF) {
  const key = `${core}|${st}|${facing}|${lite ? 1 : 0}|${size}|${blink ? 1 : 0}${stepF}|${LIGHT}`;
  const hit = RASTER.get(key);
  if (hit) return hit.url;
  if (RASTER.size > 400) RASTER.clear();
  const svg = spriteSVG(core, { state: st, size, facing, marker: false, shadow: false, lite, pose: { blink, step: stepF } });
  const r = { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
  RASTER.set(key, r);
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
        const c = document.createElement('canvas');
        c.width = c.height = Math.max(1, Math.round(size * dpr));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const vec = img.src;
        r.url = c.toDataURL('image/png');
        if (crowd) for (const x of crowd.actors.values()) if (x.imgEl && x.imgEl.src === vec) x.imgEl.src = r.url;
      } catch {
        /* keep the vector url */
      }
    };
    img.src = r.url;
  } catch {
    /* no Image in this context */
  }
  return r.url;
}

function renderSprite(a) {
  const st = visualState(a);
  if (a.live) {
    a.bodyEl.innerHTML = spriteSVG(a.core, { state: st, size: Math.round(crowd.base), facing: a.facing, marker: false, shadow: false, lite: a.lite });
    a.imgEl = null;
    a.eyesEl = a.bodyEl.querySelector('.p-eyes');
    a.footL = a.bodyEl.querySelector('.p-fl');
    a.footR = a.bodyEl.querySelector('.p-fr');
  } else {
    a.bodyEl.innerHTML = '<img alt="" draggable="false" decoding="sync">';
    a.imgEl = a.bodyEl.firstChild;
    a.eyesEl = a.footL = a.footR = null;
  }
  a.frameKey = '';
  a.eyeKey = '';
  a.footKey = '';
  const kind = st === 'reading' || st === 'done' ? null : markerKind(a.mode === 'nap' ? 'sleeping' : a.state);
  a.markEl.innerHTML = kind ? markerSVG(a.mode === 'nap' ? 'sleeping' : a.state, roleColor(a.core), { lite: a.lite }) : '';
  a.renderKey = `${st}|${a.facing}|${a.lite}|${a.state}|${a.mode === 'nap'}|${a.live ? 1 : 0}|${LIGHT}`;
}

function makeActor(spec, i) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `sao-bot k-${spec.core}`;
  el.dataset.bot = spec.id;
  el.innerHTML = '<span class="sao-shadow"></span><span class="sao-body"></span><span class="sao-mark"></span>';
  const a = {
    ...spec,
    el,
    shadowEl: el.children[0],
    bodyEl: el.children[1],
    markEl: el.children[2],
    i,
    seed: rand(0, 10),
    clock: rand(0, 10),
    t: 0,
    x: 50,
    y: 90,
    target: 0,
    vel: 0,
    phase: 0,
    stepRate: rand(2.1, 2.5),
    speed: 1 / rand(15, 25),
    sq: 1,
    sqV: 0,
    sqT: 1,
    rot: 0,
    tilt: 0,
    tiltV: 0,
    live: false,
    imgEl: null,
    frameKey: '',
    hop: 0,
    swing: 0,
    look: 0,
    facing: 'front',
    lite: false,
    blinkAt: nowS() + rand(1, 4),
    blinkUntil: 0,
    idleAt: 0,
    idleUntil: 0,
    modeUntil: 0,
    w: 0,
    h: 0,
    z: -1,
  };
  el.setAttribute('aria-label', labelFor(a));
  el.addEventListener('pointerenter', () => {
    if (!crowd.reduced) a.sqV += 1.6;
  });
  return a;
}

function assignMode(a, place, T, fresh) {
  const reduced = crowd.reduced;
  if (a.kind === 'icon') {
    a.mode = 'read';
    [a.x, a.y] = TOWN_SPOTS.icon;
    a.idleAt = T + rand(1.5, 4);
    return;
  }
  if (a.bench != null) {
    a.mode = a.state === 'done' && !crowd.quiet ? 'rest' : 'nap';
    [a.x, a.y] = TOWN_SPOTS.bench[a.bench % TOWN_SPOTS.bench.length];
    return;
  }
  const lane = LANES[a.i % LANES.length];
  a.lane = lane;
  if (a.state === 'waiting' || reduced) {
    a.mode = 'stand';
    a.t = REST_T[a.i % REST_T.length];
    a.facing = 'front';
    return;
  }
  if (a.state === 'traveling' && fresh) {
    a.t = 0;
    a.target = rand(0.8, 0.95);
    a.mode = 'prep';
    a.modeUntil = T + rand(0.2, 0.8);
    return;
  }
  if (fresh) a.t = clamp(REST_T[a.i % REST_T.length] + rand(-0.1, 0.1), 0.08, 0.95);
  a.mode = 'pause';
  a.facing = 'front';
  a.modeUntil = T + rand(1.5, 5);
  a.idleAt = T + rand(0.8, 2.2);
}

function nextTarget(a) {
  let t;
  do t = rand(0.06, 0.96);
  while (Math.abs(t - a.t) < 0.25);
  return t;
}

function measure() {
  if (!crowd) return;
  const r = crowd.layer.getBoundingClientRect();
  crowd.W = r.width || crowd.layer.clientWidth || 1;
  crowd.H = r.height || crowd.layer.clientHeight || 1;
  const base = Math.round(clamp(Math.min(crowd.H * 0.18, crowd.W * 0.16), 46, 124));
  if (base !== crowd.base) {
    crowd.base = base;
    for (const a of crowd.actors.values()) {
      a.bodyEl.style.width = `${base}px`;
      a.bodyEl.style.height = `${base}px`;
      a.shadowEl.style.width = `${Math.round(base * (a.core === 'keeper' ? 0.5 : a.core === 'icon' ? 0.4 : 0.44))}px`;
      a.shadowEl.style.height = `${Math.round(base * 0.1)}px`;
      const m = Math.round(base * 0.26);
      a.markEl.style.width = `${m}px`;
      a.markEl.style.height = `${m}px`;
      a.renderKey = '';
    }
  }
  crowd.vis = visibleSpan();
  crowd.avoid = avoidRects();
  for (const a of crowd.actors.values()) place(a);
}

// The part of the crowd layer that is really on screen, in layer pixels. On a
// phone the 16:9 painting covers a tall screen, so most of its width is cut
// off; bots are kept inside what is visible, never half off the edge.
function visibleSpan() {
  if (!crowd || typeof document === 'undefined') return null;
  const L = crowd.layer.getBoundingClientRect();
  const sx = L.width / (crowd.layer.offsetWidth || L.width || 1) || 1;
  const host = crowd.layer.closest('.sv-vista') || crowd.layer.parentElement;
  const V = host ? host.getBoundingClientRect() : L;
  const vw = (typeof window !== 'undefined' && (document.documentElement.clientWidth || window.innerWidth)) || V.right;
  const left = Math.max(V.left, L.left, 0);
  const right = Math.min(V.right, L.right, vw);
  if (!(right - left > 40)) return null;
  // the bottom edge that is really on screen: on desktop the vista ends where
  // the island map begins, well above the bottom of the painted layer
  const vh = (typeof window !== 'undefined' && (document.documentElement.clientHeight || window.innerHeight)) || V.bottom;
  const bottom = Math.min(V.bottom, L.bottom, vh);
  const sy = L.height / (crowd.layer.offsetHeight || L.height || 1) || 1;
  return { l: (left - L.left) / sx, r: (right - L.left) / sx, b: (bottom - L.top) / sy };
}

// The caption card sits over the vista; bots step aside instead of hiding
// under it. Rects are in the crowd layer's pixel space.
function avoidRects() {
  if (!crowd || typeof document === 'undefined') return [];
  const L = crowd.layer.getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll('#caption-slot > *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    out.push({ l: r.left - L.left, r: r.right - L.left, t: r.top - L.top, b: r.bottom - L.top });
  }
  // the phone dock along the bottom: bots keep their feet above it
  crowd.floor = Infinity;
  for (const el of document.querySelectorAll('#dock-slot > *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.top - L.top < crowd.H * 0.6) continue;
    crowd.floor = Math.min(crowd.floor, r.top - L.top - 6);
  }
  return out;
}

function step(a, dt, T) {
  const q = crowd.quiet ? 0.5 : 1;
  const dq = dt * q;
  a.clock += dq;
  // squash spring: weight, a little overshoot, settles
  a.sqV += (-(a.sq - a.sqT) * 170 - a.sqV * 11) * dt;
  a.sq += a.sqV * dt;
  let hop = 0;
  let rot = 0;
  let lift = 0;
  let lookT = 0;

  switch (a.mode) {
    case 'prep': {
      a.sqT = 0.88;
      if (T >= a.modeUntil) {
        a.mode = 'walk';
        a.sqT = 1;
        a.sqV += 2.4;
        a.vel = 0;
      }
      break;
    }
    case 'walk': {
      const dir = Math.sign(a.target - a.t) || 1;
      const sp = a.speed * q;
      a.vel = Math.min(sp, a.vel + sp * 2.4 * dt);
      const remain = Math.abs(a.target - a.t);
      const slow = clamp(remain / (sp * 0.7), 0.3, 1);
      const d = a.vel * slow * dt;
      a.phase += dt * a.stepRate * q * (a.vel * slow / sp);
      // poses held like hand drawn keys: four drawings per step, not a tween
      const s = Math.sin((Math.floor(a.phase * 4) / 4) * Math.PI);
      hop = Math.abs(s);
      rot = 2.8 * s;
      lift = s;
      if (d >= remain) {
        a.t = a.target;
        a.mode = 'pause';
        a.sqV -= 2.8;
        a.tiltV += (a.look >= 0 ? 1 : -1) * 70; // follow through: the body keeps going, then settles
        a.phase = 0;
        a.modeUntil = T + rand(5, 11) / q;
        a.idleAt = T + rand(0.7, 1.6) / q;
      } else {
        a.t += dir * d;
      }
      const p = crowd.path.at(a.t);
      const want = dir > 0 ? 'back' : 'front';
      if (want !== a.facing) {
        a.facing = want;
        a.sqV -= 0.9;
      }
      lookT = clamp(p.dx * dir * 0.9, -1, 1);
      break;
    }
    case 'pause': {
      if (a.facing !== 'front') {
        a.facing = 'front';
      }
      a.sqT = 1 + 0.01 * Math.sin(a.clock * 1.7 + a.seed);
      if (T >= a.idleAt && T >= a.idleUntil) {
        startIdle(a, T);
        a.idleAt = T + rand(4, 8) / q;
      }
      if (T >= a.modeUntil && T >= a.idleUntil) {
        a.target = nextTarget(a);
        a.mode = 'prep';
        a.modeUntil = T + 0.16 / q;
      }
      break;
    }
    case 'stand':
    case 'rest': {
      a.sqT = 1 + 0.012 * Math.sin(a.clock * 1.6 + a.seed);
      break;
    }
    case 'read': {
      a.sqT = 1 + 0.01 * Math.sin(a.clock * 1.4 + a.seed);
      if (T >= a.idleAt) {
        startIdle(a, T);
        a.idleAt = T + rand(5, 8) / q;
      }
      break;
    }
    case 'nap': {
      a.sqT = 1 - 0.03 + 0.03 * Math.sin(a.clock * 1.5 + a.seed);
      rot = 4 * Math.sin(a.clock * 0.75 + a.seed);
      break;
    }
    default:
      break;
  }
  if (a.idleUntil && T >= a.idleUntil) {
    a.el.classList.remove('is-idle');
    a.idleUntil = 0;
    a.live = false;
  }
  // tilt spring: a lean into the walk, overshoot on the stop
  const tiltT = a.mode === 'walk' ? a.look * 3 : 0;
  a.tiltV += (-(a.tilt - tiltT) * 90 - a.tiltV * 9) * dt;
  a.tilt += a.tiltV * dt;
  a.hop = hop;
  a.rot = rot + a.tilt;
  a.lift = lift;
  a.look += (lookT - a.look) * Math.min(1, dt * 6);
  // blink
  if (a.mode !== 'nap' && T >= a.blinkAt) {
    a.blinkUntil = T + 0.12;
    a.blinkAt = T + rand(2.4, 6);
  }
  place(a, T);
}

function startIdle(a, T) {
  a.el.classList.remove('is-idle');
  a.live = true; // the drawing itself moves: swap the baked frame for the live SVG
  renderSprite(a);
  void a.el.offsetWidth; // restart the animation
  a.el.classList.add('is-idle');
  a.idleUntil = T + (IDLE_MS[a.core] || 1600) / 1000 / (crowd.quiet ? 0.5 : 1) + 0.05;
}

function place(a, T = nowS()) {
  const c = crowd;
  if (a.mode === 'walk' || a.mode === 'prep' || a.mode === 'pause' || a.mode === 'stand') {
    const p = c.path.at(a.t);
    const s0 = persp(p.y);
    a.x = p.x + (a.lane || 0) * s0;
    a.y = p.y;
  }
  const s = persp(a.y);
  const size = c.base * s;
  const lite = size < 40;
  if (lite !== a.lite) a.lite = lite;
  const key = `${visualState(a)}|${a.facing}|${a.lite}|${a.state}|${a.mode === 'nap'}|${a.live ? 1 : 0}|${LIGHT}`;
  if (key !== a.renderKey) renderSprite(a);
  if (a.imgEl) {
    const blink = T < a.blinkUntil;
    const l = a.mode === 'walk' ? a.lift || 0 : 0;
    const stepF = l > 0.35 ? 1 : l < -0.35 ? -1 : 0;
    const fk = `${blink ? 1 : 0}${stepF}`;
    if (fk + LIGHT !== a.frameKey) {
      a.frameKey = fk + LIGHT;
      a.imgEl.src = rasterURL(a.core, visualState(a), a.facing, a.lite, Math.round(c.base), blink, stepF);
    }
  }

  const tall = a.kind === 'icon' ? 0.8 : a.core === 'baker' ? 0.78 : 0.66;
  const bw = Math.round(Math.max(44, size * 0.62));
  const bh = Math.round(Math.max(44, size * tall));
  if (bw !== a.w || bh !== a.h) {
    a.w = bw;
    a.h = bh;
    a.el.style.width = `${bw}px`;
    a.el.style.height = `${bh}px`;
  }
  // feet, contact shadow and the body's drop all stay at least 8 px above the
  // bottom edge of what is really on screen, walking or not
  const drop = c.base * s * 0.06 + c.base * 0.26 * Math.max(s, 0.72) * 0.25 + 8;
  const vb = c.vis && Number.isFinite(c.vis.b) ? c.vis.b : c.H;
  const py = Math.min((a.y / 100) * c.H, c.floor || Infinity, vb - drop);
  // stay inside a 16 px gutter of what is really on screen, measured on the
  // whole drawn sprite (body box, contact shadow and marker), and step aside
  // from the caption card. Where most of the painting is cut off (a phone),
  // the walk is mapped onto the visible span so no bot stands off screen.
  const pad = 16;
  const half = Math.max(bw / 2, (c.base * s * 1.04) / 2, (c.base * 0.26 * Math.max(s, 0.72)) / 2);
  const vis = c.vis || { l: 0, r: c.W };
  const visW = vis.r - vis.l;
  const lo = vis.l + pad + half;
  const hi = Math.max(lo, vis.r - pad - half);
  const narrow = visW < c.W * 0.7;
  let px = narrow ? lo + (clamp(a.x, 0, 100) / 100) * (hi - lo) : clamp((a.x / 100) * c.W, lo, hi);
  let want = 0;
  for (const r of c.avoid || []) {
    if (px + half > r.l - 6 && px - half < r.r + 6 && py > r.t - 4 && py - bh < r.b + 4) want = r.r + 10 + half - px;
  }
  a.adx = (a.adx || 0) + (want - (a.adx || 0)) * (a.adx == null || crowd.reduced ? 1 : 0.12);
  px = clamp(px + a.adx, lo, hi);
  const z = Math.round(a.y * 10);
  if (z !== a.z) {
    a.z = z;
    a.el.style.zIndex = String(z);
  }
  a.el.style.transform = `translate3d(${(px - bw / 2).toFixed(1)}px,${(py - bh).toFixed(1)}px,0)`;

  const sy = clamp(a.sq * (1 - 0.045 * (1 - a.hop) * (a.mode === 'walk' ? 1 : 0)), 0.7, 1.3);
  const sx = 1 + (1 - sy) * 0.9;
  const hopPx = a.hop * size * 0.07;
  a.bodyEl.style.transform = `translate(-50%,${(c.base * 0.06).toFixed(1)}px) translateY(${(-hopPx).toFixed(1)}px) scale(${(s * sx).toFixed(3)},${(s * sy).toFixed(3)}) rotate(${a.rot.toFixed(2)}deg)`;
  const SH = (LIGHTS[LIGHT] || LIGHTS.day).sh;
  const shk = s * (1 - a.hop * 0.28);
  a.shadowEl.style.transform = `translate(${(-50 + SH.x).toFixed(1)}%,50%) scale(${(shk * SH.s).toFixed(3)},${(shk * (SH.s > 1.3 ? 0.8 : 1)).toFixed(3)})`;
  const my = MARK_Y[a.core] ?? 24;
  const ms = Math.max(s, 0.72);
  const up = ((94 - my) / 100) * c.base * s * sy + hopPx;
  a.markEl.style.transform = `translate(-50%,50%) translateY(${(-up).toFixed(1)}px) scale(${ms.toFixed(3)})`;

  if (a.eyesEl) {
    const blink = T < a.blinkUntil ? 0.12 : 1;
    const lx = a.facing === 'front' ? a.look * 1.8 : 0;
    const ek = `${lx.toFixed(1)}|${blink}`;
    if (ek !== a.eyeKey) {
      a.eyeKey = ek;
      a.eyesEl.style.transform = `translateX(${lx.toFixed(1)}px) scaleY(${blink})`;
    }
  }
  if (a.footL && a.footR) {
    const l = a.mode === 'walk' ? a.lift : 0;
    const fk = l.toFixed(2);
    if (fk !== a.footKey) {
      a.footKey = fk;
      a.footL.style.transform = `translateY(${(-Math.max(0, l) * 2.8).toFixed(2)}px)`;
      a.footR.style.transform = `translateY(${(-Math.max(0, -l) * 2.8).toFixed(2)}px)`;
    }
  }
}

function frame(ms) {
  if (!crowd) return;
  crowd.raf = 0;
  const t = ms / 1000;
  const dt = clamp(t - (crowd.last || t), 0, 0.05);
  crowd.last = t;
  if (!crowd.avoidAt || t - crowd.avoidAt > 1) {
    crowd.avoidAt = t;
    crowd.avoid = avoidRects();
  }
  for (const a of crowd.actors.values()) step(a, dt, t);
  loop();
}
function loop() {
  if (!crowd || crowd.raf || crowd.reduced || crowd.hidden || crowd.actors.size === 0) return;
  crowd.raf = requestAnimationFrame(frame);
}
function stopLoop() {
  if (crowd && crowd.raf) cancelAnimationFrame(crowd.raf);
  if (crowd) crowd.raf = 0;
}

export function mountCrowd(layerEl, { onBotTap } = {}) {
  if (!layerEl) return null;
  injectCSS();
  if (crowd) unmountCrowd();
  const root = document.createElement('div');
  root.className = 'sao-crowd';
  layerEl.appendChild(root);
  crowd = {
    layer: layerEl,
    root,
    onBotTap,
    actors: new Map(),
    path: buildPath(null),
    placeId: null,
    quiet: false,
    reduced: false,
    hidden: typeof document !== 'undefined' && document.hidden,
    base: 0,
    W: 1,
    H: 1,
    raf: 0,
    last: 0,
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.sao-bot');
    if (!b || !crowd) return;
    const a = crowd.actors.get(b.dataset.bot);
    if (a && !crowd.reduced) a.sqV -= 3.2;
    if (crowd.onBotTap) crowd.onBotTap(b.dataset.bot);
  });
  crowd.onVis = () => {
    crowd.hidden = document.hidden;
    root.classList.toggle('is-paused', crowd.hidden);
    if (crowd.hidden) stopLoop();
    else {
      crowd.last = 0;
      loop();
    }
  };
  document.addEventListener('visibilitychange', crowd.onVis);
  if (typeof ResizeObserver !== 'undefined') {
    crowd.ro = new ResizeObserver(() => measure());
    crowd.ro.observe(layerEl);
  } else {
    crowd.onResize = () => measure();
    window.addEventListener('resize', crowd.onResize);
  }
  measure();
  if (pending) {
    const p = pending;
    pending = null;
    setScene(p.placeId, p.bots, p.opts);
  }
  return { destroy: unmountCrowd };
}

export function unmountCrowd() {
  if (!crowd) return;
  stopLoop();
  document.removeEventListener('visibilitychange', crowd.onVis);
  if (crowd.ro) crowd.ro.disconnect();
  if (crowd.onResize) window.removeEventListener('resize', crowd.onResize);
  crowd.root.remove();
  crowd = null;
}

// The bots stand in the scene light: rim, cool side and cast shadow follow the
// time of day (sun from the left by day, low and warm from the right at
// sunset, cool moonlight at night).
function applyLight(key) {
  if (!crowd) return;
  const L = LIGHTS[key] || LIGHTS.day;
  const st = crowd.root.style;
  st.setProperty('--rimx', L.css[0]);
  st.setProperty('--rimy', L.css[1]);
  if (!crowd.quiet) st.setProperty('--rim', L.css[2]);
  else st.removeProperty('--rim');
  st.setProperty('--sho', String(L.sh.o));
  if (key === LIGHT) return;
  LIGHT = key;
  for (const a of crowd.actors.values()) a.renderKey = '';
}

export function setScene(placeId, bots = [], { quiet = false, reduced } = {}) {
  if (!crowd) {
    pending = { placeId, bots, opts: { quiet, reduced } };
    return;
  }
  const prefers = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const red = reduced ?? prefers;
  const placeChanged = placeId !== crowd.placeId;
  const modeChanged = red !== crowd.reduced || quiet !== crowd.quiet;
  crowd.quiet = !!quiet;
  crowd.reduced = !!red;
  crowd.root.classList.toggle('is-reduced', crowd.reduced);
  crowd.root.classList.toggle('is-quiet', crowd.quiet);
  crowd.root.style.setProperty('--q', crowd.quiet ? '2' : '1');
  applyLight(sceneLight());
  const place = PLACE[placeId];
  if (placeChanged) {
    for (const a of crowd.actors.values()) a.el.remove();
    crowd.actors.clear();
    crowd.placeId = placeId;
    crowd.path = buildPath(place && place.path);
    crowd.root.classList.add('is-entering');
  }
  if (!place) {
    stopLoop();
    return;
  }

  // Who shows: at most 3 active bots; the others nap on the bench, in town only.
  const list = (Array.isArray(bots) ? bots : [])
    .map((b) => {
      const core = BOT[b && b.core] ? b.core : BOT[b && b.id] ? b.id : null;
      if (!core) return null;
      let state = STATES[b.state] ? b.state : 'working';
      if (quiet && state === 'done') state = 'sleeping';
      return { id: String(b.id || core), core, kind: 'bot', name: b.name || BOT[core].name, state, task: b.task || '' };
    })
    .filter(Boolean);
  const active = list.filter((b) => ACTIVE.has(b.state)).slice(0, MAX_ACTIVE);
  const rest = placeId === 'town' ? list.filter((b) => !active.includes(b)).slice(0, TOWN_SPOTS.bench.length) : [];
  const specs = [];
  active.forEach((b, i) => specs.push({ ...b, i, bench: null }));
  rest.forEach((b, i) => specs.push({ ...b, i, bench: i }));
  if (placeId === 'town') specs.push({ id: 'icon', core: 'icon', kind: 'icon', name: 'ICON', state: 'reading', task: '', i: 0, bench: null });

  const T = nowS();
  const keep = new Set();
  for (const sp of specs) {
    keep.add(sp.id);
    let a = crowd.actors.get(sp.id);
    if (!a) {
      a = makeActor(sp, sp.i);
      crowd.actors.set(sp.id, a);
      crowd.root.appendChild(a.el);
      const b = crowd.base;
      a.bodyEl.style.width = `${b}px`;
      a.bodyEl.style.height = `${b}px`;
      a.shadowEl.style.width = `${Math.round(b * (sp.core === 'keeper' ? 0.5 : sp.core === 'icon' ? 0.4 : 0.44))}px`;
      a.shadowEl.style.height = `${Math.round(b * 0.1)}px`;
      const m = Math.round(b * 0.26);
      a.markEl.style.width = `${m}px`;
      a.markEl.style.height = `${m}px`;
      assignMode(a, place, T, true);
    } else {
      const changed = a.state !== sp.state || a.bench !== sp.bench || a.i !== sp.i || modeChanged;
      Object.assign(a, { name: sp.name, task: sp.task, state: sp.state, bench: sp.bench, i: sp.i });
      if (changed) {
        a.el.classList.remove('is-idle');
        a.idleUntil = 0;
        assignMode(a, place, T, false);
      }
    }
    a.el.setAttribute('aria-label', labelFor(a));
  }
  for (const [id, a] of crowd.actors) {
    if (!keep.has(id)) {
      a.el.remove();
      crowd.actors.delete(id);
    }
  }
  measure();
  if (placeChanged) {
    void crowd.root.offsetWidth;
    crowd.root.classList.remove('is-entering');
  }
  if (crowd.reduced) stopLoop();
  else {
    crowd.last = 0;
    loop();
  }
}
