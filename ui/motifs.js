// The wordmark and the motifs of docs/STYLE_GUIDE.md as SVG strings. Original line art drawn for this page
// (nothing traced or copied from any paid pack). One ink: every motif draws with currentColor, 1.6 px strokes,
// round caps, and is aria-hidden (the text next to it carries the meaning).
//
//   wordmark()            the angular FINANCE wordmark (header, once)
//   amphora(pct, opts)    tuition jar that fills with ink; opts {id, from, w, h}
//   column(paid)          Ionic column for bills: filled when paid, outline when not
//   olive(), wreath()     real wins only (wreath paths draw on once with the .draw class)
//   owl()                 owl coin (safe to spend)
//   waves(), thread()     forecast
//   star()                four point star (highlights)
//   arch()                arch window (empty states)
//   pomegranate()         groceries
//   meander()             Greek key strip (dividers); bar texture lives in app.css
//   templeEngraving()     the line screen temple of the hero
//   torn(seed)            torn paper edge for the top of a band (fill = currentColor)

let seq = 0;
const uid = p => p + (++seq).toString(36);

// Common wrapper. Strokes keep 1.6 px at any drawn size (non scaling stroke).
function svg(viewBox, inner, { w, h, cls = '', fill = 'none', extra = '' } = {}) {
  const size = (w ? ` width="${w}"` : '') + (h ? ` height="${h}"` : '');
  return `<svg class="motif ${cls}" viewBox="${viewBox}"${size} fill="${fill}" stroke="currentColor" stroke-width="1.6" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${inner}</svg>`;
}
const P = (d, more = '') => `<path d="${d}" vector-effect="non-scaling-stroke"${more}/>`;

/* ---------- wordmark ---------- */
// Straight strokes, the C drawn as "<". Lettering, so it keeps its heavy stroke.
export function wordmark({ w = 140, h = 29 } = {}) {
  return `<svg class="wordmark" viewBox="0 0 210 44" width="${w}" height="${h}" aria-hidden="true" focusable="false">`
    + '<g fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="butt" stroke-linejoin="miter">'
    + '<path d="M4 2V42M4 4.5H24M4 21H20"/><path d="M34 2V42"/><path d="M45 42V2L67 42V2"/>'
    + '<path d="M75 42L89 3L103 42M82 28H96"/><path d="M112 42V2L134 42V2"/><path d="M165 3L144 22L165 41"/>'
    + '<path d="M196 4.5H176V39.5H196M176 22H192"/></g></svg>';
}

/* ---------- amphora (tuition jars) ---------- */
const AMPHORA_BODY = 'M23 14c-11 3-15 14-12 25 3 9 10 13 19 13s16-4 19-13c3-11-1-22-12-25z';
const AMPHORA_LINES = 'M23 6h14M24 6c0 4-1 5-1 8M36 6c0 4 1 5 1 8M23 14c-11 3-15 14-12 25 3 9 10 13 19 13s16-4 19-13c3-11-1-22-12-25'
  + 'M16 17c-7 0-8 8-2 10M44 17c7 0 8 8 2 10M23 52l-3 6h20l-3-6';
// The body spans y 14 to 52. Ink level for a share 0..1.
const levelY = pct => 52 - 38 * Math.max(0, Math.min(1, Number(pct) || 0));

// pct 0..1. opts.from (0..1) draws the fill starting at the old level so CSS can raise it (class .rise).
export function amphora(pct, { id = uid('jar'), from = null, w = 52, h = 56 } = {}) {
  const y = levelY(pct);
  const rise = from != null && from < pct ? ` style="--rise:${(levelY(from) - y).toFixed(2)}px"` : '';
  // The clip sits on a group that never moves: a clip on the rising rect itself would travel with its transform
  // and let the ink show below the jar while it rises.
  const fill = pct > 0
    ? `<g clip-path="url(#${id})"><rect class="jar-fill${rise ? ' rise' : ''}"${rise} x="0" y="${y.toFixed(2)}" width="60" height="${(60 - y).toFixed(2)}" fill="currentColor" stroke="none"/></g>`
    : '';
  // A thin decorated band on the shoulder, like a prize amphora, kept inside the body.
  const band = `<g clip-path="url(#${id})" stroke-width="1">${P('M6 27h48M6 32h48')}${P('M6 29.5h48', ' stroke-dasharray="1.2 2.6"')}</g>`;
  return svg('5 3 50 57', `<defs><clipPath id="${id}"><path d="${AMPHORA_BODY}"/></clipPath></defs>${fill}${band}${P(AMPHORA_LINES)}`, { w, h, cls: 'amphora' });
}

/* ---------- Ionic column (bills) ---------- */
export function column(paid, { w = 24, h = 32 } = {}) {
  const volutes = P('M4.5 5.5c-2.6.2-3 3.6-.6 4.1 1.5.3 2.2-1.4 1-2.1')
    + P('M19.5 5.5c2.6.2 3 3.6.6 4.1-1.5.3-2.2-1.4-1-2.1');
  if (paid) {
    // Filled: solid abacus, shaft and base in ink.
    return svg('0 0 24 32', '<g class="col-fill" fill="currentColor" stroke="none">'
      + '<rect x="2.6" y="4.3" width="18.8" height="2.6" rx=".6"/><rect x="6" y="8.6" width="12" height="2"/>'
      + '<rect x="7" y="10.2" width="10" height="16.6"/><rect x="5.4" y="25.8" width="13.2" height="2"/><rect x="3.4" y="28.4" width="17.2" height="2.2" rx=".5"/></g>'
      + volutes, { w, h, cls: 'column is-paid' });
  }
  return svg('0 0 24 32', P('M3 5.5h18') + volutes + P('M6.5 9.5h11') + P('M7.5 9.5v17M16.5 9.5v17')
    + P('M10.5 12v12.5M13.5 12v12.5') + P('M6 26.5h12M4 29.5h16'), { w, h, cls: 'column' });
}

/* ---------- olive branch and wreath (real wins only) ---------- */
export function olive({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', P('M8 38C16 28 26 16 38 8')
    + P('M16 29c-4-1-7 1-8 4 4 1 7-1 8-4zM20 24c0-4 2-7 6-7-1 4-3 6-6 7zM24 20c-4-1-7 0-9 3 4 1 7 0 9-3zM29 15c1-4 4-6 7-6-1 4-4 6-7 6zM31 13c-4-1-6 1-7 3'), { w, h, cls: 'olive' });
}

// Five short paths at most, so the draw on stays cheap on a phone.
export function wreath({ w = 44, h = 44 } = {}) {
  const stem = 'M21 38.5C11.5 36.5 6 27.5 8.5 13.5';
  const leaves = 'M9.4 31.4c-3.6-.4-5.8-2.8-6-5.9 3.1.2 5.4 2.6 6 5.9z'
    + 'M7.6 24.4c-3.1-1.4-4.4-4.2-3.9-7.1 2.9.9 4.5 3.7 3.9 7.1z'
    + 'M7.9 17.6c-1.9-2.6-1.8-5.8.2-7.9 1.7 2.4 1.7 5.7-.2 7.9z'
    + 'M14.6 35.6c-3.3 1.1-6.6.2-8.5-2.2 3-1.1 6.4-.2 8.5 2.2z';
  const side = `<path class="d" pathLength="1" d="${stem}"/><path class="d" pathLength="1" d="${leaves}"/>`;
  return svg('0 0 44 44', side + `<g transform="translate(44 0) scale(-1 1)">${side}</g>`
    + '<path class="d" pathLength="1" d="M18.5 39l3.5-1.6 3.5 1.6"/>', { w, h, cls: 'wreath' });
}

/* ---------- owl coin (safe to spend) ---------- */
export function owl({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', '<circle cx="22" cy="22" r="18"/>'
    + '<circle cx="22" cy="22" r="15" stroke-dasharray="1.5 2.5"/>'
    + P('M15 21c0-4 3-6 7-6s7 2 7 6c0 6-3 10-7 10s-7-4-7-10z')
    + '<circle cx="19" cy="21" r="2"/><circle cx="25" cy="21" r="2"/>'
    + P('M21 25l1 1.5 1-1.5M16 16l-1-3M28 16l1-3M18.5 31.5l-1 2.5M25.5 31.5l1 2.5'), { w, h, cls: 'owl' });
}

/* ---------- forecast ---------- */
export function waves({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', P('M4 26c4-6 8-6 10 0 2 6 6 6 8 0s6-6 8 0 6 6 10 0M4 33c4-5 8-5 10 0s6 5 8 0 6-5 8 0 6 5 10 0'), { w, h, cls: 'waves' });
}

// The Fates' thread: a drop spindle with its thread running out to the left.
export function thread({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', P('M31 5v34')
    + P('M27.5 14c0 7 7 7 7 0M26.5 19.5c1 4.5 8 4.5 9 0')
    + P('M25 33.5h12M26.5 36.5h9')
    + P('M31 7C24 8 21 14 16 17s-8 2-12 7'), { w, h, cls: 'thread' });
}

/* ---------- small marks ---------- */
export function star({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', P('M22 6c1 10 6 15 16 16-10 1-15 6-16 16-1-10-6-15-16-16 10-1 15-6 16-16z'), { w, h, cls: 'star' });
}

// Arch window with a star in the sky and the sea line: the empty state drawing.
export function arch({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', P('M11 41V19a11 11 0 0 1 22 0v22')
    + P('M15 41V19.5a7 7 0 0 1 14 0V41')
    + P('M7.5 41h29')
    + P('M15 33.5c2.3-1.4 4.7-1.4 7 0s4.7 1.4 7 0')
    + P('M22 18.6c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z'), { w, h, cls: 'arch' });
}

export function pomegranate({ w = 44, h = 44 } = {}) {
  return svg('0 0 44 44', '<circle cx="22" cy="25" r="13"/>'
    + P('M19 12l1-4h4l1 4M17 9l2 3M27 9l-2 3M15 22c3 2 4 6 3 9M29 22c-3 2-4 6-3 9M22 18v14'), { w, h, cls: 'pomegranate' });
}

// A Greek key strip that fills its width. Each call gets its own pattern id.
export function meander({ h = 14, cls = '' } = {}) {
  const id = uid('mk');
  return `<svg class="motif meander ${cls}" viewBox="0 0 400 14" preserveAspectRatio="none" width="100%" height="${h}" aria-hidden="true" focusable="false">`
    + `<defs><pattern id="${id}" width="20" height="14" patternUnits="userSpaceOnUse">`
    + '<path d="M0 12.5H20M17 12.5V1.5H5V9.5H13V5.5H9" fill="none" stroke="currentColor" stroke-width="1.6"/></pattern></defs>'
    + `<rect width="400" height="14" fill="url(#${id})"/></svg>`;
}

/* ---------- the engraved temple (hero) ---------- */
// A vertical line screen drawn from code: one line every 3 units, thin where light hits, thick in shadow.
// Three columns with their shaded drums, a pediment, a frieze with triglyphs and three steps.
let templeCache = null;
export function templeEngraving({ w = 220, h = 264 } = {}) {
  if (!templeCache) {
    const r = (x, y, wd, ht) => (ht > 0.2 && wd > 0.05 ? `M${x.toFixed(1)} ${y.toFixed(1)}h${wd.toFixed(2)}v${ht.toFixed(1)}h-${wd.toFixed(2)}z` : '');
    const columns = [[27, 57], [87, 117], [147, 177]];
    const jitter = x => Math.sin(x * 1.7) * 0.07 + Math.sin(x * 0.37) * 0.05;
    let d = '';
    for (let x = 10; x <= 199; x += 3) {
      // Pediment: apex at 115, thin lines (sky side).
      const top = 6 + 0.366 * Math.abs(x - 115);
      d += r(x, top, 0.7, 42 - top);
      // Cornice in shadow, frieze with a heavier stroke on every fourth line (triglyphs).
      d += r(x, 44, 1.5, 7);
      d += r(x, 52.5, (x - 10) % 12 === 0 ? 1.7 : 0.9, 11);
      const col = columns.find(([a, b]) => x >= a && x <= b);
      if (col) {
        const t = (x - col[0]) / (col[1] - col[0]);
        const dist = t < 0.35 ? (0.35 - t) / 0.35 : (t - 0.35) / 0.65;
        const wd = 0.34 + 1.95 * dist ** 1.6 + jitter(x);
        d += r(x, 64, 1.3, 9);                    // capital
        d += r(x, 74, wd, 122);                    // the shaft, shaded like a cylinder
      } else if (x >= 21) {
        d += r(x, 64, 2.3, 132);                  // the dark inside of the porch
        if ((x - 21) % 9 === 0) d += r(x + 0.4, 64, 1.1, 7);
      }
      if (x >= 19) {
        d += r(x, 197, 1.0, 9);
        d += r(x, 207.5, 0.6, 9.5);
        d += r(x, 218.5, 1.4, 21.5);
      }
    }
    templeCache = d;
  }
  return `<svg class="motif temple" viewBox="0 0 200 240" width="${w}" height="${h}" aria-hidden="true" focusable="false">`
    + `<path fill="currentColor" d="${templeCache}"/></svg>`;
}

/* ---------- torn paper edge ---------- */
// A jagged top edge, the same for the same seed. Put it as the first child of a band; CSS sets its colour.
export function torn(seed = 1) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  let x = 0, d = 'M0 14';
  while (x < 430) {
    x = Math.min(430, x + 5 + rnd() * 11);
    d += ` L${x.toFixed(1)} ${(2.2 + rnd() * 9.8).toFixed(1)}`;
  }
  d += ' L430 16 L0 16Z';
  return `<svg class="torn" viewBox="0 0 430 16" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
}
