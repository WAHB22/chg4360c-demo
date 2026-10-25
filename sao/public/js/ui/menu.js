// The round icon menu column on the right: Report, Map, Bots, Drafts,
// Questions, Rules, Settings. 44 px cream discs with a 1.5 px gold ring and
// navy line icons, count badges, and a drop in one by one 40 ms apart.

import { h, play } from './dom.js';
import { icon } from './icons.js';

export const MENU = [
  { id: 'report', label: 'ICON REPORT' },
  { id: 'map', label: 'Map' },
  { id: 'bots', label: 'Bots' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'questions', label: 'Questions' },
  { id: 'rules', label: 'Rules' },
  { id: 'settings', label: 'Settings' },
];

let root;
const items = {};

export function disc(item, onOpen, { withLabel = false } = {}) {
  const badge = h('span', { class: 'disc-badge', hidden: true, 'aria-hidden': 'true' });
  const btn = h(
    'button',
    { class: 'disc', type: 'button', 'aria-label': item.label, dataset: { open: item.id } },
    h('span', { class: 'disc-face', html: icon(item.id, { size: 22 }) }),
    badge,
    withLabel ? null : h('span', { class: 'disc-tip', 'aria-hidden': 'true', text: item.label }),
  );
  btn.addEventListener('click', () => onOpen(item.id, btn));
  if (!withLabel) return { btn, badge, node: btn };
  const node = h('div', { class: 'disc-labeled' }, btn, h('span', { class: 'disc-name', text: item.label, 'aria-hidden': 'true' }));
  return { btn, badge, node };
}

export function mountMenu(parent, { onOpen }) {
  root = h('nav', { class: 'menu', 'aria-label': 'Menu' });
  const list = h('ul', { class: 'menu-list' });
  for (const it of MENU) {
    const d = disc(it, onOpen);
    items[it.id] = d;
    list.appendChild(h('li', null, d.btn));
  }
  root.appendChild(list);
  parent.appendChild(root);
  // arrow keys walk the column; Tab still reaches every disc in order
  root.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const btns = MENU.map((m) => items[m.id].btn);
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    btns[(i + step + btns.length) % btns.length].focus();
  });
}

// Drop in: each disc falls a little, overshoots by 2 px and settles.
export function dropIn() {
  MENU.forEach((m, i) => {
    const b = items[m.id] && items[m.id].btn;
    if (!b) return;
    play(
      b,
      [
        { opacity: 0, transform: 'translateY(-14px) scale(.92)' },
        { opacity: 1, transform: 'translateY(2px) scale(1.02)', offset: 0.7 },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 180, delay: 120 + i * 40, easing: 'cubic-bezier(.3,.0,.4,1)' },
    );
  });
}

export function setBadges(counts) {
  for (const m of MENU) {
    const d = items[m.id];
    if (!d) continue;
    setBadge(d, counts[m.id], m.label);
  }
}

export function setBadge(d, n, label) {
  const v = Number(n) || 0;
  d.badge.hidden = v <= 0;
  d.badge.textContent = v > 9 ? '9+' : String(v);
  d.btn.setAttribute('aria-label', v > 0 ? `${label}, ${v}` : label);
}

export function setPressed(id) {
  for (const m of MENU) {
    const d = items[m.id];
    if (d) d.btn.setAttribute('aria-pressed', String(m.id === id));
  }
}
