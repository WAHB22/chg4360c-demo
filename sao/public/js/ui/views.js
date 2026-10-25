// Panel contents: a place, the bots, the drafts, one draft, the questions.
// Each function returns a list of nodes for the sheet body. Actions go back to
// main.js through the `act` object so the views stay free of data calls.

import { h, clean } from './dom.js';
import { icon } from './icons.js';
import { PLACE, SUBS } from '../places.js';
import { MAX_ACTIVE } from '../bots.js';
import { S, st, bots, botsAt, questions, questionsAt, draftsAt, allDrafts, placeInfo, placeName } from './store.js';
import { section, empty, botChip, botCard, questionCard, draftRow, orderBox } from './cards.js';
import { COPY } from './copy.js';

const MAX_Q = 3;

function loadingBlock() {
  return h('p', { class: 'empty is-loading' }, h('span', { class: 'loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: COPY.loading.panel }));
}

export function questionList(list, act) {
  const shown = list.slice(0, MAX_Q);
  const nodes = shown.map((q) => questionCard(q, { onAnswer: act.answer }));
  if (list.length > MAX_Q) {
    const more = list.length - MAX_Q;
    nodes.push(h('p', { class: 'more-note', text: more === 1 ? '1 more question waits until one of these is answered.' : `${more} more questions wait until these are answered.` }));
  }
  return h('div', { class: 'qlist' }, nodes);
}

/* ------------------------------------------------------------- place panel */

export function placeView(id, act) {
  const p = PLACE[id];
  if (!p) return [empty(COPY.empty.progress)];
  if (S.loading) return [loadingBlock()];
  const info = placeInfo(id);
  const here = botsAt(id);
  const qs = questionsAt(id);
  const drafts = draftsAt(id);
  const out = [];
  if (info.note) out.push(h('p', { class: 'place-note', text: clean(info.note) }));

  // In town the crowd seats every bot that is not out working on the bench;
  // the panel names them from the same list so words and picture agree.
  const resting = id === 'town' ? bots().filter((b) => b.state === 'sleeping' || b.state === 'done').slice(0, 4) : [];
  const restLine = resting.length
    ? h(
        'p',
        { class: 'resting' },
        h('span', { class: 'resting-lead', text: 'Resting here: ' }),
        resting.map((b, i) => {
          // the crowd naps a done bot only in quiet hours; the words follow it
          const where = b.place && b.place !== 'town' ? ` at ${/^(The |[A-Z]+'s )/.test(placeName(b.place)) ? placeName(b.place).replace(/^The /, 'the ') : `the ${placeName(b.place)}`}` : '';
          const why = b.state === 'sleeping' || S.quiet ? 'asleep' : b.rest ? clean(b.rest) : `done${where}`;
          return h('span', { text: `${clean(b.name) || b.core} (${why})${i < resting.length - 1 ? ', ' : ''}` });
        }),
      )
    : null;
  const nowHere = here.filter((b) => !resting.includes(b));
  out.push(
    section(
      'Now',
      nowHere.length
        ? h('div', { class: 'chips' }, nowHere.map((b) => botChip(b, { onTap: () => act.openBot(b.id) })))
        : restLine ? null : empty(COPY.empty.botsHere),
      restLine,
    ),
  );
  out.push(section('Waiting on you', qs.length ? questionList(qs, act) : empty(COPY.empty.waiting)));
  out.push(
    section(
      'Drafts',
      drafts.length
        ? h('ul', { class: 'drafts' }, drafts.map((d) => draftRow({ ...d, place: id }, { onOpen: (x) => act.openDraft(x, id), onCopy: act.copyDraft })))
        : empty(COPY.empty.drafts),
    ),
  );
  out.push(section(progressTitle(id), progressBlock(id, info, act)));
  if (id === 'town') out.push(section('Around the plaza', plazaLinks(act)));
  out.push(section('Give an order', orderBox(id, { onSend: act.order })));
  return out;
}

function progressTitle(id) {
  return {
    campus: 'Progress in the course halls',
    gym: 'Shields this week',
    kitchen: 'The meal slate',
    home: 'Sprouts on the windowsill',
    bobino: 'The trailer wagon',
    town: 'Progress',
  }[id] || 'Progress';
}

function genericProgress(info) {
  const list = (Array.isArray(info.progress) ? info.progress : []).filter((r) => r && (r.label || r.value));
  if (!list.length) return null;
  return h('dl', { class: 'progress' }, list.map((r) => [h('dt', { text: clean(r.label) }), h('dd', { text: clean(r.value) })]));
}

function count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function progressBlock(id, info, act) {
  const g = st().growth || {};
  const nodes = [];
  if (id === 'gym') {
    const done = count(g.gym && g.gym.done);
    const target = count(g.gym && g.gym.target) || 3;
    if (done == null) nodes.push(empty(COPY.empty.progress));
    else {
      nodes.push(
        h(
          'div',
          { class: 'shields', role: 'img', 'aria-label': `${Math.min(done, target)} of ${target} gym sessions this week` },
          Array.from({ length: target }, (_, i) => h('span', { class: `shield${i < done ? ' is-won' : ''}`, html: shieldSVG(i < done) })),
        ),
        h('p', { class: 'soft', text: `${Math.min(done, target)} of ${target} sessions this week. A shield goes up on the gate for each one.` }),
      );
    }
  } else if (id === 'kitchen') {
    const done = count(g.meals && g.meals.done);
    const target = count(g.meals && g.meals.target);
    if (done == null) nodes.push(empty(COPY.empty.progress));
    else nodes.push(slate(done, target));
  } else if (id === 'home') {
    const n = count(g.sprouts);
    if (n == null) nodes.push(empty(COPY.empty.progress));
    else {
      nodes.push(
        h('div', { class: 'sprouts', role: 'img', 'aria-label': n === 1 ? '1 sprout' : `${n} sprouts` }, Array.from({ length: Math.max(1, Math.min(n, 8)) }, (_, i) => h('span', { class: `sprout${i < n ? '' : ' is-empty'}`, html: sproutSVG(i) }))),
        h('p', { class: 'soft', text: n === 1 ? '1 idea has its first small step.' : `${n} ideas have their first small step.` }),
      );
    }
  } else if (id === 'campus') {
    const halls = PLACE.campus.halls || [];
    const prog = Array.isArray(info.progress) ? info.progress : [];
    const byLabel = Object.fromEntries(prog.filter((r) => r && r.label).map((r) => [String(r.label).trim(), clean(r.value)]));
    nodes.push(
      h(
        'ul',
        { class: 'halls' },
        halls.map((c) =>
          h('li', { class: `hall${byLabel[c] ? ' has-note' : ''}` }, h('span', { class: 'hall-seal', 'aria-hidden': 'true', html: icon('book', { size: 16 }) }), h('span', { class: 'hall-code', text: c }), h('span', { class: 'hall-note', text: byLabel[c] || 'No news' })),
        ),
      ),
    );
    const done = count(g.classes && g.classes.done);
    const target = count(g.classes && g.classes.target);
    if (done != null && target) nodes.push(h('p', { class: 'soft', text: `${done} of ${target} classes this week.` }));
    const rest = prog.filter((r) => r && r.label && !halls.includes(String(r.label).trim()));
    const extra = genericProgress({ progress: rest });
    if (extra) nodes.push(extra);
    return nodes;
  } else if (id === 'bobino') {
    const t = st().trailer || {};
    if (t.stage) {
      const stages = ['idea', 'pitch', 'deal', 'build', 'launch'];
      const at = stages.indexOf(String(t.stage).toLowerCase());
      nodes.push(
        h(
          'ol',
          { class: 'stages', 'aria-label': `Trailer stage: ${clean(t.stage)}` },
          stages.map((s, i) => h('li', { class: i < at ? 'is-past' : i === at ? 'is-now' : '', 'aria-current': i === at ? 'step' : null, text: s[0].toUpperCase() + s.slice(1) })),
        ),
        h('p', { class: 'soft', text: `The wagon is parked at ${placeName(t.at) || 'an unknown spot'}.` }),
      );
      if (at < 0) nodes.push(h('p', { class: 'soft', text: `Stage: ${clean(t.stage)}` }));
    }
  } else if (id === 'town') {
    nodes.push(
      h('button', { class: 'btn', type: 'button', onclick: () => act.open('floors') }, h('span', { html: icon('crest', { size: 16 }) }), h('span', { text: 'Climb the tower of floors' })),
    );
  }
  const gen = genericProgress(info);
  if (gen) nodes.push(gen);
  if (!nodes.length) nodes.push(empty(COPY.empty.progress));
  return nodes;
}

function plazaLinks(act) {
  const links = [
    ['well', 'brief', 'compass'],
    ['board', 'report', 'report'],
    ['charter', 'rules', 'rules'],
    ['floors', 'floors', 'crest'],
  ];
  return h(
    'ul',
    { class: 'plaza' },
    links.map(([sub, view, ic]) =>
      h(
        'li',
        null,
        h('button', { class: 'plaza-link', type: 'button', onclick: () => act.open(view) }, h('span', { class: 'plaza-ic', html: icon(ic, { size: 18 }) }), h('span', { class: 'plaza-name', text: SUBS[sub].name }), h('span', { class: 'plaza-shows', text: SUBS[sub].shows })),
      ),
    ),
  );
}

function shieldSVG(won) {
  return `<svg viewBox="0 0 40 46" width="40" height="46" aria-hidden="true"><path d="M20 3c5 3 10 4.4 15 4.6-.2 14-5.6 24-15 30.4C10.6 31.6 5.2 21.6 5 7.6 10 7.4 15 6 20 3z" fill="${won ? '#E8C88E' : 'none'}" stroke="${won ? '#F3EFE6' : 'rgba(232,200,142,.6)'}" stroke-width="1.6" stroke-linejoin="round"/>${won ? '<path d="M20 9v24M11 15h18" stroke="#8A6A34" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>' : '<path d="M20 10v22" stroke="rgba(232,200,142,.35)" stroke-width="1.2" stroke-dasharray="2 3"/>'}</svg>`;
}

function sproutSVG(i) {
  const lean = [-6, 4, -2, 7, -4, 2, -7, 5][i % 8];
  return `<svg viewBox="0 0 30 40" width="26" height="34" aria-hidden="true"><path d="M15 38c0-8 ${lean * 0.3} -14 ${lean * 0.4} -20" stroke="#9CC47E" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M${15 + lean * 0.4} 18c-6-1-9-5-9-9 5 0 8 3 9 9z" fill="#9CC47E"/><path d="M${15 + lean * 0.4} 20c5-1 8-5 8-9-5 0-7 4-8 9z" fill="#B5D69A"/><path d="M6 38h18" stroke="#B9786A" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function slate(done, target) {
  const t = target || Math.max(done, 1);
  const marks = Array.from({ length: t }, (_, i) => h('span', { class: `chalk${i < done ? ' is-done' : ''}`, 'aria-hidden': 'true' }));
  return h(
    'div',
    { class: 'slate', role: 'img', 'aria-label': target ? `${done} of ${target} meals cooked` : `${done} meals cooked` },
    h('p', { class: 'slate-title', text: 'Cooked this week' }),
    h('div', { class: 'slate-marks' }, marks),
    h('p', { class: 'slate-count', text: target ? `${done} of ${target}` : String(done) }),
  );
}

/* ----------------------------------------------------------- bots, drafts */

export function botsView(act, { focus } = {}) {
  if (S.loading) return [loadingBlock()];
  const list = bots();
  if (!list.length) return [empty(COPY.empty.bots)];
  const order = { waiting: 0, working: 1, traveling: 2, done: 3, sleeping: 4 };
  const sorted = [...list].sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5));
  const active = sorted.filter((b) => ['working', 'traveling', 'waiting'].includes(b.state));
  const out = [
    h('p', { class: 'soft lead', text: `${active.length} of ${MAX_ACTIVE} bots at work. The rest nap on the bench in town until ICON wakes them.` }),
    h('div', { class: 'botcards' }, sorted.map((b) => botCard(b, { onOpenDrafts: () => act.open('drafts', { place: b.place }), onStop: act.stop, highlight: focus && String(focus) === String(b.id) }))),
  ];
  return out;
}

export function draftsView(act, { place } = {}) {
  if (S.loading) return [loadingBlock()];
  const list = place ? draftsAt(place).map((d) => ({ ...d, place })) : allDrafts();
  const out = [];
  if (place) {
    out.push(h('p', { class: 'soft lead' }, `Drafts at ${placeName(place)}. `, h('button', { class: 'link', type: 'button', onclick: () => act.open('drafts'), text: 'Show all drafts' })));
  } else {
    out.push(h('p', { class: 'soft lead', text: 'Every draft stays inside SAO until you say yes. Nothing here has been sent.' }));
  }
  out.push(list.length ? h('ul', { class: 'drafts' }, list.map((d) => draftRow(d, { onOpen: (x) => act.openDraft(x, null), onCopy: act.copyDraft }))) : empty(place ? COPY.empty.drafts : COPY.empty.allDrafts));
  return out;
}

export function draftView(d, act) {
  const text = clean(d.text || d.body || '');
  const meta = [clean(d.time), clean(d.kind), placeName(d.place)].filter(Boolean).join(', ');
  return [
    h('p', { class: 'draft-head' }, h('span', { class: 'draft-tag', text: 'Draft' }), meta ? h('span', { class: 'soft', text: meta }) : null),
    text
      ? h('div', { class: 'draft-text' }, text.split(/\n{2,}/).map((para) => h('p', { text: para })))
      : h('p', { class: 'empty', text: 'The full text lives in the drafts folder on your machine. Open SAO there to read it.' }),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => act.approve(d, e.currentTarget) }, h('span', { html: icon('check', { size: 16 }) }), h('span', { text: 'Approve' })),
      h('button', { class: 'btn', type: 'button', onclick: (e) => act.copyDraft(d, e.currentTarget) }, h('span', { html: icon('copy', { size: 16 }) }), h('span', { text: 'Copy' })),
    ),
    h('p', { class: 'soft', text: 'Approve tells ICON this draft is right. It still never leaves SAO without you.' }),
  ];
}

export function questionsView(act) {
  if (S.loading) return [loadingBlock()];
  const list = questions();
  const out = [];
  if (S.quiet) out.push(h('p', { class: 'soft lead', text: 'Quiet hours. These can wait for the morning.' }));
  out.push(list.length ? questionList(list, act) : empty(COPY.empty.questions));
  return out;
}
