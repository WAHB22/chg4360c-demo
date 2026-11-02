// Import (Stage 1, docs/SPEC.md section 6, docs/UI.md): an "Import" button left of + Expense, drag and drop
// anywhere on a laptop, and a review sheet on the scroll colour that unrolls.
//
// Reading: CSV in the browser (lib/csv.js, src 'statement'); screenshots shrunk in the browser to 2576 px on the
// long edge as JPEG 0.9 and sent to /api/read (src 'screenshot'); PDF sent as is while its base64 stays under
// 4.3 MB (src 'statement'). Files are only held in memory while they are read: nothing is stored.
// Review: rows from lib/importer.js buildReview; ticks, categories (setCategory) and the Activities to
// "Date with Kylie" switch; save is one undoable app.act with applyImport.
// Merchant names and file names come from screenshots and file systems: every one goes through esc().

const MAX_FILE = 10 * 1024 * 1024;   // the API refuses decoded files over 10 MB
const MAX_B64 = 4300000;             // Vercel refuses request bodies over 4.5 MB before our code runs
const LONG_EDGE = 2576;
// [scale of the 2576 px size, JPEG quality]: the first that fits under MAX_B64 is sent.
const JPEG_TRIES = [[1, 0.9], [1, 0.8], [1, 0.7], [0.75, 0.8], [0.5, 0.8]];
const ACCEPT = 'image/*,application/pdf,.pdf,.csv,text/csv';
const CATEGORY_KINDS = new Set(['expense', 'refund']);
const ACCOUNT = { visa: 'Visa', chequing: 'Chequing' };

const TEXT = {
  button: 'Import',
  drop: 'Drop screenshots, PDFs or CSV files',
  dropSub: 'Files are read, never kept',
  title: 'Import',
  hint: 'Only ticked rows are saved. The files themselves are not kept.',
  tooBig: 'That file is over 10 MB',
  unsupported: 'Only screenshots, PDFs and CSV files can be read.',
  cannotOpen: 'Could not open this file.',
  badImage: 'Could not open this image. Try a PNG or JPEG screenshot.',
  imageTooBig: 'This image is too big to send. Try a smaller screenshot.',
  pdfTooBig: 'This PDF is too big to read here. Try the CSV export instead.',
  offline: 'No connection. Screenshots and PDFs need a connection. CSV files still work.',
  tooLargeToSend: 'This file is too big to send. Try a smaller screenshot or the CSV export.',
  unavailable: 'The screenshot reader is not available right now. Try again in a few minutes. CSV files still work.',
  slow: 'Reading took too long. Try again, or use the CSV export.',
  notSetUp: 'This device is not set up.',
  failed: 'Could not read this file. Try again.',
  noneFound: 'No transactions found in this file.',
  csvNone: 'No transactions could be read from this file.',
  nothing: 'Nothing to review.',
  nothingToAdd: 'Nothing to add',
  saveFailed: 'Could not save this import. Try again.',
  notReady: 'Could not prepare this import.',
};

/* ---------- drawings (original single ink line art, 1.6 px, round caps, currentColor) ---------- */
const P = d => `<path d="${d}" vector-effect="non-scaling-stroke"/>`;
const svgOpen = (cls, box, w, h) => `<svg class="motif ${cls}" viewBox="${box}" width="${w}" height="${h}" fill="none" stroke="currentColor" `
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
// A small scroll: two rollers with the sheet between them and two written lines.
const scrollIcon = (w = 20, h = 20) => svgOpen('imp-scroll-icon', '0 0 24 24', w, h)
  + P('M5.5 3.4h13a2 2 0 0 1 0 4h-13a2 2 0 0 1 0-4z') + P('M5.5 3.4a2 2 0 0 1 2 2')
  + P('M6.8 7.4v9.2M17.2 7.4v9.2') + P('M9.6 10.6h4.8M9.6 13.2h3.2')
  + P('M5.5 16.6h13a2 2 0 0 1 0 4h-13a2 2 0 0 1 0-4z') + P('M18.5 20.6a2 2 0 0 1-2-2') + '</svg>';
// The rolled end of the scroll (a disc with the paper curling inside).
const rollEnd = cls => svgOpen('imp-roll-end ' + cls, '0 0 24 24', 24, 24)
  + '<circle cx="12" cy="12" r="10.2"/>' + P('M12 16.6a4.6 4.6 0 1 1 4.6-4.6') + P('M12 12.4a1.3 1.3 0 1 1 1.3-1.3') + '</svg>';
const roll = where => `<div class="imp-roll ${where}" aria-hidden="true">${rollEnd('l')}<span class="imp-roll-bar"></span>${rollEnd('r')}</div>`;
const CHEVRON = '<svg class="imp-chev" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" vector-effect="non-scaling-stroke"/></svg>';
const CHECK = '<svg class="imp-check" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 10.5l3.6 3.6 7.4-8.2"/></svg>';

let current = null; // the open import sheet, one at a time

export function mount(app) {
  const slot = document.getElementById('import-slot');
  if (!slot || slot.querySelector('#importFab')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'importFab';
  btn.className = 'fab secondary imp-fab';
  btn.innerHTML = `${scrollIcon(20, 20)}<span>${TEXT.button}</span>`;

  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'importInput';
  input.multiple = true;
  input.accept = ACCEPT;
  input.hidden = true;
  input.tabIndex = -1;

  btn.addEventListener('click', () => { if (app.state && !current) input.click(); });
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = ''; // the same file can be picked again, and the page keeps no hold on it
    if (files.length) openImport(app, files);
  });
  slot.append(btn, input);
  setupDrop(app);
}

/* ---------- drag and drop (laptop) ---------- */
function setupDrop(app) {
  const ov = document.createElement('div');
  ov.className = 'imp-drop';
  ov.hidden = true;
  ov.innerHTML = `<div class="imp-drop-in">${scrollIcon(64, 64)}<p class="imp-drop-text">${TEXT.drop}</p><p class="caps">${TEXT.dropSub}</p></div>`;
  document.body.append(ov);

  let watchdog = null;
  const hasFiles = e => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  const canDrop = () => !!app.state && !current && !document.getElementById('main')?.hidden && !document.querySelector('dialog[open]');
  const hide = () => {
    clearTimeout(watchdog);
    watchdog = null;
    ov.classList.remove('is-on');
    ov.hidden = true;
  };
  const show = () => {
    if (ov.hidden) {
      ov.hidden = false;
      void ov.offsetHeight; // commit the start so the fade runs
      ov.classList.add('is-on');
    }
    // dragover keeps coming while files are held over the page; if it stops, the drag ended somewhere else.
    clearTimeout(watchdog);
    watchdog = setTimeout(hide, 1500);
  };

  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (canDrop()) show();
  });
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // a file dropped anywhere must never open in place of the page
    const ok = canDrop();
    e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
    if (ok) show();
  });
  // The overlay covers the page and its children ignore the pointer, so leaving it means leaving the window.
  ov.addEventListener('dragleave', e => { if (e.target === ov) hide(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const ok = canDrop();
    hide();
    const files = Array.from(e.dataTransfer.files || []);
    if (ok && files.length) openImport(app, files);
  });
  window.addEventListener('dragend', hide);
  window.addEventListener('blur', hide);
}

/* ---------- reading one file ---------- */
function kindOf(file) {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  if (type === 'text/csv' || name.endsWith('.csv')) return 'csv';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/.test(name)) return 'image';
  return null;
}

function base64Of(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function blobToBase64(blob) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() };
    } catch { /* some formats only decode through an img element */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

// The screenshot as JPEG base64, at most 2576 px on the long edge. '' when no size fits under MAX_B64.
async function imageToJpeg(file) {
  const pic = await decodeImage(file);
  const canvas = document.createElement('canvas');
  try {
    if (!pic.w || !pic.h) throw new Error('empty image');
    const base = Math.min(1, LONG_EDGE / Math.max(pic.w, pic.h));
    for (const [scale, quality] of JPEG_TRIES) {
      const w = Math.max(1, Math.round(pic.w * base * scale)), h = Math.max(1, Math.round(pic.h * base * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const g = canvas.getContext('2d');
      g.fillStyle = '#FFFFFF'; // transparent pixels become white, not black
      g.fillRect(0, 0, w, h);
      g.drawImage(pic.src, 0, 0, w, h);
      const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', quality));
      const data = blob ? await blobToBase64(blob) : canvas.toDataURL('image/jpeg', quality).split(',')[1] || '';
      if (data && data.length <= MAX_B64) return data;
    }
    return '';
  } finally {
    pic.done();
    canvas.width = 0;
    canvas.height = 0;
  }
}

// A message for an answer that is not ok. JSON errors from our API are shown as given (escaped where shown).
// Vercel's own 413 and 503 have no JSON body.
function apiError(res) {
  const msg = res.json && typeof res.json.error === 'string' ? res.json.error.trim() : '';
  if (msg) return msg;
  if (res.status === 413) return TEXT.tooLargeToSend;
  if (res.status === 503) return TEXT.unavailable;
  if (res.status === 504) return TEXT.slow;
  if (res.status === 401) return TEXT.notSetUp;
  return TEXT.failed;
}

// -> {rows, src, skipped, dropped} or {error}. Throws only when aborted (the sheet was closed).
async function readFile(app, file, signal) {
  if (file.size > MAX_FILE) return { error: TEXT.tooBig };
  const kind = kindOf(file);
  if (!kind) return { error: TEXT.unsupported };

  if (kind === 'csv') {
    let text;
    try { text = await file.text(); } catch { return { error: TEXT.cannotOpen }; }
    const { rows, skipped } = app.lib.csv.parseCSV(text);
    if (!rows.length) return { error: skipped.length ? TEXT.csvNone : TEXT.noneFound };
    return { rows, src: 'statement', skipped };
  }

  let type, data;
  if (kind === 'image') {
    try { data = await imageToJpeg(file); } catch { return { error: TEXT.badImage }; }
    if (!data) return { error: TEXT.imageTooBig };
    type = 'image/jpeg';
  } else {
    try { data = base64Of(await file.arrayBuffer()); } catch { return { error: TEXT.cannotOpen }; }
    if (data.length > MAX_B64) return { error: TEXT.pdfTooBig };
    type = 'application/pdf';
  }
  if (signal.aborted) throw new DOMException('closed', 'AbortError');

  let res;
  try {
    res = await app.api('/api/read', { method: 'POST', body: { name: file.name || '', type, data, uploadDate: app.today() }, signal });
  } catch (e) {
    if (signal.aborted || (e && e.name === 'AbortError')) throw e;
    return { error: TEXT.offline };
  } finally {
    data = null;
  }
  if (!res.ok) return { error: apiError(res) };
  const rows = res.json && Array.isArray(res.json.rows) ? res.json.rows : null;
  if (!rows) return { error: TEXT.failed };
  if (!rows.length) return { error: TEXT.noneFound };
  return { rows, src: kind === 'image' ? 'screenshot' : 'statement', dropped: Number(res.json.dropped) || 0 };
}

/* ---------- the import sheet ---------- */
function openImport(app, files) {
  if (current || !app.state || !files.length) return;
  const { esc, fmt, shortDate, isISODate, clone, joinAnd, findItem, findItemByName, monthOf } = app.lib.core;
  const { buildReview, setCategory, applyImport } = app.lib.importer;
  const { label, clockTime } = app.lib.labels;
  const { prettyMerchant } = app.lib.merchants;
  const motifs = app.motifs;

  const ctrl = new AbortController();
  let closed = false;
  let rows = null;        // review rows (lib/importer.js)
  let memory;             // remembered picks, from the last setCategory
  let results = [];       // one per file: {name, state, error, rows, src, skipped, dropped}
  let offRender = () => {};
  const opened = Date.now();

  const root = document.createElement('div');
  root.className = 'imp';
  root.innerHTML = '<p class="caps imp-count" role="status" aria-live="polite"></p><div class="imp-view"></div>';
  const countEl = root.querySelector('.imp-count');
  const view = root.querySelector('.imp-view');

  // However the sheet goes (Cancel, Escape, the backdrop, save, or the page dropping every sheet). Safe to run twice.
  const cleanup = () => {
    closed = true;
    ctrl.abort();
    offRender();
    if (current === handle) current = null;
  };
  const handle = app.sheet({
    title: TEXT.title,
    body: root,
    actions: [{ label: 'Cancel', onClick: (e, h) => h.close() }],
    onClose: cleanup,
  });
  handle.el.classList.add('imp-sheet');
  handle.el.addEventListener('close', cleanup);
  current = handle;

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const needText = n => `Pick a category for ${plural(n, 'row', 'rows')}`;
  const amountText = r => (r.direction === 'in' ? '+' : '') + fmt(r.amount);
  const timeText = t => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? clockTime(new Date(2000, 0, 1, Number(m[1]), Number(m[2]))) : 'time not shown';
  };
  const nameOf = r => prettyMerchant(r.merchant) || r.merchant || 'No name';
  const kylie = () => findItemByName(app.state, 'Dates with Kylie');

  /* ----- reading ----- */
  function drawProgress(i) {
    countEl.textContent = `Reading ${i} of ${results.length}`;
    view.innerHTML = `
      <div class="imp-reading">
        <div class="imp-reading-art">${scrollIcon(48, 48)}</div>
        <ol class="imp-files">${results.map(r => `
          <li class="imp-file is-${r.state}">
            <span class="imp-file-name" data-user>${esc(r.name)}</span>
            <span class="imp-file-state">${esc(r.state === 'error' ? r.error : r.state === 'done' ? plural(r.rows.length, 'row', 'rows') + ' found' : r.state)}</span>
          </li>`).join('')}</ol>
      </div>`;
  }

  async function readAll() {
    results = files.map(f => ({ file: f, name: f.name || 'File', state: 'waiting', error: '', rows: null }));
    for (let i = 0; i < results.length; i++) {
      if (closed) return;
      const r = results[i];
      r.state = 'reading';
      drawProgress(i + 1);
      let out;
      try {
        out = await readFile(app, r.file, ctrl.signal);
      } catch (e) {
        if (closed || ctrl.signal.aborted) return;
        console.error('Import could not read a file:', e);
        out = { error: TEXT.failed };
      }
      r.file = null; // nothing of the file is kept once it is read
      Object.assign(r, out);
      r.state = r.error ? 'error' : 'done';
    }
    files = [];
    if (closed) return;
    drawProgress(results.length);
    const batches = results.map((r, i) => ({ fileId: 'file' + i, name: r.name, src: r.src, rows: r.rows }))
      .filter(b => Array.isArray(b.rows) && b.rows.length);
    if (!batches.length) { showNothing(); return; }
    if (!app.state) { handle.close(); return; }
    rows = buildReview(app.state, batches, { today: app.today() });
    showReview();
  }

  /* ----- what went wrong, and notes ----- */
  function problemsHtml() {
    const bad = results.filter(r => r.error);
    const notes = [];
    for (const r of results) {
      if (r.dropped) notes.push(`${plural(r.dropped, 'row', 'rows')} in <span data-user>${esc(r.name)}</span> could not be read.`);
      if (r.skipped && r.skipped.length) {
        notes.push(`<details class="imp-skipped"><summary>${plural(r.skipped.length, 'line', 'lines')} in <span data-user>${esc(r.name)}</span> skipped</summary>`
          + `<ul>${r.skipped.map(s => `<li>Line ${esc(s.line)} · ${esc(s.reason)}</li>`).join('')}</ul></details>`);
      }
    }
    return (bad.length ? `<ul class="imp-problems" role="alert">${bad.map(r => `
        <li><b data-user>${esc(r.name)}</b><span>${esc(r.error)}</span></li>`).join('')}</ul>` : '')
      + (notes.length ? `<div class="imp-notes">${notes.map(n => n.startsWith('<details') ? n : `<p>${n}</p>`).join('')}</div>` : '');
  }

  function showNothing() {
    const bad = results.filter(r => r.error).length;
    countEl.textContent = results.length === 1 ? 'The file could not be read' : `${plural(bad, 'file', 'files')} could not be read`;
    view.innerHTML = `${problemsHtml()}<div class="empty imp-empty">${motifs.arch()}<span>${TEXT.nothing}</span></div>`;
    handle.setActions([{ label: 'Close', primary: true, onClick: (e, h) => h.close() }]);
  }

  /* ----- the review ----- */
  function rowHtml(r) {
    const k = esc(r.key);
    const st = app.state;
    const ns = r.status === 'notspending';
    const needsCat = CATEGORY_KINDS.has(r.kind);
    const when = [isISODate(r.date) ? shortDate(r.date) : esc(r.date), timeText(r.time), ACCOUNT[r.account]].filter(Boolean).join(' · ');

    let chip = '';
    if (!ns && needsCat) {
      const item = r.itemId != null ? findItem(st, r.itemId) : null;
      chip = `<button class="imp-chip${item ? '' : ' is-empty'}" type="button" id="imp-chip-${k}" data-chip="${k}" aria-haspopup="dialog" aria-describedby="imp-m-${k}">`
        + `<span class="imp-chip-in"><span${item ? ' data-user' : ''}>${item ? esc(item.name) : 'Pick a category'}</span>${CHEVRON}</span></button>`;
    } else if (r.kind === 'bill' || r.kind === 'income') {
      chip = `<button class="imp-chip quiet" type="button" id="imp-chip-${k}" data-chip="${k}" aria-haspopup="dialog" aria-describedby="imp-m-${k}">`
        + `<span class="imp-chip-in">${r.kind === 'bill' ? 'Count as spending' : 'Count as a refund'}</span></button>`;
    }
    let sw = '';
    if (!ns && needsCat && r.altItemId != null) {
      const on = !!kylie() && r.itemId === kylie().id;
      sw = `<button class="imp-switch" type="button" role="switch" aria-checked="${on}" id="imp-sw-${k}" data-switch="${k}" aria-describedby="imp-m-${k}">`
        + '<span class="imp-track" aria-hidden="true"><span class="imp-knob"></span></span><span>Date with Kylie</span></button>';
    }
    const icon = r.status === 'bill' ? motifs.column(true, { w: 12, h: 16 }) : ''; // the column it will fill
    const status = r.statusText ? `<p class="imp-status s-${esc(r.status)}">${icon}<span>${esc(r.statusText)}</span></p>` : '';
    const bm = r.kind === 'bill' && r.billMatch;
    const diff = bm && Number(bm.diffPct) > 5 ? `<p class="imp-note">Bill is ${fmt(bm.billAmt)}, this charge is ${fmt(r.amount)}</p>` : '';
    const saveAs = (r.kind === 'pay' || r.kind === 'income') && r.note && !ns
      ? `<p class="imp-note">Saved as <span data-user>${esc(r.note)}</span></p>` : '';
    const tick = ns
      ? '<span class="imp-tickwrap is-off" aria-hidden="true"></span>'
      : `<label class="imp-tickwrap"><input class="imp-tick" type="checkbox" id="imp-t-${k}" data-tick="${k}"${r.ticked ? ' checked' : ''} aria-labelledby="imp-m-${k} imp-a-${k}"><span class="imp-box" aria-hidden="true">${CHECK}</span></label>`;

    return `
      <li class="imp-row s-${esc(r.status)}${r.ticked && !ns ? ' is-ticked' : ''}" data-key="${k}">
        ${tick}
        <div class="imp-main">
          <p class="imp-top"><span class="imp-merchant" id="imp-m-${k}" data-user>${esc(nameOf(r))}</span><span class="imp-amt" id="imp-a-${k}">${esc(amountText(r))}</span></p>
          <p class="imp-when">${when}</p>
          ${status}${diff}${saveAs}
          ${chip || sw ? `<div class="imp-actions">${chip}${sw}</div>` : ''}
        </div>
      </li>`;
  }

  function listHtml() {
    const many = results.filter(r => r.rows && r.rows.length && !r.error).length > 1;
    const byFile = [];
    for (const r of rows) {
      let g = byFile.find(x => x.fileId === r.fileId);
      if (!g) byFile.push(g = { fileId: r.fileId, list: [] });
      g.list.push(r);
    }
    return byFile.map(g => {
      const res = results[Number(String(g.fileId).replace('file', ''))];
      const head = many && res ? `<p class="caps imp-file-head"><span data-user>${esc(res.name)}</span></p>` : '';
      return `${head}<ul class="imp-list">${g.list.map(rowHtml).join('')}</ul>`;
    }).join('');
  }

  // What saving would do, from a dry run of applyImport on a copy (so the button says exactly that).
  function plan() {
    if (!app.state) return { text: TEXT.nothingToAdd, disabled: true };
    let counts;
    try {
      counts = applyImport(clone(app.state), rows, memory);
    } catch (e) {
      if (e && e.count) return { text: needText(e.count), disabled: true, missing: e.count };
      console.error('Import dry run failed:', e);
      return { text: TEXT.notReady, disabled: true };
    }
    const add = [];
    if (counts.expenses) add.push(plural(counts.expenses, 'expense', 'expenses'));
    if (counts.pays) add.push(plural(counts.pays, 'pay', 'pays'));
    const parts = add.length ? ['Add ' + add[0], ...add.slice(1)] : [];
    if (counts.bills) parts.push((parts.length ? 'tick ' : 'Tick ') + plural(counts.bills, 'bill', 'bills') + ' paid');
    if (!parts.length) return { text: TEXT.nothingToAdd, disabled: true };
    return { text: joinAnd(parts), disabled: false, counts };
  }

  function updateCount() {
    const live = rows.filter(r => r.status !== 'notspending');
    const ticked = live.filter(r => r.ticked).length;
    countEl.textContent = `${plural(rows.length, 'row', 'rows')} found · ${ticked} ticked`;
  }

  function updateFooter() {
    const btn = handle.el.querySelector('#impSave');
    if (!btn) return;
    const p = plan();
    btn.textContent = p.text;
    btn.disabled = p.disabled;
  }

  function setError(text) {
    const el = root.querySelector('.imp-error');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function showReview() {
    view.innerHTML = `
      <div class="imp-review">
        ${problemsHtml()}
        <p class="imp-hint">${TEXT.hint}</p>
        ${roll('top')}
        <div class="imp-reveal">
          <div class="imp-reveal-in">${listHtml()}</div>
          ${roll('bottom')}
        </div>
        <p class="form-error imp-error" role="alert" hidden></p>
      </div>`;
    updateCount();
    handle.setActions([
      { label: 'Cancel', onClick: (e, h) => h.close() },
      { label: TEXT.nothingToAdd, primary: true, id: 'impSave', onClick: save },
    ]);
    updateFooter();
    unroll(view.querySelector('.imp-reveal'));
    offRender = app.on('render', () => { if (!closed && rows) updateFooter(); });
  }

  // The scroll unrolls: the outer box slides down from above while its content slides up by the same amount,
  // so the rows stay still and are uncovered from the top, with the bottom roller riding the edge.
  // Transform only (opacity only with reduced motion, from CSS). Played once, when the review first shows.
  function unroll(el) {
    if (!el) return;
    el.style.setProperty('--unroll-h', el.offsetHeight + 'px');
    if (Date.now() - opened < 250) el.style.setProperty('--unroll-delay', '160ms');
    el.classList.add('unrolling');
    const done = () => { el.classList.remove('unrolling'); el.style.removeProperty('--unroll-h'); };
    el.addEventListener('animationend', e => { if (e.target === el) done(); });
    setTimeout(done, 1200);
  }

  // Re-draws the rows and keeps keyboard focus on the same control.
  function redraw({ flip } = {}) {
    const inner = view.querySelector('.imp-reveal-in');
    if (!inner) return;
    const active = document.activeElement;
    const fid = active && root.contains(active) ? active.id : '';
    inner.innerHTML = listHtml();
    if (fid) {
      const again = root.querySelector('#' + CSS.escape(fid));
      if (again) again.focus({ preventScroll: true });
    }
    if (flip) {
      // The switch slides from its old position to the new one.
      const sw = root.querySelector('#imp-sw-' + CSS.escape(flip));
      if (sw) {
        const to = sw.getAttribute('aria-checked');
        sw.setAttribute('aria-checked', to === 'true' ? 'false' : 'true');
        void sw.offsetHeight;
        sw.setAttribute('aria-checked', to);
      }
    }
    updateCount();
    updateFooter();
    setError('');
  }

  function pick(key, itemId) {
    if (!app.state) return;
    rows = setCategory(app.state, rows, key, itemId);
    memory = rows.memory;
    redraw();
  }

  function openPicker(key) {
    const r = rows.find(x => x.key === key);
    if (!r || !app.state) return;
    const st = app.state;
    const flat = [];
    const groups = (st.budget || []).filter(g => (g.items || []).length).map((g, gi) => `
      <section class="imp-group" aria-labelledby="imp-g${gi}">
        <h3 class="caps" id="imp-g${gi}"><span data-user>${esc(g.name)}</span></h3>
        <div class="imp-opts">${g.items.map(i => {
          flat.push(i.id);
          return `<button type="button" class="imp-opt" data-pick="${flat.length - 1}" aria-pressed="${i.id === r.itemId}"><span data-user>${esc(i.name)}</span></button>`;
        }).join('')}</div>
      </section>`).join('');
    const why = r.kind === 'bill' ? 'Picking a category adds this as an expense instead of ticking the bill.'
      : r.kind === 'income' ? 'Picking a category saves this as a refund instead of income.'
      : r.norm ? `Next time <span data-user>${esc(nameOf(r))}</span> gets this category on its own.` : '';
    const body = `
      <p class="imp-pick-for"><b data-user>${esc(nameOf(r))}</b> · ${esc(amountText(r))}${isISODate(r.date) ? ' · ' + shortDate(r.date) : ''}</p>
      ${why ? `<p class="imp-pick-why">${why}</p>` : ''}
      ${groups || '<div class="empty">No categories yet.</div>'}`;
    const h = app.sheet({
      title: 'Pick a category',
      body,
      onClose: () => {
        const chip = !closed && document.getElementById('imp-chip-' + key);
        if (chip) chip.focus({ preventScroll: true });
      },
    });
    h.el.classList.add('imp-picker');
    h.body.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const id = flat[Number(b.dataset.pick)];
      if (id === undefined) return;
      if (!closed) pick(key, id);
      h.close();
    });
  }

  // The months the saved records land in, oldest first.
  function monthsOf(list) {
    const out = new Set();
    for (const r of list) {
      if (!r.ticked || r.status === 'notspending' || !isISODate(r.date)) continue;
      out.add(r.kind === 'bill' && r.billMatch && isISODate(r.billMatch.date) ? monthOf(r.billMatch.date) : monthOf(r.date));
    }
    return [...out].sort();
  }

  function save() {
    if (!rows || !app.state) return;
    setError('');
    const p = plan();
    if (p.missing) { setError(needText(p.missing)); updateFooter(); return; }
    if (p.disabled || !p.counts) return;
    const months = monthsOf(rows);
    const chosen = rows, mem = memory;
    try {
      app.act(label('import', p.counts), d => { applyImport(d, chosen, mem); });
    } catch (e) {
      if (e && e.count) setError(needText(e.count));
      else { console.error('Import could not be saved:', e); setError(TEXT.saveFailed); }
      updateFooter();
      return;
    }
    handle.close();
    // Show where the new records went when none of them is in the month on screen.
    if (months.length && !months.includes(app.month())) app.setMonth(months[months.length - 1]);
  }

  root.addEventListener('change', e => {
    const box = e.target.closest('[data-tick]');
    if (!box || !rows) return;
    rows = rows.map(r => (r.key === box.dataset.tick ? { ...r, ticked: box.checked } : r));
    redraw();
  });
  root.addEventListener('click', e => {
    if (!rows) return;
    const chip = e.target.closest('[data-chip]');
    if (chip) { openPicker(chip.dataset.chip); return; }
    const sw = e.target.closest('[data-switch]');
    if (sw) {
      const r = rows.find(x => x.key === sw.dataset.switch);
      if (!r || r.altItemId == null || !app.state) return;
      rows = setCategory(app.state, rows, r.key, r.altItemId);
      memory = rows.memory;
      redraw({ flip: r.key });
    }
  });

  readAll();
  return handle;
}
