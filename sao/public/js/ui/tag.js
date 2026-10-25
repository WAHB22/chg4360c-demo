// Time and weather tag, top right: "Sat 22:40, Light rain, 6°C", or
// "Weather unknown" when the forecast cannot be reached. During quiet hours a
// small moon tag sits beside it: "Quiet hours until 7:00".

import { h } from './dom.js';
import { icon } from './icons.js';
import { COPY } from './copy.js';

let root;
let timeEl;
let wxEl;
let sepEl;
let moonEl;
let moonText;

export function mountTag(parent) {
  root = h('div', { class: 'tags' });
  const tag = h('div', { class: 'tag glass', role: 'group', 'aria-label': 'Time and weather' });
  timeEl = h('span', { class: 'tag-time' });
  wxEl = h('span', { class: 'tag-wx' });
  sepEl = h('span', { class: 'tag-sep', 'aria-hidden': 'true', text: ', ' });
  tag.append(timeEl, sepEl, wxEl);
  moonText = h('span');
  moonEl = h('div', { class: 'tag tag-moon glass', hidden: true, role: 'note' }, h('span', { class: 'tag-ic', html: icon('moon', { size: 14 }) }), moonText);
  root.append(moonEl, tag);
  parent.appendChild(root);
}

export function renderTag({ day, time, weather, quiet, until }) {
  if (!root) return;
  timeEl.textContent = `${day} ${time}`;
  // undefined: the forecast is still on its way, so show the time alone
  sepEl.hidden = wxEl.hidden = weather === undefined;
  if (weather && weather.label) {
    const t = weather.tempC != null && Number.isFinite(Number(weather.tempC)) ? `, ${Math.round(weather.tempC)}°C` : '';
    wxEl.textContent = `${weather.label}${t}`;
  } else {
    wxEl.textContent = COPY.empty.weather;
  }
  moonEl.hidden = !quiet;
  if (quiet) moonText.textContent = `Quiet hours until ${until || '7:00'}`;
}
