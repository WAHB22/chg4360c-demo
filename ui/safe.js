// Safe to spend today (Stage 3, docs/UI.md, docs/SPEC.md 5.3).
//
// The hero number on paper: whole dollars a day from lib/money.js safeToSpend(state, app.today()), always for
// today whatever month is viewed. "today · payday in 6 days" under it, then the payday date with "(estimate)"
// when it is one, and the owl coin. The number counts over 400 ms when its value changes, never on a render that
// leaves it the same, and not at all under reduced motion. A tap opens the sum in plain words, from result.parts.
// With no paycheque on or before today ({missing:'pay'}) it asks for the last one and opens app.openPay().
//
// Bill names and pay notes come from his data and from imports (merchant text read from screenshots), so every
// one goes through esc() and carries data-user. Every amount and date shown comes from lib functions.

const COUNT_MS = 400;
// Close to the guide's ease out, cubic-bezier(0.23, 1, 0.32, 1).
const ease = p => 1 - Math.pow(1 - p, 5);
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let target = null;     // the value the number shows, or is counting to
let displayed = null;  // the value on screen right now (null before the first draw)
let raf = 0;

export function mount(app) {
  const root = document.getElementById('safe');
  if (!root) return;
  const draw = () => {
    try { render(app, root); } catch (e) { console.error('Could not draw safe to spend:', e); }
  };
  root.addEventListener('click', e => {
    if (e.target.closest('[data-log-pay]')) { app.openPay(); return; }
    if (e.target.closest('#safeBtn')) openBreakdown(app);
  });
  app.on('render', draw);
  if (app.state) draw();
}

function render(app, root) {
  if (!app.state) return;
  const r = app.lib.money.safeToSpend(app.state, app.today());
  if (!r || r.missing) drawMissing(app, root);
  else drawPeriod(app, root, r);
}

/* ---------- words ---------- */
const daysWord = n => (n === 1 ? '1 day' : n + ' days');
const paydayIn = n => (n === 1 ? 'payday tomorrow' : `payday in ${n} days`);

// The payday before the estimated next one, when it is after the last logged paycheque: he was paid but has not
// logged it, so the pay period still runs from the old paycheque (SPEC 5.2 steps 14 days from the last one).
function missedPayday(app, r) {
  const np = r && r.nextPay;
  if (!np || !np.estimate || !r.period) return null;
  const prev = app.lib.core.addDays(np.date, -14);
  return prev > r.period.start ? prev : null;
}

// Only touch the DOM when the text changes (no flicker, no lost selection, focus kept).
function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
function setHtml(el, html) {
  if (!el || el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function storyLine(app, box) {
  const el = box.querySelector('.safe-story');
  if (!el) return;
  const text = typeof app.story === 'function' ? app.story('safe') : '';
  setText(el, text);
  el.hidden = !text;
}

/* ---------- the hero ---------- */
function drawPeriod(app, root, r) {
  const { esc, shortDate } = app.lib.core;
  let box = root.querySelector(':scope > .safe[data-mode="period"]');
  if (!box) {
    cancelAnimationFrame(raf);
    root.innerHTML = `
      <div class="safe" data-mode="period">
        <p class="hero-caps" id="safeCaps">Safe to spend today</p>
        <button class="safe-hit" id="safeBtn" type="button" aria-labelledby="safeCaps safeBtn">
          <span class="big-num safe-num"></span>
          <span class="safe-when"></span>
          <span class="safe-date"></span>
          <span class="safe-more">${app.motifs.owl({ w: 40, h: 40 })}<span class="safe-more-text">See how it adds up</span></span>
        </button>
        <div class="safe-missed" hidden></div>
        <p class="story safe-story" hidden></p>
      </div>`;
    box = root.firstElementChild;
  }
  const np = r.nextPay;
  // On a narrow phone the line may only break after "today ·".
  setHtml(box.querySelector('.safe-when'), `today · <span class="nw">${paydayIn(r.days)}</span>`);
  setHtml(box.querySelector('.safe-date'),
    `<span class="safe-sep"> · </span>${esc(shortDate(np.date))}${np.estimate ? ' <span class="est">(estimate)</span>' : ''}`);

  const missed = missedPayday(app, r);
  const note = box.querySelector('.safe-missed');
  setHtml(note, missed
    ? `<p>Payday ${esc(shortDate(missed))} is not logged yet.</p><button class="btn" type="button" id="safeMissedPay" data-log-pay>Log paycheque</button>`
    : '');
  note.hidden = !missed;

  storyLine(app, box);
  countTo(app, box.querySelector('.safe-num'), r.perDay);
}

function drawMissing(app, root) {
  let box = root.querySelector(':scope > .safe[data-mode="missing"]');
  if (!box) {
    cancelAnimationFrame(raf);
    target = null;
    displayed = 0; // once a paycheque is logged, the number counts up from $0
    root.innerHTML = `
      <div class="safe" data-mode="missing">
        <p class="hero-caps">Safe to spend today</p>
        <div class="safe-coin">${app.motifs.owl({ w: 76, h: 76 })}${app.motifs.star({ w: 22, h: 22 })}</div>
        <p class="safe-ask" id="safeAsk">Log your last paycheque to see what is safe to spend</p>
        <p class="safe-ask-sub">It counts from your last payday to the next one.</p>
        <button class="btn-primary safe-log" type="button" id="safeLogPay" data-log-pay aria-describedby="safeAsk">Log paycheque</button>
        <p class="story safe-story" hidden></p>
      </div>`;
    box = root.firstElementChild;
  }
  storyLine(app, box);
}

// Counts the number from what is on screen to `to` over 400 ms. Same value: nothing moves.
function countTo(app, el, to) {
  const { fmtShort } = app.lib.core;
  if (el.textContent && to === target) return;
  const from = displayed == null ? 0 : displayed;
  target = to;
  cancelAnimationFrame(raf);
  raf = 0;
  // Sized for the value it lands on, so nothing jumps when the count ends.
  el.dataset.len = String(fmtShort(to).length);
  const show = v => { displayed = v; el.textContent = fmtShort(v); };
  if (from === to || reduced() || document.hidden) { show(to); return; }
  const t0 = performance.now();
  const tick = now => {
    // A frame's timestamp can be a little earlier than t0: clamped, so the first frame never runs past `from`.
    const p = Math.max(0, Math.min(1, (now - t0) / COUNT_MS));
    show(p < 1 ? Math.round(from + (to - from) * ease(p)) : to);
    raf = p < 1 ? requestAnimationFrame(tick) : 0;
  };
  raf = requestAnimationFrame(tick);
}

/* ---------- the sum, in plain words ---------- */
function openBreakdown(app) {
  if (!app.state) return;
  const compute = () => app.lib.money.safeToSpend(app.state, app.today());
  const first = compute();
  if (!first || first.missing) return;
  let html = breakdownHtml(app, first);
  let after = null; // runs once the sheet has closed and focus is back on the hero
  let off = () => {};

  const actionsFor = r => {
    const missed = missedPayday(app, r);
    return [
      { label: 'Close', primary: !missed, onClick: (e, h) => h.close() },
      missed ? { label: 'Log paycheque', primary: true, onClick: (e, h) => { after = () => app.openPay(); h.close(); } } : null,
    ];
  };

  const handle = app.sheet({
    title: 'Safe to spend today',
    body: html,
    actions: actionsFor(first),
    onClose() {
      off();
      const fn = after;
      after = null;
      if (fn) fn();
    },
  });

  // Keep the sum current while it is open (a sync can bring new data).
  off = app.on('render', () => {
    if (!handle.el.isConnected) { off(); return; }
    if (!app.state) return;
    const r = compute();
    if (!r || r.missing) { handle.close(); return; }
    const next = breakdownHtml(app, r);
    if (next === html) return;
    html = next;
    handle.setBody(next);
    handle.setActions(actionsFor(r));
  });
}

function breakdownHtml(app, r) {
  const { esc, fmt, fmtShort, shortDate, joinAnd } = app.lib.core;
  const incomeNote = app.lib.importer && app.lib.importer.incomeNote;
  const p = r.parts;
  const np = r.nextPay;
  const start = esc(shortDate(r.period.start));
  const end = esc(shortDate(r.period.end));
  const missed = missedPayday(app, r);

  const payName = note => {
    const n = String(note ?? '').trim();
    if (!n) return 'Bobino pay';
    return typeof incomeNote === 'function' ? incomeNote(n) : n;
  };
  const head = (title, amt) => `<div class="sb-line sb-head"><h3 class="caps">${title}</h3><span class="amt">${amt}</span></div>`;
  const row = (name, sub, amt, icon = '') =>
    `<li class="sb-row">${icon}<span class="sb-name"><b data-user>${esc(name)}</b><small>${sub}</small></span><span class="amt">${amt}</span></li>`;
  const list = rows => (rows.length ? `<ul class="sb-list">${rows.join('')}</ul>` : '');
  const billRow = b => row(b.name, `${esc(shortDate(b.date))} · ${b.paid ? 'paid' : 'not paid yet'}`, fmt(b.amt),
    `<span class="sb-icon">${app.motifs.column(!!b.paid, { w: 18, h: 24 })}</span>`);

  const nextLine = np.estimate
    ? `Next payday ${esc(shortDate(np.date))} <span class="est">(estimate, 14 days after the last one)</span>.`
    : `Next payday ${esc(shortDate(np.date))}.`;

  const pays = p.pays.map(x => row(payName(x.note), esc(shortDate(x.date)), fmt(x.amt)));
  const bills = p.billsInPeriod.map(billRow);
  const older = p.olderUnpaid.map(b => billRow({ ...b, paid: false }));

  const less = [`${fmt(p.spending)} spent`, `${fmt(p.billsTotal)} in bills`];
  if (p.olderUnpaid.length) less.push(`${fmt(p.olderTotal)} in older bills`);
  const daysText = r.days === 1 ? 'Today only.' : `Today to ${end}.`;
  const split = r.pool < 0
    ? 'Below zero, so nothing is safe to spend until payday.'
    : `${fmt(r.pool)} divided by ${daysWord(r.days)}, rounded down to whole dollars.`;

  return `
    <div class="sb">
      <div class="sb-lead">
        ${app.motifs.owl({ w: 44, h: 44 })}
        <p><span class="sb-num">${fmtShort(r.perDay)}</span> <span class="sb-lead-text">today · ${paydayIn(r.days)}</span></p>
      </div>
      <p class="sb-intro">This pay period runs from your last payday, ${start}, to ${end}, the day before the next one. ${nextLine}</p>
      ${missed ? `<p class="sb-missed">Payday ${esc(shortDate(missed))} is not logged yet, so this still counts from ${start}. Log it to start the new pay period.</p>` : ''}
      <div class="sb-ledger">
        <section class="sb-group" aria-label="Pays">
          ${head('Pays this period', fmt(p.income))}
          ${list(pays) || `<p class="sb-note">No pay logged since ${start}.</p>`}
        </section>
        <section class="sb-group" aria-label="Spending">
          ${head('Spending this period', fmt(p.spending))}
          <p class="sb-note">Every purchase dated ${start} to ${end}, on the Visa or from chequing.</p>
        </section>
        <section class="sb-group" aria-label="Bills">
          ${head('Bills this period', fmt(p.billsTotal))}
          <p class="sb-note">${bills.length ? `Paid or not, every bill due ${start} to ${end} comes out of this pay.` : `No bills due ${start} to ${end}.`}</p>
          ${list(bills)}
        </section>
        <section class="sb-group" aria-label="Older bills">
          ${head('Older bills not paid', fmt(p.olderTotal))}
          <p class="sb-note">${older.length ? `Bills due before ${start} that are still not ticked paid.` : 'Nothing unpaid from the weeks before this pay period.'}</p>
          ${list(older)}
        </section>
        <div class="sb-result">
          ${head('Left for this pay period', fmt(r.pool)).replace('sb-head', 'sb-head sb-left')}
          <p class="sb-note">${fmt(p.income)} in, less ${joinAnd(less)}.</p>
          ${head('Days left', daysWord(r.days))}
          <p class="sb-note">${daysText} ${split}</p>
          <div class="sb-line sb-final"><h3 class="caps">Safe to spend today</h3><span class="sb-final-num">${fmtShort(r.perDay)}</span></div>
        </div>
      </div>
    </div>`;
}
