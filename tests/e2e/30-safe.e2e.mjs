// Safe to spend today (Stage 3) at 390x844. The SPEC 5.3 acceptance checks, on the page:
//   1. sample-nov on Nov 14 (pay $1,300 on Nov 6, $647 spent, $163.96 of bills Nov 6 to 19): "$81 today · payday in 6 days",
//      "Nov 20 (estimate)".
//   2. The same day after expenses added through the + Expense form bring spending since Nov 6 to $1,200:
//      "$0 today · payday in 6 days" (pool -$63.96, never shown as a negative number).
//   3. A second server seeded with sample-period3: "$49 today" on Nov 30 (4 days) and "$65 today" on Dec 1 (3 days),
//      pool $196.90 on both days.
// Also: the sum sheet in plain words from result.parts, the count only when the value changes (never on a plain
// render, never under reduced motion), the month switcher leaves it alone, a payday that came and is not logged,
// no paycheque at all (the original defaults, as his real data starts) with Log paycheque, escaping of hostile bill
// names, the first week story, focus, tap targets, no dashes, the text column left of the temple, dark mode.

const P3 = 'tests/fixtures/sample-period3.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();

export default async function ({ page, base, shot, step, assert, freshPage, open, waitSynced, key }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  const heroText = (pg = page) => pg.locator('#safe').innerText().then(norm);
  const sheet = (pg = page) => pg.locator('dialog.sheet[open]');
  const sheetGone = (pg = page) => pg.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const sheetText = async (pg = page) => norm(await sheet(pg).innerText());
  const sheetTitle = async (pg = page) => norm(await sheet(pg).locator('.sheet-head h2').textContent());
  const closeSheet = async (pg = page) => { await pg.keyboard.press('Escape'); await sheetGone(pg); };
  const activeId = (pg = page) => pg.evaluate(() => document.activeElement && document.activeElement.id);
  // safeToSpend as the page computes it (today = the page's today).
  const lib = (pg = page) => pg.evaluate(() => {
    const f = window.__finance;
    return JSON.parse(JSON.stringify(f.lib.money.safeToSpend(f.state, f.today())));
  });
  const money = (pg, v) => pg.evaluate(n => window.__finance.lib.core.fmtShort(n), v);
  // Waits until the hero number shows `want` (the count has landed).
  const numIs = async (pg, want, timeout = 6000) => {
    await pg.waitForFunction(w => document.querySelector('#safe .safe-num')?.textContent === w, want, { timeout })
      .catch(async () => {
        const now = await pg.locator('#safe .safe-num').textContent({ timeout: 500 }).catch(() => 'no number');
        throw new Error(`the safe to spend number should be ${want}, it is ${now}`);
      });
  };
  // Records every text the number shows from now on.
  const watchNumber = (pg = page) => pg.evaluate(() => {
    const el = document.querySelector('#safe .safe-num');
    if (window.__safeObs) window.__safeObs.disconnect();
    window.__safeSeen = [];
    window.__safeObs = new MutationObserver(() => window.__safeSeen.push(el.textContent));
    window.__safeObs.observe(el, { childList: true, characterData: true, subtree: true });
  });
  const seenNumbers = (pg = page) => pg.evaluate(() => window.__safeSeen.slice());
  const undoSays = async (want, pg = page) => {
    await pg.waitForFunction(w => document.getElementById('undo').classList.contains('is-shown')
      && (document.getElementById('undoText')?.textContent || '').trim() === w, want, { timeout: 5000 })
      .catch(async () => { throw new Error(`Undo bar should say "${want}", it says "${await pg.locator('#undoText').textContent()}"`); });
  };
  // Waits until this device has nothing waiting to be saved and the status says Synced.
  const waitSaved = (pg = page) => pg.waitForFunction(() => !localStorage.getItem('finance-pending')
    && /^Synced/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 15000 });
  // The undo bar pauses while the pointer is over it: move the pointer away and wait for the bar to go.
  const undoGone = async (pg = page) => {
    await pg.mouse.move(100, 120);
    await pg.waitForFunction(() => !document.getElementById('undo').classList.contains('is-shown'), null, { timeout: 12000 });
    await sleep(300);
  };
  const addExpense = async (amt, note, pg = page) => {
    await pg.locator('#fab').click();
    await sheet(pg).waitFor();
    await sheet(pg).locator('input[name="amt"]').fill(String(amt));
    await sheet(pg).locator('input[name="note"]').fill(note);
    await sheet(pg).getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone(pg);
  };
  // Text of the hero that runs into the engraved temple (the first engraved line is at x 10 of its 200 wide drawing).
  const intoTemple = (pg = page) => pg.evaluate(() => {
    const t = document.querySelector('#temple svg').getBoundingClientRect();
    const edge = t.left + t.width * 10 / 200;
    const out = [];
    for (const el of document.querySelectorAll('#safe .hero-caps, #safe .safe-num, #safe .safe-when, #safe .safe-date, #safe .safe-more, #safe .safe-missed p, #safe .safe-ask, #safe .safe-ask-sub, #safe .safe-log')) {
      if (!el.getClientRects().length) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width && r.right > edge + 0.5 && r.top < t.bottom) out.push(`${el.className} ends at ${Math.round(r.right)}, the temple starts at ${Math.round(edge)}`);
    }
    return out;
  });
  // Buttons inside `sel` smaller than 44x44.
  const smallTargets = (pg, sel) => pg.evaluate(s => [...document.querySelectorAll(`${s} button, ${s} a[href]`)]
    .filter(el => el.getClientRects().length && !el.closest('[hidden]'))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => Math.round(r.width) < 44 || Math.round(r.height) < 44)
    .map(({ el, r }) => `${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`), sel);
  // Dashes in visible text and labels under `sel` (his own data marked data-user, and minus amounts, excepted).
  const dashes = (pg, sel) => pg.evaluate(s => {
    const DASH = /[‐-―−]|\s-\s|[A-Za-z]-[A-Za-z]|(^|\s)-(?!\$)/;
    const bad = [];
    for (const root of document.querySelectorAll(s)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!el || el.closest('[data-user], [hidden]') || !el.getClientRects().length) continue;
        const t = walker.currentNode.textContent.replace(/-\$[\d,.]+/g, '').trim();
        if (t && DASH.test(t)) bad.push(t);
      }
      for (const el of root.querySelectorAll('[aria-label], [title], [placeholder]')) {
        for (const a of ['aria-label', 'title', 'placeholder']) {
          const v = el.getAttribute(a);
          if (v && DASH.test(v.replace(/-\$[\d,.]+/g, ''))) bad.push(`${a}: ${v}`);
        }
      }
    }
    return bad;
  }, sel);

  /* ---------- check 1: Nov 14 on the sample ---------- */
  await step('SPEC 5.3 check 1: Nov 14 shows $81 today · payday in 6 days · Nov 20 (estimate), with the owl coin', async () => {
    await open();
    await waitSynced();
    await numIs(page, '$81');
    const r = await lib();
    assert.equal(r.perDay, 81);
    assert.equal(r.pool, 489.04);
    assert.equal(r.days, 6);
    assert.deepEqual(r.period, { start: '2026-11-06', end: '2026-11-19' });
    assert.equal(r.nextPay.date, '2026-11-20');
    assert.equal(r.nextPay.estimate, true);
    const t = await heroText();
    assert.match(t, /^SAFE TO SPEND TODAY \$81 today · payday in 6 days Nov 20 \(estimate\) See how it adds up/i, t);
    assert.ok(t.includes('$81 today'), t);
    assert.match(t, /payday in 6 days/i);
    assert.match(t, /estimate/);
    assert.equal(await page.locator('#safe svg.owl').count(), 1, 'the owl coin');
    const font = await page.locator('#safe .safe-num').evaluate(el => {
      const cs = getComputedStyle(el);
      return { family: cs.fontFamily, size: cs.fontSize };
    });
    assert.match(font.family, /Bodoni Moda/);
    assert.equal(font.size, '96px');
    assert.deepEqual(await intoTemple(), [], 'no text runs into the temple at 390 px');
    assert.equal(await page.getByRole('button', { name: /^Safe to spend today \$81 today · payday in 6 days/i }).count(), 1, 'the button is named by the label and the number');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('81');
  });

  await step('a render that leaves the number the same moves nothing', async () => {
    await watchNumber();
    await page.evaluate(() => { window.__finance.render(); window.__finance.render(); });
    await sleep(600);
    assert.deepEqual(await seenNumbers(), []);
  });

  await step('tap opens the sum in plain words: pays, spending, each bill with its date and paid or not, older bills, left, divided by days, rounded down', async () => {
    await page.locator('#safeBtn').click();
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Safe to spend today');
    const s = await sheetText();
    for (const want of [
      '$81 today · payday in 6 days',
      'This pay period runs from your last payday, Nov 6, to Nov 19, the day before the next one.',
      'Next payday Nov 20 (estimate, 14 days after the last one).',
      'PAYS THIS PERIOD $1,300.00', 'Bobino pay Nov 6 $1,300.00',
      'SPENDING THIS PERIOD $647.00', 'Every purchase dated Nov 6 to Nov 19, on the Visa or from chequing.',
      'BILLS THIS PERIOD $163.96', 'Paid or not, every bill due Nov 6 to Nov 19 comes out of this pay.',
      'Spotify Nov 6 · paid $14.44', 'Gym (ABC) Nov 12 · paid $31.58',
      'Netflix Nov 16 · not paid yet $27.11', 'Phone + Crave/Disney (Bell) Nov 18 · not paid yet $90.83',
      'OLDER BILLS NOT PAID $0.00', 'Nothing unpaid from the weeks before this pay period.',
      'LEFT FOR THIS PAY PERIOD $489.04', '$1,300.00 in, less $647.00 spent and $163.96 in bills.',
      'DAYS LEFT 6 days', 'Today to Nov 19. $489.04 divided by 6 days, rounded down to whole dollars.',
      'SAFE TO SPEND TODAY $81',
    ]) assert.ok(s.includes(want), `the sheet should say "${want}"\n  it says: ${s}`);
    // Ionic columns: filled for the two paid bills, outline for the two unpaid ones.
    assert.equal(await sheet().locator('.sb-list .column.is-paid').count(), 2);
    assert.equal(await sheet().locator('.sb-list .column:not(.is-paid)').count(), 2);
    assert.deepEqual(await dashes(page, 'dialog.sheet[open]'), []);
    assert.deepEqual(await smallTargets(page, 'dialog.sheet[open]'), []);
    await shot('breakdown');
    await closeSheet();
    assert.equal(await activeId(), 'safeBtn', 'focus goes back to the number');
  });

  await step('keyboard: Tab reaches the number with a visible focus ring, Enter opens the sum, Escape comes back', async () => {
    await page.locator('#next').focus();
    await page.keyboard.press('Tab');
    assert.equal(await activeId(), 'safeBtn');
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      return { style: cs.outlineStyle, width: cs.outlineWidth, visible: document.activeElement.matches(':focus-visible') };
    });
    assert.ok(ring.visible && ring.style !== 'none' && ring.width !== '0px', JSON.stringify(ring));
    await page.keyboard.press('Enter');
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Safe to spend today');
    await closeSheet();
    assert.equal(await activeId(), 'safeBtn');
  });

  await step('it always uses today: October shows the same number, and nothing moves', async () => {
    await watchNumber();
    await page.locator('#prev').click();
    await page.waitForFunction(() => document.getElementById('monthLabel').textContent === 'October 2026');
    assert.ok((await heroText()).includes('$81 today · payday in 6 days'));
    await page.locator('#next').click();
    await page.waitForFunction(() => document.getElementById('monthLabel').textContent === 'November 2026');
    await sleep(500);
    assert.deepEqual(await seenNumbers(), []);
  });

  await step('the one line story shows in the first week on this device only', async () => {
    assert.ok((await heroText()).includes('Athenians called their coins owls.'), 'shown on the first day');
    const pg = await freshPage({ open: false });
    await pg.addInitScript(() => { try { localStorage.setItem('finance-first-seen', '2026-10-01'); } catch { /* blocked */ } });
    await pg.goto(base + '/?key=' + key + '&today=2026-11-14');
    await waitSynced(pg);
    await numIs(pg, '$81');
    assert.equal(await pg.locator('#safe .safe-story').isVisible(), false, 'hidden after the first week');
    assert.ok(!(await heroText(pg)).includes('Athenians'));
  });

  await step('tap targets, no dashes, and every word left of the temple at 320 px; no sideways scroll', async () => {
    assert.deepEqual(await smallTargets(page, '#safe'), []);
    assert.deepEqual(await dashes(page, '#safe'), []);
    const pg = await freshPage({ viewport: { width: 320, height: 700 } });
    await waitSynced(pg);
    await numIs(pg, '$81');
    assert.deepEqual(await intoTemple(pg), [], 'no text runs into the temple at 320 px');
    assert.ok(await pg.evaluate(() => document.scrollingElement.scrollWidth <= 320), 'no sideways scroll');
    assert.deepEqual(await smallTargets(pg, '#safe'), []);
    await shot('320', { page: pg });
  });

  await step('dark mode: the number in light ink on deep blue', async () => {
    const pg = await freshPage({ dark: true });
    await waitSynced(pg);
    await numIs(pg, '$81');
    const color = await pg.locator('#safe .safe-num').evaluate(el => getComputedStyle(el).color);
    assert.equal(color, 'rgb(233, 228, 210)');
    await shot('dark', { page: pg });
  });

  /* ---------- a payday that came and was not logged (read only, same data) ---------- */
  await step('Nov 27 with no Nov 20 pay logged: says so, and Log paycheque opens the pay form from the hero and from the sum', async () => {
    const pg = await freshPage({ today: '2026-11-27' });
    await waitSynced(pg);
    const r = await lib(pg);
    assert.equal(r.period.start, '2026-11-06');
    assert.equal(r.nextPay.date, '2026-12-04');
    assert.equal(r.nextPay.estimate, true);
    assert.equal(r.days, 7);
    await numIs(pg, await money(pg, r.perDay));
    const t = await heroText(pg);
    assert.ok(t.includes(`${await money(pg, r.perDay)} today · payday in 7 days`), t);
    assert.ok(t.includes('Dec 4 (estimate)'), t);
    assert.ok(t.includes('Payday Nov 20 is not logged yet.'), t);
    assert.deepEqual(await smallTargets(pg, '#safe'), []);
    await pg.evaluate(() => window.scrollTo(0, 0));
    await shot('missed', { page: pg });

    await pg.locator('#safeMissedPay').click();
    await sheet(pg).waitFor();
    assert.equal(await sheetTitle(pg), 'Log paycheque');
    await closeSheet(pg);

    await pg.locator('#safeBtn').click();
    await sheet(pg).waitFor();
    const s = await sheetText(pg);
    assert.ok(s.includes('Payday Nov 20 is not logged yet, so this still counts from Nov 6. Log it to start the new pay period.'), s);
    await sheet(pg).getByRole('button', { name: 'Log paycheque', exact: true }).click();
    await pg.waitForFunction(() => {
      const open = document.querySelectorAll('dialog.sheet[open]');
      return open.length === 1 && open[0].querySelector('.sheet-head h2').textContent === 'Log paycheque';
    });
    await closeSheet(pg);
    assert.equal(await activeId(pg), 'safeBtn', 'focus comes back to the number');
  });

  /* ---------- check 2: spending since Nov 6 reaches $1,200 through the form ---------- */
  await step('SPEC 5.3 check 2: expenses added through the form bring spending since Nov 6 to $1,200: $0 today · payday in 6 days', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await watchNumber();
    await addExpense(300, 'Safe test one');
    await undoSays('Added Safe test one $300');
    // (1300 - 947 - 163.96) / 6 = 31.50
    await numIs(page, '$31');
    const counted = await seenNumbers();
    assert.equal(counted.at(-1), '$31');
    const values = counted.map(v => Number(v.replace(/[$,]/g, '')));
    assert.ok(values.some(v => v > 31 && v < 81), `the number counts down through the values between: ${counted.join(' ')}`);
    assert.ok(values.every((v, i) => i === 0 || v <= values[i - 1]), `it only goes one way: ${counted.join(' ')}`);

    await addExpense(253, 'Safe test two');
    await undoSays('Added Safe test two $253');
    await numIs(page, '$0');
    const r = await lib();
    assert.equal(r.parts.spending, 1200);
    assert.equal(r.pool, -63.96);
    assert.equal(r.perDay, 0);
    assert.equal(r.days, 6);
    const t = await heroText();
    assert.ok(t.includes('$0 today · payday in 6 days'), t);
    assert.ok(!/-\s*\$|\$\s*-/.test(t), 'never a negative amount in the hero');
    await undoGone(); // a clean picture
    await shot('zero');

    await page.locator('#safeBtn').click();
    await sheet().waitFor();
    const s = await sheetText();
    for (const want of ['$0 today · payday in 6 days', 'SPENDING THIS PERIOD $1,200.00', 'LEFT FOR THIS PAY PERIOD -$63.96',
      '$1,300.00 in, less $1,200.00 spent and $163.96 in bills.', 'Below zero, so nothing is safe to spend until payday.', 'SAFE TO SPEND TODAY $0']) {
      assert.ok(s.includes(want), `the sheet should say "${want}"\n  it says: ${s}`);
    }
    await closeSheet();
  });

  await step('a hostile bill name stays plain text in the sum', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">Gym & "Co"';
    await page.locator('#addBill').click();
    await sheet().waitFor();
    await sheet().locator('input[name="name"]').fill(evil);
    await sheet().locator('input[name="amt"]').fill('10');
    await sheet().locator('input[name="day"]').fill('15');
    await sheet().getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#safeBtn').click();
    await sheet().waitFor();
    assert.equal(await sheet().locator('img').count(), 0);
    assert.ok((await sheetText()).includes(evil + ' Nov 15 · not paid yet $10.00'));
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await closeSheet();
  });

  /* ---------- no paycheque at all: his real data starts here ---------- */
  await step('no paycheque yet (the original defaults): an inviting ask, and Log paycheque opens the pay form; once logged the number counts up', async () => {
    const doc = await page.evaluate(() => window.__finance.lib.migrate.defaults());
    assert.deepEqual(doc.months, {}, 'the defaults hold no pays');
    await page.setInputFiles('#importFile', { name: 'finance-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    await page.locator('#safe .safe[data-mode="missing"]').waitFor();
    assert.deepEqual(await lib(), { missing: 'pay' });
    const t = await heroText();
    assert.ok(t.includes('Log your last paycheque to see what is safe to spend'), t);
    assert.ok(!/\$/.test(t), 'no amount while there is no pay');
    assert.equal(await page.locator('#safe svg.owl').count(), 1);
    assert.deepEqual(await smallTargets(page, '#safe'), []);
    assert.deepEqual(await dashes(page, '#safe'), []);
    assert.deepEqual(await intoTemple(), []);
    await undoGone();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('no-pay');

    await page.locator('#safeLogPay').click();
    await sheet().waitFor();
    assert.equal(await sheetTitle(), 'Log paycheque');
    assert.equal(await sheet().locator('input[name="date"]').inputValue(), '2026-11-14');
    await sheet().locator('input[name="amt"]').fill('1300');
    await sheet().getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone();
    await undoSays('Logged pay $1,300');
    const r = await lib();
    assert.ok(!r.missing);
    assert.equal(r.days, 14);
    assert.equal(r.nextPay.date, '2026-11-28');
    await numIs(page, await money(page, r.perDay));
    const after = await heroText();
    assert.ok(after.includes(`${await money(page, r.perDay)} today · payday in 14 days`), after);
    assert.ok(after.includes('Nov 28 (estimate)'), after);
    // Saved before the next step starts a second server (the in memory store is shared by the whole process).
    await waitSaved();
  });

  /* ---------- check 3: the period3 sample on a second server ---------- */
  let p3 = null;
  await step('SPEC 5.3 check 3: sample-period3 shows $49 today on Nov 30 and $65 today on Dec 1 (pool $196.90 both days)', async () => {
    p3 = await freshPage({ seed: P3, today: '2026-11-30' });
    await waitSynced(p3);
    await numIs(p3, '$49');
    let r = await lib(p3);
    assert.deepEqual([r.perDay, r.pool, r.days], [49, 196.9, 4]);
    assert.deepEqual(r.period, { start: '2026-11-20', end: '2026-12-03' });
    assert.equal(r.parts.billsTotal, 803.1);
    let t = await heroText(p3);
    assert.ok(t.includes('$49 today · payday in 4 days'), t);
    assert.ok(t.includes('Dec 4 (estimate)'), t);

    await p3.goto(p3.base + '/?key=' + key + '&today=2026-12-01');
    await waitSynced(p3);
    await numIs(p3, '$65');
    r = await lib(p3);
    assert.deepEqual([r.perDay, r.pool, r.days], [65, 196.9, 3]);
    t = await heroText(p3);
    assert.ok(t.includes('$65 today · payday in 3 days'), t);
    await shot('period3', { page: p3 });
  });

  await step('reduced motion at 320 px: the number changes at once with no count, and a long amount still fits left of the temple', async () => {
    assert.ok(p3, 'needs the period3 server');
    const pg = await freshPage({ reducedMotion: true, open: false, viewport: { width: 320, height: 700 } });
    await pg.goto(p3.base + '/?key=' + key + '&today=2026-12-01');
    await waitSynced(pg);
    await numIs(pg, '$65');
    await watchNumber(pg);
    await addExpense(30, 'Safe test calm', pg);
    // (196.90 - 30) / 3 = 55.63
    await numIs(pg, '$55');
    await sleep(500);
    assert.deepEqual(await seenNumbers(pg), ['$55']);
    // A refund of $3,000 (a negative expense): (166.90 + 3000) / 3 = 1055.63
    await addExpense(-3000, 'Safe test refund', pg);
    await numIs(pg, '$1,055');
    assert.deepEqual(await seenNumbers(pg), ['$55', '$1,055']);
    assert.deepEqual(await intoTemple(pg), [], 'a long amount stays left of the temple at 320 px');
    await pg.evaluate(() => window.scrollTo(0, 0));
    await shot('long-320', { page: pg });
    await waitSaved(pg);
  });

  await step('no confirm or alert anywhere', async () => {
    assert.deepEqual(dialogs, []);
  });
}
