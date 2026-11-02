// Chequing forecast (Stage 5, docs/UI.md, docs/SPEC.md 5.5).
//
// On the scroll band: one spun thread, the Fates' thread of docs/STYLE_GUIDE.md. A drop spindle hangs at today and
// the thread runs out of it to payday or month end, whichever is later: x by day, y by balance, from
// lib/forecast.js forecast(state, today, {nextPay}) with nextPay from lib/money.js. Days whose balance uses an
// estimate (the 30 day average spending, or a planned pay) are dotted; anything under $0 turns terracotta over a
// vertical line screen, like the engraving. Days with bills, pays or the Visa payment get a dot (a star for pay),
// each a 44 px button that opens the day. The lowest point gets a ring. Every number shown comes from the lib
// result; this file only places it. The forecast is always from today, whatever month is viewed.
//
// Bill names, notes and tx labels come from his data and from imports (merchant text read from screenshots), so
// every one goes through esc() and carries data-user.

const H_PHONE = 184;
const H_WIDE = 224;
const PAD = { top: 18, right: 10, bottom: 18, left: 34 }; // the left gutter holds the spindle
const HIT = 44;
const DRAWN = 'finance-forecast-drawn'; // the day the thread last drew on (once a day)
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get: k => { try { return window.localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* blocked */ } },
};
const f1 = v => String(Math.round(v * 10) / 10);

let sig = '';          // what is on screen, so a render that changes nothing touches nothing
let current = null;    // {r, t} of the chart on screen, for the day sheet
let inView = false;

export function mount(app) {
  const root = document.getElementById('forecast');
  if (!root) return;
  root.setAttribute('aria-labelledby', 'fcTitle');
  const draw = () => {
    try { render(app, root); } catch (e) { console.error('Could not draw the forecast:', e); }
  };
  root.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const acc = t.closest('[data-fc-account]');
    if (acc) { app.openAccount(acc.dataset.fcAccount); return; }
    const hit = t.closest('[data-fc-days]');
    if (hit) openDays(app, hit.dataset.fcDays.split(' '));
  });
  app.on('render', draw);
  if ('ResizeObserver' in window) {
    let width = 0;
    new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== width) { width = w; if (sig) draw(); }
    }).observe(root);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries.some(e => e.isIntersecting);
      if (inView) drawOn(app, root);
    }, { threshold: 0.3 }).observe(root);
  }
  if (app.state) draw();
}

function render(app, root) {
  const s = app.state;
  if (!s) return;
  const { core, money, forecast: F } = app.lib;
  const t = app.today();
  const np = money.nextPay(s, t);
  const r = F.forecast(s, t, { nextPay: np });
  root.hidden = false;
  const ctx = {
    r, np, t,
    story: typeof app.story === 'function' ? app.story('forecast') : '',
    cheq: core.chequingAccount(s),
    visa: core.visaAccount(s),
  };
  if (!r || r.missing) drawMissing(app, root, ctx);
  else drawChart(app, root, ctx);
}

/* ---------- pieces ---------- */
const head = caps => `<div class="band-head"><h2 id="fcTitle">Chequing forecast</h2>${caps ? `<p class="caps">${caps}</p>` : ''}</div>`;
const storyHtml = (esc, text) => (text ? `<p class="story fc-story">${esc(text)}</p>` : '');
const ringGlyph = '<svg class="fc-glyph" viewBox="0 0 22 20" width="22" height="20" aria-hidden="true" focusable="false"><circle cx="11" cy="10" r="4.6"/></svg>';
const hatchGlyph = '<svg class="fc-glyph fc-glyph-neg" viewBox="0 0 22 20" width="22" height="20" aria-hidden="true" focusable="false"><path d="M4 6v8M7 6v8M10 6v8M13 6v8M16 6v8M19 6v8"/></svg>';
const dotsGlyph = '<svg class="fc-glyph" viewBox="0 0 22 20" width="22" height="20" aria-hidden="true" focusable="false"><path d="M2 10H20" stroke-dasharray="0 4"/></svg>';

function keepFocus(root, fn) {
  const a = document.activeElement;
  const id = a && root.contains(a) && a.id ? a.id : null;
  fn();
  if (id && document.activeElement !== document.getElementById(id)) document.getElementById(id)?.focus({ preventScroll: true });
}

/* ---------- no chequing balance yet ---------- */
function drawMissing(app, root, { cheq, story }) {
  const key = 'missing|' + (cheq ? cheq.id : '') + '|' + story;
  if (sig === key && root.querySelector('.fc-missing')) return;
  sig = key;
  current = null;
  const { esc } = app.lib.core;
  keepFocus(root, () => {
    root.innerHTML = `
      ${head('')}
      <div class="fc-missing">
        <div class="fc-missing-art">${app.motifs.thread({ w: 64, h: 64 })}</div>
        <p class="fc-ask" id="fcAsk">Enter your chequing balance to see the forecast</p>
        <p class="fc-ask-sub">It counts your bills, paydays and average spending from today.</p>
        ${cheq ? `<button class="btn-primary fc-ask-btn" type="button" id="fcEnterCheq" data-fc-account="${esc(cheq.id)}" aria-describedby="fcAsk">Enter chequing balance</button>` : ''}
      </div>
      ${storyHtml(esc, story)}`;
  });
}

/* ---------- the chart ---------- */
function drawChart(app, root, ctx) {
  const { r, np, t, story, cheq, visa } = ctx;
  if (!root.querySelector(':scope > .fc-plot')) {
    root.innerHTML = `${head('')}<div class="fc-plot"></div><div class="fc-axis" aria-hidden="true"></div><dl class="fc-keys"></dl><div class="fc-notes"></div>`;
    sig = '';
  }
  const plot = root.querySelector(':scope > .fc-plot');
  const W = Math.max(240, Math.round(plot.clientWidth || 358));
  const key = JSON.stringify([W, r, np, t, story, cheq && cheq.id, visa && visa.id]);
  if (key === sig) return;
  const fresh = !sig || !plot.firstChild;
  sig = key;
  current = { r, t };

  const { core } = app.lib;
  const { esc, fmtShort, shortDate, addDays, monthEnd, monthOf } = core;
  const pts = r.points;
  const at = new Map(pts.map((p, i) => [p.date, i]));
  const pointOn = d => pts[at.get(d)];
  const mEnd = monthEnd(monthOf(t));
  const anyEst = pts.some(p => p.estimate);
  const g = geometry(pts, W);

  // The three numbers: today, the day before next pay, month end (one entry per date, first label wins).
  const keys = [];
  const addKey = (k, cap, date) => { if (at.has(date) && !keys.some(x => x.date === date)) keys.push({ k, cap, date, p: pointOn(date) }); };
  addKey('today', 'Today', t);
  if (np) addKey('before-pay', 'Before payday', addDays(np.date, -1));
  addKey('month-end', 'Month end', mEnd);
  keys.sort((a, b) => a.date.localeCompare(b.date)); // payday can come after month end

  // Days with a bill, a pay or the Visa payment: a dot, and a button around it.
  const marks = [];
  pts.forEach((p, i) => {
    const kinds = new Set(p.events.filter(e => e.type !== 'spend' && e.amt !== 0).map(e => e.type));
    if (kinds.size) marks.push({ i, p, pay: kinds.has('pay'), x: g.x(i), y: g.y(p.bal) });
  });

  const low = r.lowest;
  const lowPoint = pointOn(low.date) || pts[0];
  const lowWhen = low.date === t ? 'today' : 'on ' + shortDate(low.date);
  const lowText = `Lowest: ${fmtShort(low.bal)} ${lowWhen}`;

  const summary = summaryText(app, { r, np, t, keys, anyEst, lowText, low });
  const data = {
    today: t, 'today-bal': pointOn(t).bal,
    'month-end': mEnd, 'month-end-bal': at.has(mEnd) ? pointOn(mEnd).bal : '',
    end: r.end, lowest: low.date, 'lowest-bal': low.bal, daily: r.dailySpend,
  };
  if (np) {
    const before = addDays(np.date, -1);
    Object.assign(data, { 'next-pay': np.date, 'before-pay': before, 'before-pay-bal': at.has(before) ? pointOn(before).bal : '' });
  }

  keepFocus(root, () => {
    root.querySelector(':scope > .band-head').outerHTML = head(marks.length ? 'tap a dot for that day' : '');
    for (const name of Object.keys(plot.dataset)) delete plot.dataset[name];
    for (const [k, v] of Object.entries(data)) plot.setAttribute('data-' + k, String(v));
    plot.style.height = g.H + 'px';
    plot.innerHTML = chartSvg(app, r, g, marks, lowPoint, at, { summary, esc, np, mEnd })
      + hitsHtml(app, marks, g, t);

    const axis = root.querySelector(':scope > .fc-axis');
    axis.innerHTML = ticks(app, { t, np, mEnd, end: r.end, at, g }).map(x =>
      `<span class="fc-tick" data-k="${x.k}" data-x="${f1(x.x)}" data-align="${x.align}"><b>${x.cap}</b>${x.sub ? ' ' + esc(x.sub) : ''}</span>`).join('');
    layoutTicks(axis, W);

    const dl = root.querySelector(':scope > .fc-keys');
    dl.dataset.n = String(keys.length);
    dl.innerHTML = keys.map(({ k, cap, date, p }) => `
      <div class="fc-key" data-key="${k}" data-date="${date}" data-bal="${p.bal}">
        <dt>${cap}</dt>
        <dd><b class="amt${p.bal < 0 ? ' neg' : ''}">${esc(fmtShort(p.bal))}</b><small>${esc(shortDate(date))}${p.estimate ? '<span class="fc-sep"> · </span><span class="fc-est-word">estimate</span>' : ''}</small></dd>
      </div>`).join('');

    const notes = [];
    notes.push(`<p class="fc-note fc-low${low.bal < 0 ? ' is-neg' : ''}">${ringGlyph}<span><span class="fc-low-text">${esc(lowText)}${low.note ? `, <span data-user>${esc(low.note)}</span>` : ''}</span>${lowPoint.estimate ? ' <span class="est">(estimate)</span>' : ''}</span></p>`);
    if (r.negative) notes.push(`<p class="fc-note fc-neg-line">${hatchGlyph}<span>${esc(r.negative.text)}</span></p>`);
    if (anyEst) {
      notes.push(`<p class="fc-note fc-est-line">${dotsGlyph}<span>${r.dailySpend > 0
        ? `Dotted: estimate from your average spending of ${esc(fmtShort(r.dailySpend))} a day`
        : 'Dotted: estimate'}</span></p>`);
    }
    if (r.visaMarker && visa) {
      notes.push(`<div class="fc-row fc-visa"><p>${esc(r.visaMarker.text)}</p><button class="btn" type="button" id="fcVisaDue" data-fc-account="${esc(visa.id)}">Set due day</button></div>`);
    }
    if (cheq) {
      const when = r.start.date === t ? 'today' : 'on ' + shortDate(r.start.date);
      notes.push(`<div class="fc-row fc-from"><p>Starts from ${esc(fmtShort(r.start.bal))} in chequing, entered ${esc(when)}.</p><button class="btn-quiet small" type="button" id="fcUpdateCheq" data-fc-account="${esc(cheq.id)}" aria-label="Update the chequing balance">Update balance</button></div>`);
    }
    root.querySelector(':scope > .fc-notes').innerHTML = notes.join('') + storyHtml(esc, story);
  });

  if (fresh && inView) drawOn(app, root);
}

/* ---------- geometry ---------- */
function geometry(pts, W) {
  const H = W >= 560 ? H_WIDE : H_PHONE;
  const n = pts.length;
  const bals = pts.map(p => p.bal);
  let lo = Math.min(0, ...bals), hi = Math.max(0, ...bals);
  if (hi - lo < 1) hi = lo + 1;
  const span = hi - lo;
  hi += span * 0.06;
  if (lo < 0) lo -= span * 0.06;
  const x0 = PAD.left, x1 = W - PAD.right, yTop = PAD.top, yBot = H - PAD.bottom;
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const x = i => x0 + i * step;
  const y = b => yTop + ((hi - b) / (hi - lo)) * (yBot - yTop);
  return { W, H, n, x, y, x0, x1, yTop, yBot, yZero: y(0), hasNeg: lo < 0 };
}

// Runs of days drawn the same way: solid, or dotted when the day's balance uses an estimate.
function runs(pts, g) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const dotted = !!pts[i].estimate;
    const last = out[out.length - 1];
    const xy = [g.x(i), g.y(pts[i].bal)];
    if (last && last.dotted === dotted) last.xy.push(xy);
    else out.push({ dotted, xy: [[g.x(i - 1), g.y(pts[i - 1].bal)], xy] });
  }
  return out;
}
const pathOf = xy => 'M' + xy.map(([a, b]) => f1(a) + ' ' + f1(b)).join('L');

// A drop spindle hanging from the start of the thread, in the left gutter: hook, shaft, the cop of spun yarn
// with two windings, and the whorl. The thread leads from today's point to the hook.
function spindle(g, y0) {
  const sx = 12;
  const hy = Math.max(g.yTop - 6, Math.min(y0 + 3, g.H - 38));
  const d = `M${sx} ${f1(hy + 4)}v-2.4c0-1.6 2-1.8 2.6-.6`
    + `M${sx} ${f1(hy + 4)}V${f1(hy + 37)}`
    + `M${sx} ${f1(hy + 7.5)}c-4.6 3-4.6 11.5 0 15M${sx} ${f1(hy + 7.5)}c4.6 3 4.6 11.5 0 15`
    + `M${sx - 3} ${f1(hy + 13)}l6-1.9M${sx - 3.4} ${f1(hy + 17.2)}l6.8-2.1`
    + `M${sx - 6.5} ${f1(hy + 28)}c0 3.3 13 3.3 13 0M${sx - 6.5} ${f1(hy + 28)}c0-2.1 13-2.1 13 0`;
  const lead = `M${f1(g.x0)} ${f1(y0)}C${f1(g.x0 - 9)} ${f1(y0)} ${sx + 9} ${f1(hy + 0.5)} ${sx + 2.6} ${f1(hy + 1.6)}`;
  return `<path class="fc-spindle" d="${d}"/><path class="fc-spindle fc-lead" d="${lead}"/>`;
}

// A four point star, filled (pay days).
function starPath(cx, cy, r = 6) {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k - Math.PI / 2;
    const rr = k % 2 ? r * 0.3 : r;
    pts.push(f1(cx + Math.cos(a) * rr) + ' ' + f1(cy + Math.sin(a) * rr));
  }
  return 'M' + pts.join('L') + 'Z';
}

function chartSvg(app, r, g, marks, lowPoint, at, { summary, esc, np, mEnd }) {
  const pts = r.points;
  const lines = runs(pts, g).map(run => `<path class="fc-thread${run.dotted ? ' is-est' : ''}" d="${pathOf(run.xy)}"/>`).join('');
  const y0 = g.y(pts[0].bal);
  const yZ = g.yZero;
  let below = '';
  if (g.hasNeg && pts.length > 1) {
    const area = `M${f1(g.x(0))} ${f1(yZ)}L` + pts.map((p, i) => f1(g.x(i)) + ' ' + f1(g.y(p.bal))).join('L') + `L${f1(g.x(pts.length - 1))} ${f1(yZ)}Z`;
    below = `<path class="fc-hatch" clip-path="url(#fc-below)" fill="url(#fc-hatch)" d="${area}"/>`
      + `<g class="fc-red" clip-path="url(#fc-below)">${lines}</g>`;
  }
  // Payday and month end: faint rules down to the labels.
  const rules = [np && np.date, mEnd].filter((d, k, a) => d && at.has(d) && a.indexOf(d) === k && at.get(d) > 0)
    .map(d => `<path class="fc-rule" d="M${f1(g.x(at.get(d)))} ${f1(g.yTop - 8)}V${g.H}"/>`).join('');
  // "$0" at the right end, on the side away from where the thread ends.
  const endBal = pts[pts.length - 1].bal;
  const zeroBelow = endBal >= 0 && yZ + 13 <= g.H;
  const zeroLabel = `<text class="fc-zero-label" x="${g.W}" y="${f1(zeroBelow ? yZ + 12 : yZ - 5)}" text-anchor="end">$0</text>`;
  const dots = marks.map(m => (m.pay
    ? `<path class="fc-dot${m.p.bal < 0 ? ' is-neg' : ''}" d="${starPath(m.x, m.y)}"/>`
    : `<circle class="fc-dot${m.p.bal < 0 ? ' is-neg' : ''}" cx="${f1(m.x)}" cy="${f1(m.y)}" r="3.2"/>`)).join('');
  const li = at.get(lowPoint.date) ?? 0;
  const onDot = marks.some(m => m.i === li);
  const ring = `<circle class="fc-ring${lowPoint.bal < 0 ? ' is-neg' : ''}${onDot ? ' on-dot' : ''}" cx="${f1(g.x(li))}" cy="${f1(g.y(lowPoint.bal))}" r="${onDot ? 7 : 4.6}"/>`;
  return `<svg class="fc-svg" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}" role="img" aria-label="${esc(summary)}" focusable="false">`
    + '<defs>'
    + `<clipPath id="fc-above"><rect x="-20" y="-40" width="${g.W + 40}" height="${f1(yZ + 40)}"/></clipPath>`
    + (g.hasNeg ? `<clipPath id="fc-below"><rect x="-20" y="${f1(yZ)}" width="${g.W + 40}" height="${f1(g.H - yZ + 40)}"/></clipPath>`
      + '<pattern id="fc-hatch" width="3" height="8" patternUnits="userSpaceOnUse"><path class="fc-hatch-line" d="M1.5 0V8"/></pattern>' : '')
    + '</defs>'
    + `<g class="fc-grid">${rules}<path class="fc-zero" d="M0 ${f1(yZ)}H${g.W}"/>${zeroLabel}</g>`
    + `<g class="fc-spin">${spindle(g, y0)}</g>`
    + `<g class="fc-line"><g class="fc-ink" clip-path="url(#fc-above)">${lines}</g>${below}</g>`
    + `<g class="fc-marks">${dots}${ring}</g>`
    + '</svg>';
}

/* ---------- the day buttons ---------- */
// Every dot gets a 44 px button. Dots so close that their buttons would mostly cover each other share one button
// (it opens all their days); two days apart on a phone the buttons only touch at the edge.
const NEAR = HIT * 0.75;
function hitsHtml(app, marks, g, t) {
  if (!marks.length) return '';
  const groups = [];
  for (const m of marks) {
    const last = groups[groups.length - 1];
    const prev = last && last[last.length - 1];
    if (prev && m.x - prev.x < NEAR && Math.abs(m.y - prev.y) < NEAR) last.push(m);
    else groups.push([m]);
  }
  const { esc } = app.lib.core;
  const buttons = groups.map(list => {
    const xs = list.map(m => m.x), ys = list.map(m => m.y);
    let left = Math.min(...xs) - HIT / 2;
    const width = Math.max(...xs) - Math.min(...xs) + HIT;
    left = Math.max(-8, Math.min(left, g.W + 8 - width));
    const top = Math.min(...ys) - HIT / 2;
    const height = Math.max(...ys) - Math.min(...ys) + HIT;
    const days = list.map(m => m.p.date);
    const label = list.map(m => dayWords(app, m.p, t)).join('. ');
    return `<button class="fc-hit${list.length > 1 ? ' many' : ''}" type="button" id="fc-day-${days[0]}" data-fc-days="${days.join(' ')}"`
      + ` style="left:${f1(left)}px;top:${f1(top)}px;width:${f1(width)}px;height:${f1(height)}px" aria-label="${esc(label)}"></button>`;
  }).join('');
  return `<div class="fc-hits" role="group" aria-label="Days with bills or pay">${buttons}</div>`;
}

const eventName = (app, e) => (e.type === 'pay' ? (app.lib.importer.incomeNote(e.label) || 'Pay') : e.label);
const shown = e => e.amt !== 0;

// "Nov 18: Phone + Crave/Disney (Bell) $90.83 out, Spending estimate $21.57 out. Balance $215.78 (estimate)"
function dayWords(app, p, t) {
  const { fmtShort, shortDate } = app.lib.core;
  const evs = p.events.filter(shown).map(e => `${eventName(app, e)} ${fmtShort(Math.abs(e.amt))} ${e.amt < 0 ? 'out' : 'in'}`);
  return `${p.date === t ? 'Today' : shortDate(p.date)}: ${evs.join(', ')}. Balance ${fmtShort(p.bal)}${p.estimate ? ' (estimate)' : ''}`;
}

function openDays(app, dates) {
  if (!current) return;
  const { r, t } = current;
  const { esc, fmtShort, shortDate, joinAnd } = app.lib.core;
  const days = dates.map(d => r.points.find(p => p.date === d)).filter(Boolean);
  if (!days.length) return;
  const many = days.length > 1;
  const dayName = d => (d === t ? 'Today' : shortDate(d));
  const userText = e => e.type === 'bill' || (!e.estimate && (e.type === 'spend' || (e.type === 'pay' && e.label !== 'Pay')));
  const body = days.map(p => {
    const rows = p.events.filter(shown).map(e => `
      <li class="fc-ev${e.estimate ? ' is-est' : ''}">
        <span class="fc-ev-name"><span${userText(e) ? ' data-user' : ''}>${esc(eventName(app, e))}</span>${e.date !== p.date ? `<small>${esc(shortDate(e.date))}</small>` : ''}</span>
        <span class="amt">${esc(fmtShort(Math.abs(e.amt)))} ${e.amt < 0 ? 'out' : 'in'}</span>
      </li>`).join('');
    return `
      <section class="fc-day" data-date="${p.date}">
        ${many ? `<h3 class="caps">${esc(dayName(p.date))}</h3>` : ''}
        <ul class="fc-evs">${rows}</ul>
        <p class="fc-day-bal"><span>Balance at the end of the day</span><span class="amt${p.bal < 0 ? ' neg' : ''}">${esc(fmtShort(p.bal))}${p.estimate ? ' <span class="est">(estimate)</span>' : ''}</span></p>
      </section>`;
  }).join('');
  app.sheet({ title: joinAnd(days.map(p => dayName(p.date))), body: `<div class="fc-days">${body}</div>` });
}

/* ---------- labels under the chart ---------- */
function ticks(app, { t, np, mEnd, end, at, g }) {
  const { shortDate } = app.lib.core;
  // The ledger under the axis gives today's and month end's dates; payday's date only shows here.
  const out = [{ k: 'today', date: t, cap: 'Today', sub: '' }];
  if (np && at.has(np.date)) out.push({ k: 'payday', date: np.date, cap: np.date === mEnd ? 'Payday, month end' : 'Payday', sub: shortDate(np.date) + (np.estimate ? ' (estimate)' : '') });
  if (at.has(mEnd) && !out.some(x => x.date === mEnd)) out.push({ k: 'month-end', date: mEnd, cap: 'Month end', sub: '' });
  out.sort((a, b) => a.date.localeCompare(b.date));
  for (const x of out) {
    x.x = g.x(at.get(x.date));
    x.align = x.date === t ? 'start' : x.date === end ? 'end' : 'mid';
  }
  return out;
}

// Places the labels under their days without overlap and inside the width.
function layoutTicks(axis, W) {
  const items = [...axis.children].map(el => ({ el, x: Number(el.dataset.x), w: el.offsetWidth }));
  const gap = 12;
  for (const it of items) {
    const align = it.el.dataset.align;
    it.left = align === 'start' ? 0 : align === 'end' ? W - it.w : it.x - it.w / 2;
    it.left = Math.max(0, Math.min(W - it.w, it.left));
  }
  for (let i = 1; i < items.length; i++) items[i].left = Math.max(items[i].left, items[i - 1].left + items[i - 1].w + gap);
  const last = items[items.length - 1];
  if (last && last.left + last.w > W) {
    last.left = W - last.w;
    for (let i = items.length - 2; i >= 0; i--) items[i].left = Math.min(items[i].left, items[i + 1].left - gap - items[i].w);
  }
  // Still no room (a very narrow screen): keep today and payday, drop month end.
  if (items.length > 2 && items[0].left < 0) {
    const drop = items.find(it => it.el.dataset.k === 'month-end');
    if (drop) { drop.el.remove(); layoutTicks(axis, W); return; }
  }
  for (const it of items) it.el.style.left = f1(Math.max(0, it.left)) + 'px';
}

/* ---------- words for screen readers ---------- */
function summaryText(app, { r, np, t, keys, anyEst, lowText, low }) {
  const { fmtShort, shortDate } = app.lib.core;
  const parts = [`Chequing forecast from ${shortDate(t)} to ${shortDate(r.end)}${anyEst ? ', an estimate after today' : ''}.`];
  for (const k of keys) parts.push(`${k.cap}, ${shortDate(k.date)}: ${fmtShort(k.p.bal)}.`);
  if (np) parts.push(`Payday ${shortDate(np.date)}${np.estimate ? ' (estimate)' : ''}.`);
  parts.push(lowText + (low.note ? ', ' + low.note : '') + '.');
  if (r.negative) parts.push(`Below $0 from ${shortDate(r.negative.firstDate)}. ${r.negative.text}.`);
  return parts.join(' ');
}

/* ---------- the once a day draw on ---------- */
// The thread pulls out of the spindle when the band first comes into view each day. Transform and opacity only;
// nothing under reduced motion.
function drawOn(app, root) {
  if (reduced()) return;
  const plot = root.querySelector(':scope > .fc-plot');
  if (!plot || !plot.querySelector('.fc-line')) return;
  const day = app.today();
  if (store.get(DRAWN) === day) return;
  store.set(DRAWN, day);
  plot.classList.remove('is-drawing');
  void plot.offsetWidth;
  plot.classList.add('is-drawing');
  setTimeout(() => plot.classList.remove('is-drawing'), 900);
}
