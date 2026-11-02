// Import (Stage 1) at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js).
// The dev server's fake reader returns the Oct 31 rows of tests/fixtures/oct31.js for any image or PDF:
// Nuage Cafe 6.58, Sammi & Soupe Dumpling 100.63, Payment 100, EPLV Billetterie Bio 38, Espace Vego Biodome 13.06,
// Payment 100 (time cut off). Screenshots are drawn on a canvas in the page and CSV statements are built here:
// no image or statement file is ever committed.
//
// Flow: the button and its file input; a screenshot read (shrunk to 2576 px, JPEG); the review (6 rows, 4 ticked,
// categories, Not spending, "time not shown"); the Date with Kylie switch; save as one undoable change; the
// expenses in October; Undo back to the exact data; duplicates on a second import; a CSV statement (bill tick,
// pay, a picked category that is remembered); drag and drop; PDF; every per file problem; hostile names;
// reduced motion; dark mode; nothing of the files kept.

const BOOK = ['savedAt', 'note', 'baseSavedAt'];
const CARD = '4500********1234';
const OCT31 = ['Nuage Cafe', 'Sammi & Soupe Dumpling', 'Payment', 'EPLV Billetterie Bio', 'Espace Vego Biodome', 'Payment'];
const VISA_CSV = [
  `2026-11-12,TIM HORTONS #2231,3.45,,${CARD}`,
  `2026-11-13,PAYMENT THANK YOU/PAIEMENT MERCI,,500.00,${CARD}`,
  `2026-11-13,NETFLIX.COM,27.11,,${CARD}`,
  `2026-11-13,ZORBA BOUTIQUE,48.00,,${CARD}`,
].join('\n');
const CHEQUING_CSV = [
  '2026-11-12,INTERNET TRANSFER 000000123456,200.00,',
  '2026-11-13,E-TRANSFER RECEIVED Kylie,,40.00',
].join('\r\n');

export default async function ({ page, shot, step, assert, freshPage, allowErrors, open, waitSynced }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  // Every upload to /api/read, as the page sent it.
  const reads = [];
  page.on('request', req => {
    if (req.method() !== 'POST' || !req.url().endsWith('/api/read')) return;
    try { reads.push(JSON.parse(req.postData() || 'null')); } catch { reads.push(null); }
  });

  const sheet = (pg = page) => pg.locator('dialog.imp-sheet[open]');
  const rowsOf = (pg = page) => sheet(pg).locator('.imp-row');
  const sheetGone = (pg = page) => pg.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const canon = (pg = page) => pg.evaluate(b => window.__finance.lib.core.canonical(window.__finance.state, b), BOOK);
  const state = (pg = page) => pg.evaluate(() => JSON.parse(JSON.stringify(window.__finance.state)));
  const text = (loc) => loc.first().textContent().then(t => (t || '').replace(/\s+/g, ' ').trim());
  const undoSays = async (want, pg = page) => {
    await pg.waitForFunction(w => {
      const bar = document.getElementById('undo');
      return bar.classList.contains('is-shown') && (document.getElementById('undoText')?.textContent || '').trim() === w;
    }, want, { timeout: 8000 }).catch(async () => {
      throw new Error(`Undo bar should say "${want}", it says "${await text(pg.locator('#undoText'))}"`);
    });
  };
  // A PNG drawn on a canvas in the page.
  const png = async (pg = page, w = 3000, h = 1600) => {
    const b64 = await pg.evaluate(([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1C1C1A'; g.font = `${Math.round(h / 18)}px sans-serif`;
      ['Nuage Cafe  $6.58', 'Sammi & Soupe Dumpling  $100.63', 'Payment  $100.00', 'EPLV Billetterie Bio  $38.00',
        'Espace Vego Biodome  $13.06', 'Payment  $100.00'].forEach((t, i) => g.fillText(t, w / 20, (i + 1.5) * h / 8));
      return c.toDataURL('image/png').split(',')[1];
    }, [w, h]);
    return Buffer.from(b64, 'base64');
  };
  const choose = async (files, pg = page) => {
    const [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.locator('#importFab').click()]);
    assert.ok(chooser.isMultiple(), 'the file picker takes many files');
    await chooser.setFiles(files);
  };
  const waitReview = async (n, pg = page) => {
    await sheet(pg).locator('.imp-review').waitFor();
    if (n != null) {
      await pg.waitForFunction(k => document.querySelectorAll('dialog.imp-sheet[open] .imp-row').length === k, n, { timeout: 5000 })
        .catch(async () => { throw new Error(`the review should have ${n} rows, it has ${await rowsOf(pg).count()}`); });
    }
  };
  const info = (pg = page) => pg.evaluate(() => [...document.querySelectorAll('dialog.imp-sheet[open] .imp-row')].map(li => {
    const t = s => (li.querySelector(s)?.textContent ?? null)?.replace(/\s+/g, ' ').trim() ?? null;
    return {
      merchant: t('.imp-merchant'),
      amount: t('.imp-amt'),
      when: t('.imp-when'),
      ticked: li.querySelector('.imp-tick') ? li.querySelector('.imp-tick').checked : null,
      chip: t('.imp-chip'),
      status: t('.imp-status') || '',
      note: t('.imp-note') || '',
      switch: li.querySelector('[role=switch]')?.getAttribute('aria-checked') ?? null,
    };
  }));
  const saveText = (pg = page) => text(pg.locator('#impSave'));
  const closeSheet = async (pg = page) => { await pg.keyboard.press('Escape'); await sheetGone(pg); };
  let pngBuf = null;
  let afterFirstSave = null;

  await step('the Import button sits left of + Expense, with a file input for many screenshots, PDFs or CSV files', async () => {
    await open();
    await waitSynced();
    const btn = page.locator('#import-slot #importFab');
    assert.equal(await text(btn), 'Import');
    const [b, f] = await Promise.all([btn.boundingBox(), page.locator('#fab').boundingBox()]);
    assert.ok(b.x + b.width <= f.x, 'Import is left of + Expense');
    assert.ok(b.height >= 44 && b.width >= 44, `Import is ${b.width}x${b.height}`);
    const input = page.locator('#importInput');
    assert.equal(await input.getAttribute('type'), 'file');
    assert.ok(await input.evaluate(el => el.multiple && el.hidden));
    const accept = await input.getAttribute('accept');
    for (const a of ['image/*', 'application/pdf', '.csv', 'text/csv']) assert.ok(accept.split(',').includes(a), `accept has ${a}: ${accept}`);
  });

  let before = null;
  await step('a screenshot is shrunk to 2576 px as a JPEG and read: 6 rows, 4 ticked with their categories', async () => {
    before = await canon();
    pngBuf = await png();
    await choose([{ name: 'oct31.png', mimeType: 'image/png', buffer: pngBuf }]);
    await waitReview(6);
    assert.equal(reads.length, 1, 'one upload');
    const r = reads[0];
    assert.equal(r.type, 'image/jpeg');
    assert.equal(r.uploadDate, '2026-11-14');
    assert.equal(r.name, 'oct31.png');
    const dims = await page.evaluate(async b64 => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, r.data);
    assert.deepEqual(dims, [2576, 1374], 'the 3000 x 1600 PNG is sent as 2576 x 1374');

    const rows = await info();
    assert.deepEqual(rows.map(x => x.merchant), OCT31);
    assert.deepEqual(rows.map(x => x.ticked), [true, true, null, true, true, null], 'the 4 expenses are ticked; Payments have no tick box');
    assert.deepEqual(rows.map(x => x.chip), ['Coffee and snacks', 'Eating out', null, 'Activities', 'Activities', null], 'no chip on Not spending rows');
    assert.equal(rows[2].status, 'Not spending');
    assert.equal(rows[5].status, 'Not spending');
    assert.equal(rows[2].amount, '+$100.00');
    assert.equal(rows[0].amount, '$6.58');
    assert.equal(rows[0].when, 'Oct 31 · 9:41 a.m. · Visa');
    assert.equal(rows[5].when, 'Oct 31 · time not shown · Visa');
    assert.deepEqual(rows.map(x => x.switch), [null, null, null, 'false', 'false', null], 'Date with Kylie only on Activities rows');
    assert.equal(await text(sheet().locator('.imp-count')), '6 rows found · 4 ticked');
    assert.equal(await saveText(), 'Add 4 expenses');
    assert.ok(await page.locator('#impSave').isEnabled());
  });

  await step('one tap switches the Biodome row to Dates with Kylie', async () => {
    const row = rowsOf().filter({ hasText: 'Espace Vego Biodome' });
    const sw = row.locator('[role=switch]');
    assert.equal(await text(sw), 'Date with Kylie');
    await sw.click();
    await page.waitForFunction(() => {
      const li = [...document.querySelectorAll('dialog.imp-sheet[open] .imp-row')].find(x => x.textContent.includes('Biodome'));
      return li && li.querySelector('.imp-chip')?.textContent.trim() === 'Dates with Kylie';
    });
    assert.equal(await row.locator('[role=switch]').getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'switch', 'focus stays on the switch');
    const rows = await info();
    assert.equal(rows[3].chip, 'Activities', 'the other Activities row is left alone');
    assert.equal(await saveText(), 'Add 4 expenses');
    await page.mouse.move(5, 5);
    await shot('review');
  });

  await step('every control in the review is at least 44 px, and its text has no dash', async () => {
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('dialog.imp-sheet[open] :is(button, input:not([type=hidden]), summary, [role=switch])')) {
        const target = el.matches('input[type=checkbox]') ? (el.closest('label') || el) : el;
        const r = target.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (Math.round(r.width) < 44 || Math.round(r.height) < 44) out.push(`${target.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    assert.deepEqual(small, []);
    const dashes = await page.evaluate(() => {
      const bad = [];
      const DASH = /[‐-―−]|\s-\s|[A-Za-z]-[A-Za-z]|(^|\s)-(?!\$)/;
      const root = document.querySelector('dialog.imp-sheet[open]');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!el || el.closest('[data-user], [hidden], style')) continue;
        const t = walker.currentNode.textContent.trim();
        if (t && DASH.test(t)) bad.push(t);
      }
      for (const el of root.querySelectorAll('[aria-label]')) if (DASH.test(el.getAttribute('aria-label'))) bad.push(el.getAttribute('aria-label'));
      return bad;
    });
    assert.deepEqual(dashes, []);
  });

  await step('save is one undoable change "Imported 4 expenses", and the 4 expenses show in October', async () => {
    await page.locator('#impSave').click();
    await sheetGone();
    await undoSays('Imported 4 expenses');
    const s = await state();
    const oct = s.months['2026-10'].tx;
    assert.equal(oct.length, 4);
    const by = Object.fromEntries(oct.map(t => [t.note, t]));
    assert.deepEqual(Object.keys(by).sort(), ['EPLV Billetterie Bio', 'Espace Vego Biodome', 'Nuage Cafe', 'Sammi & Soupe Dumpling']);
    assert.equal(by['Nuage Cafe'].item, 'i-coffee');
    assert.equal(by['Sammi & Soupe Dumpling'].item, 'i-eat');
    assert.equal(by['EPLV Billetterie Bio'].item, 'i-act');
    assert.equal(by['Espace Vego Biodome'].item, 'i-kylie');
    for (const t of oct) {
      assert.equal(t.src, 'screenshot');
      assert.equal(t.account, 'visa');
      assert.equal(t.date, '2026-10-31');
      assert.equal(t.merchant, t.note);
    }
    assert.equal(by['Nuage Cafe'].fp, '658|nuage cafe');
    assert.equal(by['Nuage Cafe'].amt, 6.58);
    assert.equal(s.months['2026-11'].tx.length, 8, 'November is untouched');
    assert.deepEqual(s.merchantMap, {}, 'rule categories and the Kylie switch are not remembered');
    // The page moves to the month the expenses went to.
    assert.equal(await text(page.locator('#monthLabel')), 'October 2026');
    const txText = await text(page.locator('#tx'));
    for (const m of ['Nuage Cafe', 'Sammi & Soupe Dumpling', 'EPLV Billetterie Bio', 'Espace Vego Biodome']) assert.ok(txText.includes(m), `${m} in October's spending`);
    assert.equal(await text(page.locator('[data-sum="spent"]')), '$158.27');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'importFab', 'focus goes back to Import');
    await page.evaluate(() => document.getElementById('spendBand').scrollIntoView({ block: 'start' }));
    await shot('saved');
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await step('Undo puts back exactly the data from before the import', async () => {
    await page.locator('#undoBtn').click();
    await undoSays('Undid "Imported 4 expenses"');
    assert.equal(await canon(), before, 'canonical JSON is the same as before the import');
    assert.equal(await page.locator('#tx .row').count(), 0, 'October has no spending again');
  });

  await step('the same screenshot imported again flags all 4 expenses as possible duplicates', async () => {
    await choose([{ name: 'oct31.png', mimeType: 'image/png', buffer: pngBuf }]);
    await waitReview(6);
    await page.locator('dialog.imp-sheet [role=switch]').last().click();
    await page.locator('#impSave').click();
    await sheetGone();
    await undoSays('Imported 4 expenses');
    afterFirstSave = await canon();

    await choose([{ name: 'oct31 again.png', mimeType: 'image/png', buffer: pngBuf }]);
    await waitReview(6);
    const rows = await info();
    assert.deepEqual(rows.map(x => x.ticked), [false, false, null, false, false, null], 'duplicates start unticked');
    assert.deepEqual(rows.map(x => x.status), [
      'Possible duplicate of Nuage Cafe $6.58 on Oct 31',
      'Possible duplicate of Sammi & Soupe Dumpling $100.63 on Oct 31',
      'Not spending',
      'Possible duplicate of EPLV Billetterie Bio $38 on Oct 31',
      'Possible duplicate of Espace Vego Biodome $13.06 on Oct 31',
      'Not spending',
    ]);
    assert.equal(await text(sheet().locator('.imp-count')), '6 rows found · 0 ticked');
    assert.equal(await saveText(), 'Nothing to add');
    assert.ok(await page.locator('#impSave').isDisabled());
    await page.mouse.move(5, 5);
    await shot('duplicates');
    // A real repeat purchase can still be kept by ticking it.
    await rowsOf().filter({ hasText: 'Nuage Cafe' }).locator('.imp-tickwrap').click();
    assert.equal(await saveText(), 'Add 1 expense');
    await rowsOf().filter({ hasText: 'Nuage Cafe' }).locator('.imp-tickwrap').click();
    assert.equal(await saveText(), 'Nothing to add');
    await closeSheet();
    assert.equal(await canon(), afterFirstSave, 'closing the review changes nothing');
  });

  await step('CSV statements are read in the browser: a category pick, a bill tick and a pay', async () => {
    const uploads = reads.length;
    await choose([
      { name: 'visa.csv', mimeType: 'text/csv', buffer: Buffer.from(VISA_CSV) },
      { name: 'chequing.csv', mimeType: 'text/csv', buffer: Buffer.from(CHEQUING_CSV) },
    ]);
    await waitReview(6);
    assert.equal(reads.length, uploads, 'CSV files are never uploaded');
    assert.deepEqual(await sheet().locator('.imp-file-head').allTextContents(), ['visa.csv', 'chequing.csv']);
    const rows = await info();
    const by = Object.fromEntries(rows.map(r => [r.merchant, r]));
    assert.equal(by['Tim Hortons'].chip, 'Coffee and snacks');
    assert.equal(by['Tim Hortons'].when, 'Nov 12 · time not shown · Visa');
    assert.equal(by['Payment Thank You/Paiement Merci'].status, 'Not spending');
    assert.equal(by['Netflix.com'].status, 'Ticks Netflix paid');
    assert.equal(by['Netflix.com'].chip, 'Count as spending');
    assert.equal(by['Zorba Boutique'].chip, 'Pick a category');
    assert.equal(by['Zorba Boutique'].ticked, true);
    assert.equal(by['Internet Transfer 000000123456'].status, 'Not spending');
    const kylie = rows.find(r => /Kylie/.test(r.merchant));
    assert.equal(kylie.status, 'Income');
    assert.equal(kylie.note, 'Saved as Interac transfer from Kylie');
    assert.equal(kylie.when, 'Nov 13 · time not shown · Chequing');
    assert.equal(await saveText(), 'Pick a category for 1 row');
    assert.ok(await page.locator('#impSave').isDisabled());

    const chip = rowsOf().filter({ hasText: 'Zorba Boutique' }).locator('.imp-chip');
    await chip.click();
    const picker = page.locator('dialog.imp-picker[open]');
    await picker.waitFor();
    assert.equal(await text(picker.locator('h2')), 'Pick a category');
    assert.ok((await text(picker.locator('.imp-pick-for'))).startsWith('Zorba Boutique · $48.00'));
    assert.deepEqual(await picker.locator('.imp-group h3').allTextContents(), ['Food', 'Pets', 'Transport', 'Personal']);
    await page.mouse.move(5, 5);
    await shot('picker');
    await picker.getByRole('button', { name: 'Clothing and shoes' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog.imp-picker'));
    assert.equal(await text(rowsOf().filter({ hasText: 'Zorba Boutique' }).locator('.imp-chip')), 'Clothing and shoes');
    assert.match(await page.evaluate(() => document.activeElement?.id || ''), /^imp-chip-/, 'focus goes back to the chip');
    assert.equal(await saveText(), 'Add 2 expenses, 1 pay and tick 1 bill paid');

    await page.locator('#impSave').click();
    await sheetGone();
    await undoSays('Imported 2 expenses, 1 pay and ticked 1 bill paid');
    const s = await state();
    const nov = s.months['2026-11'];
    const tim = nov.tx.find(t => t.note === 'Tim Hortons' && t.src === 'statement');
    assert.deepEqual([tim.item, tim.src, tim.account, tim.amt, tim.date], ['i-coffee', 'statement', 'visa', 3.45, '2026-11-12']);
    const zorba = nov.tx.find(t => t.note === 'Zorba Boutique');
    assert.deepEqual([zorba.item, zorba.src, zorba.amt], ['i-cloth', 'statement', 48]);
    assert.equal(nov.paid['b-netflix@2026-11-16'], true, 'Netflix ticked paid');
    const pay = nov.pays.find(p => p.amt === 40);
    assert.deepEqual([pay.date, pay.note, pay.kind], ['2026-11-13', 'Interac transfer from Kylie', 'income']);
    assert.equal(s.merchantMap['zorba boutique'], 'i-cloth', 'the pick is remembered for next time');
    assert.equal(nov.tx.some(t => /payment|transfer/i.test(t.note)), false, 'Visa payments and transfers are never spending');
    assert.equal(await text(page.locator('#monthLabel')), 'November 2026');
    assert.equal(await page.locator('.col-btn[data-key="b-netflix@2026-11-16"]').getAttribute('aria-pressed'), 'true');
  });

  await step('drag and drop: a quiet overlay, then the dropped file opens the review', async () => {
    const csv = `2026-11-14,COSTCO WHOLESALE W1234,50.00,,${CARD}`;
    await page.evaluate(c => {
      const dt = new DataTransfer();
      dt.items.add(new File([c], 'drop.csv', { type: 'text/csv' }));
      window.__dt = dt;
      document.getElementById('main').dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, csv);
    const ov = page.locator('.imp-drop');
    await ov.waitFor({ state: 'visible' });
    assert.equal(await text(ov.locator('.imp-drop-text')), 'Drop screenshots, PDFs or CSV files');
    await shot('drop');
    // Leaving the window hides it; coming back shows it again.
    await page.evaluate(() => document.querySelector('.imp-drop').dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: window.__dt })));
    await ov.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.getElementById('main').dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: window.__dt })));
    await ov.waitFor({ state: 'visible' });
    const prevented = await page.evaluate(() => {
      const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt });
      document.querySelector('.imp-drop').dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert.ok(prevented, 'the browser never opens the dropped file itself');
    await waitReview(1);
    assert.ok(await ov.isHidden());
    const [row] = await info();
    assert.equal(row.merchant, 'Costco Wholesale W1234');
    assert.equal(row.chip, 'Groceries');
    await closeSheet();

    // With a sheet open, a drop does nothing (and still does not open the file).
    await page.locator('#fab').click();
    await page.locator('dialog.sheet[open]').waitFor();
    const quiet = await page.evaluate(() => {
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
      const shown = !document.querySelector('.imp-drop').hidden;
      const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt });
      document.body.dispatchEvent(e);
      return { shown, prevented: e.defaultPrevented };
    });
    assert.deepEqual(quiet, { shown: false, prevented: true });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('dialog.imp-sheet').count(), 0, 'no import while another sheet is open');
    await closeSheet();
  });

  await step('a PDF statement is sent as application/pdf', async () => {
    const n = reads.length;
    await choose([{ name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% synthetic test file\n%%EOF\n') }]);
    await waitReview(6);
    assert.equal(reads.length, n + 1);
    assert.equal(reads[n].type, 'application/pdf');
    assert.equal(reads[n].name, 'statement.pdf');
    assert.equal(Buffer.from(reads[n].data, 'base64').toString().slice(0, 8), '%PDF-1.4');
    await closeSheet();
  });

  await step('when every file fails, the sheet says so and offers Close', async () => {
    await choose([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await sheet().locator('.imp-empty').waitFor();
    assert.equal(await text(sheet().locator('.imp-count')), 'The file could not be read');
    assert.equal(await text(sheet().locator('.imp-problems li b')), 'notes.txt');
    assert.equal(await text(sheet().locator('.imp-problems li span')), 'Only screenshots, PDFs and CSV files can be read.');
    assert.equal(await text(sheet().locator('.imp-empty')), 'Nothing to review.');
    await sheet().getByRole('button', { name: 'Close', exact: true }).last().click();
    await sheetGone();
  });

  await step('each file shows its own problem, Reading N of 9 counts up, and the good file still opens', async () => {
    allowErrors(/status of (413|429|503)|ERR_INTERNET_DISCONNECTED/);
    let call = 0;
    await page.route('**/api/read', route => {
      call++;
      const json = (status, error) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
      if (call === 1) return route.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large' });
      if (call === 2) return json(503, 'Reading screenshots is not set up yet. CSV files still work.');
      if (call === 3) return route.fulfill({ status: 503, contentType: 'text/html', body: '<html>Service Unavailable</html>' });
      if (call === 4) return json(429, 'You have used all 30 reads for today. They reset at midnight. CSV files still work.');
      if (call === 5) return route.abort('internetdisconnected');
      return route.continue();
    });
    await page.evaluate(() => {
      window.__counts = [];
      new MutationObserver(() => {
        const t = document.querySelector('dialog.imp-sheet .imp-count')?.textContent;
        if (t && window.__counts[window.__counts.length - 1] !== t) window.__counts.push(t);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const small = await png(page, 600, 400);
    const hostile = '<img src=x onerror="window.__pwned=1">.png';
    await choose([
      { name: hostile, mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(Math.round(3.4 * 1024 * 1024), 65) },
      { name: 's1.png', mimeType: 'image/png', buffer: small },
      { name: 's2.png', mimeType: 'image/png', buffer: small },
      { name: 's3.png', mimeType: 'image/png', buffer: small },
      { name: 's4.png', mimeType: 'image/png', buffer: small },
      { name: 's5.png', mimeType: 'image/png', buffer: small },
      { name: 's6.png', mimeType: 'image/png', buffer: small },
    ]);
    await waitReview(6);
    await page.unroute('**/api/read');
    const problems = await sheet().locator('.imp-problems li').evaluateAll(lis => lis.map(li => [li.querySelector('b').textContent, li.querySelector('span').textContent]));
    assert.deepEqual(problems, [
      [hostile, 'That file is over 10 MB'],
      ['notes.txt', 'Only screenshots, PDFs and CSV files can be read.'],
      ['big.pdf', 'This PDF is too big to read here. Try the CSV export instead.'],
      ['s1.png', 'This file is too big to send. Try a smaller screenshot or the CSV export.'],
      ['s2.png', 'Reading screenshots is not set up yet. CSV files still work.'],
      ['s3.png', 'The screenshot reader is not available right now. Try again in a few minutes. CSV files still work.'],
      ['s4.png', 'You have used all 30 reads for today. They reset at midnight. CSV files still work.'],
      ['s5.png', 'No connection. Screenshots and PDFs need a connection. CSV files still work.'],
    ]);
    assert.equal(call, 6, 'files refused in the browser are never sent');
    const counts = await page.evaluate(() => window.__counts);
    for (let i = 1; i <= 9; i++) assert.ok(counts.includes(`Reading ${i} of 9`), `"Reading ${i} of 9" was shown: ${counts.join(' | ')}`);
    assert.equal(await sheet().locator('.imp-problems img').count(), 0, 'a file name is text, never HTML');
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await page.mouse.move(5, 5);
    await shot('problems');
    await closeSheet();
  });

  await step('merchant names from a screenshot are shown as text, never as HTML', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">Evil & Co';
    await page.route('**/api/read', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ rows: [{ date: '2026-11-13', time: '10:05', merchant: evil, amount: 9.99, direction: 'out', account: 'visa', raw: evil }], dropped: 2 }),
    }));
    await choose([{ name: 'evil.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await waitReview(1);
    await page.unroute('**/api/read');
    const [row] = await info();
    assert.ok(row.merchant.includes('<img'), 'shown as text: ' + row.merchant);
    assert.equal(row.chip, 'Pick a category');
    assert.equal(await text(sheet().locator('.imp-notes')), '2 rows in evil.png could not be read.');
    await rowsOf().first().locator('.imp-chip').click();
    const picker = page.locator('dialog.imp-picker[open]');
    await picker.waitFor();
    assert.ok((await text(picker.locator('.imp-pick-for'))).includes('<img'));
    assert.equal(await page.locator('dialog.sheet img').count(), 0);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.imp-picker'));
    assert.match(await page.evaluate(() => document.activeElement?.id || ''), /^imp-chip-/, 'Escape on the picker goes back to the chip');
    await closeSheet();
  });

  await step('reduced motion: the scroll fades in and nothing moves', async () => {
    const pg = await freshPage({ reducedMotion: true });
    await waitSynced(pg);
    await choose([{ name: 'visa.csv', mimeType: 'text/csv', buffer: Buffer.from(VISA_CSV) }], pg);
    await waitReview(4, pg);
    const anim = await pg.evaluate(() => {
      const el = document.querySelector('dialog.imp-sheet .imp-reveal');
      el.classList.add('unrolling');
      const out = [getComputedStyle(el).animationName, getComputedStyle(el.firstElementChild).animationName];
      el.classList.remove('unrolling');
      return out;
    });
    assert.deepEqual(anim, ['imp-fade', 'none']);
    const normal = await page.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'imp-reveal unrolling';
      d.innerHTML = '<div class="imp-reveal-in"></div>';
      document.body.append(d);
      const out = [getComputedStyle(d).animationName, getComputedStyle(d.firstElementChild).animationName];
      d.remove();
      return out;
    });
    assert.deepEqual(normal, ['imp-unroll', 'imp-unroll-in'], 'with motion on, the scroll unrolls');
  });

  await step('dark mode: the review on the dark scroll colour', async () => {
    // A fresh store (sample data only), so the screenshot shows a first import, not duplicates.
    const pg = await freshPage({ dark: true, seed: 'tests/fixtures/sample-nov.js' });
    try {
      await waitSynced(pg);
      await choose([{ name: 'oct31.png', mimeType: 'image/png', buffer: await png(pg) }], pg);
      await waitReview(6, pg);
      assert.deepEqual((await info(pg)).map(x => x.ticked), [true, true, null, true, true, null]);
      assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('dialog.imp-sheet')).backgroundColor), 'rgb(45, 37, 64)');
      await pg.mouse.move(5, 5);
      await shot('review-dark', { page: pg });
      await closeSheet(pg);
    } finally {
      await pg.server.close(); // the main page's store is back
    }
  });

  await step('nothing of the files is kept on the device, and no confirm or alert was used', async () => {
    const kept = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i), v = localStorage.getItem(k) || '';
        if (/data:image|data:application|iVBORw0KGgo|\/9j\/4|JVBERi0/.test(v) || v.length > 500000) out.push(k);
      }
      return out;
    });
    assert.deepEqual(kept, []);
    assert.deepEqual(dialogs, []);
  });
}
