// Core page checks at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js, a v1 doc).
// Hand calculated from the fixture: earned $1,300.00 (pay Nov 6), spent $647.00 (8 expenses),
// bills ticked paid $828.11 (Rent 587.50, Parking 90, iCloud 4.59, Claude Max 100, Spotify 14.44, Gym Nov 12 31.58).

export default async function ({ page, base, shot, step, assert, freshPage, allowErrors, open, waitSynced, key }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  const text = sel => page.locator(sel).first().textContent().then(t => (t || '').trim());
  const undoSays = async (want, { exact = true } = {}) => {
    await page.waitForFunction(([w, ex]) => {
      const bar = document.getElementById('undo');
      const t = (document.getElementById('undoText')?.textContent || '').trim();
      return bar.classList.contains('is-shown') && (ex ? t === w : t.startsWith(w));
    }, [want, exact], { timeout: 5000 }).catch(async () => {
      throw new Error(`Undo bar should say "${want}", it says "${await text('#undoText')}"`);
    });
  };
  const sheet = () => page.locator('dialog.sheet[open]');
  const sheetGone = () => page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const saveSheet = async () => { await sheet().getByRole('button', { name: 'Save', exact: true }).click(); await sheetGone(); };
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__finance.state)));
  const clickUndo = async () => { await page.locator('#undoBtn').click(); };
  const serverDoc = async () => (await fetch(base + '/api/data', { headers: { 'x-app-key': key } })).json();

  await step('opens with the key, saves it on the device and removes it from the address bar', async () => {
    await open();
    assert.ok(!page.url().includes('key='), 'key left in the URL: ' + page.url());
    assert.ok(page.url().includes('today=2026-11-14'));
    assert.equal(await page.evaluate(() => localStorage.getItem('finance-key')), 'dev-key');
    await page.waitForFunction(() => /^Synced/.test(document.getElementById('status').textContent));
  });

  await step('the v1 sample loads as v2 with every new field filled', async () => {
    const s = await state();
    assert.equal(s.version, 2);
    assert.deepEqual(s.settings.chequing, { bal: null, asOf: null });
    const t1 = s.months['2026-11'].tx.find(t => t.id === 't1');
    assert.equal(t1.src, 'manual');
    assert.equal(t1.merchant, 'Costco');
    assert.equal(t1.account, null);
    assert.equal(t1.fp, '18240|costco');
  });

  await step('month summary: Earned $1,300.00, Spent $647.00, Bills paid $828.11', async () => {
    assert.equal(await text('[data-sum="earned"]'), '$1,300.00');
    assert.equal(await text('[data-sum="spent"]'), '$647.00');
    assert.equal(await text('[data-sum="paid"]'), '$828.11');
    assert.equal(await text('[data-sum="bills"]'), '$1,072.70');
    assert.equal(await text('[data-sum="left"]'), '-$419.70');
    const cls = await page.locator('[data-sum="left"]').getAttribute('class');
    assert.ok(!/neg|red|alarm/.test(cls), 'a negative left is not styled as an alarm');
  });

  await step('Netflix shows soon; no ticked bill shows late', async () => {
    const netflix = page.locator('.row.bill', { hasText: 'Netflix' });
    assert.equal(await netflix.locator('.tag.soon').textContent(), 'soon');
    assert.equal(await page.locator('.row.bill.is-paid .tag').count(), 0);
    assert.equal(await page.locator('.row.bill', { hasText: 'Phone + Crave' }).locator('.tag').count(), 0, 'Nov 18 is 4 days away');
    assert.equal(await page.locator('.col-btn[data-key="b-rent@2026-11-01"]').getAttribute('aria-pressed'), 'true');
  });

  await step('home bands in order, at most two torn edges, one wordmark', async () => {
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section, main > footer')].map(s => s.id));
    assert.deepEqual(order, ['hero', 'limits', 'billsBand', 'spendBand', 'jarsBand', 'forecast', 'accountsBand', 'foot']);
    assert.ok(await page.locator('svg.torn').count() <= 2);
    assert.equal(await page.locator('.wordmark').count(), 1);
    assert.equal(await page.locator('#safe').count(), 1);
    assert.equal(await page.locator('#import-slot').count(), 1);
    assert.equal(await page.locator('#history-slot').count(), 1);
    const slots = await page.locator('.cover-slot[data-item]').count();
    const items = await page.evaluate(() => window.__finance.state.budget.reduce((n, g) => n + g.items.length, 0));
    assert.equal(slots, items, 'one cover slot per item');
  });

  await step('screenshots of the top and the full page', async () => {
    await shot('top');
    await shot('full', { fullPage: true });
  });

  await step('add an expense with Paid with Visa: every v2 field is saved', async () => {
    await page.locator('#fab').click();
    await sheet().waitFor();
    assert.equal(await sheet().locator('h2').textContent(), 'Add expense');
    assert.equal(await sheet().locator('input[name="date"]').inputValue(), '2026-11-14');
    await sheet().locator('input[name="amt"]').fill('12.34');
    await sheet().locator('select[name="item"]').selectOption('i-coffee');
    await sheet().locator('input[name="note"]').fill('Test cafe');
    await sheet().getByText('Visa', { exact: true }).click();
    await saveSheet();
    await undoSays('Added Test cafe $12.34');
    await page.locator('#tx .row', { hasText: 'Test cafe' }).waitFor();
    const tx = (await state()).months['2026-11'].tx.find(t => t.note === 'Test cafe');
    assert.equal(tx.amt, 12.34);
    assert.equal(tx.item, 'i-coffee');
    assert.equal(tx.src, 'manual');
    assert.equal(tx.merchant, 'Test cafe');
    assert.equal(tx.fp, '1234|test cafe');
    assert.equal(tx.account, 'visa');
    assert.equal(await text('[data-sum="spent"]'), '$659.34');
  });

  await step('delete it at once (no confirm), the undo bar says Deleted, Undo brings it back', async () => {
    await page.locator('#tx .row', { hasText: 'Test cafe' }).click();
    await sheet().waitFor();
    await sheet().getByRole('button', { name: 'Delete' }).click();
    await sheetGone();
    await undoSays('Deleted Test cafe $12.34');
    assert.equal(await page.locator('#tx .row', { hasText: 'Test cafe' }).count(), 0);
    await shot('undo');
    const [bar, fab] = await Promise.all([page.locator('#undo').boundingBox(), page.locator('#fab').boundingBox()]);
    assert.ok(fab.y + fab.height <= bar.y + 1, `the floating button (bottom ${fab.y + fab.height}) must sit above the undo bar (top ${bar.y})`);
    await clickUndo();
    await page.locator('#tx .row', { hasText: 'Test cafe' }).waitFor();
    await undoSays('Undid "Deleted Test cafe $12.34"');
    assert.equal(dialogs.length, 0, 'no confirm or alert: ' + dialogs.join(', '));
  });

  await step('untick a bill then Undo', async () => {
    const rent = page.locator('.col-btn[data-key="b-rent@2026-11-01"]');
    await rent.click();
    await undoSays('Unticked Rent (my half)');
    assert.equal(await rent.getAttribute('aria-pressed'), 'false');
    assert.equal(await text('[data-sum="paid"]'), '$240.61');
    await clickUndo();
    await page.waitForFunction(() => document.querySelector('.col-btn[data-key="b-rent@2026-11-01"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await text('[data-sum="paid"]'), '$828.11');
  });

  await step('a bill ticked before its date says paid on time and draws the wreath once', async () => {
    await page.locator('.col-btn[data-key="b-netflix@2026-11-16"]').click();
    await undoSays('Ticked Netflix paid on time');
    assert.equal(await page.locator('.col-btn[data-key="b-netflix@2026-11-16"] .win-wreath').count(), 1);
    assert.equal(await page.locator('.col-btn[data-key="b-netflix@2026-11-16"]').getAttribute('aria-pressed'), 'true');
    await clickUndo();
    await page.waitForFunction(() => document.querySelector('.col-btn[data-key="b-netflix@2026-11-16"]').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('.win-wreath').count(), 0, 'no wreath for an undo');
  });

  await step('change a limit then Undo', async () => {
    const groc = page.locator('.bar-hit[data-item="i-groc"]');
    assert.match(await groc.textContent(), /of \$400/);
    await groc.click();
    await sheet().waitFor();
    await sheet().locator('input[name="limit"]').fill('480');
    await saveSheet();
    await undoSays('Changed Groceries limit to $480');
    assert.match(await page.locator('.bar-hit[data-item="i-groc"]').textContent(), /of \$480/);
    await clickUndo();
    await page.waitForFunction(() => /of \$400/.test(document.querySelector('.bar-hit[data-item="i-groc"]').textContent));
  });

  await step('money added to a jar raises the amphora, Undo takes it back', async () => {
    await page.locator('.jar[data-goal="j-h27"]').click();
    await sheet().waitFor();
    await sheet().locator('input[name="add"]').fill('200');
    await saveSheet();
    await undoSays('Added $200 to Hiver 2027 cushion');
    assert.equal(await page.locator('.jar[data-goal="j-h27"] .jar-fill.rise').count(), 1);
    assert.equal((await state()).goals.find(g => g.id === 'j-h27').saved, 200);
    await clickUndo();
    await page.waitForFunction(() => window.__finance.state.goals.find(g => g.id === 'j-h27').saved === 0);
  });

  await step('Chequing balance also sets settings.chequing; Visa gets a due day and asOf', async () => {
    await page.locator('#accounts [data-acc="a-cheq"]').click();
    await sheet().waitFor();
    await sheet().locator('input[name="bal"]').fill('500');
    await saveSheet();
    await undoSays('Updated Chequing to $500');
    let s = await state();
    assert.deepEqual(s.settings.chequing, { bal: 500, asOf: '2026-11-14' });
    await page.locator('#accounts [data-acc="a-visa"]').click();
    await sheet().waitFor();
    assert.equal(await sheet().locator('input[name="due"]').count(), 1, 'Payment due day field');
    await sheet().locator('input[name="due"]').fill('22');
    await sheet().locator('input[name="bal"]').fill('700');
    await saveSheet();
    await undoSays('Updated Visa owing to $700');
    s = await state();
    assert.equal(s.settings.visaDueDay, 22);
    assert.equal(s.accounts.find(a => a.id === 'a-visa').asOf, '2026-11-14');
    assert.match(await page.locator('#accounts [data-acc="a-visa"]').textContent(), /due the 22nd/);
  });

  await step('month switcher goes to October and back', async () => {
    await page.locator('#prev').click();
    assert.equal(await text('#monthLabel'), 'October 2026');
    assert.equal(await text('[data-sum="earned"]'), '$2,600.00');
    await page.locator('#next').click();
    assert.equal(await text('#monthLabel'), 'November 2026');
  });

  await step('Escape closes a sheet and focus goes back to the button that opened it', async () => {
    await page.locator('#fab').focus();
    await page.keyboard.press('Enter');
    await sheet().waitFor();
    assert.ok(await page.evaluate(() => document.querySelector('dialog.sheet').contains(document.activeElement)), 'focus moved into the sheet');
    await page.keyboard.press('Escape');
    await sheetGone();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'fab');
  });

  await step('restore backup: a bad file says so; a good one is one undoable action', async () => {
    await page.locator('#importFile').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await undoSays('That file is not a finance backup.');
    const doc = await state();
    doc.bills.find(b => b.id === 'b-spot').name = 'Spotify Family';
    doc.savedAt = '2026-11-01T12:00:00.000Z';
    await page.locator('#importFile').setInputFiles({ name: 'finance-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    await undoSays('Restored backup from Nov 1');
    await page.locator('.row.bill', { hasText: 'Spotify Family' }).waitFor();
    await clickUndo();
    await page.waitForFunction(() => !document.querySelector('#bills').textContent.includes('Spotify Family'));
  });

  await step('offline save then sync: not synced while /api is blocked, synced after', async () => {
    await waitSynced();
    allowErrors(/net::ERR_FAILED|Failed to load resource/);
    await page.route('**/api/**', route => route.abort('failed'));
    await page.locator('#fab').click();
    await sheet().waitFor();
    await sheet().locator('input[name="amt"]').fill('9.99');
    await sheet().locator('input[name="note"]').fill('Offline lunch');
    await saveSheet();
    await page.waitForFunction(() => /Not synced yet/.test(document.getElementById('status').textContent), null, { timeout: 8000 });
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-pending') || '[]'));
    assert.ok(pending.some(a => a.label === 'Added Offline lunch $9.99'), 'the change waits on this device');
    assert.ok(!(await serverDoc()).months['2026-11'].tx.some(t => t.note === 'Offline lunch'), 'not on the server yet');
    await page.unroute('**/api/**');
    await waitSynced(page, 20000);
    assert.ok((await serverDoc()).months['2026-11'].tx.some(t => t.note === 'Offline lunch'), 'the server has the change');
  });

  await step('every tappable element is at least 44 px (page and the expense form)', async () => {
    const measure = () => page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary')) {
        if (el.closest('[hidden]')) continue;
        const target = el.matches('input[type=radio], input[type=checkbox]') ? (el.closest('label') || el) : el;
        const r = target.getBoundingClientRect();
        const cs = getComputedStyle(target);
        if ((r.width === 0 && r.height === 0) || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (target.matches('.skip')) continue; // only shown on keyboard focus, then 47 px
        if (Math.round(r.height) < 44 || Math.round(r.width) < 44) out.push(`${target.tagName.toLowerCase()}.${target.className || ''} "${(target.textContent || target.getAttribute('aria-label') || target.name || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    const onPage = await measure();
    await page.locator('#fab').click();
    await sheet().waitFor();
    const inForm = await measure();
    await page.keyboard.press('Escape');
    await sheetGone();
    assert.deepEqual([...onPage, ...inForm], []);
  });

  await step('no dash or hyphen in visible UI text (amounts and his own data excepted)', async () => {
    const check = () => page.evaluate(() => {
      const bad = [];
      const DASH = /[‐-―−]|\s-\s|[A-Za-z]-[A-Za-z]|(^|\s)-(?!\$)/;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode, el = n.parentElement;
        if (!el || el.closest('script, style, [data-user], [hidden]')) continue;
        if (!el.getClientRects().length) continue;
        const t = n.textContent.replace(/-\$[\d,.]+/g, '').trim();
        if (t && DASH.test(t)) bad.push(t);
      }
      for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
        for (const a of ['aria-label', 'placeholder', 'title']) {
          const v = el.getAttribute(a);
          if (v && !el.closest('[data-user]') && DASH.test(v.replace(/-\$[\d,.]+/g, ''))) bad.push(`${a}: ${v}`);
        }
      }
      return bad;
    });
    const onPage = await check();
    await page.locator('#fab').click();
    await sheet().waitFor();
    const inForm = await check();
    await page.keyboard.press('Escape');
    await sheetGone();
    // Bill names come from his data; they are marked data-user. Aria labels quote them, so drop those names first.
    const names = await page.evaluate(() => window.__finance.state.bills.map(b => b.name));
    const left = [...onPage, ...inForm].filter(t => !names.some(n => t.includes(n)));
    assert.deepEqual(left, []);
  });

  await step('a fresh device without the key shows only the not set up screen, no amounts', async () => {
    const pg = await freshPage({ key: false });
    await pg.locator('#notsetup').waitFor();
    assert.equal((await pg.locator('#notsetup h2').textContent()).trim(), 'This device is not set up');
    assert.match(await pg.locator('#notsetup').textContent(), /Open your private setup link on this device once\./);
    assert.ok(await pg.locator('#main').isHidden());
    assert.ok(await pg.locator('#fabs').isHidden());
    const body = await pg.evaluate(() => document.body.innerText);
    assert.ok(!/\$\d/.test(body), 'no amounts on the page');
    await shot('not-set-up', { page: pg });
  });

  await step('cached data on a device with no key is never shown', async () => {
    const doc = await state();
    const pg = await freshPage({ open: false });
    await pg.addInitScript(cache => { try { localStorage.setItem('finance-cache', cache); } catch {} }, JSON.stringify(doc));
    await pg.goto(base + '/?today=2026-11-14');
    await pg.locator('#notsetup').waitFor();
    const body = await pg.evaluate(() => document.body.innerText + document.getElementById('main').innerHTML);
    assert.ok(!/\$\d/.test(body), 'no cached amounts in the page');
  });

  await step('dark mode', async () => {
    const pg = await freshPage({ dark: true });
    await pg.waitForFunction(() => /^Synced/.test(document.getElementById('status').textContent));
    const bg = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(16, 22, 58)');
    await shot('dark', { page: pg, fullPage: true });
  });
}
