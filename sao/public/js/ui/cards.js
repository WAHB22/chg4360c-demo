// Shared pieces of the panels: section titles, bot chips, bot cards,
// question cards, draft rows and the order box.

import { h, clear, clean, play, wait } from './dom.js';
import { icon, markerIcon } from './icons.js';
import { BOT, STATES } from '../bots.js';
import { PLACE } from '../places.js';
import { botName, placeName } from './store.js';
import { COPY } from './copy.js';

// characters.js hands its sprite painter in here when it loads.
export const hooks = { sprite: null };

export function section(title, ...kids) {
  return h(
    'section',
    { class: 'psec' },
    h('h3', { class: 'psec-title' }, h('span', { text: title }), h('span', { class: 'psec-rule', 'aria-hidden': 'true' })),
    ...kids,
  );
}

export function empty(text) {
  return h('p', { class: 'empty', text });
}

function avatar(core, state, size = 40) {
  const wrap = h('span', { class: 'avatar', 'aria-hidden': 'true', style: { '--bot': (BOT[core] || {}).color || 'var(--gold)' } });
  let svg = '';
  try {
    if (hooks.sprite) svg = hooks.sprite(core, { state, size, marker: false, shadow: false, lite: true });
  } catch (e) {
    svg = '';
  }
  if (svg) wrap.innerHTML = svg;
  else wrap.classList.add('avatar-dot');
  return wrap;
}

function stateLabel(state) {
  return STATES[state] ? STATES[state].label : clean(state) || '';
}

export function botChip(b, { onTap } = {}) {
  const core = BOT[b.core] || {};
  const chip = h(
    'button',
    { class: `chip is-${b.state}`, type: 'button', style: { '--bot': core.color }, 'aria-label': `${clean(b.name) || core.name}, ${stateLabel(b.state).toLowerCase()}` },
    h('span', { class: 'chip-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'chip-name', text: clean(b.name) || core.name }),
    h('span', { class: 'chip-mark', 'aria-hidden': 'true', html: markerIcon(b.state, 11) }),
    h('span', { class: 'chip-state', text: stateLabel(b.state) }),
  );
  if (onTap) chip.addEventListener('click', () => onTap(b));
  return chip;
}

export function botCard(b, { onOpenDrafts, onStop, highlight } = {}) {
  const core = BOT[b.core] || {};
  const name = clean(b.name) || core.name;
  const card = h('article', { class: `botcard is-${b.state}${highlight ? ' is-lit' : ''}`, style: { '--bot': core.color }, 'aria-label': name, dataset: { bot: b.id } });
  const stop = h('button', { class: 'btn btn-quiet', type: 'button' }, h('span', { html: icon('stop', { size: 16 }) }), h('span', { class: 'btn-text', text: 'Stop' }));
  let armed = false;
  let armTimer = null;
  stop.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      stop.classList.add('is-armed');
      stop.querySelector('.btn-text').textContent = 'Tap again to stop';
      armTimer = setTimeout(() => {
        armed = false;
        stop.classList.remove('is-armed');
        stop.querySelector('.btn-text').textContent = 'Stop';
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
    stop.disabled = true;
    stop.querySelector('.btn-text').textContent = 'Stopping';
    if (onStop) await onStop(b);
    stop.querySelector('.btn-text').textContent = 'Stops after this step';
  });
  const canStop = b.state === 'working' || b.state === 'traveling' || b.state === 'waiting';
  const rows = [
    ['Task', clean(b.task) || 'No task'],
    ['Model', clean(b.model) || 'Not named'],
    ['Started', clean(b.startedAt) || 'Not started'],
    ['Last result', clean(b.lastResult) || COPY.empty.lastResult],
  ];
  card.append(
    h('span', { class: 'botcard-stripe', 'aria-hidden': 'true' }),
    h(
      'header',
      { class: 'botcard-head' },
      avatar(b.core, b.state),
      h(
        'div',
        { class: 'botcard-who' },
        h('h4', { class: 'botcard-name', text: name }),
        h(
          'p',
          { class: 'botcard-state' },
          h('span', { class: 'mark', 'aria-hidden': 'true', html: markerIcon(b.state, 11) }),
          `${stateLabel(b.state)}${PLACE[b.place] ? ` at ${placeName(b.place)}` : ''}`,
        ),
      ),
    ),
    h('dl', { class: 'botcard-facts' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => onOpenDrafts && onOpenDrafts(b) }, h('span', { html: icon('drafts', { size: 16 }) }), h('span', { text: 'Open drafts' })),
      canStop ? stop : null,
    ),
  );
  return card;
}

export function questionCard(q, { onAnswer } = {}) {
  const from = BOT[q.from] || null;
  const opts = (Array.isArray(q.options) ? q.options : []).map(clean).filter(Boolean).slice(0, 2);
  const gi = Number.isInteger(q.guess) && opts[q.guess] != null ? q.guess : 0;
  const ordered = opts.length ? [opts[gi], ...opts.filter((_, i) => i !== gi)] : [];
  const guess = ordered[0] || '';
  const card = h('article', { class: 'qcard', style: { '--bot': from ? from.color : 'var(--gold)' }, dataset: { q: q.id } });
  const body = h('div', { class: 'qcard-body' });
  const meta = [from ? from.name : botName(q.from) || 'ICON', PLACE[q.place] ? `at ${placeName(q.place)}` : '', q.askedAt ? clean(q.askedAt) : ''].filter(Boolean).join(' ');
  const input = h('input', { class: 'field', type: 'text', placeholder: 'Or write your own', 'aria-label': 'Write your own answer', maxlength: '400' });
  const send = h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Send your answer', html: icon('send', { size: 18 }) });

  let done = false;
  const answer = async (text) => {
    const t = clean(text);
    if (!t || done) return;
    done = true;
    card.querySelectorAll('button,input').forEach((n) => { n.disabled = true; });
    const ok = onAnswer ? await onAnswer(q, t) : true;
    if (ok === false) {
      done = false;
      card.querySelectorAll('button,input').forEach((n) => { n.disabled = false; });
      return;
    }
    await fold(card, t);
  };
  send.addEventListener('click', () => answer(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      answer(input.value);
    }
  });

  body.append(
    h('p', { class: 'qcard-from' }, h('span', { class: 'chip-dot', 'aria-hidden': 'true' }), h('span', { text: meta })),
    h('p', { class: 'qcard-text', text: clean(q.text) }),
    ordered.length
      ? h(
          'div',
          { class: 'qcard-opts', role: 'group', 'aria-label': 'Suggested answers' },
          ordered.map((o, i) =>
            h(
              'button',
              { class: `opt${i === 0 ? ' is-guess' : ''}`, type: 'button', onclick: () => answer(o), 'aria-label': i === 0 ? `${o}, my guess` : o },
              h('span', { class: 'opt-text', text: o }),
              i === 0 ? h('span', { class: 'opt-guess', 'aria-hidden': 'true', text: 'my guess' }) : null,
            ),
          ),
        )
      : null,
    h('div', { class: 'qcard-free' }, input, send),
    guess ? h('p', { class: 'qcard-working', text: `Working with: ${guess}, until you answer` }) : null,
  );
  card.appendChild(body);
  return card;
}

async function fold(card, answer) {
  const hgt = card.offsetHeight;
  const done = h('div', { class: 'qcard-done' }, h('span', { class: 'qcard-check', html: icon('check', { size: 18 }) }), h('span', { text: `Answered: ${answer}` }));
  card.classList.add('is-answered');
  clear(card).appendChild(done);
  card.style.height = `${hgt}px`;
  await play(card, [{ height: `${hgt}px` }, { height: '52px' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
  card.style.height = '';
  await wait(900);
  const h2 = card.offsetHeight;
  await play(card, [{ height: `${h2}px`, opacity: 1, marginBottom: '8px' }, { height: '0px', opacity: 0, marginBottom: '0px' }], { duration: 220, easing: 'cubic-bezier(.5,0,.75,0)' });
  card.remove();
}

export function draftRow(d, { onOpen, onCopy } = {}) {
  const meta = [clean(d.time), clean(d.kind), d.place && PLACE[d.place] ? placeName(d.place) : ''].filter(Boolean).join(', ');
  return h(
    'li',
    { class: 'draft' },
    h('span', { class: 'draft-tag', text: 'DRAFT' }),
    h('div', { class: 'draft-main' }, h('p', { class: 'draft-title', text: clean(d.title) || 'Untitled draft' }), meta ? h('p', { class: 'draft-meta', text: meta }) : null),
    h(
      'div',
      { class: 'draft-actions' },
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => onOpen && onOpen(d), 'aria-label': `Open ${clean(d.title) || 'draft'}` }, h('span', { html: icon('open', { size: 15 }) }), h('span', { text: 'Open' })),
      h('button', { class: 'btn btn-small', type: 'button', onclick: (e) => onCopy && onCopy(d, e.currentTarget), 'aria-label': `Copy ${clean(d.title) || 'draft'}` }, h('span', { html: icon('copy', { size: 15 }) }), h('span', { text: 'Copy' })),
    ),
  );
}

export function orderBox(place, { onSend } = {}) {
  const id = `order-${place}`;
  const ta = h('textarea', { class: 'field field-area', id, rows: '3', maxlength: '1200', placeholder: 'Tell ICON what to do next. It waits for the next loop.' });
  const btn = h('button', { class: 'btn btn-primary', type: 'button' }, h('span', { html: icon('send', { size: 16 }) }), h('span', { text: 'Save for next loop' }));
  const note = h('p', { class: 'order-note', text: 'Orders are DRAFT work. Nothing is sent outside SAO without your yes.' });
  btn.addEventListener('click', async () => {
    const t = ta.value.trim();
    if (!t) {
      ta.focus();
      return;
    }
    btn.disabled = true;
    const ok = onSend ? await onSend(place, t) : true;
    btn.disabled = false;
    if (ok !== false) ta.value = '';
  });
  return h('div', { class: 'order' }, h('label', { class: 'sr-only', for: id, text: `Order for ${placeName(place) || 'ICON'}` }), ta, h('div', { class: 'order-row' }, note, btn));
}
