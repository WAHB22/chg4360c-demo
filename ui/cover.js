// Cover it and raise suggestions (Stage 4, docs/UI.md, docs/SPEC.md 5.4).
//
// On every render core draws an empty <div class="cover-slot" data-item> under each limit bar; this module fills them:
//   - a quiet note when moves changed the item's limit this month: "+$40 moved in" or "$40 moved out" (any month);
//   - when the item is orange or red (lib/budget.js bars) in the current month or a later one, an outline button
//     "Cover it · move room from <first source>" (sources come most room first from coverSuggestion);
//   - in the current month, when raiseSuggestion says the item was topped up three months running:
//     "Groceries topped up Sep, Oct and Nov. Make it $480?" with a button that raises the base limit for real.
// A tap on Cover it opens a sheet: two amphorae pouring, one plain line per source ("Move $40 from Volleyball to
// Groceries"), "This covers it" or "This covers $25 of $40", the item after the move, and "Move it", which runs
// app.act(label('move'), s => applyCover(s, month, suggestion, today)) as one undoable change.
//
// Past months get the note only: covering a month that has ended would turn an overspend into a "held" mark.
// Item names are his data (and can come from imports), so every one goes through esc() and carries data-user.
// Every amount comes from lib functions; this file only formats them.

const LATER_KEY = 'finance-raise-not-now'; // {itemId: 'YYYY-MM'}: "Not now" on a raise, per device, per month
let seq = 0;

export function mount(app) {
  const root = document.getElementById('budget');
  if (!root) return;
  root.addEventListener('click', e => {
    const cover = e.target.closest('[data-cover]');
    if (cover) { openCover(app, cover.dataset.cover); return; }
    const raise = e.target.closest('[data-raise]');
    if (raise) { doRaise(app, raise.dataset.raise); return; }
    const later = e.target.closest('[data-raise-later]');
    if (later) notNow(app, later.dataset.raiseLater);
  });
  app.on('render', () => draw(app));
  if (app.state) draw(app);
}

function draw(app) {
  try { drawSlots(app); } catch (e) { console.error('Could not draw Cover it:', e); }
}

/* ---------- reading (lib only) ---------- */
function itemsOf(app, state, monthKey) {
  return new Map(app.lib.budget.bars(state, monthKey).flatMap(g => g.items).map(i => [i.id, i]));
}
const currentMonth = app => app.lib.core.monthOf(app.today());
const canCover = (app, monthKey) => monthKey >= currentMonth(app);
const needsCover = bar => bar && bar.limit > 0 && (bar.cls === 'orange' || bar.cls === 'red');

function raiseFor(app, state, monthKey, itemId) {
  if (monthKey !== currentMonth(app)) return null;
  return app.lib.budget.raiseSuggestion(state, monthKey, itemId);
}
const raiseText = (app, name, r) => {
  const { esc, fmtShort, joinAnd, monthShort } = app.lib.core;
  return `<span data-user>${esc(name)}</span> topped up ${joinAnd(r.months.map(monthShort))}. Make it ${fmtShort(r.newLimit)}?`;
};

/* ---------- per device "Not now" on a raise ---------- */
function laterMap() {
  try {
    const v = JSON.parse(window.localStorage.getItem(LATER_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function setLater(itemId, monthKey) {
  try {
    const v = laterMap();
    v[itemId] = monthKey;
    window.localStorage.setItem(LATER_KEY, JSON.stringify(v));
  } catch { /* blocked storage: the offer simply comes back */ }
}

/* ---------- the slots ---------- */
function drawSlots(app) {
  const s = app.state;
  if (!s) return;
  const M = app.month();
  const items = itemsOf(app, s, M);
  const later = laterMap();
  // Core draws fresh empty slots on every render, so each one is simply filled (or emptied after "Not now").
  for (const slot of document.querySelectorAll('#budget .cover-slot[data-item]')) {
    const bar = items.get(slot.dataset.item);
    slot.innerHTML = bar ? slotHtml(app, s, M, bar, items, later) : '';
  }
}

function slotHtml(app, s, M, bar, items, later) {
  const { esc, fmtShort, sum } = app.lib.core;
  const { budget } = app.lib;
  const parts = [];

  // How much this month's moves changed the limit (effective limit minus base limit, exact in cents).
  const moved = sum([bar.limit, -bar.baseLimit]);
  if (moved > 0) parts.push(`<p class="cover-note">+${fmtShort(moved)} moved in</p>`);
  else if (moved < 0) parts.push(`<p class="cover-note">${fmtShort(-moved)} moved out</p>`);

  const r = raiseFor(app, s, M, bar.id);
  if (r && later[bar.id] !== M) {
    parts.push(`
      <div class="cover-raise">
        <p>${raiseText(app, bar.name, r)}</p>
        <div class="cover-raise-do">
          <button class="btn cover-raise-btn" type="button" id="raise-${esc(bar.id)}" data-raise="${esc(bar.id)}">Make it ${fmtShort(r.newLimit)}<span class="sr-only"> for <span data-user>${esc(bar.name)}</span></span></button>
          <button class="btn-quiet cover-later" type="button" data-raise-later="${esc(bar.id)}">Not now</button>
        </div>
      </div>`);
  }

  if (canCover(app, M) && needsCover(bar)) {
    const sug = budget.coverSuggestion(s, M, bar.id);
    const first = sug && sug.from.length ? items.get(sug.from[0].itemId) : null;
    if (first) {
      parts.push(`<button class="cover-btn" type="button" id="cover-${esc(bar.id)}" data-cover="${esc(bar.id)}">`
        + `<span>Cover it · move room from <span data-user>${esc(first.name)}</span></span>`
        + `<span class="sr-only"> to <span data-user>${esc(bar.name)}</span></span></button>`);
    }
  }
  return parts.join('');
}

/* ---------- the pour (two amphorae, original line art in the motifs.js style) ---------- */
// The amphora of ui/motifs.js, redrawn here so the ink sits in its own clipped group and can move inside the jar.
const BODY = 'M23 14c-11 3-15 14-12 25 3 9 10 13 19 13s16-4 19-13c3-11-1-22-12-25z';
const LINES = 'M23 6h14M24 6c0 4-1 5-1 8M36 6c0 4 1 5 1 8M23 14c-11 3-15 14-12 25 3 9 10 13 19 13s16-4 19-13c3-11-1-22-12-25'
  + 'M16 17c-7 0-8 8-2 10M44 17c7 0 8 8 2 10M23 52l-3 6h20l-3-6';
const P = d => `<path d="${d}" vector-effect="non-scaling-stroke"/>`;

function jar(clipId, inkY, inkCls, inkTransform = '') {
  const ink = `<rect class="${inkCls}" x="-30" y="${inkY}" width="120" height="80" fill="currentColor" stroke="none"/>`;
  return `<defs><clipPath id="${clipId}"><path d="${BODY}"/></clipPath></defs>`
    + `<g clip-path="url(#${clipId})">${inkTransform ? `<g transform="${inkTransform}">${ink}</g>` : ink}`
    + `<g stroke-width="1">${P('M6 27h48M6 32h48')}</g></g>`
    + P(LINES);
}

// The source stands on a small pedestal, tipped 36 degrees on the corner of its foot (40, 58), pouring a thread
// of ink into the upright target on the ground. CSS tips it from upright, lowers its ink and raises the target's.
function pourArt() {
  const n = ++seq;
  const src = jar('pour-a' + n, 34, 'pour-src-ink', 'rotate(-36 30 36)');
  const dst = jar('pour-b' + n, 36.8, 'pour-dst-ink');
  return `<svg class="motif pour" viewBox="0 0 240 108" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`
    + P('M10 104h220')
    // A fluted altar: cap, shaft with four flutes, base.
    + P('M36 62h62M39 66.5h56M42 66.5v31.5M92 66.5v31.5M52 71v23M62 71v23M72 71v23M82 71v23M39 98h56')
    + `<g transform="translate(22 4) rotate(36 40 58)"><g class="pour-tilt">${src}</g></g>`
    + `<g class="pour-stream">${P('M90 18c18-4 44-6 64 6 14 9 22 20 26 32')}</g>`
    + `<g transform="translate(150 46)">${dst}</g>`
    + '</svg>';
}

/* ---------- the sheet ---------- */
function openCover(app, itemId) {
  const s = app.state;
  if (!s) return;
  const { core, budget, labels } = app.lib;
  const { esc, fmtShort, clone, monthName, joinAnd } = core;
  const M = app.month();
  const today = app.today();
  const items = itemsOf(app, s, M);
  const target = items.get(itemId);
  const sug = target ? budget.coverSuggestion(s, M, itemId) : null;
  if (!target || !sug || !sug.from.length) {
    app.toast('There is no room left in your other limits this month.');
    return;
  }

  // The month after the move, from the lib on a copy: the target and each source as they would read.
  const preview = clone(s);
  budget.applyCover(preview, M, sug, today);
  const after = itemsOf(app, preview, M);
  const name = id => (items.get(id) || {}).name || 'Other';
  const reads = bar => `<b>${fmtShort(bar.spent)}</b> of ${fmtShort(bar.limit)}`;

  const lines = sug.from.map(f => {
    const a = after.get(f.itemId);
    return `
      <li>
        <p class="cover-line">Move <b>${fmtShort(f.amt)}</b> from <span data-user>${esc(name(f.itemId))}</span> to <span data-user>${esc(target.name)}</span></p>
        ${a ? `<p class="cover-left"><span data-user>${esc(a.name)}</span> after: ${fmtShort(a.spent)} of ${fmtShort(a.limit)}</p>` : ''}
      </li>`;
  }).join('');
  const t = after.get(itemId) || target;
  // Words in Bodoni, amounts in Inter (the guide: Inter for every number).
  const num = n => `<span class="cover-num">${fmtShort(n)}</span>`;
  const result = sug.partial ? `This covers ${num(sug.total)} of ${num(sug.needed)}` : 'This covers it';
  const state = t.cls === 'red' ? 'over the limit' : t.cls === 'orange' ? 'close to the limit' : t.cls === 'green' ? 'under 75%' : '';
  const r = raiseFor(app, s, M, itemId);

  const body = `
    <div class="cover">
      <div class="cover-art">${pourArt()}</div>
      <ul class="cover-lines">${lines}</ul>
      <p class="cover-result">${result}</p>
      <div class="cover-after">
        <p class="bar-top"><span class="nm"><span data-user>${esc(t.name)}</span> after</span><span class="amt">${reads(t)}</span></p>
        <span class="track" aria-hidden="true"><span class="fill ${t.cls}" style="width:${Math.max(0, Math.min(100, t.width)).toFixed(1)}%"></span></span>
        ${state ? `<span class="sr-only">, ${state}</span>` : ''}
      </div>
      <p class="cover-month">Room moves for ${esc(monthName(M))} only. Your limits still add up to ${fmtShort(budget.totalLimits(s, M))}.</p>
      ${r ? `
      <div class="cover-raise in-sheet">
        <p>${raiseText(app, target.name, r)}</p>
        <div class="cover-raise-do"><button class="btn" type="button" data-sheet-raise>Make it ${fmtShort(r.newLimit)}</button></div>
      </div>` : ''}
    </div>`;

  let handle;
  const move = () => {
    const now = app.state;
    if (!now) return;
    // Dry run on a copy: the label names what will really move (applyCover clamps to each source's room today).
    const made = budget.applyCover(clone(now), M, sug, app.today());
    handle.close();
    if (!made.length) { app.toast('There is no room left in your other limits this month.'); return; }
    const fromNames = [...new Set(made.map(mv => mv.from))].map(name);
    const lbl = labels.label('move', { amt: core.sum(made, mv => mv.amt), fromName: joinAnd(fromNames), toName: target.name });
    app.act(lbl, d => { budget.applyCover(d, M, sug, app.today()); });
    focusBar(itemId);
  };

  handle = app.sheet({
    title: 'Cover ' + target.name,
    body,
    actions: [
      { label: 'Cancel', onClick: () => handle.close() },
      { label: 'Move it', primary: true, id: 'coverMove', onClick: move },
    ],
    onMount(h) {
      const btn = h.el.querySelector('[data-sheet-raise]');
      if (btn) btn.addEventListener('click', () => { h.close(); doRaise(app, itemId); });
    },
    onClose: () => refocus(itemId),
  });
}

/* ---------- raise ---------- */
function doRaise(app, itemId) {
  const s = app.state;
  if (!s) return;
  const { budget, labels, core } = app.lib;
  const M = app.month();
  const r = raiseFor(app, s, M, itemId);
  const item = core.findItem(s, itemId);
  if (!r || !item) return;
  app.act(labels.label('raise', { name: item.name, newLimit: r.newLimit }), d => { budget.applyRaise(d, r); });
  focusBar(itemId);
}

function notNow(app, itemId) {
  setLater(itemId, app.month());
  draw(app);
  focusBar(itemId);
}

/* ---------- focus ---------- */
// After a change the button pressed may be gone: keep the keyboard on the same limit row.
function focusBar(itemId) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected && !a.closest('dialog')) return;
  const cover = document.getElementById('cover-' + itemId);
  const bar = cover || document.querySelector(`#budget .bar-hit[data-item="${CSS.escape(itemId)}"]`);
  if (bar && !document.querySelector('dialog.sheet[open]')) bar.focus({ preventScroll: true });
}
// The sheet puts focus back on its opener; when that button left with the change, the row takes it.
function refocus(itemId) {
  const a = document.activeElement;
  if (!a || a === document.body || !a.isConnected) focusBar(itemId);
}
