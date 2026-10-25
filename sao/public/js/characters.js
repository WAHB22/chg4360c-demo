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

// Paint
const INK = '#5A4638B3';    // warm brown ink at 0.7, never black
const INK_SOLID = '#5A4638';
const SHADE = '#8E86A8';    // the one cool shadow tone (gouache, not a gradient)
const CONTACT = '#5A4A60';  // soft contact shadow
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
const tone = (id) => BODY_TONE[id] || BOT[id].color;

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

function makeCtx(lite, pose = {}) {
  const k = 'sao' + (++uid).toString(36);
  const defs = [];
  let n = 0;
  return {
    lite,
    pose,
    sw: lite ? 2.5 : 1.35,
    defs,
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
function ink(ctx, d, w = 1) {
  if (ctx.lite) return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${r2(ctx.sw * w)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const a = r2(ctx.sw * w * 0.82);
  return (
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${a}" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${INK_SOLID}" stroke-opacity="0.32" stroke-width="${r2(a * 0.75)}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${r2(14 + w * 9)} ${r2(5 + w * 4)}" transform="translate(0.45 0.55)"/>`
  );
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
  if (!ctx.lite && !flat && rx > 2.2) s += `<ellipse cx="${r2(cx + rx * 0.16)}" cy="${r2(cy + ry * 0.34)}" rx="${r2(rx * 0.8)}" ry="${r2(ry * 0.6)}" fill="${SHADE}" opacity="0.3"/>`;
  if (line) s += ink(ctx, ellipsePath(cx, cy, rx, ry), line);
  return `<g${t}${o}>${s}</g>`;
}
// A stroked line with an ink outline (for handles, straps, tubes).
function rod(ctx, d, color, w) {
  const out = w + ctx.sw * 1.5;
  return (
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${r2(out)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${ctx.paint(color)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}
// Union of circles with one outer outline (puffy cap, crest).
function puffs(ctx, circles, color) {
  const out = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r2(r + ctx.sw / 2)}"/>`).join('');
  const fill = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ctx.paint(color)}"/>`).join('');
  let shade = '';
  if (!ctx.lite) shade = circles.map(([x, y, r]) => `<circle cx="${r2(x + r * 0.22)}" cy="${r2(y + r * 0.36)}" r="${r2(r * 0.7)}" fill="${SHADE}" opacity="0.22"/>`).join('');
  return `<g fill="${INK}">${out}</g>${fill}${shade}`;
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
  const lit = blob(box.cx - box.rx * 0.2, box.cy - box.ry * 0.2, box.rx * 1.02, box.ry * 0.97, { wob: ctx.lite ? 0 : 0.035, seed: top * 3 + 5, n: 10 });
  const x0 = box.cx - box.rx - 6;
  const x1 = box.cx + box.rx + 6;
  const R = `M${r2(x0)} ${r2(top - 6)}H${r2(x1)}V${r2(box.cy + box.ry + 6)}H${r2(x0)}Z`;
  const shOp = r2(Math.min(0.5, coolOp + 0.04));
  s += `<path d="${R}${lit}" fill-rule="evenodd" fill="${SHADE}" opacity="${shOp}"/>`;
  if (!ctx.lite) {
    const dab = DABS[id] || DABS.icon;
    // pooled pigment along the shadow edge (watercolor dries darker at its rim)
    s += `<path d="${lit}" fill="none" stroke="${mix(SHADE, DEEP, 0.3)}" stroke-width="1.1" opacity="0.28" stroke-dasharray="9 3 16 4"/>`;
    s += `<path d="${blob(box.cx - box.rx * 0.32, box.cy - box.ry * 0.5, box.rx * 0.62, box.ry * 0.34, { wob: 0.12, seed: top * 7 })}" fill="${CREAM}" opacity="0.26"/>`;
    const ax = r2(box.cx + box.rx * 0.5);
    const ay = r2(box.cy - box.ry * 0.05);
    s += `<ellipse cx="${ax}" cy="${ay}" rx="4.2" ry="3" fill="${dab[0]}" opacity="0.3" transform="rotate(-18 ${ax} ${ay})"/>`;
    s += `<ellipse cx="${r2(box.cx - box.rx * 0.58)}" cy="${r2(box.cy + box.ry * 0.38)}" rx="3.6" ry="2.4" fill="${dab[1]}" opacity="0.28"/>`;
    s += `<ellipse cx="${r2(box.cx + box.rx * 0.18)}" cy="${r2(box.cy + box.ry * 0.66)}" rx="4.6" ry="2" fill="${dab[2]}" opacity="0.24"/>`;
    s += `<path d="${d}" fill="none" stroke="${mix(color, DEEP, 0.45)}" stroke-width="3" opacity="0.26"/>`;
  }
  s += `</g>`;
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
    if (!ctx.lite) {
      const v = mix(c, CREAM, 0.55);
      s += [[42, 60], [58, 60], [50, 67], [41, 73], [59, 73], [50, 80]]
        .map(([x, y]) => `<path d="M${x - 3} ${y}Q${x} ${y + 2.6} ${x + 3} ${y}" fill="none" stroke="${v}" stroke-width="1.3" stroke-linecap="round" opacity="0.9"/>`)
        .join('');
    }
    s += nub(ctx, 25.5, 73, c, 12) + nub(ctx, 74.5, 73, c, -12);
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
  const tg = ctx.id('t');
  ctx.defs.push(
    `<linearGradient id="${tg}" gradientUnits="userSpaceOnUse" x1="68" y1="86" x2="88" y2="44">` +
      `<stop offset="0" stop-color="${mix(c, COOL, 0.3)}"/><stop offset="0.45" stop-color="${c}"/>` +
      `<stop offset="0.68" stop-color="${mix(c, CREAM, 0.3)}"/><stop offset="0.76" stop-color="${PAPER}"/><stop offset="1" stop-color="${PAPER}"/></linearGradient>`,
  );
  const tail = (dx = 0) => {
    let g = `<g class="p-tail" ${org(66 + dx, 84)}>${dx ? `<g transform="translate(${dx} 1)">` : ''}`;
    g += `<path d="M63.6 87C80 93.4 96.4 78 92.2 58C90.2 47.4 84.2 42 78.8 44C82.8 50 84 58 81.6 66C78.6 74 72 79 63 80Z" fill="url(#${tg})" stroke="${INK}" stroke-width="${ctx.sw}" stroke-linejoin="round"/>`;
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
    if (!ctx.lite) s += `<path d="M50 64L50 90M40 66Q38.6 78 37 88M60 66Q61.4 78 63 88" fill="none" stroke="${COOL}" stroke-width="1.1" opacity="0.26"/>`;
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
  if (!ctx.lite) s += `<path d="M40 67Q38.6 78 37 88M60.6 67Q62 78 63.4 88" fill="none" stroke="${COOL}" stroke-width="1.1" opacity="0.26"/>`;
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
    g += `<path d="M20 ${20 - h}L${20 + w} 20L20 ${20 + h}L${20 - w} 20Z" fill="${color}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
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
  const ctx = makeCtx(lite, opts.pose || {});
  const look = state === 'traveling' ? 'working' : state;
  const art = DRAW[key](ctx, look, facing === 'back');

  let shadow = '';
  if (showShadow) {
    const sh = ctx.id('s');
    ctx.defs.push(`<filter id="${sh}" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="1.3"/></filter>`);
    const rx = key === 'icon' ? 18 : key === 'keeper' ? 25 : 21;
    // soft contact shadow, a little off center toward the cool side
    shadow =
      `<g class="p-shadow" filter="url(#${sh})"><ellipse cx="51.5" cy="94.2" rx="${rx}" ry="3.6" fill="${CONTACT}" opacity="0.3"/>` +
      `<ellipse cx="50.5" cy="93.8" rx="${r2(rx * 0.55)}" ry="2" fill="${CONTACT}" opacity="0.22"/></g>`;
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
        `<feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="3" seed="${sd + 11}" result="n"/>` +
        `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42 0 0 0 0 0.33 0 0 0 0 0.3 0.55 0 0 0 -0.27" result="g"/>` +
        `<feComposite in="g" in2="d" operator="in" result="gi"/>` +
        `<feMerge><feMergeNode in="d"/><feMergeNode in="gi"/></feMerge></filter>`,
    );
    paper = ` filter="url(#${f})"`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" class="sao-sprite-svg" data-sprite="${key}" aria-hidden="true" focusable="false" overflow="visible">` +
    `<title>${name}</title><defs>${ctx.defs.join('')}</defs>` +
    shadow +
    `<g class="p-all" ${org(50, 93)}><g${paper}>${art}</g></g>` +
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
.sao-bot .sao-shadow{position:absolute;left:50%;bottom:0;border-radius:50%;background:radial-gradient(closest-side,rgba(90,74,96,.34),rgba(90,74,96,.16) 62%,rgba(90,74,96,0));margin-left:4%;pointer-events:none}
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

.sao-bot.is-idle.k-baker .p-cloth{animation:sao-wipe calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
.sao-bot.is-idle.k-baker .p-tray{animation:sao-tray calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
@keyframes sao-wipe{0%{transform:none}10%{transform:translate(-1px,2px)}24%{transform:translate(14px,-19px) rotate(-28deg)}34%{transform:translate(19px,-20px) rotate(-18deg)}44%{transform:translate(12px,-19px) rotate(-32deg)}54%{transform:translate(19px,-20px) rotate(-18deg)}72%{transform:translate(13px,-18px) rotate(-26deg)}100%{transform:none}}
@keyframes sao-tray{0%,20%{transform:none}34%{transform:rotate(-3deg)}54%{transform:rotate(3deg)}74%{transform:rotate(-1deg)}100%{transform:none}}

.sao-bot.is-idle.k-keeper .p-all{animation:sao-tidy calc(2.1s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
.sao-bot.is-idle.k-keeper .p-prop{animation:sao-swing calc(2.1s * var(--q,1)) cubic-bezier(.4,0,.3,1) both}
@keyframes sao-tidy{0%{transform:none}14%{transform:scale(1.05,.93)}34%{transform:rotate(-6deg)}54%{transform:rotate(6deg)}74%{transform:rotate(-2deg)}100%{transform:none}}
@keyframes sao-swing{0%,14%{transform:none}34%{transform:rotate(12deg)}54%{transform:rotate(-12deg)}74%{transform:rotate(5deg)}100%{transform:none}}

.sao-bot.is-idle.k-steward .p-key{animation:sao-key calc(1.9s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
@keyframes sao-key{0%{transform:none}14%,64%{transform:translateY(-3px)}24%{transform:translateY(-3px) rotate(80deg)}34%{transform:translateY(-3px)}46%{transform:translateY(-3px) rotate(80deg)}56%{transform:translateY(-3px)}82%{transform:translateY(.6px)}100%{transform:none}}

.sao-bot.is-idle.k-bard .p-tail{animation:sao-tail calc(2.3s * var(--q,1)) cubic-bezier(.45,0,.3,1) both}
.sao-bot.is-idle.k-bard .p-prop{animation:sao-brush calc(2.3s * var(--q,1)) cubic-bezier(.4,0,.2,1) both}
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
  const key = `${core}|${st}|${facing}|${lite ? 1 : 0}|${size}|${blink ? 1 : 0}${stepF}`;
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
  a.renderKey = `${st}|${a.facing}|${a.lite}|${a.state}|${a.mode === 'nap'}|${a.live ? 1 : 0}`;
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
      a.shadowEl.style.width = `${Math.round(base * (a.core === 'keeper' ? 0.54 : 0.46))}px`;
      a.shadowEl.style.height = `${Math.round(base * 0.1)}px`;
      const m = Math.round(base * 0.26);
      a.markEl.style.width = `${m}px`;
      a.markEl.style.height = `${m}px`;
      a.renderKey = '';
    }
  }
  for (const a of crowd.actors.values()) place(a);
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
  const key = `${visualState(a)}|${a.facing}|${a.lite}|${a.state}|${a.mode === 'nap'}|${a.live ? 1 : 0}`;
  if (key !== a.renderKey) renderSprite(a);
  if (a.imgEl) {
    const blink = T < a.blinkUntil;
    const l = a.mode === 'walk' ? a.lift || 0 : 0;
    const stepF = l > 0.35 ? 1 : l < -0.35 ? -1 : 0;
    const fk = `${blink ? 1 : 0}${stepF}`;
    if (fk !== a.frameKey) {
      a.frameKey = fk;
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
  const px = (a.x / 100) * c.W;
  const py = (a.y / 100) * c.H;
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
  a.shadowEl.style.transform = `translate(-50%,50%) scale(${(s * (1 - a.hop * 0.28)).toFixed(3)})`;
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
      a.shadowEl.style.width = `${Math.round(b * (sp.core === 'keeper' ? 0.54 : 0.46))}px`;
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
