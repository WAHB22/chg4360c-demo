// The tower of floors: Term, Internship climb, Trailer climb. Floors climb
// from the base. Cleared floors are gold with their dates, the current floor
// glows, upcoming floors are outlined, boss deadlines carry a crest and the
// days left. A floor cleared since the last visit fills with gold (900 ms).

import { h, clean, store, play } from './dom.js';
import { icon } from './icons.js';
import { st, daysLeft } from './store.js';
import { COPY } from './copy.js';

const TABS = [
  { id: 'term', label: 'Term' },
  { id: 'internship', label: 'Internship climb' },
  { id: 'trailer', label: 'Trailer climb' },
];
const SEEN_KEY = 'sao.ui.floors.seen.v1';

let tab = 'term';

export function floorsView(act, { now, initial } = {}) {
  if (initial && TABS.some((t) => t.id === initial)) tab = initial;
  const wrap = h('div', { class: 'floors' });
  const list = h('div', { class: 'floors-panel', role: 'tabpanel' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Climbs' });
  const btns = TABS.map((t) => {
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-selected': String(t.id === tab), tabindex: t.id === tab ? '0' : '-1', text: t.label });
    b.addEventListener('click', () => select(t.id));
    return b;
  });
  tabs.append(...btns);
  tabs.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      select(TABS[n].id);
      btns[n].focus();
    }
  });
  function select(id) {
    tab = id;
    btns.forEach((b, i) => {
      const on = TABS[i].id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    list.setAttribute('aria-labelledby', `tab-${id}`);
    renderTower(list, id, now);
  }
  wrap.append(tabs, list);
  select(tab);
  return [wrap];
}

function renderTower(list, id, now) {
  list.innerHTML = '';
  const floors = (st().floors && Array.isArray(st().floors[id]) ? st().floors[id] : []).filter((f) => f && f.title);
  if (!floors.length) {
    list.appendChild(h('p', { class: 'empty', text: COPY.empty.floors }));
    return;
  }
  const sorted = [...floors].sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0));
  // the current floor is the first one not cleared, unless one is marked
  let curIdx = sorted.findIndex((f) => f.status === 'current');
  if (curIdx < 0) curIdx = sorted.findIndex((f) => f.status !== 'cleared');
  const seen = store(SEEN_KEY) || {};
  const fresh = [];
  const ol = h('ol', { class: 'tower', reversed: true, style: { '--top-rise': String(sorted.length - 1) }, 'aria-label': `${TABS.find((t) => t.id === id).label}, ${sorted.filter((f) => f.status === 'cleared').length} of ${sorted.length} floors cleared` });
  for (let i = sorted.length - 1; i >= 0; i--) {
    const f = sorted[i];
    const cleared = f.status === 'cleared';
    const current = !cleared && i === curIdx;
    const boss = !!f.boss;
    const left = boss && !cleared ? daysLeft(f, now) : null;
    const key = `${id}:${f.n}:${f.title}`;
    const cls = ['floor', cleared ? 'is-cleared' : current ? 'is-current' : 'is-upcoming', boss ? 'is-boss' : ''].filter(Boolean).join(' ');
    const status = cleared ? `cleared${f.date ? ` ${clean(f.date)}` : ''}` : current ? 'you are here' : 'upcoming';
    const li = h(
      'li',
      { class: cls, 'aria-current': current ? 'step' : null, style: { '--rise': String(i) } },
      h('span', { class: 'floor-n', 'aria-hidden': 'true', text: String(f.n ?? i + 1) }),
      h(
        'div',
        { class: 'floor-main' },
        h('p', { class: 'floor-title' }, boss ? h('span', { class: 'floor-crest', html: icon('crest', { size: 16 }), 'aria-hidden': 'true' }) : null, h('span', { text: clean(f.title) })),
        h('p', { class: 'floor-meta' }, h('span', { class: 'sr-only', text: `Floor ${f.n ?? i + 1}, ${boss ? 'boss deadline, ' : ''}${status}. ` }), h('span', { 'aria-hidden': 'true', text: cleared ? clean(f.date) || 'Cleared' : current ? 'You are here' : clean(f.date) || 'Ahead' })),
      ),
      boss && left != null && !cleared ? h('span', { class: 'floor-days', 'aria-hidden': 'true' }, h('b', { text: String(Math.max(0, left)) }), h('small', { text: left === 1 ? 'day' : 'days' })) : null,
    );
    if (cleared && seen[key] && seen[key] !== 'cleared') fresh.push(li);
    seen[key] = cleared ? 'cleared' : 'open';
    ol.appendChild(li);
  }
  ol.appendChild(h('li', { class: 'tower-base', 'aria-hidden': 'true' }));
  list.appendChild(ol);
  store(SEEN_KEY, seen);
  // floors cleared since the last visit fill with gold from the left
  fresh.forEach((li, k) => {
    li.classList.add('is-fresh');
    play(li, [{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { duration: 900, delay: 200 + k * 120, easing: 'cubic-bezier(.16,1,.3,1)' });
  });
}
