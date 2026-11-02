// History (Stage 2) at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js).
// Three changes are saved one by one; History lists their notes newest first with Current on top. The oldest of the
// three is restored; the page then holds exactly that version, History shows the restore on top with the previous
// current still listed, and Undo of the restore brings the current data back (canonical JSON, bookkeeping left out).
// Then: loading state, every way it can fail (404, offline list, offline restore), escaping of hostile notes,
// the "when" wording, tap targets, no dashes, focus, and a dark screenshot.

const BOOKKEEPING = ['savedAt', 'note', 'baseSavedAt'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Playwright's unroute(url, handler) compares a function url by identity, so every route and its unroute share
// one of these (a new arrow function in unroute would remove nothing and leak the fake into later steps).
const isList = u => u.search.includes('history=1');
const isVersion = u => u.search.includes('version=');

export default async function ({ page, base, shot, step, assert, freshPage, allowErrors, open, waitSynced, key }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  const sheet = () => page.locator('dialog.sheet[open]');
  const sheetGone = () => page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const rows = () => sheet().locator('.hist-row');
  const notes = () => sheet().locator('.hist-note').allTextContents().then(l => l.map(t => t.trim()));
  const undoText = () => page.locator('#undoText').textContent().then(t => (t || '').trim());
  const undoSays = async want => {
    await page.waitForFunction(w => {
      const bar = document.getElementById('undo');
      return bar.classList.contains('is-shown') && (document.getElementById('undoText')?.textContent || '').trim() === w;
    }, want, { timeout: 5000 }).catch(async () => { throw new Error(`Undo bar should say "${want}", it says "${await undoText()}"`); });
  };
  // Canonical JSON of the page's state (or of a doc after migrate), without sync bookkeeping.
  const pageCanon = () => page.evaluate(b => window.__finance.lib.core.canonical(window.__finance.state, b), BOOKKEEPING);
  const docCanon = doc => page.evaluate(([d, b]) => {
    const f = window.__finance;
    return f.lib.core.canonical(f.lib.migrate.migrate(d), b);
  }, [doc, BOOKKEEPING]);
  const serverGet = async (query = '') => (await fetch(base + '/api/data' + query, { headers: { 'x-app-key': key } })).json();
  // Waits until this device has nothing pending, the status says Synced and the newest version on the server has `note`.
  const waitSaved = async note => {
    await page.waitForFunction(() => !localStorage.getItem('finance-pending') && /^Synced/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
    const until = Date.now() + 10000;
    let last = null;
    while (Date.now() < until) {
      last = (await serverGet('?history=1')).versions?.[0]?.note;
      if (last === note) return;
      await sleep(100);
    }
    throw new Error(`the newest save should be "${note}", it is "${last}"`);
  };
  const openHistory = async () => {
    await page.locator('#historyBtn').click();
    await sheet().waitFor();
    await sheet().locator('.hist-list, .hist-problem, .hist-view > .empty').first().waitFor();
  };
  const closeSheet = async () => { await page.keyboard.press('Escape'); await sheetGone(); };
  const saveSheet = async () => { await sheet().getByRole('button', { name: 'Save', exact: true }).click(); await sheetGone(); };

  let beforeRestore = null;   // canonical state before the restore (= the newest save)
  let restoredId = null;      // the version restored
  let restoreLabel = null;

  await step('the History button sits in the footer next to the backup buttons', async () => {
    await open();
    await waitSynced();
    const btn = page.locator('#history-slot #historyBtn');
    assert.equal(await btn.count(), 1);
    assert.equal((await btn.textContent()).trim(), 'History');
    const box = await btn.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, `History button is ${box.width}x${box.height}`);
    await btn.scrollIntoViewIfNeeded();
    await shot('button');
  });

  await step('three changes, each saved before the next', async () => {
    await page.locator('#fab').click();
    await sheet().waitFor();
    await sheet().locator('input[name="amt"]').fill('11.11');
    await sheet().locator('input[name="note"]').fill('History one');
    await saveSheet();
    await undoSays('Added History one $11.11');
    await waitSaved('Added History one $11.11');

    await page.locator('.bar-hit[data-item="i-groc"]').click();
    await sheet().waitFor();
    await sheet().locator('input[name="limit"]').fill('480');
    await saveSheet();
    await undoSays('Changed Groceries limit to $480');
    await waitSaved('Changed Groceries limit to $480');

    await page.locator('.col-btn[data-key="b-netflix@2026-11-16"]').click();
    await undoSays('Ticked Netflix paid on time');
    await waitSaved('Ticked Netflix paid on time');
  });

  await step('History lists the notes newest first, Current on top, Restore on the others', async () => {
    await openHistory();
    assert.equal((await sheet().locator('h2').textContent()).trim(), 'History');
    const list = await notes();
    assert.deepEqual(list.slice(0, 4), ['Ticked Netflix paid on time', 'Changed Groceries limit to $480', 'Added History one $11.11', 'Sample data']);
    const server = (await serverGet('?history=1')).versions;
    assert.equal(await rows().count(), server.length, 'one row per kept version');
    const top = rows().first();
    assert.equal(await top.getAttribute('aria-current'), 'true');
    assert.equal((await top.locator('.hist-current').textContent()).trim(), 'Current');
    assert.equal(await top.locator('.hist-restore').count(), 0, 'no restore on the current version');
    assert.equal(await sheet().locator('.hist-current').count(), 1, 'Current only once');
    assert.equal(await sheet().getByRole('button', { name: 'Restore this version' }).count(), server.length - 1);
    // The sample's savedAt is Nov 14 15:00Z, and the server keeps savedAt increasing, so every save is on Nov 14,
    // which is today on this page (?today=2026-11-14).
    const when = await sheet().locator('.hist-when').allTextContents();
    for (const w of when) assert.match(w.trim(), /^Today, \d{1,2}:\d{2} [ap]\.m\.$/);
    await shot('list');
  });

  await step('restore the oldest of the three: the page shows that version, the sheet closes, the undo bar offers Undo', async () => {
    beforeRestore = await pageCanon();
    const row = rows().filter({ hasText: 'Added History one $11.11' });
    const server = (await serverGet('?history=1')).versions;
    const v = server.find(x => x.note === 'Added History one $11.11');
    restoredId = v.id;
    restoreLabel = await page.evaluate(s => window.__finance.lib.labels.label('restoreVersion', { savedAt: s }), v.savedAt);
    assert.match(restoreLabel, /^Restored the version from Nov 14, \d{1,2}:\d{2} [ap]\.m\.$/);
    await row.getByRole('button', { name: 'Restore this version' }).click();
    await sheetGone();
    await undoSays(restoreLabel);
    // Keep the undo bar up for the rest of this check (its timer pauses under the pointer).
    await page.locator('#undoText').hover();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'historyBtn', 'focus back on History');

    const doc = await serverGet('?version=' + encodeURIComponent(restoredId));
    assert.equal(await pageCanon(), await docCanon(doc), 'the page holds exactly the restored version');
    assert.notEqual(await pageCanon(), beforeRestore);
    // And on screen: the expense from that save is there, the later two changes are not.
    await page.locator('#tx .row', { hasText: 'History one' }).waitFor();
    assert.equal(await page.locator('.col-btn[data-key="b-netflix@2026-11-16"]').getAttribute('aria-pressed'), 'false');
    assert.match(await page.locator('.bar-hit[data-item="i-groc"]').textContent(), /of \$400/);
    // The shot shows the restored data (Groceries back to $400, Netflix unpaid) with the undo bar below it.
    // Scrolling the window moves neither focus nor the pointer, so the undo bar stays paused.
    await page.evaluate(() => {
      const el = document.querySelector('.bar-hit[data-item="i-groc"]');
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150);
    });
    await shot('restored');
  });

  await step('History now has the restore on top and the previous current still listed', async () => {
    await waitSaved(restoreLabel);
    // Opened from the keyboard so the pointer stays on the undo bar.
    await page.locator('#historyBtn').focus();
    await page.keyboard.press('Enter');
    await sheet().waitFor();
    await sheet().locator('.hist-list').waitFor();
    const list = await notes();
    assert.equal(list[0], restoreLabel);
    assert.equal(list[1], 'Ticked Netflix paid on time');
    assert.equal(await rows().first().locator('.hist-current').count(), 1);
    assert.equal(await rows().nth(1).getByRole('button', { name: 'Restore this version' }).count(), 1, 'the previous current can be restored');
    await shot('after-restore');
    await closeSheet();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'historyBtn');
  });

  await step('Undo of the restore brings the current data back (canonical JSON), on the page and on the server', async () => {
    assert.ok(await page.locator('#undo').evaluate(el => el.classList.contains('is-shown')), 'the undo bar is still there');
    assert.equal(await undoText(), restoreLabel);
    await page.locator('#undoBtn').click();
    await undoSays(`Undid "${restoreLabel}"`);
    assert.equal(await pageCanon(), beforeRestore);
    assert.equal(await page.locator('.col-btn[data-key="b-netflix@2026-11-16"]').getAttribute('aria-pressed'), 'true');
    await waitSaved(`Undid "${restoreLabel}"`);
    assert.equal(await docCanon(await serverGet()), beforeRestore, 'the server has the current data again');
    await page.mouse.move(5, 5);
  });

  await step('a version that matches the page says so and changes nothing', async () => {
    // After the undo the data equals the "Ticked Netflix" save again.
    await openHistory();
    const before = await pageCanon();
    await rows().filter({ hasText: 'Ticked Netflix paid on time' }).getByRole('button', { name: 'Restore this version' }).click();
    await sheetGone();
    await undoSays('That version matches what is here already.');
    assert.equal(await page.locator('#undoBtn').isVisible(), false, 'nothing to undo');
    assert.equal(await pageCanon(), before);
  });

  await step('loading state while the list is on its way', async () => {
    const slow = async route => { await sleep(900); await route.continue(); };
    await page.route(isList, slow);
    await page.locator('#historyBtn').click();
    await sheet().waitFor();
    const loading = sheet().locator('.hist-loading');
    await loading.waitFor();
    assert.match(await loading.textContent(), /Loading saves/);
    assert.equal(await sheet().locator('.hist-view').getAttribute('aria-busy'), 'true');
    await shot('loading');
    await sheet().locator('.hist-list').waitFor();
    assert.equal(await sheet().locator('.hist-view').getAttribute('aria-busy'), null);
    await page.unroute(isList, slow);
    await closeSheet();
  });

  await step('notes are escaped, and the time reads Today, Yesterday, a date, or a date with the year', async () => {
    const at = (...a) => new Date(...a).toISOString(); // local time, same zone as the browser
    const fake = { versions: [
      { id: 'finance-preview/data-4-a.json', savedAt: at(2026, 10, 14, 15, 20), note: '<img src=x onerror="window.__pwned=1">Added <b>Nuage</b>' },
      { id: 'finance-preview/data-3-a.json', savedAt: at(2026, 10, 13, 9, 5), note: 'Changed "Dépanneur" & co $4' },
      { id: 'finance-preview/data-2-a.json', savedAt: at(2026, 10, 1, 0, 0), note: '' },
      { id: 'finance-preview/data-1-a.json', savedAt: at(2025, 11, 31, 23, 59), note: '<script>window.__pwned=2</script>' },
    ] };
    const handler = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) });
    await page.route(isList, handler);
    await openHistory();
    assert.deepEqual(await notes(), [
      '<img src=x onerror="window.__pwned=1">Added <b>Nuage</b>',
      'Changed "Dépanneur" & co $4',
      'Saved',
      '<script>window.__pwned=2</script>',
    ]);
    assert.equal(await sheet().locator('img, b, script').count(), 0, 'no markup from a note');
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    const when = (await sheet().locator('.hist-when').allTextContents()).map(t => t.trim());
    assert.deepEqual(when, ['Today, 3:20 p.m.', 'Yesterday, 9:05 a.m.', 'Nov 1, 12:00 a.m.', 'Dec 31, 2025, 11:59 p.m.']);
    await closeSheet();
    await page.unroute(isList, handler);
  });

  await step('the sheet: tap targets at least 44 px, no dash or hyphen, Escape returns focus', async () => {
    await openHistory();
    // The real list again (the fake above is gone): the newest save is the undo of the restore.
    assert.equal((await notes())[0], `Undid "${restoreLabel}"`, 'the fake list from the step before is not used any more');
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('dialog.sheet[open] button')) {
        const r = el.getBoundingClientRect();
        if (Math.round(r.width) < 44 || Math.round(r.height) < 44) out.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    assert.deepEqual(small, []);
    const dashes = await page.evaluate(() => {
      const bad = [];
      const DASH = /[‐-―−]|\s-\s|[A-Za-z]-[A-Za-z]|(^|\s)-(?!\$)/;
      const root = document.querySelector('dialog.sheet[open]');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!el || el.closest('[data-user], [hidden]')) continue;
        const t = walker.currentNode.textContent.trim();
        if (t && DASH.test(t)) bad.push(t);
      }
      for (const el of root.querySelectorAll('[aria-label], [title], [placeholder]')) {
        for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v && DASH.test(v)) bad.push(v); }
      }
      return bad;
    });
    assert.deepEqual(dashes, []);
    await closeSheet();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'historyBtn');
  });

  await step('a version that is no longer kept shows a plain message and restores nothing', async () => {
    allowErrors(/status of 404/);
    const gone = route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'That version is no longer kept' }) });
    await page.route(isVersion, gone);
    const before = await pageCanon();
    await openHistory();
    await rows().nth(2).getByRole('button', { name: 'Restore this version' }).click();
    const msg = sheet().locator('.hist-msg');
    await msg.waitFor();
    assert.equal((await msg.textContent()).trim(), 'That version is no longer kept.');
    assert.equal(await sheet().count(), 1, 'the sheet stays open');
    assert.equal(await pageCanon(), before, 'nothing restored');
    assert.equal(await sheet().getByRole('button', { name: 'Restore this version' }).first().isEnabled(), true, 'buttons work again');
    await shot('gone');
    await closeSheet();
    await page.unroute(isVersion, gone);
  });

  await step('offline: the list says so plainly, Try again loads it; an offline restore changes nothing', async () => {
    allowErrors(/net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/);
    const fail = route => route.abort('internetdisconnected');
    await page.route(isList, fail);
    await page.locator('#historyBtn').click();
    await sheet().waitFor();
    const problem = sheet().locator('.hist-problem');
    await problem.waitFor();
    assert.match(await problem.textContent(), /No connection\. The history loads when you are online\./);
    await shot('offline');
    await page.unroute(isList, fail);
    await sheet().getByRole('button', { name: 'Try again' }).click();
    await sheet().locator('.hist-list').waitFor();

    await page.route(isVersion, fail);
    const before = await pageCanon();
    await rows().nth(1).getByRole('button', { name: 'Restore this version' }).click();
    const msg = sheet().locator('.hist-msg');
    await msg.waitFor();
    assert.equal((await msg.textContent()).trim(), 'No connection. Try again when you are online.');
    assert.equal(await pageCanon(), before, 'nothing restored');
    await closeSheet();
    await page.unroute(isVersion, fail);
  });

  await step('dark mode: the History sheet', async () => {
    const pg = await freshPage({ dark: true });
    await pg.waitForFunction(() => /^Synced/.test(document.getElementById('status').textContent));
    await pg.locator('#historyBtn').click();
    await pg.locator('dialog.sheet[open] .hist-list').waitFor();
    const bg = await pg.evaluate(() => getComputedStyle(document.querySelector('dialog.sheet[open]')).backgroundColor);
    assert.equal(bg, 'rgb(24, 32, 74)');
    await shot('dark', { page: pg });
  });

  await step('no confirm or alert anywhere', async () => {
    assert.equal(dialogs.length, 0, dialogs.join(', '));
  });
}
