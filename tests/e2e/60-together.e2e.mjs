// The modules working together, at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js).
//
// One story, each step through the page as he would do it:
//   1. Chequing balance $420 through the Accounts row: the forecast draws. Safe to spend reads $81.
//   2. A chequing CSV with COSTCO WHOLESALE $150.00 on Nov 13 is imported (Groceries by the seeded rule):
//      Groceries 278.65 + 150 = 428.65 of 400 is red, so Cover it shows on Groceries.
//      Safe to spend: spending since Nov 6 is 647 + 150 = 797, (1300 - 797 - 163.96) / 6 = 56.50, so $56.
//      Forecast: a chequing purchase on Nov 13 is inside the 30 day window, so dailySpend goes from
//      647 / 30 = 21.57 to 797 / 30 = 26.57 and every later day moves.
//   3. Undo takes the import back everywhere: $81, Groceries green with no Cover it, the forecast as before.
//   4. The same file imported again, then Cover it: "Moved $30 Clothing and shoes → Groceries" (needed 28.65,
//      rounded up to $30; Clothing and shoes has the most room). Undo puts it back; moved again, the save lands
//      and History lists it on top. A move never changes safe to spend.
//   5. A paycheque of $1,300 logged Nov 14 through + Log paycheque starts a new pay period Nov 14 to Nov 27
//      (14 days). Income 1,300, nothing spent since Nov 14, bills Nov 14 to 27: Netflix 27.11, Phone + Crave 90.83,
//      Internet 89.43, Gym 31.58 = 238.95. (1300 - 238.95) / 14 = 75.79, so $75, "payday in 14 days", Nov 28.
//      The forecast's estimated pay moves from Nov 20 to Nov 28. Undo puts both back.
// Every number on screen is also checked against lib/money.js and lib/forecast.js on the page's own state.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const COSTCO_CSV = '2026-11-13,COSTCO WHOLESALE W503,150.00,\r\n';
const MOVE = 'Moved $30 Clothing and shoes → Groceries';

export default async function ({ page, base, shot, step, assert, open, waitSynced, key }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const sheet = () => page.locator('dialog.sheet[open]');
  const sheetGone = () => page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const undoText = () => page.locator('#undoText').textContent().then(clean);
  const undoSays = async want => {
    await page.waitForFunction(w => {
      const bar = document.getElementById('undo');
      return bar.classList.contains('is-shown') && (document.getElementById('undoText')?.textContent || '').trim() === w;
    }, want, { timeout: 5000 }).catch(async () => { throw new Error(`the undo bar should say "${want}", it says "${await undoText()}"`); });
  };
  const undo = async () => {
    await page.mouse.move(5, 5);
    await page.locator('#undoBtn').click();
  };
  const serverGet = async (query = '') => (await fetch(base + '/api/data' + query, { headers: { 'x-app-key': key } })).json();
  // Nothing pending on this device, Synced, and the newest save on the server has `note`.
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

  /* ----- what the page shows, and what lib says on the page's own state ----- */
  const libSafe = () => page.evaluate(() => {
    const a = window.__finance;
    const r = a.lib.money.safeToSpend(a.state, a.today());
    return r.missing ? r : { perDay: r.perDay, pool: r.pool, days: r.days, next: r.nextPay.date, estimate: r.nextPay.estimate };
  });
  const safeShows = async want => {
    await page.waitForFunction(w => document.querySelector('#safe .safe-num')?.textContent === w, want, { timeout: 4000 })
      .catch(async () => { throw new Error(`safe to spend should read ${want}, it reads ${await page.locator('#safe .safe-num').textContent()}`); });
  };
  const libForecast = () => page.evaluate(() => {
    const a = window.__finance;
    const t = a.today();
    const r = a.lib.forecast.forecast(a.state, t, { nextPay: a.lib.money.nextPay(a.state, t) });
    if (r.missing) return r;
    return { daily: r.dailySpend, end: r.points[r.points.length - 1].bal, lowest: r.lowest.bal, lowDate: r.lowest.date, n: r.points.length };
  });
  const pageForecast = () => page.evaluate(() => {
    const p = document.querySelector('#forecast .fc-plot');
    return p ? { ...p.dataset } : null;
  });
  // The forecast on screen matches lib: daily spend, month end, lowest point and next pay.
  const forecastMatches = async () => {
    await page.waitForFunction(() => document.querySelector('#forecast .fc-plot svg'), null, { timeout: 4000 });
    const lib = await libForecast();
    const np = await page.evaluate(() => window.__finance.lib.money.nextPay(window.__finance.state, window.__finance.today()));
    const ds = await pageForecast();
    assert.equal(Number(ds.daily), lib.daily, 'forecast daily spend on screen equals lib');
    assert.equal(Number(ds.lowestBal), lib.lowest, 'forecast lowest balance on screen equals lib');
    assert.equal(ds.lowest, lib.lowDate, 'forecast lowest date on screen equals lib');
    assert.equal(ds.nextPay, np.date, 'forecast payday on screen equals lib nextPay');
    return { ...lib, nextPay: np.date, monthEndBal: Number(ds.monthEndBal) };
  };
  const barAmt = id => page.locator(`#budget .bar-hit[data-item="${id}"] .bar-top .amt`).textContent().then(clean);
  const barCls = id => page.locator(`#budget .bar-hit[data-item="${id}"] .fill`).getAttribute('class');
  const coverBtn = id => page.locator(`#budget .cover-slot[data-item="${id}"] .cover-btn`);
  const groceriesId = () => page.evaluate(() => window.__finance.lib.core.findItemByName(window.__finance.state, 'Groceries').id);

  const importCsv = async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importFab').click()]);
    await chooser.setFiles([{ name: 'chequing.csv', mimeType: 'text/csv', buffer: Buffer.from(COSTCO_CSV) }]);
    await sheet().locator('.imp-review').waitFor();
    await page.waitForFunction(() => document.querySelector('#impSave')?.textContent === 'Add 1 expense' && !document.querySelector('#impSave').disabled, null, { timeout: 5000 })
      .catch(async () => { throw new Error(`the import button should say "Add 1 expense", it says "${await page.locator('#impSave').textContent()}"`); });
    assert.equal(clean(await sheet().locator('.imp-chip').first().textContent()), 'Groceries', 'Costco is Groceries by the seeded rule');
    await page.locator('#impSave').click();
    await undoSays('Imported 1 expense');
    await sheetGone();
  };

  let G = null;
  let before = null;        // forecast before the import
  let afterImport = null;   // forecast after the import

  await step('start: chequing balance through the Accounts row draws the forecast; safe to spend is $81', async () => {
    await open();
    await waitSynced();
    G = await groceriesId();
    await safeShows('$81');
    assert.equal((await libSafe()).perDay, 81);
    const cheqId = await page.evaluate(() => window.__finance.lib.core.chequingAccount(window.__finance.state).id);
    await page.locator(`#accounts [data-acc="${cheqId}"]`).click();
    await sheet().locator('input[name="bal"]').fill('420');
    await sheet().locator('button[type="submit"]').click();
    await sheetGone();
    before = await forecastMatches();
    assert.equal(before.daily, 21.57, 'dailySpend before: 647 / 30');
    assert.equal(before.nextPay, '2026-11-20');
    assert.equal(await barAmt(G), '$278.65 of $400');
    assert.equal(await coverBtn(G).count(), 0, 'Groceries is green: no Cover it');
  });

  await step('an import that pushes Groceries over its limit: Cover it shows, safe to spend and the forecast follow', async () => {
    await importCsv();
    assert.equal(clean(await page.locator('#monthLabel').textContent()), 'November 2026', 'the import is in November, the view stays');
    assert.equal(await barAmt(G), '$428.65 of $400');
    assert.match(await barCls(G), /\bred\b/);
    await coverBtn(G).waitFor({ timeout: 3000 });
    assert.equal(clean(await coverBtn(G).textContent()), 'Cover it · move room from Clothing and shoes to Groceries');
    const s = await libSafe();
    assert.equal(s.perDay, 56, '(1300 - 797 - 163.96) / 6 = 56.50');
    assert.equal(s.pool, 339.04);
    await safeShows('$56');
    afterImport = await forecastMatches();
    assert.equal(afterImport.daily, 26.57, 'dailySpend after: 797 / 30');
    assert.notEqual(afterImport.monthEndBal, before.monthEndBal, 'the forecast moved');
    const tx = await page.evaluate(() => window.__finance.state.months['2026-11'].tx.find(t => t.merchant && /COSTCO WHOLESALE/.test(t.merchant)));
    assert.equal(tx.account, 'chequing');
    assert.equal(tx.src, 'statement');
    await page.mouse.move(5, 5);
    await page.locator(`#budget .bar-hit[data-item="${G}"]`).scrollIntoViewIfNeeded();
    await shot('import-cover');
  });

  await step('Undo takes the import back everywhere: $81, Groceries green with no Cover it, the forecast as before', async () => {
    await waitSaved('Imported 1 expense'); // its own save, so each note in History stays separate
    await undo();
    await undoSays('Undid "Imported 1 expense"');
    await safeShows('$81');
    assert.equal(await barAmt(G), '$278.65 of $400');
    assert.equal(await coverBtn(G).count(), 0);
    const f = await forecastMatches();
    assert.equal(f.daily, before.daily);
    assert.equal(f.monthEndBal, before.monthEndBal);
  });

  await step('Cover it after a new import moves room; Undo puts it back; the move shows in History', async () => {
    await waitSaved('Undid "Imported 1 expense"');
    await importCsv();
    await safeShows('$56');
    await waitSaved('Imported 1 expense');

    await coverBtn(G).click();
    await sheet().locator('.cover-lines').waitFor();
    assert.equal(clean(await sheet().locator('.cover-line').first().textContent()), 'Move $30 from Clothing and shoes to Groceries');
    await page.locator('#coverMove').click();
    await undoSays(MOVE);
    await sheetGone();
    assert.equal(await barAmt(G), '$428.65 of $430');
    assert.doesNotMatch(await barCls(G), /\bred\b/, 'Groceries is no longer red');
    await safeShows('$56'); // room moves never change what is safe to spend
    assert.equal((await libSafe()).perDay, 56);
    await waitSaved(MOVE);

    await undo();
    await undoSays(`Undid "${MOVE}"`);
    assert.equal(await barAmt(G), '$428.65 of $400');
    assert.match(await barCls(G), /\bred\b/);
    await coverBtn(G).waitFor();
    await waitSaved(`Undid "${MOVE}"`);

    await coverBtn(G).click();
    await page.locator('#coverMove').click();
    await undoSays(MOVE);
    await sheetGone();
    await waitSaved(MOVE);

    await page.mouse.move(5, 5);
    await page.locator('#historyBtn').click();
    await sheet().locator('.hist-list').waitFor();
    const notes = (await sheet().locator('.hist-note').allTextContents()).map(clean);
    assert.equal(notes[0], MOVE, 'the move is the newest save');
    assert.ok(notes.includes(`Undid "${MOVE}"`), 'the undo of the first move is listed');
    assert.ok(notes.includes('Imported 1 expense'), 'the import is listed');
    assert.equal(await sheet().locator('.hist-row').first().locator('.hist-current').count(), 1, 'the move is Current');
    await shot('history-move');
    await page.keyboard.press('Escape');
    await sheetGone();
  });

  await step('a paycheque logged through the form updates safe to spend and the forecast; Undo puts both back', async () => {
    const fBefore = await forecastMatches();
    await page.mouse.move(5, 5);
    await page.locator('#addPay').click();
    await sheet().locator('input[name="amt"]').fill('1300');
    await sheet().locator('input[name="date"]').fill('2026-11-14');
    await sheet().locator('button[type="submit"]').click();
    await undoSays('Logged pay $1,300');
    await sheetGone();

    const s = await libSafe();
    assert.deepEqual(s, { perDay: 75, pool: 1061.05, days: 14, next: '2026-11-28', estimate: true }, '(1300 - 238.95) / 14 = 75.79');
    await safeShows('$75');
    assert.equal(clean(await page.locator('#safe .safe-when').textContent()), 'today · payday in 14 days');
    assert.equal(clean(await page.locator('#safe .safe-date').textContent()).replace(/^· /, ''), 'Nov 28 (estimate)');
    const f = await forecastMatches();
    assert.equal(f.nextPay, '2026-11-28', 'the estimated pay moved to Nov 28');
    assert.notEqual(f.lowDate + f.lowest, fBefore.lowDate + fBefore.lowest, 'the forecast changed');
    await page.locator('#forecast').scrollIntoViewIfNeeded();
    await shot('pay-forecast');

    await undo();
    await undoSays('Undid "Logged pay $1,300"');
    await safeShows('$56');
    const back = await forecastMatches();
    assert.equal(back.nextPay, '2026-11-20');
    assert.equal(back.monthEndBal, fBefore.monthEndBal);
    assert.equal(back.lowest, fBefore.lowest);
  });

  await step('no sideways scroll at any phone width from 320 to 430 px, with the longest month name on one line', async () => {
    await page.evaluate(() => window.__finance.setMonth('2026-09')); // "September 2026" is the longest label
    const bad = [];
    for (let w = 320; w <= 430; w += 1) {
      await page.setViewportSize({ width: w, height: 844 });
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        h: document.getElementById('monthLabel').getBoundingClientRect().height,
      }));
      if (r.sw > w || r.h > 22) bad.push(`${w} px: page ${r.sw} px wide, month label ${Math.round(r.h)} px tall`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__finance.setMonth('2026-11'));
    assert.deepEqual(bad, []);
  });

  await step('scrolled to the end with the undo bar showing, nothing on the page sits under the floating buttons or the bar', async () => {
    await page.evaluate(() => window.__finance.toast('Logged pay $1,300'));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(350); // the floating buttons move up above the bar
    const hidden = await page.evaluate(() => {
      const covers = [document.getElementById('fabs'), document.getElementById('undo')].map(e => e.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return [...document.querySelectorAll('#main button, #main .hint, #main a[href]')]
        .filter(el => el.offsetParent)
        .map(el => ({ t: (el.textContent || '').trim().slice(0, 40), r: el.getBoundingClientRect() }))
        .filter(x => covers.some(c => hit(x.r, c)))
        .map(x => x.t);
    });
    assert.deepEqual(hidden, [], 'the last controls and the footer note stay clear of the floating buttons and the undo bar');
    await shot('bottom');
  });

  await step('the whole page at the end: no horizontal scroll, every visible button at least 44 px, no confirm or alert', async () => {
    await page.mouse.move(5, 5);
    await page.evaluate(() => window.scrollTo(0, 0));
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 390, `no horizontal scroll (${wide})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=switch], a[href], input:not([type=hidden]):not([hidden])')]
      .filter(el => el.offsetParent && !el.closest('[hidden]') && !el.closest('.sr-only'))
      .map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.w < 44 || x.h < 44));
    assert.deepEqual(small, [], 'every visible control is at least 44 x 44');
    assert.deepEqual(dialogs, []);
    await shot('end', { fullPage: true });
  });
}
