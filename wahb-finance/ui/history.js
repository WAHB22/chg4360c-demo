// History (Stage 2, docs/UI.md): a "History" button in the footer opens a sheet with the last 10 saves
// (GET /api/data?history=1). The newest is marked Current; any other can be restored
// (GET /api/data?version=<id>, then app.restore as one undoable change). Notes come from the server and can quote
// merchant names read from screenshots, so every string goes through esc() before it reaches the page.

const LIST_PATH = '/api/data?history=1';
const versionPath = id => '/api/data?version=' + encodeURIComponent(id);
// Sync bookkeeping: two docs that differ only here hold the same data.
const BOOKKEEPING = ['savedAt', 'note', 'baseSavedAt'];
const isDoc = d => d !== null && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.bills);

const TEXT = {
  intro: 'The last 10 saves are kept here. Restoring one is a change you can undo.',
  loading: 'Loading saves',
  empty: 'No saves yet. Each change you make is saved here.',
  offline: 'No connection. The history loads when you are online.',
  notSetUp: 'This device is not set up.',
  failed: 'Could not load the history. Try again.',
  gone: 'That version is no longer kept.',
  restoreOffline: 'No connection. Try again when you are online.',
  restoreFailed: 'Could not load that version. Try again.',
  restoreError: 'Could not restore that version.',
  same: 'That version matches what is here already.',
};

// A counterclockwise arrow: single ink line, 1.6 px, round caps.
const RESTORE_ICON = '<svg class="hist-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M5.5 12.5a6.5 6.5 0 1 0 1.9-4.6" vector-effect="non-scaling-stroke"/>'
  + '<path d="M7.6 4.2v3.9h3.9" vector-effect="non-scaling-stroke"/></svg>';

export function mount(app) {
  const slot = document.getElementById('history-slot');
  if (!slot || slot.querySelector('#historyBtn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'historyBtn';
  btn.className = 'btn';
  btn.textContent = 'History';
  btn.addEventListener('click', () => openHistory(app));
  slot.append(btn);
}

// "Today, 3:20 p.m.", "Yesterday, 9:05 a.m.", "Nov 14, 3:20 p.m.", "Dec 31, 2025, 11:59 p.m." in local time.
// Today is app.today(), the same day the rest of the page uses.
function whenText(app, savedAt) {
  const { isoOf, addDays, shortDate } = app.lib.core;
  const d = new Date(savedAt);
  if (savedAt == null || savedAt === '' || isNaN(d)) return 'Time not known';
  const day = isoOf(d);
  const today = app.today();
  let date;
  if (day === today) date = 'Today';
  else if (day === addDays(today, -1)) date = 'Yesterday';
  else date = shortDate(day) + (day.slice(0, 4) !== today.slice(0, 4) ? ', ' + day.slice(0, 4) : '');
  return date + ', ' + app.lib.labels.clockTime(d);
}

function openHistory(app) {
  if (!app.state) return;
  const { esc, canonical } = app.lib.core;
  const { motifs } = app;

  let closed = false;
  let busy = false;        // a restore is being fetched
  let seq = 0;             // the newest list request; older answers are dropped
  let shown = null;        // the versions on screen, in the order shown
  let off = () => {};

  const root = document.createElement('div');
  root.className = 'hist';
  root.innerHTML = `
    <p class="hist-intro">${esc(TEXT.intro)}</p>
    <p class="hist-msg" role="status" aria-live="polite" hidden></p>
    <div class="hist-view"></div>`;
  const msgEl = root.querySelector('.hist-msg');
  const view = root.querySelector('.hist-view');

  const handle = app.sheet({
    title: 'History',
    body: root,
    onClose: () => { closed = true; off(); },
  });

  function setMsg(text) {
    msgEl.textContent = text || '';
    msgEl.hidden = !text;
  }

  function showLoading() {
    view.setAttribute('aria-busy', 'true');
    view.innerHTML = `
      <div class="hist-loading">
        <p class="caps">${esc(TEXT.loading)}</p>
        <span class="hist-ghost" aria-hidden="true"><i></i><i></i></span>
        <span class="hist-ghost" aria-hidden="true"><i></i><i></i></span>
        <span class="hist-ghost" aria-hidden="true"><i></i><i></i></span>
      </div>`;
  }

  function showProblem(text, retry) {
    view.removeAttribute('aria-busy');
    view.innerHTML = `
      <div class="hist-problem" role="alert">
        <div class="empty">${motifs.arch()}<span>${esc(text)}</span></div>
        ${retry ? '<button class="btn hist-retry" type="button">Try again</button>' : ''}
      </div>`;
  }

  function showList(list) {
    // A reload keeps keyboard focus on the same version's button.
    const focused = view.contains(document.activeElement) && document.activeElement.closest('.hist-restore');
    const focusId = focused && shown ? shown[Number(focused.dataset.i)]?.id : null;
    shown = list;
    view.removeAttribute('aria-busy');
    if (!list.length) {
      view.innerHTML = `<div class="empty">${motifs.arch()}<span>${esc(TEXT.empty)}</span></div>`;
      return;
    }
    view.innerHTML = `<ol class="hist-list">${list.map((v, i) => {
      const current = i === 0;
      const note = typeof v.note === 'string' && v.note.trim() ? v.note.trim() : 'Saved';
      return `
        <li class="hist-row${current ? ' is-current' : ''}"${current ? ' aria-current="true"' : ''}>
          <div class="hist-text">
            <p class="hist-top">
              <span class="hist-when" id="hist-w${i}">${esc(whenText(app, v.savedAt))}</span>
              ${current ? `<span class="hist-current">${motifs.star({ w: 14, h: 14 })}Current</span>` : ''}
            </p>
            <p class="hist-note" id="hist-n${i}" data-user>${esc(note)}</p>
          </div>
          ${current ? '' : `<button class="hist-restore" type="button" data-i="${i}" aria-describedby="hist-w${i} hist-n${i}">${RESTORE_ICON}<span>Restore this version</span></button>`}
        </li>`;
    }).join('')}</ol>`;
    if (focusId) {
      const i = list.findIndex(v => v.id === focusId);
      const again = i > 0 && view.querySelector(`.hist-restore[data-i="${i}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  async function load({ quiet = false } = {}) {
    const my = ++seq;
    // A quiet reload (after a save lands) keeps the list on screen and only swaps it when the answer is good.
    const keep = quiet && shown;
    if (!keep) showLoading();
    let res;
    try {
      res = await app.api(LIST_PATH);
    } catch {
      if (my === seq && !closed && !keep) showProblem(TEXT.offline, true);
      return;
    }
    if (my !== seq || closed) return;
    const versions = res.ok && res.json && Array.isArray(res.json.versions)
      ? res.json.versions.filter(v => v && typeof v === 'object' && typeof v.id === 'string' && v.id)
      : null;
    if (versions) { showList(versions); return; }
    if (keep) return;
    if (res.status === 401) showProblem(TEXT.notSetUp, false);
    else showProblem(TEXT.failed, true);
  }

  function setButtonsDisabled(disabled) {
    for (const b of view.querySelectorAll('.hist-restore')) b.disabled = disabled;
  }
  function resetButton(btn) {
    btn.removeAttribute('aria-busy');
    btn.querySelector('span').textContent = 'Restore this version';
    setButtonsDisabled(false);
  }

  async function restoreAt(i, btn) {
    if (busy || !shown || !shown[i] || !app.state) return;
    const v = shown[i];
    busy = true;
    setMsg('');
    setButtonsDisabled(true);
    btn.setAttribute('aria-busy', 'true');
    btn.querySelector('span').textContent = 'Restoring…';

    let res;
    try {
      res = await app.api(versionPath(v.id));
    } catch {
      busy = false;
      if (closed) return;
      resetButton(btn);
      setMsg(TEXT.restoreOffline);
      return;
    }
    busy = false;
    if (closed) return; // closed while it loaded: he changed his mind
    if (res.status === 404) {
      resetButton(btn);
      setMsg(TEXT.gone);
      load({ quiet: true }); // the list on the server moved on: show what is kept now
      return;
    }
    if (res.status === 401) { resetButton(btn); setMsg(TEXT.notSetUp); return; }
    if (!res.ok || !isDoc(res.json)) { resetButton(btn); setMsg(TEXT.restoreFailed); return; }
    if (!app.state) return;

    const doc = res.json;
    if (canonical(app.lib.migrate.migrate(doc), BOOKKEEPING) === canonical(app.state, BOOKKEEPING)) {
      handle.close();
      app.toast(TEXT.same);
      return;
    }
    const lbl = app.lib.labels.label('restoreVersion', { savedAt: doc.savedAt || v.savedAt });
    try {
      app.restore(doc, lbl);
    } catch {
      resetButton(btn);
      setMsg(TEXT.restoreError);
      return;
    }
    handle.close();
  }

  root.addEventListener('click', e => {
    const restoreBtn = e.target.closest('.hist-restore');
    if (restoreBtn && !restoreBtn.disabled) { restoreAt(Number(restoreBtn.dataset.i), restoreBtn); return; }
    if (e.target.closest('.hist-retry')) { setMsg(''); load(); }
  });

  // A save that lands while the sheet is open (a change made just before opening it) joins the list.
  off = app.on('synced', () => { if (!closed && !busy) load({ quiet: true }); });

  load();
  return handle;
}
