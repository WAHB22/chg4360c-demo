// SAO HUD: tap panel with Status / Queue / Orders / Memory tabs, index, legend
// and the usage switch that previews ICON resting.
import { entities } from './mock.js';
import { createWorld } from './world.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { icon: 'ICON', bot: 'Bot', dorm: 'Dorm', district: 'District', building: 'Building', island: 'Island' };
const STATE = { working: 'Working', blocked: 'Blocked', waiting: 'Waiting on you' };
const DAY = 86400000;

const panel = $('#panel');
const body = $('#pBody');
let current = null;
let tab = 'status';
let resting = false;

// The port sign is painted with the page fonts, so load them first.
await Promise.all([document.fonts.load('700 44px Cinzel'), document.fonts.load('500 30px Alegreya')]).catch(() => {});
const world = createWorld({
  canvas: $('#world'),
  labelLayer: $('#labels'),
  entities,
  onPick: (id) => (id ? open(id) : close()),
});

function rows(list) {
  return `<dl>${list.filter(Boolean).map(([k, v, cls = '']) => `<dt>${esc(k)}</dt><dd class="${cls}">${v}</dd>`).join('')}</dl>`;
}
function deadlineText(e) {
  const days = Math.ceil((e.deadline - Date.now()) / DAY);
  const when = new Date(e.deadline).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const left = days <= 0 ? 'due today' : days === 1 ? 'in 1 day' : `in ${days} days`;
  return `${esc(e.deadlineLabel)}, ${esc(when)}, <strong class="${days <= 3 ? 'hot' : ''}">${left}</strong>`;
}

const views = {
  status(e) {
    return rows([
      e.kind === 'bot' && ['State', `<span class="pill ${e.state}">${STATE[e.state]}</span>`],
      ['Task', esc(e.task)],
      ['Status', esc(e.status)],
      ['Last result', `<span class="draft">DRAFT</span> ${esc(e.last)}`],
      e.kind === 'bot' && ['Role', esc(e.role)],
      e.kind === 'bot' && ['Runner', esc(e.runner)],
      e.kind === 'bot' && ['Works at', esc(entities[e.home]?.name ?? e.home)],
      e.deadline && ['Next deadline', deadlineText(e)],
      e.inside && ['Inside', esc(e.inside)],
    ]);
  },
  queue(e) {
    if (!e.queue.length) return '<p class="empty">Nothing waiting here.</p>';
    return `<ul class="queue">${e.queue.map((q) => `
      <li class="${q.done ? 'done' : ''}">
        <span class="qt ${q.type}">${q.type === 'approval' ? 'Needs your OK' : 'Question for you'}</span>
        <p>${esc(q.text)}</p>
        ${q.type === 'approval' && !q.done ? `<button class="confirm" data-q="${esc(q.id)}">Confirm</button>` : ''}
        ${q.done ? '<p class="small">Confirmed. Simulated in phase 1.</p>' : ''}
        ${q.type === 'question' && !q.done ? '<p class="small">Answer in the order box below.</p>' : ''}
      </li>`).join('')}</ul>`;
  },
  orders(e) {
    if (!e.orders.length) return '<p class="empty">No orders yet. Write one below.</p>';
    return `<ul class="orders">${e.orders.map((o) => `
      <li><span class="qt ${o.mode}">${o.mode === 'order' ? (o.queued ? 'Queued' : 'Running') : 'Suggestion'}</span>
      <time>${esc(o.time)}</time><p>${esc(o.text)}</p></li>`).join('')}</ul>`;
  },
  memory(e) {
    const lines = e.memory.length ? e.memory : ['No memory lines for this place yet.'];
    return `<p class="small">Read only. Only ICON writes to memory.md.</p><ul class="mem">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  },
};

function render() {
  const e = entities[current];
  if (!e) return;
  $('#pKind').textContent = KIND[e.kind] ?? e.kind;
  $('#pKind').className = `kind ${e.kind === 'bot' ? e.state : ''}`;
  $('#pName').textContent = e.name;
  $('#pTitle').textContent = e.title;
  for (const b of panel.querySelectorAll('[role=tab]')) {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    const count = b.dataset.tab === 'queue' ? e.queue.filter((q) => !q.done).length : 0;
    b.innerHTML = `${b.dataset.tab[0].toUpperCase()}${b.dataset.tab.slice(1)}${count ? `<b>${count}</b>` : ''}`;
  }
  body.innerHTML = views[tab](e);
}

function open(id) {
  current = id;
  tab = 'status';
  panel.hidden = false;
  world.select(id);
  render();
  placeView();
}
function close() {
  current = null;
  panel.hidden = true;
  world.select(null);
  placeView();
}
function placeView() {
  if (panel.hidden) return world.setInset({});
  const wide = innerWidth > 820;
  const r = panel.getBoundingClientRect();
  world.setInset(wide ? { right: r.width + 16 } : { bottom: innerHeight - r.top });
}

panel.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[role=tab]');
  if (!b) return;
  tab = b.dataset.tab;
  render();
});
panel.querySelector('.tabs').addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
  const tabs = [...panel.querySelectorAll('[role=tab]')];
  const i = tabs.findIndex((t) => t.dataset.tab === tab);
  tab = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab;
  render();
  panel.querySelector(`[data-tab=${tab}]`).focus();
});

body.addEventListener('click', (ev) => {
  const b = ev.target.closest('.confirm');
  if (!b) return;
  const q = entities[current].queue.find((x) => x.id === b.dataset.q);
  q.done = true;
  render();
  world.refresh();
});

function submit(mode) {
  const ta = $('#orderText');
  const text = ta.value.trim();
  if (!text || !current) return;
  const e = entities[current];
  const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  e.orders.unshift({ text, time, mode, queued: mode === 'order' && resting });
  if (mode === 'order' && !resting) {
    e.status = 'Working on your order';
    if (e.kind === 'bot') e.state = 'working';
  }
  ta.value = '';
  tab = 'orders';
  render();
  world.refresh();
}
$('#orderForm').addEventListener('submit', (ev) => { ev.preventDefault(); submit('order'); });
$('#orderForm [data-mode=suggest]').addEventListener('click', () => submit('suggest'));
$('#orderText').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submit('order'); }
});
$('#pClose').addEventListener('click', close);
addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { close(); toggleIndex(false); } });
addEventListener('resize', placeView);

// Usage switch: previews ICON resting (real detection arrives in phase 4)
$('#usageBtn').addEventListener('click', () => {
  resting = !resting;
  $('#usageBtn').setAttribute('aria-checked', String(resting));
  $('#usageBtn').textContent = resting ? 'Usage: limited' : 'Usage: normal';
  $('#usageBtn').classList.toggle('on', resting);
  $('#resting').hidden = !resting;
  document.body.classList.toggle('resting', resting);
  world.setRest(resting);
});

// Index: keyboard and screen reader route to every place
const groups = [
  ['ICON', ['icon']],
  ['Bots', Object.keys(entities).filter((k) => entities[k].kind === 'bot')],
  ['Campus', ['campus', 'chg3127', 'chg3337', 'chg3735', 'chg4360', 'chm2120', 'gng4120']],
  ['Sites', ['internship', 'port', 'trailer', 'social', 'spitch']],
  ['World', ['ground']],
];
$('#index .in').innerHTML = groups.map(([g, ids]) => `<h3>${g}</h3><ul>${ids.map((id) =>
  `<li><button data-open="${id}">${esc(entities[id].name)}</button></li>`).join('')}</ul>`).join('');
function toggleIndex(force) {
  const nav = $('#index');
  const show = force ?? nav.hidden;
  nav.hidden = !show;
  $('#indexBtn').setAttribute('aria-expanded', String(show));
}
$('#indexBtn').addEventListener('click', () => toggleIndex());
$('#index').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-open]');
  if (!b) return;
  toggleIndex(false);
  open(b.dataset.open);
  $('#pClose').focus();
});

// Test hook for screenshots: ?open=<id>&tab=<tab>&rest=1
const qs = new URLSearchParams(location.search);
if (qs.get('rest') === '1') $('#usageBtn').click();
if (qs.get('open') && entities[qs.get('open')]) {
  open(qs.get('open'));
  if (views[qs.get('tab')]) { tab = qs.get('tab'); render(); }
}
