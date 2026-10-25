// Caption card, bottom left of the vista: the place name, its real reference
// and its specialty with the place symbol. It changes with a short settle
// after each travel.

import { h, play, clear } from './dom.js';
import { icon } from './icons.js';
import { PLACE } from '../places.js';
import { COPY } from './copy.js';

let root;
let onOpen;
let lastId = null;

export function mountCaption(parent, { onOpenPlace } = {}) {
  onOpen = onOpenPlace;
  root = h('div', { class: 'caption glass', 'aria-live': 'off' });
  root.addEventListener('click', () => {
    if (lastId && onOpen) onOpen(lastId);
  });
  parent.appendChild(root);
}

export function renderCaption(id, { loading = false, animate = false } = {}) {
  if (!root) return;
  const p = PLACE[id];
  clear(root);
  if (loading || !p) {
    root.classList.add('is-loading');
    root.append(h('div', { class: 'caption-name', text: COPY.loading.caption }), h('div', { class: 'caption-ref loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    return;
  }
  root.classList.remove('is-loading');
  root.append(
    h('div', { class: 'caption-name' }, p.name),
    h('div', { class: 'caption-ref', text: p.ref }),
    h('div', { class: 'caption-spec' }, h('span', { class: 'caption-sym', html: icon(p.symbol, { size: 16 }) }), h('span', { text: `Specialty: ${p.specialty}` })),
  );
  root.setAttribute('title', `Open ${p.name}`);
  if (animate && lastId !== id) {
    play(root, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(-1px)', offset: 0.75 }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 600, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  lastId = id;
}
