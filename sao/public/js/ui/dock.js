// Phone dock: three round buttons at the bottom (Map, Menu, ICON), and the
// menu sheet that holds the seven menu discs with their names.

import { h } from './dom.js';
import { icon } from './icons.js';
import { MENU, disc, setBadge } from './menu.js';

let menuItems = {};

export function mountDock(parent, { onMap, onMenu, onIcon }) {
  const mk = (id, label, ic, fn) => {
    const b = h('button', { class: 'dock-btn', type: 'button', 'aria-label': label, dataset: { dock: id } }, h('span', { class: 'dock-face', html: icon(ic, { size: 22 }) }), h('span', { class: 'dock-name', text: label }));
    b.addEventListener('click', () => fn(b));
    return b;
  };
  const nav = h('nav', { class: 'dock', 'aria-label': 'Quick menu' }, mk('map', 'Map', 'map', onMap), mk('menu', 'Menu', 'menu', onMenu), mk('icon', 'ICON', 'compass', onIcon));
  parent.appendChild(nav);
  return nav;
}

export function menuGrid(onOpen, counts = {}) {
  menuItems = {};
  const grid = h('ul', { class: 'menu-grid' });
  for (const it of MENU) {
    const d = disc(it, (id, btn) => onOpen(id, btn), { withLabel: true });
    menuItems[it.id] = d;
    setBadge(d, counts[it.id], it.label);
    grid.appendChild(h('li', null, d.node));
  }
  return grid;
}
