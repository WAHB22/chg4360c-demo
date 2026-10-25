// Status block, top left: name, phase, the Week Meter (120 x 6 px, percent or
// ???%, its fills on tap) and up to 3 active bot dots with their markers.
// It fades to 40 percent after 5 s without input and comes back on any input.

import { h, clear, clean } from './dom.js';
import { markerIcon } from './icons.js';
import { S, st, activeBots, placeName } from './store.js';
import { BOT, STATES } from '../bots.js';
import { COPY } from './copy.js';

let root = null;
let nameEl;
let phaseEl;
let srcEl;
let meterBtn;
let barFill;
let pctEl;
let fillsEl;
let dotsEl;
let idleTimer = null;
let onBot = null;

export function mountStatus(parent, { onBotTap } = {}) {
  onBot = onBotTap;
  root = h('section', { class: 'status glass', 'aria-label': 'Status' });
  nameEl = h('div', { class: 'status-name' });
  phaseEl = h('div', { class: 'status-phase' });
  srcEl = h('div', { class: 'status-src', hidden: true });
  barFill = h('i', { class: 'meter-fill' });
  pctEl = h('span', { class: 'meter-pct' });
  meterBtn = h(
    'button',
    { class: 'meter', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'meter-fills' },
    h('span', { class: 'meter-label', text: 'Week' }),
    h('span', { class: 'meter-bar', 'aria-hidden': 'true' }, barFill),
    pctEl,
  );
  fillsEl = h('div', { class: 'meter-fills', id: 'meter-fills', hidden: true });
  dotsEl = h('div', { class: 'status-bots', role: 'list', 'aria-label': 'Active bots' });
  root.append(h('div', { class: 'status-who' }, nameEl, phaseEl, srcEl), meterBtn, fillsEl, dotsEl);
  parent.appendChild(root);

  meterBtn.addEventListener('click', () => {
    const open = fillsEl.hidden;
    fillsEl.hidden = !open;
    meterBtn.setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
  });
  root.addEventListener('pointerenter', wake);
  root.addEventListener('focusin', wake);
  renderStatus();
  wake();
}

// Any input brings the block back to full strength; 5 s later it rests.
export function wake() {
  if (!root) return;
  root.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (root.matches(':hover') || root.contains(document.activeElement) || !fillsEl.hidden) {
      wake();
      return;
    }
    root.classList.add('is-idle');
  }, 5000);
}

function level(p) {
  if (p == null) return 'unknown';
  if (p < 60) return 'low';
  if (p <= 85) return 'mid';
  return 'high';
}

export function renderStatus() {
  if (!root) return;
  const s = st();
  const owner = s.owner || {};
  nameEl.textContent = clean(owner.name) || (S.loading ? '' : 'Traveler');
  phaseEl.textContent = S.loading ? COPY.loading.status : clean(owner.phase) || '';
  phaseEl.hidden = !phaseEl.textContent;
  srcEl.hidden = S.loading || S.source !== 'demo';
  srcEl.textContent = 'Demo world, invented data';

  const wm = s.weekMeter || {};
  const raw = Number(wm.percent);
  const missing = Array.isArray(wm.missing) ? wm.missing.filter(Boolean) : [];
  const known = !S.loading && wm.percent != null && Number.isFinite(raw) && missing.length === 0;
  const pct = known ? Math.max(0, Math.min(100, Math.round(raw))) : null;
  const lv = level(pct);
  root.dataset.meter = lv;
  barFill.style.width = pct == null ? '100%' : `${pct}%`;
  pctEl.textContent = pct == null ? COPY.loading.meter : `${pct}%`;
  const words = { low: 'light', mid: 'steady', high: 'heavy', unknown: 'not known yet' }[lv];
  meterBtn.setAttribute('aria-label', pct == null ? `Week Meter, ${words}. Show what fills it.` : `Week Meter ${pct} percent, ${words}. Show what fills it.`);

  clear(fillsEl);
  const fills = Array.isArray(wm.fills) ? wm.fills.filter(Boolean) : [];
  if (fills.length) {
    fillsEl.appendChild(h('ul', { class: 'fills' }, fills.map((f) => h('li', { text: clean(f) }))));
  }
  if (missing.length) {
    fillsEl.appendChild(h('p', { class: 'fills-missing' }, `Not known yet: ${missing.map(clean).join(', ')}`));
  }
  if (!fills.length && !missing.length) fillsEl.appendChild(h('p', { class: 'fills-missing', text: COPY.empty.meter }));

  clear(dotsEl);
  const act = activeBots();
  for (const b of act) {
    const core = BOT[b.core];
    const label = `${clean(b.name) || core.name}, ${STATES[b.state] ? STATES[b.state].label.toLowerCase() : b.state}${b.place ? ` at ${placeName(b.place)}` : ''}`;
    const dot = h(
      'button',
      { class: `bot-dot is-${b.state}`, type: 'button', role: 'listitem', 'aria-label': label, title: label, style: { '--bot': core.color } },
      h('span', { class: 'bot-dot-body', 'aria-hidden': 'true' }),
      h('span', { class: 'bot-dot-mark', 'aria-hidden': 'true', html: markerIcon(b.state, 10) }),
    );
    dot.addEventListener('click', () => onBot && onBot(b.id));
    dotsEl.appendChild(dot);
  }
  dotsEl.hidden = act.length === 0;
}

