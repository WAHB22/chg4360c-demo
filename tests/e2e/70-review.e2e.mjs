// Browser checks for the findings of the review (security, money, text and accessibility, data safety),
// at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js) unless a step says otherwise.
// Each step is the reviewer's reproduction turned into a lasting check: it failed before the fix.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CARD = '4500********1234';
const CSV4 = [
  `2026-11-13,IGA EXTRA #8123 MONTREAL QC,41.20,,${CARD}`,
  `2026-11-13,TIM HORTONS #2231 MONTREAL QC,3.95,,${CARD}`,
  `2026-11-13,PETRO CANADA 4411 LAVAL QC,45.00,,${CARD}`,
  `2026-11-13,PIZZA NOVA MONTREAL QC,22.10,,${CARD}`,
].join('\n');
const LAPTOP = { width: 1280, height: 800 };
const SAMPLE = 'tests/fixtures/sample-nov.js';

// WCAG contrast of two '#RRGGBB' colours.
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hexOf = rgb => '#' + (rgb.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();

export default async function ({ page, base, shot, step, assert, freshPage, allowErrors, open, waitSynced, key, server }) {
  // Offline steps abort requests, the 401 steps get refused ones: both log a failed resource in the console.
  allowErrors(/status of 401|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Failed to load resource/);

  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const sheet = (pg = page) => pg.locator('dialog.sheet[open]');
  const sheetGone = (pg = page) => pg.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const synced = (pg = page, timeout = 20000) => pg.waitForFunction(
    () => !localStorage.getItem('finance-pending') && /^Synced/.test(document.getElementById('status').textContent), null, { timeout });
  const serverDoc = async () => (await fetch(base + '/api/data', { headers: { 'x-app-key': key } })).json();
  const txNamed = async note => (await serverDoc()).months['2026-11'].tx.filter(t => t.note === note).length;
  const undoSays = async (want, pg = page) => {
    await pg.waitForFunction(w => document.getElementById('undo').classList.contains('is-shown')
      && (document.getElementById('undoText')?.textContent || '').trim() === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`the undo bar should say "${want}", it says "${clean(await pg.locator('#undoText').textContent())}"`); });
  };
  // Two real clicks at the centre of a control, `gap` ms apart: a fast double tap or double click.
  const doubleClick = async (pg, loc, gap = 90) => {
    const b = await loc.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await pg.mouse.click(x, y);
    await sleep(gap);
    await pg.mouse.click(x, y);
  };
  const addExpense = async (pg, amt, note) => {
    await pg.locator('#fab').click();
    await sheet(pg).waitFor();
    await sheet(pg).locator('input[name="amt"]').fill(String(amt));
    await sheet(pg).locator('input[name="note"]').fill(note);
    await sheet(pg).getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone(pg);
  };
  const withRotatedKey = async fn => {
    const was = process.env.APP_KEY;
    try { return await fn(() => { process.env.APP_KEY = 'rotated-key'; }); } finally { process.env.APP_KEY = was; }
  };
  const notSetUpScreen = pg => pg.evaluate(() => ({
    notSetUp: !document.getElementById('notsetup').hidden,
    main: !document.getElementById('main').hidden,
    sheets: document.querySelectorAll('dialog.sheet').length,
    amounts: (document.body.innerText.match(/\$\d/g) || []).length,
    leftover: ['announce', 'undoText', 'payPlan', 'txCount', 'limitsDay', 'monthLabel']
      .map(id => [id, (document.getElementById(id)?.textContent || '').trim()]).filter(([, t]) => t),
    cache: localStorage.getItem('finance-cache'),
  }));

  // Closes a fresh page's context, and the extra dev server it was seeded on (the in memory store is global to
  // this process: while that server runs, the base server serves its data too).
  const done = async pg => {
    await pg.context().close();
    if (pg.server && pg.server !== server && pg.server.close) await pg.server.close().catch(() => {});
  };

  await open();
  await waitSynced();

  /* ---------- security ---------- */
  await step('device key: the #key= link keeps the key out of every request, and the page sends no Referer', async () => {
    for (const how of ['hash', 'query']) {
      const pg = await freshPage({ open: false });
      const reqs = [];
      pg.on('request', r => reqs.push({ url: r.url(), referer: r.headers().referer || '', type: r.resourceType() }));
      await pg.goto(how === 'hash' ? `${pg.base}/?today=2026-11-14#key=${key}` : `${pg.base}/?key=${key}&today=2026-11-14`);
      await pg.waitForFunction(() => !document.getElementById('main').hidden);
      await synced(pg);
      const after = await pg.evaluate(() => ({ href: location.pathname + location.search + location.hash, stored: localStorage.getItem('finance-key'), policy: document.querySelector('meta[name="referrer"]')?.content }));
      assert.equal(after.stored, key, how);
      assert.equal(after.href, '/?today=2026-11-14', `${how}: the key is gone from the address bar`);
      assert.equal(after.policy, 'no-referrer');
      const leaks = reqs.filter(r => r.url.includes('key=' + key) || r.referer.includes(key));
      if (how === 'hash') assert.deepEqual(leaks, [], 'a fragment never reaches the server');
      else assert.deepEqual(leaks.map(r => r.type), ['document'], 'only the setup link itself, never a Referer on the assets');
      assert.ok(reqs.filter(r => r.url.startsWith(pg.base)).every(r => !r.referer), 'no Referer at all');
    }
  });

  /* ---------- 401: everything hidden, nothing readable left ---------- */
  await step('a key changed on the server: the next refresh hides every number, clears the live region and the cache', async () => {
    const pg = await freshPage();
    await synced(pg);
    // A change, so the live region and the undo bar hold text with an amount.
    await addExpense(pg, 4.5, 'Before the key changed');
    await undoSays('Added Before the key changed $4.50', pg);
    await synced(pg);
    await withRotatedKey(async rotate => {
      rotate();
      await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await pg.waitForFunction(() => !document.getElementById('notsetup').hidden);
      const r = await notSetUpScreen(pg);
      assert.deepEqual({ ...r, cache: !!r.cache }, { notSetUp: true, main: false, sheets: 0, amounts: 0, leftover: [], cache: false });
      assert.equal(clean(await pg.locator('#notsetup').innerText()), 'This device is not set up Open your private setup link on this device once.');
    });
    await done(pg);
  });

  await step('a 401 heard by History or by Import (not the sync engine) also hides the whole page', async () => {
    for (const how of ['history', 'import']) {
      const pg = await freshPage();
      await synced(pg);
      await withRotatedKey(async rotate => {
        rotate();
        if (how === 'history') await pg.locator('#historyBtn').click();
        else await pg.locator('#importInput').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
        await pg.waitForFunction(() => !document.getElementById('notsetup').hidden, null, { timeout: 10000 })
          .catch(() => { throw new Error(`${how}: the page still shows his data after the 401`); });
        const r = await notSetUpScreen(pg);
        assert.deepEqual({ ...r, cache: !!r.cache }, { notSetUp: true, main: false, sheets: 0, amounts: 0, leftover: [], cache: false }, how);
      });
      await pg.context().close();
    }
  });

  /* ---------- data safety ---------- */
  await step('two tabs on one device, no connection, one reloaded: both expenses reach the server', async () => {
    const a = await freshPage();
    await synced(a);
    const b = await a.context().newPage();
    await b.goto(a.base + '/?today=2026-11-14');
    await b.waitForFunction(() => !document.getElementById('main').hidden);
    await synced(b);
    await a.context().route('**/api/**', r => r.abort('internetdisconnected'));
    await a.bringToFront();
    await addExpense(a, 8.1, 'Tab A lunch');
    await b.bringToFront();
    await addExpense(b, 8.2, 'Tab B taxi');
    assert.deepEqual(await a.evaluate(() => JSON.parse(localStorage.getItem('finance-pending')).map(x => x.label)),
      ['Added Tab A lunch $8.10', 'Added Tab B taxi $8.20'], 'tab B kept tab A\'s unsaved change');
    await a.bringToFront();
    await a.reload();
    await a.waitForFunction(() => !document.getElementById('main').hidden);
    assert.equal(await a.locator('#tx .row', { hasText: 'Tab A lunch' }).count(), 1, 'tab A shows its own change after the reload');
    assert.equal(await a.locator('#tx .row', { hasText: 'Tab B taxi' }).count(), 1, 'and the other tab\'s');
    await a.context().unroute('**/api/**');
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await b.evaluate(() => window.dispatchEvent(new Event('online')));
    await Promise.all([synced(a, 25000), synced(b, 25000)]);
    assert.equal(await txNamed('Tab A lunch'), 1);
    assert.equal(await txNamed('Tab B taxi'), 1);
    await done(a);
  });

  await step('a double click, a double tap or Enter twice on Save saves once (expense, laptop and reduced motion)', async () => {
    for (const [label, opts] of [['laptop', { viewport: LAPTOP }], ['reduced', { reducedMotion: true }], ['touch', { reducedMotion: true, touch: true, mobile: true }]]) {
      const pg = await freshPage(opts);
      await synced(pg);
      await pg.locator('#fab').click();
      await sheet(pg).waitFor();
      await sleep(600);
      await sheet(pg).locator('input[name="amt"]').fill('12.34');
      await sheet(pg).locator('input[name="note"]').fill('Double ' + label);
      const save = sheet(pg).getByRole('button', { name: 'Save', exact: true });
      if (label === 'touch') {
        const b = await save.boundingBox();
        await pg.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await sleep(120);
        await pg.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      } else await doubleClick(pg, save);
      await sheetGone(pg);
      await synced(pg);
      assert.equal(await txNamed('Double ' + label), 1, label);
      assert.equal(clean(await pg.locator('#undoText').textContent()), `Added Double ${label} $12.34`, `${label}: the second tap did not land on Undo`);
      await pg.context().close();
    }
    const pg = await freshPage({ viewport: LAPTOP });
    await synced(pg);
    await pg.locator('#fab').click();
    await sheet(pg).waitFor();
    await sleep(600);
    await sheet(pg).locator('input[name="amt"]').fill('7.77');
    await sheet(pg).locator('input[name="note"]').fill('Enter twice');
    await pg.keyboard.press('Enter');
    await sleep(80);
    await pg.keyboard.press('Enter');
    await sheetGone(pg);
    await synced(pg);
    assert.equal(await txNamed('Enter twice'), 1);
    await done(pg);
  });

  await step('a double click on Move it moves once; on "Add 4 expenses" imports once', async () => {
    const pg = await freshPage({ reducedMotion: true });
    await synced(pg);
    const movesBefore = ((await serverDoc()).months['2026-11'].moves || []).length;
    await pg.locator('#budget .cover-slot[data-item="i-catfood"] .cover-btn').click();
    await sheet(pg).locator('#coverMove').waitFor();
    await sleep(400);
    await doubleClick(pg, sheet(pg).locator('#coverMove'));
    await sheetGone(pg);
    await synced(pg);
    const moves = (await serverDoc()).months['2026-11'].moves || [];
    assert.equal(moves.length - movesBefore, 1, JSON.stringify(moves));
    assert.equal(await pg.evaluate(() => window.__finance.lib.budget.effectiveLimit(window.__finance.state, '2026-11', 'i-catfood')), 40);

    const before = (await serverDoc()).months['2026-11'].tx.filter(t => t.src === 'statement').length;
    await pg.locator('#importInput').setInputFiles({ name: 'visa.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV4) });
    await pg.waitForFunction(() => /^Add 4 expenses$/.test(document.querySelector('#impSave')?.textContent || ''));
    await sleep(600);
    await doubleClick(pg, sheet(pg).locator('#impSave'));
    await sheetGone(pg);
    await synced(pg);
    const after = (await serverDoc()).months['2026-11'].tx.filter(t => t.src === 'statement').length;
    assert.equal(after - before, 4);
    await done(pg);
  });

  await step('editing the Chequing balance keeps fields another build stored on settings.chequing', async () => {
    const pg = await freshPage();
    await synced(pg);
    await pg.evaluate(() => window.__finance.act('Test setup: build B field', d => { d.settings.chequing = { bal: 420, asOf: '2026-11-10', bSource: 'manual' }; }, { undo: false }));
    await synced(pg);
    await pg.locator('#accounts [data-acc="a-cheq"]').click();
    await sheet(pg).locator('input[name="bal"]').fill('500');
    await sheet(pg).getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone(pg);
    await synced(pg);
    assert.deepEqual((await serverDoc()).settings.chequing, { bal: 500, asOf: '2026-11-14', bSource: 'manual' });
    await done(pg);
  });

  /* ---------- keyboard focus ---------- */
  await step('keyboard: ticking a bill keeps focus on its column; a delete puts focus on Undo, and Undo on the restored row', async () => {
    const pg = await freshPage({ viewport: LAPTOP, seed: SAMPLE });
    await synced(pg);
    const col = 'button.col-btn[data-key="b-netflix@2026-11-16"]';
    await pg.locator(col).focus();
    await pg.keyboard.press('Space');
    await undoSays('Ticked Netflix paid on time', pg);
    assert.equal(await pg.evaluate(c => document.activeElement.matches(c), col), true, 'focus stays on the Netflix column');
    await pg.keyboard.press('Enter');
    await undoSays('Unticked Netflix', pg);
    assert.equal(await pg.evaluate(c => document.activeElement.matches(c), col), true, 'and after unticking');

    await pg.locator('#tx [data-tx="t8"]').focus();
    await pg.keyboard.press('Enter');
    await sheet(pg).waitFor();
    await sheet(pg).getByRole('button', { name: 'Delete', exact: true }).focus();
    await pg.keyboard.press('Enter');
    await undoSays('Deleted Volleyball $74', pg);
    await sheetGone(pg);
    await pg.waitForFunction(() => document.activeElement?.id === 'undoBtn');
    await pg.keyboard.press('Enter');
    await undoSays('Undid "Deleted Volleyball $74"', pg);
    assert.equal(await pg.evaluate(() => document.activeElement?.getAttribute('data-tx')), 't8', 'focus is on the restored row');
    await done(pg);
  });

  await step('with the undo bar up, Tab never leaves a control under the floating buttons', async () => {
    const pg = await freshPage();
    await synced(pg);
    await pg.evaluate(() => window.__finance.act('Changed bill Spotify', d => { d.bills[4].note = 'x'; }));
    await pg.locator('#undo.is-shown').waitFor();
    await pg.locator('#bills .col-btn').first().focus();
    const hidden = [];
    for (let i = 0; i < 40; i++) {
      await pg.keyboard.press('Tab');
      const r = await pg.evaluate(() => {
        const a = document.activeElement, b = a.getBoundingClientRect();
        const e = document.elementFromPoint(b.left + b.width / 2, Math.min(b.top + b.height / 2, innerHeight - 1));
        return { own: !!a.closest('.fabs, #undo'), centre: !!(e && e.closest('.fabs, #undo')), shown: document.getElementById('undo').classList.contains('is-shown'),
          name: (a.getAttribute('aria-label') || a.textContent).replace(/\s+/g, ' ').trim().slice(0, 40) };
      });
      if (!r.shown) break;
      if (r.centre && !r.own) hidden.push(r.name);
    }
    assert.deepEqual(hidden, []);
    await done(pg);
  });

  /* ---------- look ---------- */
  await step('the bar legend swatches on sand sit on a paper ring that keeps 3:1', async () => {
    const c = await page.evaluate(() => [...document.querySelectorAll('#limits .legend .dot')].map(d => {
      const cs = getComputedStyle(d);
      return { dot: cs.backgroundColor, ring: (cs.boxShadow.match(/rgba?\([^)]*\)/) || [''])[0], paper: getComputedStyle(document.body).backgroundColor };
    }));
    assert.equal(c.length, 3);
    for (const x of c) {
      assert.equal(hexOf(x.ring), hexOf(x.paper), 'the ring is the paper colour');
      assert.ok(ratio(hexOf(x.dot), hexOf(x.ring)) >= 3, `${hexOf(x.dot)} on ${hexOf(x.ring)}: ${ratio(hexOf(x.dot), hexOf(x.ring)).toFixed(2)}:1`);
    }
  });

  await step('import: the word "reading" stays at full opacity (the drawing pulses instead)', async () => {
    const pg = await freshPage();
    await synced(pg);
    await pg.route('**/api/read', async route => { await sleep(1500); await route.continue(); });
    await pg.locator('#importInput').setInputFiles({ name: 'IMG_1.png', mimeType: 'image/png', buffer: PNG });
    await pg.locator('.imp-file.is-reading').waitFor();
    const s = await pg.evaluate(async () => {
      const el = document.querySelector('.imp-file.is-reading .imp-file-state');
      let min = 1;
      for (let i = 0; i < 40; i++) { min = Math.min(min, Number(getComputedStyle(el).opacity)); await new Promise(r => setTimeout(r, 16)); }
      return { min, word: getComputedStyle(el).animationName, art: getComputedStyle(document.querySelector('.imp-reading-art')).animationName };
    });
    assert.deepEqual(s, { min: 1, word: 'none', art: 'imp-pulse' });
    await sheet(pg).locator('.imp-review').waitFor({ timeout: 10000 });
    await done(pg);
  });

  await step('reduced motion: hovering the hero does not turn the owl; the count up stays between old and new', async () => {
    const pg = await freshPage({ reducedMotion: true, viewport: LAPTOP });
    await synced(pg);
    const owl = () => pg.evaluate(() => getComputedStyle(document.querySelector('.safe-more .owl')).transform);
    const rest = await owl();
    await pg.locator('#safeBtn').hover();
    await sleep(300);
    assert.equal(await owl(), rest);
    await pg.context().close();

    const cp = await freshPage({ open: false });
    await cp.context().addInitScript(() => {
      window.__frames = [];
      const tick = () => {
        const el = document.querySelector('.safe-num');
        if (el && el.textContent && window.__frames[window.__frames.length - 1] !== el.textContent) window.__frames.push(el.textContent);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await cp.goto(cp.base + '/?key=' + key + '&today=2026-11-14');
    await cp.waitForFunction(() => !document.getElementById('main').hidden);
    await synced(cp);
    await sleep(600);
    const num = t => Number(t.replace(/[^0-9.-]/g, ''));
    for (const amt of ['1000', '-1000', '1000', '-1000']) {
      await cp.evaluate(() => { window.__frames = [document.querySelector('.safe-num').textContent]; });
      await cp.locator('#fab').click();
      await sheet(cp).locator('input[name="amt"]').fill(amt);
      await sheet(cp).getByRole('button', { name: 'Save', exact: true }).click();
      await sleep(1000);
      const f = await cp.evaluate(() => window.__frames.slice());
      const lo = Math.min(num(f[0]), num(f.at(-1))), hi = Math.max(num(f[0]), num(f.at(-1)));
      assert.ok(f.every(x => num(x) >= lo && num(x) <= hi), `${f[0]} to ${f.at(-1)} showed ${f.join(', ')}`);
      assert.ok(f.every(x => !x.startsWith('-')), 'never a negative amount to spend');
    }
    await done(cp);
  });

  await step('the page draws once with every feature in place (hero, forecast, buttons), so nothing shifts in later', async () => {
    const pg = await freshPage({ open: false });
    await pg.context().addInitScript(() => {
      new MutationObserver((list, obs) => {
        const main = document.getElementById('main');
        if (!main || main.hidden) return;
        window.__firstShow = {
          safe: !!document.querySelector('#safe .safe'), forecast: !document.getElementById('forecast').hidden,
          cover: !!document.querySelector('#budget .cover-slot .cover-btn'), importBtn: !!document.getElementById('importFab'),
          historyBtn: !!document.getElementById('historyBtn'),
        };
        obs.disconnect();
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
    });
    await pg.goto(pg.base + '/?key=' + key + '&today=2026-11-14');
    await pg.waitForFunction(() => window.__firstShow);
    assert.deepEqual(await pg.evaluate(() => window.__firstShow), { safe: true, forecast: true, cover: true, importBtn: true, historyBtn: true });
    await done(pg);
  });

  /* ---------- money on screen ---------- */
  await step('forecast: a Visa due day between the balance date and today is taken out today, and listed for that day', async () => {
    const pg = await freshPage({ seed: 'tests/fixtures/forecast-sample.js' });
    await synced(pg);
    await pg.locator('#accounts [data-acc="a-visa"]').click();
    await sheet(pg).locator('input[name="due"]').fill('13');
    await sheet(pg).getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone(pg);
    await pg.waitForFunction(() => document.querySelector('.fc-key[data-key="today"] b')?.textContent === '-$588.04');
    const keys = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fc-key')].map(k => [k.dataset.key, k.querySelector('b').textContent])));
    assert.deepEqual(keys, { today: '-$588.04', 'before-pay': '-$806.38', 'month-end': '$151.73' });
    await pg.locator('#forecast [data-fc-days*="2026-11-14"]').click();
    await sheet(pg).waitFor();
    assert.ok((await sheet(pg).innerText()).includes('Visa payment'), 'the day sheet lists the Visa payment');
    await pg.keyboard.press('Escape');
    await sheetGone(pg);
    await done(pg);
  });

  await step('forecast: a Visa due date after the range shows its marker and a Change due day button', async () => {
    const pg = await freshPage({ seed: 'tests/fixtures/forecast-sample.js', today: '2026-11-25' });
    await synced(pg);
    await pg.locator('#forecast #fcUpdateCheq').click();
    await sheet(pg).locator('input[name="bal"]').fill('900');
    await sheet(pg).getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone(pg);
    await pg.locator('#forecast .fc-visa').waitFor();
    const owing = await pg.evaluate(() => window.__finance.lib.forecast.visaOwing(window.__finance.state));
    const amt = await pg.evaluate(n => window.__finance.lib.core.fmtShort(n), owing);
    assert.equal(clean(await pg.locator('#forecast .fc-visa p').textContent()), `Visa payment of ${amt} is due Dec 22, after this forecast.`);
    assert.equal(clean(await pg.locator('#fcVisaDue').textContent()), 'Change due day');
    await done(pg);
  });

  await step('jars: $10,000 of $10,043 reads 99%, never 100%', async () => {
    const pg = await freshPage({ seed: SAMPLE });
    await synced(pg);
    const id = await pg.evaluate(() => window.__finance.state.goals.find(g => /Automne 2026/.test(g.name)).id);
    await pg.evaluate(gid => window.__finance.act('Test setup: nearly full', d => { const g = d.goals.find(x => x.id === gid); g.saved = 10000; g.target = 10043; }), id);
    const jar = clean(await pg.locator(`#goals [data-goal="${id}"]`).innerText());
    assert.match(jar, /\$10,000 of \$10,043 · 99%/);
    await done(pg);
  });

  await step('raise: "Make it $470" on Groceries topped up $40, $60, $85 reads $485 this month (never $555), $470 next month', async () => {
    const pg = await freshPage({ seed: SAMPLE });
    await synced(pg);
    await pg.evaluate(() => window.__finance.act('Test setup: three top ups', d => {
      const { getMonth } = window.__finance.lib.core;
      const mv = (id, date, amt) => ({ id, date, from: 'i-cloth', to: 'i-groc', amt });
      getMonth(d, '2026-09').moves.push(mv('m9', '2026-09-20', 40));
      getMonth(d, '2026-10').moves.push(mv('m10', '2026-10-20', 60));
      getMonth(d, '2026-11').moves.push(mv('m11', '2026-11-10', 85));
    }, { undo: false }));
    const bar = () => pg.locator('.bar-hit[data-item="i-groc"] .amt').textContent().then(clean);
    assert.equal(await bar(), '$278.65 of $485');
    assert.equal(clean(await pg.locator('#budget .cover-slot[data-item="i-groc"] .cover-raise p').textContent()), 'Groceries topped up Sep, Oct and Nov. Make it $470?');
    await pg.locator('#raise-i-groc').click();
    await undoSays('Raised Groceries limit to $470', pg);
    assert.equal(await bar(), '$278.65 of $485');
    assert.equal(clean(await pg.locator('#budget .cover-slot[data-item="i-groc"] .cover-note').textContent()), '+$15 moved in');
    assert.equal(clean(await pg.locator('.bar-hit[data-item="i-cloth"] .amt').textContent()), '$0 of $135');
    await pg.locator('#next').click();
    await pg.waitForFunction(() => document.getElementById('monthLabel').textContent === 'December 2026');
    assert.equal(await bar(), '$0 of $470');
    await done(pg);
  });

  await shot('end');
}
