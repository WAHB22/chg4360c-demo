// The overlay host. Place panels and lists slide in from the right (400 px on
// a laptop, 360 px on a tablet); the ICON REPORT, the brief and the floors
// open as centered glass strong modals (max 640 px). On a phone every one of
// them is a bottom sheet: 60 percent tall, drag the grip up to full height,
// drag it down to close. Only one is open at a time. Escape closes it and the
// focus goes back to whatever opened it.

import { h, clear, play, trapFocus, isPhone, reducedMotion } from './dom.js';
import { icon } from './icons.js';

let host;
let scrim;
let cur = null; // { el, body, kind, opener, untrap, onClose, id }
let closing = null;
let onClosed = null;

export function mountSheets(parent, { onClose } = {}) {
  onClosed = onClose;
  host = h('div', { class: 'sheets' });
  scrim = h('div', { class: 'scrim', hidden: true });
  scrim.addEventListener('click', () => closeSheet());
  host.appendChild(scrim);
  parent.appendChild(host);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cur) {
      e.preventDefault();
      closeSheet();
    }
  });
}

export function currentSheet() {
  return cur;
}

// spec: {id, kind:'panel'|'modal', title, sub, symbol, back, label, className, opener}
export async function openSheet(spec) {
  const opener = spec.opener || (cur ? cur.opener : document.activeElement);
  if (cur) await closeSheet({ silent: true, keepScrim: spec.kind === 'modal', fast: true });
  const kind = spec.kind === 'modal' ? 'modal' : 'panel';
  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  const el = h('div', {
    class: `sheet sheet-${kind} ${spec.className || ''}`,
    role: 'dialog',
    'aria-modal': kind === 'modal' ? 'true' : 'false',
    'aria-labelledby': titleId,
    dataset: { size: 'half', view: spec.id || '' },
  });
  const grip = h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }, h('i'));
  const closeBtn = h('button', { class: 'btn-round', type: 'button', 'aria-label': 'Close', html: icon('close', { size: 18 }) });
  closeBtn.addEventListener('click', () => closeSheet());
  const titleEl = h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, spec.title || '');
  const head = h(
    'header',
    { class: 'sheet-head' },
    spec.back
      ? h('button', { class: 'btn-round', type: 'button', 'aria-label': spec.back.label || 'Back', html: icon('back', { size: 18 }), onclick: spec.back.onBack })
      : null,
    spec.symbol ? h('span', { class: 'sheet-sym', 'aria-hidden': 'true', html: icon(spec.symbol, { size: 22 }) }) : null,
    h('div', { class: 'sheet-titles' }, titleEl, spec.sub ? h('p', { class: 'sheet-sub', text: spec.sub }) : null),
    closeBtn,
  );
  const body = h('div', { class: 'sheet-body' });
  el.append(grip, head, body);
  host.appendChild(el);
  if (kind === 'modal') {
    scrim.hidden = false;
    if (!scrim.classList.contains('is-on')) {
      scrim.classList.add('is-on');
      play(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    }
  } else if (!spec.keepScrim) {
    scrim.classList.remove('is-on');
    scrim.hidden = true;
  }
  cur = { el, body, kind, opener, id: spec.id, untrap: kind === 'modal' ? trapFocus(el) : null, titleEl };
  setupDrag(el, grip, head);
  document.documentElement.classList.add('has-sheet');
  document.documentElement.dataset.sheet = kind;
  return cur;
}

export function showSheet(handle) {
  if (!handle) return;
  const el = handle.el;
  const phone = isPhone();
  let from;
  if (phone) from = 'translateY(24px)';
  else if (handle.kind === 'modal') from = 'translateY(12px) scale(.985)';
  else from = 'translateX(24px)';
  // panels arrive with weight: they travel in, pass their mark by a hair and settle back
  play(el, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'translateY(-3px) scale(1.006)', offset: 0.68 }, { opacity: 1, transform: 'translateY(0.5px) scale(0.999)', offset: 0.86 }, { opacity: 1, transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.22,.9,.32,1)' });
  setTimeout(() => {
    try { handle.titleEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }, 30);
}

export async function closeSheet({ silent = false, keepScrim = false, fast = false } = {}) {
  // a close already under way finishes on its own; a newer sheet still closes
  if (!cur) return closing || undefined;
  const c = cur;
  cur = null;
  if (c.untrap) c.untrap();
  const phone = isPhone();
  let to;
  if (phone) to = 'translateY(24px)';
  else if (c.kind === 'modal') to = 'translateY(8px) scale(.99)';
  else to = 'translateX(24px)';
  const tasks = [play(c.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: fast ? 120 : 200, easing: 'cubic-bezier(.5,0,.75,0)' })];
  if (!keepScrim && scrim.classList.contains('is-on')) {
    scrim.classList.remove('is-on');
    tasks.push(play(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 120 : 200 }).then(() => { if (!scrim.classList.contains('is-on')) scrim.hidden = true; }));
  }
  const done = Promise.all(tasks).then(() => {
    c.el.remove();
    if (closing === done) closing = null;
    if (!cur) {
      document.documentElement.classList.remove('has-sheet');
      delete document.documentElement.dataset.sheet;
    }
  });
  if (!silent) {
    if (c.opener && document.contains(c.opener) && typeof c.opener.focus === 'function') {
      try { c.opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    if (onClosed) onClosed(c.id);
  }
  closing = done;
  return done;
}

export function sheetBody() {
  return cur ? cur.body : null;
}

export function refill(handle, nodes) {
  if (!handle) return;
  const top = handle.body.scrollTop;
  clear(handle.body);
  for (const n of [].concat(nodes)) if (n) handle.body.appendChild(n);
  handle.body.scrollTop = top;
}

/* ------------------------------------------------------- phone sheet drag */

function setupDrag(el, grip, head) {
  let startY = 0;
  let startH = 0;
  let lastY = 0;
  let lastT = 0;
  let vel = 0;
  let dragging = false;
  const vh = () => window.innerHeight;
  const full = () => vh() - 12;
  const half = () => Math.round(vh() * 0.6);

  const down = (e) => {
    if (!isPhone()) return;
    if (e.target.closest('button') && e.currentTarget !== grip) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = performance.now();
    startH = el.getBoundingClientRect().height;
    vel = 0;
    el.classList.add('is-dragging');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const move = (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dy = e.clientY - lastY;
    vel = dy / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    let hgt = startH - (e.clientY - startY);
    // rubber band past full height
    if (hgt > full()) hgt = full() + (hgt - full()) * 0.2;
    el.style.height = `${Math.max(80, hgt)}px`;
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-dragging');
    const hgt = el.getBoundingClientRect().height;
    const flingDown = vel > 0.6;
    const flingUp = vel < -0.6;
    if ((flingDown && hgt < half() + 40) || hgt < half() * 0.6) {
      el.style.height = '';
      closeSheet();
      return;
    }
    const goFull = flingUp || (!flingDown && hgt > (half() + full()) / 2);
    el.dataset.size = goFull ? 'full' : 'half';
    el.style.height = '';
    if (reducedMotion()) el.classList.add('no-snap');
  };
  for (const t of [grip, head]) {
    t.addEventListener('pointerdown', down);
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
  }
  grip.addEventListener('dblclick', () => {
    el.dataset.size = el.dataset.size === 'full' ? 'half' : 'full';
  });
}
