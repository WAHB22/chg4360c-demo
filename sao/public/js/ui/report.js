// The ICON REPORT (glass strong modal, max 640 px) and the morning brief.
// Report: Done, Needs me (max 3, tappable), Next paths (max 3), Not checked or
// not done; each line carries its bot and model in soft text.
// Brief: the well scene, Today, Due soonest (top 3 with days left), the Week
// Meter line and up to 5 news items with their project.

import { h, clean } from './dom.js';
import { icon } from './icons.js';
import { BOT } from '../bots.js';
import { st, daysLeft, daysText } from './store.js';
import { hooks } from './cards.js';
import { COPY } from './copy.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const txt = (v) => clean(typeof v === 'string' ? v : v && v.text);

function by(item) {
  if (!item || typeof item !== 'object') return null;
  const who = BOT[item.bot] ? BOT[item.bot].name : clean(item.bot);
  const parts = [who, clean(item.model)].filter(Boolean);
  return parts.length ? h('span', { class: 'by', text: parts.join(', ') }) : null;
}

function rsec(title, nodes, lead) {
  return h(
    'section',
    { class: 'rsec' },
    h('h3', { class: 'rsec-title', text: title }),
    lead ? h('p', { class: 'rsec-lead', text: lead }) : null,
    nodes && nodes.length ? nodes : h('p', { class: 'empty', text: COPY.empty.reportSection }),
  );
}

export function reportTitle() {
  const r = st().report || {};
  return { title: 'ICON Report', sub: r.at ? `${clean(r.at)}, written by ICON` : 'Written by ICON' };
}

export function reportView(act) {
  const r = st().report;
  if (!r || typeof r !== 'object' || (!arr(r.done).length && !arr(r.needsMe).length && !arr(r.nextPaths).length && !arr(r.notChecked).length)) {
    return [h('p', { class: 'empty', text: COPY.empty.report })];
  }
  const done = arr(r.done).filter((d) => txt(d)).map((d) => h('li', { class: 'rline' }, h('span', { class: 'rtext', text: txt(d) }), by(d)));
  const needs = arr(r.needsMe).filter((d) => txt(d)).slice(0, 3).map((d) =>
    h(
      'li',
      { class: 'rline' },
      h('button', { class: 'rneed', type: 'button', onclick: () => act.need(d) }, h('span', { class: 'rneed-mark', 'aria-hidden': 'true', html: icon('marker_question', { size: 14 }) }), h('span', { class: 'rtext', text: txt(d) }), h('span', { class: 'rgo', 'aria-hidden': 'true', html: icon('back', { size: 14 }) })),
      by(d),
    ),
  );
  const paths = arr(r.nextPaths).filter((d) => txt(d)).slice(0, 3).map((d, i) =>
    h(
      'li',
      { class: 'rline rpath' },
      h('span', { class: 'rpath-n', 'aria-hidden': 'true', text: String.fromCharCode(65 + i) }),
      h('div', { class: 'rpath-main' }, h('span', { class: 'rtext', text: txt(d) }), by(d)),
      h('button', { class: 'btn btn-small', type: 'button', onclick: (e) => act.path(txt(d), e.currentTarget) }, 'Take this path'),
    ),
  );
  const notc = arr(r.notChecked).filter((d) => txt(d)).map((d) => h('li', { class: 'rline' }, h('span', { class: 'rtext', text: txt(d) }), by(d)));
  return [
    rsec('Done', done.length ? [h('ul', { class: 'rlist' }, done)] : null),
    rsec('Needs me', needs.length ? [h('ul', { class: 'rlist' }, needs)] : null, needs.length ? 'Decisions only you can make.' : null),
    rsec('Next paths', paths.length ? [h('ol', { class: 'rlist' }, paths)] : null),
    rsec('Not checked or not done', notc.length ? [h('ul', { class: 'rlist rlist-soft' }, notc)] : null),
    h('p', { class: 'signoff', text: 'Your answer becomes the next loop’s orders.' }),
  ];
}

/* ------------------------------------------------------------ the brief */

function wellScene() {
  let herald = '';
  try {
    if (hooks.sprite) herald = hooks.sprite('herald', { state: 'working', size: 84, marker: false, shadow: true });
  } catch (e) {
    herald = '';
  }
  // a small painted vignette: dawn wash, far hills, the stone well, Herald on its rim
  const sky = `<svg class="well-art" viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="wb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FB7D6"/><stop offset=".55" stop-color="#E9C9B8"/><stop offset="1" stop-color="#F3DCC0"/></linearGradient>
      <linearGradient id="wb-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A7B4C9"/><stop offset="1" stop-color="#C9C3CC"/></linearGradient>
      <linearGradient id="wb-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9B486"/><stop offset="1" stop-color="#7E8A66"/></linearGradient>
      <radialGradient id="wb-sun" cx=".7" cy=".55" r=".4"><stop offset="0" stop-color="#FFF1D6" stop-opacity=".95"/><stop offset="1" stop-color="#FFF1D6" stop-opacity="0"/></radialGradient>
      <filter id="wb-soft"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"/></filter>
    </defs>
    <rect width="600" height="180" fill="url(#wb-sky)"/>
    <rect width="600" height="180" fill="url(#wb-sun)"/>
    <path d="M0 112C80 92 150 98 220 90s170 4 240-6 110 8 140 10V180H0z" fill="url(#wb-hill)" opacity=".8"/>
    <path d="M0 132c90-14 200-10 300-8s210-6 300 4V180H0z" fill="url(#wb-ground)" filter="url(#wb-soft)"/>
    <g filter="url(#wb-soft)">
      <ellipse cx="300" cy="170" rx="70" ry="7" fill="#4B5A63" opacity=".35"/>
      <path d="M244 122h112v40c0 6-25 10-56 10s-56-4-56-10z" fill="#D8CDB8"/>
      <path d="M244 140h112M252 154h96" stroke="#A89C88" stroke-width="2" fill="none"/>
      <path d="M262 122v-6M286 122v-6M314 122v-6M338 122v-6" stroke="#A89C88" stroke-width="2"/>
      <ellipse cx="300" cy="122" rx="58" ry="8" fill="#EDE4D2"/>
      <ellipse cx="300" cy="122" rx="46" ry="5" fill="#3D5560"/>
      <path d="M252 122V70M348 122V70" stroke="#8A5A3B" stroke-width="5" stroke-linecap="round"/>
      <path d="M240 72l60-22 60 22z" fill="#C2744B"/><path d="M240 72l60-22 60 22" stroke="#9C5A3C" stroke-width="2" fill="none"/>
      <path d="M300 80v26" stroke="#6E5A4A" stroke-width="1.5"/><rect x="292" y="104" width="16" height="12" rx="2" fill="#8A5A3B"/>
    </g>
    <g opacity=".55" fill="#F6E6CF"><circle cx="90" cy="40" r="1.4"/><circle cx="140" cy="28" r="1"/><circle cx="520" cy="34" r="1.2"/></g>
  </svg>`;
  return h('div', { class: 'well', 'aria-hidden': 'true' }, h('div', { html: sky }), herald ? h('div', { class: 'well-herald', html: herald }) : null);
}

export function briefTitle() {
  const b = st().brief || {};
  return { title: 'The morning brief', sub: b.date ? `${clean(b.date)}, read at the well by Herald` : 'Read at the well by Herald' };
}

export function briefView(act, { now } = {}) {
  const b = st().brief;
  const out = [wellScene()];
  if (!b || typeof b !== 'object') {
    out.push(h('p', { class: 'empty', text: COPY.empty.brief }));
    return out;
  }
  const today = arr(b.today).map(txt).filter(Boolean);
  out.push(rsec('Today', today.length ? [h('ul', { class: 'rlist' }, today.map((t) => h('li', { class: 'rline' }, h('span', { class: 'rtext', text: t }))))] : [h('p', { class: 'empty', text: COPY.empty.today })]));

  const due = arr(b.due)
    .filter((d) => d && d.item)
    .map((d) => ({ ...d, left: daysLeft(d, now) }))
    .sort((a, c) => (a.left ?? 999) - (c.left ?? 999))
    .slice(0, 3);
  out.push(
    rsec(
      'Due soonest',
      due.length
        ? [
            h(
              'ul',
              { class: 'rlist due' },
              due.map((d) => h('li', { class: `rline due-line${d.left != null && d.left <= 3 ? ' is-near' : ''}` }, h('span', { class: 'due-days', text: d.left == null ? '' : String(Math.max(0, d.left)) , 'aria-hidden': 'true' }), h('span', { class: 'rtext' }, clean(d.item), h('span', { class: 'by', text: [clean(d.date), daysText(d.left)].filter(Boolean).join(', ') })))),
            ),
          ]
        : [h('p', { class: 'empty', text: COPY.empty.due })],
    ),
  );

  const wm = st().weekMeter || {};
  const pct = wm.percent != null && Number.isFinite(Number(wm.percent)) && !arr(wm.missing).length ? `${Math.round(wm.percent)}%` : '???%';
  const fills = arr(wm.fills).map(clean).filter(Boolean);
  out.push(h('p', { class: 'brief-meter' }, h('span', { class: 'brief-meter-k', text: 'Week Meter' }), h('span', { class: 'brief-meter-v', text: pct }), fills.length ? h('span', { class: 'by', text: fills.join(', ') }) : null));

  const news = arr(b.news).filter((n) => txt(n)).slice(0, 5);
  out.push(
    rsec(
      'News from your fields',
      news.length ? [h('ul', { class: 'rlist' }, news.map((n) => h('li', { class: 'rline' }, h('span', { class: 'rtext', text: txt(n) }), n.project ? h('span', { class: 'proj', text: clean(n.project) }) : null)))] : [h('p', { class: 'empty', text: COPY.empty.news })],
    ),
  );
  out.push(h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => act.close(), text: 'Start the day' })));
  return out;
}
