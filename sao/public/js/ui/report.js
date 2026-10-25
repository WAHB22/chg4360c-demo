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
import * as clock from '../clock.js';

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
  const needs = arr(r.needsMe).filter((d) => txt(d)).slice(0, 3).map((d, i) =>
    h(
      'li',
      { class: `rneed-row${i === 0 ? ' is-first' : ''}` },
      h('span', { class: 'rneed-n', 'aria-hidden': 'true', text: String(i + 1) }),
      h(
        'button',
        { class: 'rneed', type: 'button', onclick: () => act.need(d), 'aria-label': `Decide: ${txt(d)}` },
        h('span', { class: 'rtext', text: txt(d) }),
        h('span', { class: 'rneed-mark', 'aria-hidden': 'true', html: icon('marker_question', { size: 15 }) }),
      ),
      by(d),
    ),
  );
  const pathList = arr(r.nextPaths).filter((d) => txt(d)).slice(0, 3);
  const paths = pathList.map((d, i) =>
    i === 0
      ? h(
          'li',
          { class: 'rpath is-first' },
          h('p', { class: 'rpath-main' }, h('span', { class: 'rtext', text: txt(d) }), by(d)),
          h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: (e) => act.path(txt(d), e.currentTarget) }, 'Take this path'),
        )
      : h(
          'li',
          { class: 'rpath is-alt' },
          h('button', { class: 'linkish', type: 'button', onclick: (e) => act.path(txt(d), e.currentTarget) }, h('span', { class: 'linkish-or', text: 'or ' }), h('span', { class: 'rtext', text: txt(d) })),
          by(d),
        ),
  );
  const notc = arr(r.notChecked).filter((d) => txt(d)).map((d) => h('li', { class: 'rline' }, h('span', { class: 'rtext', text: txt(d) }), by(d)));
  return [
    rsec('Done', done.length ? [h('ul', { class: 'rlist' }, done)] : null),
    rsec('Needs me', needs.length ? [h('ol', { class: 'rneeds' }, needs)] : null, needs.length ? 'Decisions only you can make.' : null),
    rsec('Next paths', paths.length ? [h('ol', { class: 'rpaths' }, paths)] : null),
    rsec('Not checked or not done', notc.length ? [h('ul', { class: 'rlist rlist-soft' }, notc)] : null),
    h('p', { class: 'signoff', text: 'Your answer becomes the next loop’s orders.' }),
  ];
}

/* ------------------------------------------------------------ the brief */

// The banner is a crop of the real painted town at morning, around the well,
// rendered once per season and weather into an image and kept as a blob URL.
const WELL_VIEW = '640 400 620 172';
const wellCache = new Map();

async function wellImage() {
  let season = 'autumn';
  try { season = clock.season(clock.now()); } catch (e) { /* keep autumn */ }
  const key = season;
  if (wellCache.has(key)) return wellCache.get(key);
  const job = import('../scene.js').then((m) => {
    let svg = m.paintPlace('town', { time: 'morning', season, weather: 'clear', width: 1600, height: 900 });
    if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('no painting');
    svg = svg.replace(/<svg\b([^>]*)>/, (all, attrs) => {
      let a = attrs.replace(/\sviewBox="[^"]*"/, '').replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, '');
      if (!/xmlns=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
      return `<svg${a} viewBox="${WELL_VIEW}" width="1240" height="344" preserveAspectRatio="xMidYMid slice">`;
    });
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  });
  wellCache.set(key, job);
  job.catch(() => wellCache.delete(key));
  return job;
}

// warm the banner while the world is idle, so the brief opens painted
export function prewarmBrief() {
  wellImage().catch(() => {});
}

function wellScene() {
  let herald = '';
  try {
    if (hooks.sprite) herald = hooks.sprite('herald', { state: 'working', size: 56, marker: false, shadow: true });
  } catch (e) {
    herald = '';
  }
  const img = h('img', { class: 'well-art', alt: '', decoding: 'async' });
  const box = h('div', { class: 'well is-waiting', 'aria-hidden': 'true' }, img, h('i', { class: 'well-veil' }), herald ? h('div', { class: 'well-herald', html: herald }) : null);
  wellImage()
    .then((url) => {
      img.addEventListener('load', () => box.classList.remove('is-waiting'), { once: true });
      img.src = url;
    })
    .catch(() => box.classList.add('is-bare'));
  return box;
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
