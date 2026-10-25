// System messages: one short centered pill at a quarter of the height.
// 200 ms in, 3 s hold, 400 ms out, at most 1 at a time (the rest wait in line).
// During quiet hours nothing shows: messages are held until quiet ends.
// Screen readers hear each message through a polite live region.

import { h, play, clean } from './dom.js';
import { S } from './store.js';

let host = null;
let live = null;
const line = [];
const held = [];
let busy = false;

export function mountToast(root) {
  host = h('div', { class: 'sysmsg-host', 'aria-hidden': 'true' });
  live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.appendChild(host);
  root.appendChild(live);
}

export function say(text, { force = false } = {}) {
  const t = clean(text);
  if (!t) return;
  if (S.quiet && !force) {
    if (!held.includes(t)) held.push(t);
    return;
  }
  if (line.includes(t)) return;
  line.push(t);
  pump();
}

// Called when quiet hours end: held messages come out one by one.
export function releaseHeld() {
  while (held.length) say(held.shift());
}

export function heldCount() {
  return held.length;
}

async function pump() {
  if (busy || !host) return;
  const t = line.shift();
  if (!t) return;
  busy = true;
  const pill = h('div', { class: 'sysmsg' }, h('span', { class: 'sysmsg-mark', 'aria-hidden': 'true' }), h('span', { text: t }));
  host.appendChild(pill);
  if (live) {
    live.textContent = '';
    setTimeout(() => { if (live) live.textContent = t; }, 30);
  }
  await play(pill, [{ opacity: 0, transform: 'translateY(6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
  await new Promise((r) => setTimeout(r, 3000));
  await play(pill, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 400, easing: 'cubic-bezier(.5,0,.75,0)' });
  pill.remove();
  busy = false;
  pump();
}
