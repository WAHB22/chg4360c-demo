// The Rules view (the charter stone by the well) and Settings.

import { h, clean } from './dom.js';
import { icon } from './icons.js';
import { S, st, setPref } from './store.js';
import { COPY } from './copy.js';

export function rulesView() {
  const rules = (Array.isArray(st().rules) ? st().rules : []).map(clean).filter(Boolean);
  const stone = h(
    'div',
    { class: 'stone' },
    h('div', { class: 'stone-face' }, h('p', { class: 'stone-head', text: 'The charter' }), rules.length ? h('ol', { class: 'stone-rules' }, rules.map((r) => h('li', { text: r }))) : h('p', { class: 'stone-empty', text: COPY.empty.rules })),
  );
  return [
    h('p', { class: 'soft lead', text: 'Carved by the well in town. Every bot reads it before it starts work.' }),
    stone,
    h('p', { class: 'soft', text: 'Only you change these. Ask ICON in an order and it proposes the new line for your yes.' }),
  ];
}

function toggle(id, label, desc, on, onChange) {
  const btn = h('button', { class: 'switch', type: 'button', role: 'switch', id, 'aria-checked': String(!!on) }, h('span', { class: 'switch-knob', 'aria-hidden': 'true' }));
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('label', { class: 'setting-name', for: id, text: label }), desc ? h('p', { class: 'setting-desc', text: desc }) : null), btn);
}

function quietLine() {
  const q = st().quiet || {};
  const start = q.nightStart || '22:00';
  const end = q.nightEnd || '07:00';
  const shifts = (Array.isArray(q.shifts) ? q.shifts : []).filter((s) => s && s.day && s.start && s.end);
  const sh = shifts.length ? `, and during shifts: ${shifts.map((s) => `${clean(s.day)} ${clean(s.start)} to ${clean(s.end)}`).join('; ')}` : '';
  return `${start} to ${end}${sh}`;
}

export function settingsView(act) {
  const soundOpts = [
    { v: 'off', label: 'Off' },
    { v: 'ambient', label: 'Ambient' },
    { v: 'cues', label: 'Ambient plus cues' },
  ];
  const radios = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'set-sound' },
    soundOpts.map((o) => {
      const b = h('button', { class: 'seg', type: 'button', role: 'radio', 'aria-checked': String(S.prefs.sound === o.v), text: o.label });
      b.addEventListener('click', () => {
        radios.querySelectorAll('.seg').forEach((x) => x.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        setPref('sound', o.v);
        act.sound(o.v);
      });
      return b;
    }),
  );
  return [
    toggle('set-intro', 'Skip the opening', 'The 2 second fade in on the first open of the day.', S.prefs.skipIntro, (v) => setPref('skipIntro', v)),
    h(
      'div',
      { class: 'setting setting-col' },
      h('div', { class: 'setting-text' }, h('p', { class: 'setting-name', id: 'set-sound', text: 'Sound' }), h('p', { class: 'setting-desc', text: 'Off until you choose. Wind and water for ambient; soft bells for new questions and reports with cues. Silent in quiet hours.' })),
      radios,
    ),
    toggle('set-motion', 'Reduce motion', 'Every movement becomes a short fade or a still picture.', S.prefs.reduceMotion, (v) => {
      setPref('reduceMotion', v);
      act.motion(v);
    }),
    h(
      'div',
      { class: 'setting setting-col' },
      h('div', { class: 'setting-text' }, h('p', { class: 'setting-name' }, h('span', { class: 'inline-ic', html: icon('moon', { size: 15 }) }), 'Quiet hours'), h('p', { class: 'setting-desc', text: quietLine() }), h('p', { class: 'setting-desc', text: 'No questions, no messages and no sound. Bots slow down and nap. Set by ICON from your rules, shown here to read.' })),
    ),
  ];
}
