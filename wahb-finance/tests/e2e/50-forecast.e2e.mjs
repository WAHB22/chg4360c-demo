// Chequing forecast (Stage 5) at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js).
//
// Hand calculation (docs/SPEC.md 5.5) with Chequing $420 entered on Nov 14:
//   average spending = $647.00 in the 30 days to Nov 14, none on the Visa, / 30 = 21.5667, so $21.57 a day
//   Nov 14 (today)            420.00
//   Nov 19 (day before pay)   420 - 5 x 21.57 - Netflix 27.11 (Nov 16) - Phone + Crave 90.83 (Nov 18) = 194.21
//   Nov 30 (month end)        194.21 + planned pay 1,300 (Nov 20) - 11 x 21.57 - Internet 89.43 (Nov 22) - Gym 31.58 (Nov 26) = 1,135.93
//   lowest $194.21 on Nov 19, the day after Phone + Crave
// With Chequing $60: Nov 15 38.43, Nov 16 -10.25 (first below $0), lowest Nov 19 -165.79, so need $170 (next $10 up)
// and Savings $2,150 covers it: "Move $170 from savings before Nov 16".
// Visa owing $640 has no due day in the sample, so it is left out with a marker until a due day is set.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const near = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) <= tol;

export default async function ({ page, shot, step, assert, freshPage, open, waitSynced }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  const fc = (pg = page) => pg.locator('#forecast');
  const sheet = (pg = page) => pg.locator('dialog.sheet[open]');
  const sheetGone = (pg = page) => pg.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const sheetTitle = async (pg = page) => norm(await sheet(pg).locator('.sheet-head h2').textContent());
  const saveSheet = async (pg = page) => { await sheet(pg).getByRole('button', { name: 'Save', exact: true }).click(); await sheetGone(pg); };
  const state = (pg = page) => pg.evaluate(() => JSON.parse(JSON.stringify(window.__finance.state)));
  const txt = async (sel, pg = page) => norm(await pg.locator(sel).first().textContent());
  const toForecast = async (pg = page) => {
    await pg.evaluate(() => document.getElementById('forecast').scrollIntoView({ block: 'start' }));
    await sleep(250);
  };
  const undoSays = async (want, pg = page) => {
    await pg.waitForFunction(w => document.getElementById('undo').classList.contains('is-shown')
      && (document.getElementById('undoText')?.textContent || '').trim() === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`Undo bar should say "${want}", it says "${await pg.locator('#undoText').textContent()}"`); });
  };
  const waitSaved = (pg = page) => pg.waitForFunction(() => !localStorage.getItem('finance-pending')
    && /^Synced/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 15000 });
  // lib/forecast.js as the page calls it: today = the page's today, nextPay from lib/money.js.
  const lib = (pg = page) => pg.evaluate(() => {
    const f = window.__finance, c = f.lib.core;
    const t = f.today();
    const np = f.lib.money.nextPay(f.state, t);
    const r = f.lib.forecast.forecast(f.state, t, { nextPay: np });
    const balOn = d => (r.points || []).find(p => p.date === d)?.bal;
    const beforePay = np ? c.addDays(np.date, -1) : null;
    const monthEnd = c.monthEnd(c.monthOf(t));
    return JSON.parse(JSON.stringify({ r, np, t, beforePay, monthEnd, bal: { today: balOn(t), beforePay: balOn(beforePay), monthEnd: balOn(monthEnd) } }));
  });
  // The numbers the page exposes on the chart.
  const shown = (pg = page) => pg.evaluate(() => {
    const d = document.querySelector('#forecast .fc-plot')?.dataset || {};
    return { today: d.today, todayBal: d.todayBal, beforePay: d.beforePay, beforePayBal: d.beforePayBal, monthEnd: d.monthEnd, monthEndBal: d.monthEndBal, end: d.end, lowestBal: d.lowestBal };
  });
  // Everything that draws the line: the numbers and every path of the thread.
  const lineNow = async (pg = page) => ({
    shown: await shown(pg),
    paths: await pg.evaluate(() => [...document.querySelectorAll('#forecast .fc-line path')].map(p => p.getAttribute('d'))),
  });
  const addExpense = async (amt, note, paidWith, pg = page) => {
    await pg.locator('#fab').click();
    await sheet(pg).waitFor();
    await sheet(pg).locator('input[name="amt"]').fill(String(amt));
    await sheet(pg).locator('input[name="note"]').fill(note);
    await sheet(pg).getByText(paidWith, { exact: true }).click();
    await saveSheet(pg);
  };
  const daySheetRows = (pg = page) => pg.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .fc-ev')]
    .map(li => li.textContent.replace(/\s+/g, ' ').trim()));
  const sizes = (pg = page, sel = '#forecast button') => pg.evaluate(s => [...document.querySelectorAll(s)]
    .filter(b => b.getClientRects().length)
    .map(b => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }), sel);

  await step('the prompt shows first: settings.chequing is empty after migration, so there is no chart', async () => {
    await open();
    await waitSynced();
    assert.deepEqual((await state()).settings.chequing, { bal: null, asOf: null });
    assert.deepEqual((await lib()).r, { missing: 'chequing' });
    assert.equal(await fc().isHidden(), false, 'the forecast band shows');
    assert.equal(await txt('#forecast h2'), 'Chequing forecast');
    // The sample is a v1 save whose Chequing account already shows $420: he confirms it, he does not retype it.
    assert.equal(await txt('#forecast .fc-ask'), 'Confirm your chequing balance of $420 to see the forecast');
    assert.equal(await fc().locator('svg[role="img"]').count(), 0, 'no chart without a balance');
    assert.equal(await txt('#fcEnterCheq'), 'Confirm chequing balance');
    for (const s of await sizes()) assert.ok(s.w >= 44 && s.h >= 44, `${s.id} is ${s.w}x${s.h}`);
    const bg = await fc().evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(bg, 'rgb(225, 199, 184)', 'scroll band #E1C7B8');
    await toForecast();
    await shot('prompt');
  });

  await step('one tap on the prompt opens the Chequing form; saving the balance draws the chart', async () => {
    await page.locator('#fcEnterCheq').click();
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Chequing');
    await sheet().locator('input[name="bal"]').fill('420');
    await saveSheet();
    await undoSays('Chequing balance set to $420');
    assert.deepEqual((await state()).settings.chequing, { bal: 420, asOf: '2026-11-14' });
    await fc().locator('.fc-plot svg[role="img"]').waitFor();
    assert.equal(await fc().locator('.fc-missing').count(), 0);
  });

  await step('today, the day before next pay and month end match lib/forecast.js and the hand calculation', async () => {
    const L = await lib();
    const d = await shown();
    assert.equal(L.r.dailySpend, 21.57);
    assert.deepEqual([d.today, d.beforePay, d.monthEnd, d.end], ['2026-11-14', '2026-11-19', '2026-11-30', '2026-11-30']);
    assert.equal(Number(d.todayBal), L.bal.today);
    assert.equal(Number(d.beforePayBal), L.bal.beforePay);
    assert.equal(Number(d.monthEndBal), L.bal.monthEnd);
    assert.ok(near(d.todayBal, 420) && near(d.beforePayBal, 194.21) && near(d.monthEndBal, 1135.93), JSON.stringify(d));
    // The ledger under the chart shows the same three numbers.
    assert.equal(await txt('.fc-key[data-key="today"] b'), '$420');
    assert.equal(await txt('.fc-key[data-key="before-pay"] b'), '$194.21');
    assert.equal(await txt('.fc-key[data-key="before-pay"] small'), 'Nov 19 · estimate');
    assert.equal(await txt('.fc-key[data-key="month-end"] b'), '$1,135.93');
    assert.equal(await txt('.fc-key[data-key="month-end"] small'), 'Nov 30 · estimate');
    // One plotted point per day, Nov 14 to Nov 30, every day after today dotted (the 30 day average is an estimate).
    const segs = await page.evaluate(() => [...document.querySelectorAll('#forecast .fc-ink .fc-thread')]
      .map(p => ({ est: p.classList.contains('is-est'), n: p.getAttribute('d').split('L').length })));
    assert.equal(segs.reduce((s, x) => s + x.n - 1, 0), L.r.points.length - 1, 'one segment per day');
    assert.equal(L.r.points.length, 17);
    assert.ok(segs.every(x => x.est), 'after today the line is dotted');
    assert.equal(await txt('#forecast .fc-est-line'), 'Dotted: estimate from your average spending of $21.57 a day');
    assert.equal(await txt('#forecast .fc-low'), 'Lowest: $194.21 on Nov 19, the day after Phone + Crave (estimate)');
    assert.equal(`Lowest: $194.21 on Nov 19, ${L.r.lowest.note}`, 'Lowest: $194.21 on Nov 19, the day after Phone + Crave');
    assert.deepEqual(await page.locator('#forecast .fc-tick').allTextContents().then(a => a.map(norm)), ['Today', 'Payday Nov 20 (estimate)', 'Month end']);
    assert.equal(await txt('#forecast .fc-visa p'), 'Visa owing $640. Set its due date to include it.');
    assert.equal(await txt('#fcVisaDue'), 'Set due day');
    assert.equal(await txt('#forecast .fc-from p'), 'Starts from $420 in chequing, entered today.');
    assert.equal(await fc().locator('.fc-red, .fc-neg-line').count(), 0, 'nothing below $0');
    const label = await fc().locator('svg[role="img"]').getAttribute('aria-label');
    assert.equal(label, 'Chequing forecast from Nov 14 to Nov 30, an estimate after today. Today, Nov 14: $420. '
      + 'Before payday, Nov 19: $194.21 (estimate). Month end, Nov 30: $1,135.93 (estimate). Payday Nov 20 (estimate). '
      + 'Lowest: $194.21 on Nov 19, the day after Phone + Crave (estimate).');
    assert.equal(await txt('#forecast .fc-story'), 'Lachesis measured the thread. This one measures your month.');
    await toForecast();
    await shot('chart');
  });

  await step('days with bills or pay are 44 px buttons that open the day: absolute amounts with in or out', async () => {
    const L = await lib();
    const want = L.r.points.filter(p => p.events.some(e => e.type !== 'spend')).map(p => p.date);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#forecast .fc-hit')].map(b => b.dataset.fcDays));
    assert.deepEqual(ids, want);
    assert.deepEqual(want, ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-22', '2026-11-26']);
    for (const s of await sizes()) assert.ok(s.w >= 44 && s.h >= 44, `${s.id} is ${s.w}x${s.h}`);
    await page.locator('#fc-day-2026-11-18').click();
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Nov 18');
    assert.deepEqual(await daySheetRows(), ['Phone + Crave/Disney (Bell) $90.83 out', 'Spending estimate $21.57 out']);
    assert.deepEqual(await page.locator('dialog.sheet[open] .fc-day-bal > span').allTextContents().then(a => a.map(norm)),
      ['Balance at the end of the day', '$215.78 (estimate)']);
    await page.keyboard.press('Escape');
    await sheetGone();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fc-day-2026-11-18', 'focus goes back to the dot');
    // From the keyboard: Tab to the payday star and press Enter.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fc-day-2026-11-20');
    await page.keyboard.press('Enter');
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Nov 20');
    assert.deepEqual(await daySheetRows(), ['Pay estimate $1,300 in', 'Spending estimate $21.57 out']);
    await page.keyboard.press('Escape');
    await sheetGone();
  });

  await step('a Visa purchase does not move the line while no Visa due day is set; a chequing one does', async () => {
    const before = await lineNow();
    const libBefore = await lib();
    await addExpense(85, 'Visa test', 'Visa');
    await undoSays('Added Visa test $85');
    assert.equal((await state()).months['2026-11'].tx.find(t => t.note === 'Visa test').account, 'visa');
    await sleep(150);
    assert.deepEqual(await lineNow(), before, 'same numbers and the same line');
    const libAfter = await lib();
    assert.deepEqual(libAfter.r.points.map(p => p.bal), libBefore.r.points.map(p => p.bal));
    assert.equal(await txt('#forecast .fc-visa p'), 'Visa owing $640. Set its due date to include it.');
    // A chequing purchase changes the 30 day average: (647 + 30) / 30 = 22.57 a day.
    await addExpense(30, 'Chequing test', 'Chequing');
    await undoSays('Added Chequing test $30');
    const L = await lib();
    assert.equal(L.r.dailySpend, 22.57);
    await page.waitForFunction(v => document.querySelector('#forecast .fc-plot')?.dataset.monthEndBal === String(v), L.bal.monthEnd);
    assert.notEqual(L.bal.monthEnd, libBefore.bal.monthEnd);
    assert.ok(near(L.bal.beforePay, 420 - 5 * 22.57 - 27.11 - 90.83), String(L.bal.beforePay));
    await page.locator('#undoBtn').click();
    await page.waitForFunction(v => document.querySelector('#forecast .fc-plot')?.dataset.monthEndBal === String(v), libBefore.bal.monthEnd);
    assert.deepEqual(await lineNow(), before, 'Undo puts the line back');
  });

  await step('the month switcher leaves the forecast on today', async () => {
    const before = await shown();
    await page.locator('#prev').click();
    assert.equal(await txt('#monthLabel'), 'October 2026');
    assert.deepEqual(await shown(), before);
    await page.locator('#next').click();
    assert.equal(await txt('#monthLabel'), 'November 2026');
  });

  await step('dark mode: deep ink night, the thread in light ink', async () => {
    await waitSaved();
    const pg = await freshPage({ dark: true });
    await fc(pg).locator('.fc-plot svg[role="img"]').waitFor();
    const colours = await pg.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      band: getComputedStyle(document.getElementById('forecast')).backgroundColor,
      thread: getComputedStyle(document.querySelector('#forecast .fc-ink .fc-thread')).stroke,
      dot: getComputedStyle(document.querySelector('#forecast .fc-dot')).fill,
    }));
    assert.deepEqual(colours, { body: 'rgb(16, 22, 58)', band: 'rgb(45, 37, 64)', thread: 'rgb(233, 228, 210)', dot: 'rgb(233, 228, 210)' });
    assert.deepEqual(await shown(pg), await shown());
    await toForecast(pg);
    await shot('dark', { page: pg });
  });

  await step('a low balance turns the part under $0 terracotta and suggests moving savings', async () => {
    await page.locator('#accounts [data-acc="a-cheq"]').click();
    await sheet().waitFor();
    await sheet().locator('input[name="bal"]').fill('60');
    await saveSheet();
    await undoSays('Updated Chequing to $60');
    await fc().locator('.fc-red .fc-thread').first().waitFor();
    const L = await lib();
    assert.deepEqual(L.r.negative, { firstDate: '2026-11-16', need: 170, text: 'Move $170 from savings before Nov 16' });
    assert.equal(await txt('#forecast .fc-neg-line'), 'Move $170 from savings before Nov 16 (estimate)');
    assert.equal(await txt('#forecast .fc-low'), 'Lowest: -$165.79 on Nov 19, the day after Phone + Crave (estimate)');
    assert.equal(await txt('.fc-key[data-key="before-pay"] b'), '-$165.79');
    assert.equal(await page.locator('.fc-key[data-key="before-pay"] b').getAttribute('class'), 'amt neg');
    const d = await shown();
    assert.equal(Number(d.beforePayBal), L.bal.beforePay);
    assert.ok(near(d.beforePayBal, -165.79));
    const geo = await page.evaluate(() => {
      const svg = document.querySelector('#forecast .fc-svg');
      const zero = svg.querySelector('.fc-zero').getBBox().y;
      const clip = svg.querySelector('#fc-below rect');
      const ring = svg.querySelector('.fc-ring');
      return {
        zero, clipY: Number(clip.getAttribute('y')), ringY: Number(ring.getAttribute('cy')),
        red: getComputedStyle(svg.querySelector('.fc-red .fc-thread')).stroke,
        ink: getComputedStyle(svg.querySelector('.fc-ink .fc-thread')).stroke,
        hatch: !!svg.querySelector('.fc-hatch'),
        redDots: svg.querySelectorAll('.fc-dot.is-neg').length,
      };
    });
    assert.ok(Math.abs(geo.clipY - geo.zero) < 0.2, 'the red part starts at the $0 line');
    assert.ok(geo.ringY > geo.zero, 'the lowest point is under the $0 line');
    assert.equal(geo.red, 'rgb(163, 59, 42)', 'terracotta #A33B2A');
    assert.equal(geo.ink, 'rgb(27, 51, 178)', 'ink #1B33B2 above $0');
    assert.ok(geo.hatch, 'line screen under $0');
    assert.equal(geo.redDots, 2, 'Netflix and Phone + Crave are under $0');
    assert.match(await fc().locator('svg[role="img"]').getAttribute('aria-label'), /Below \$0 from Nov 16\. Move \$170 from savings before Nov 16 \(estimate\)\.$/);
    await toForecast();
    await shot('negative');
  });

  await step('the Visa marker sets the due day; then the Visa payment is a dot on its day', async () => {
    await page.locator('#fcVisaDue').click();
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Visa owing');
    await sheet().locator('input[name="due"]').fill('22');
    await saveSheet();
    await undoSays('Visa due day set to the 22nd');
    await page.waitForFunction(() => !document.querySelector('#forecast .fc-visa'));
    const L = await lib();
    assert.equal(L.r.visaMarker, null);
    assert.deepEqual((await shown()).monthEndBal, String(L.bal.monthEnd));
    assert.ok(near(L.bal.monthEnd, 775.93 - 640), String(L.bal.monthEnd));
    await page.locator('#fc-day-2026-11-22').click();
    await sheet().waitFor();
    assert.deepEqual(await daySheetRows(), ['Internet (Bell) $89.43 out', 'Visa payment $640 out', 'Spending estimate $21.57 out']);
    await page.keyboard.press('Escape');
    await sheetGone();
  });

  await step('names from his data are escaped: a hostile bill name shows as text', async () => {
    await page.locator('#addBill').click();
    await sheet().waitFor();
    await sheet().locator('input[name="name"]').fill('<img src=x onerror="window.__pwned=1">Evil');
    await sheet().locator('input[name="amt"]').fill('10');
    await sheet().locator('input[name="day"]').fill('21');
    await saveSheet();
    // Payday (Nov 20) and Nov 21 sit one day apart at almost the same height, closer than a tap target:
    // one button opens both days.
    const hit = page.locator('#forecast .fc-hit[data-fc-days="2026-11-20 2026-11-21"]');
    await hit.waitFor();
    for (const s of await sizes(page, '#forecast .fc-hit.many')) assert.ok(s.w >= 44 && s.h >= 44, `${s.id} is ${s.w}x${s.h}`);
    await hit.click();
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Nov 20 and Nov 21');
    const rows = await daySheetRows();
    assert.ok(rows.includes('<img src=x onerror="window.__pwned=1">Evil $10 out'), rows.join(' | '));
    assert.equal(await page.locator('#forecast img, dialog.sheet img').count(), 0);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await page.keyboard.press('Escape');
    await sheetGone();
  });

  await step('tap targets, focus ring and no dashes in the forecast and its sheet', async () => {
    for (const s of await sizes()) assert.ok(s.w >= 44 && s.h >= 44, `${s.id} is ${s.w}x${s.h}`);
    // From the keyboard (a scripted focus after a tap would not show the ring, as in any browser).
    await page.locator('#fc-day-2026-11-16').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fc-day-2026-11-18');
    const ring = await page.locator('#fc-day-2026-11-18').evaluate(b => getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineWidth);
    assert.equal(ring, 'solid 2px', 'visible focus');
    const names = (await state()).bills.map(b => b.name);
    const check = () => page.evaluate(() => {
      const DASH = /[‐-―−]|\s-\s|[A-Za-z]-[A-Za-z]|(^|\s)-(?!\$)/;
      const bad = [];
      for (const root of document.querySelectorAll('#forecast, dialog.sheet[open]')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const el = walker.currentNode.parentElement;
          if (!el || el.closest('[data-user], [hidden]') || !el.getClientRects().length) continue;
          const t = walker.currentNode.textContent.replace(/-\$[\d,.]+/g, '').trim();
          if (t && DASH.test(t)) bad.push(t);
        }
        for (const el of root.querySelectorAll('[aria-label]')) {
          const v = el.getAttribute('aria-label').replace(/-\$[\d,.]+/g, '');
          if (DASH.test(v)) bad.push('aria-label: ' + v);
        }
      }
      return bad;
    });
    const onPage = await check();
    await page.locator('#fc-day-2026-11-18').click();
    await sheet().waitFor();
    const inSheet = await check();
    await page.keyboard.press('Escape');
    await sheetGone();
    assert.deepEqual([...onPage, ...inSheet].filter(t => !names.some(n => t.includes(n))), []);
    assert.deepEqual(dialogs, [], 'no confirm or alert');
  });

  await step('no horizontal scroll from 320 to 1280 px; the chart fills its band', async () => {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await sleep(200);
      const m = await page.evaluate(() => {
        const plot = document.querySelector('#forecast .fc-plot');
        const svg = plot.querySelector('svg');
        const ticks = [...document.querySelectorAll('#forecast .fc-tick')].map(t => t.getBoundingClientRect());
        const p = plot.getBoundingClientRect();
        return {
          scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          plot: Math.round(p.width), svg: Math.round(svg.getBoundingClientRect().width),
          ticksInside: ticks.every(r => r.left >= p.left - 0.5 && r.right <= p.right + 0.5),
          ticksApart: ticks.every((r, i) => i === 0 || r.left >= ticks[i - 1].right),
        };
      });
      assert.equal(m.scroll, 0, `horizontal scroll at ${width}`);
      assert.equal(m.svg, m.plot, `chart width at ${width}`);
      assert.ok(m.ticksInside && m.ticksApart, `day labels at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await step('the thread draws on once a day, and not at all under reduced motion', async () => {
    const watch = pg => pg.evaluate(() => {
      window.__drew = false;
      const plot = document.querySelector('#forecast .fc-plot');
      new MutationObserver(() => { if (plot.classList.contains('is-drawing')) window.__drew = true; })
        .observe(plot, { attributes: true, attributeFilter: ['class'] });
    });
    const pg = await freshPage();
    await fc(pg).locator('.fc-plot svg').waitFor();
    await watch(pg);
    await toForecast(pg);
    await pg.waitForFunction(() => window.__drew === true);
    assert.equal(await pg.evaluate(() => localStorage.getItem('finance-forecast-drawn')), '2026-11-14');
    await pg.reload();
    await fc(pg).locator('.fc-plot svg').waitFor();
    await watch(pg);
    await toForecast(pg);
    await sleep(500);
    assert.equal(await pg.evaluate(() => window.__drew), false, 'not twice the same day');
    const rm = await freshPage({ reducedMotion: true });
    await fc(rm).locator('.fc-plot svg').waitFor();
    await watch(rm);
    await toForecast(rm);
    await sleep(500);
    assert.equal(await rm.evaluate(() => window.__drew), false);
    assert.equal(await rm.evaluate(() => localStorage.getItem('finance-forecast-drawn')), null);
  });

  await step('the one line story shows only in the first week on this device', async () => {
    assert.equal(await txt('#forecast .fc-story'), 'Lachesis measured the thread. This one measures your month.');
    await page.evaluate(() => localStorage.setItem('finance-first-seen', '2026-11-01'));
    await page.reload();
    await fc().locator('.fc-plot svg').waitFor();
    assert.equal(await fc().locator('.fc-story').count(), 0);
  });
}
