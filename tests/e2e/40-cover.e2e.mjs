// Cover it and raise (Stage 4) at 390x844 on the Nov 14 sample (tests/fixtures/sample-nov.js).
//
// Hand calculated from the fixture (docs/SPEC.md 5.4):
//   Limits: Food 400 + 150 + 50 + 50 + 50 + 0 = 700, Pets 30 + 15 + 10 + 0 = 55, Transport 60,
//   Personal 150 + 50 + 200 + 0 + 104 + 25 + 0 = 529. totalLimits = 1,344.
//   Already orange: Cat food 28 of 30 (93%) and Gas 58 of 60 (97%). Groceries 278.65 of 400 (70%) is green.
//   Two expenses ($100 Costco, $50 Metro) push Groceries to 428.65 of 400: red. needed = 28.65 rounded up to
//   the next $5 = $30. The source with the most room is Clothing and shoes (150 room, 0 spent; under 75% it can
//   give floor(150 x 0.75) = 112), so: Move $30 from Clothing and shoes to Groceries, "This covers it".
//   After: Groceries 428.65 of 430 (99.7%, orange, no longer red), Clothing and shoes 0 of 120. Total still 1,344.
//   Raise: with moves to Groceries of $90 in Sep and $120 in Oct, plus this $30 in Nov:
//   400 + (90 + 120 + 30) / 3 = 480, already a whole $10: "Make it $480".
//   Partial: $1,500 more on Groceries (1,928.65 of 430 after the move) needs 1,498.65, so $1,500. Under 75% no
//   three sources reach it, nor with their full room: the three roomiest give their full room,
//   Clothing and shoes $120, Eating out $85 (85.20 floored), Dates with Kylie $80 = $285. "This covers $285 of $1,500".

const BOOKKEEPING = ['savedAt', 'note', 'baseSavedAt'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOVE = 'Moved $30 Clothing and shoes → Groceries';

export default async function ({ page, base, shot, step, assert, freshPage, open, waitSynced, key }) {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });

  const sheet = (pg = page) => pg.locator('dialog.sheet[open]');
  const sheetGone = (pg = page) => pg.waitForFunction(() => !document.querySelector('dialog.sheet'));
  const slot = (id, pg = page) => pg.locator(`#budget .cover-slot[data-item="${id}"]`);
  const coverBtn = (id, pg = page) => slot(id, pg).locator('.cover-btn');
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const undoText = () => page.locator('#undoText').textContent().then(clean);
  const undoSays = async want => {
    await page.waitForFunction(w => {
      const bar = document.getElementById('undo');
      return bar.classList.contains('is-shown') && (document.getElementById('undoText')?.textContent || '').trim() === w;
    }, want, { timeout: 5000 }).catch(async () => { throw new Error(`Undo bar should say "${want}", it says "${await undoText()}"`); });
  };
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__finance.state)));
  const canon = () => page.evaluate(b => window.__finance.lib.core.canonical(window.__finance.state, b), BOOKKEEPING);
  // lib/budget.js in the page, on the page's own state.
  const total = () => page.evaluate(() => window.__finance.lib.budget.totalLimits(window.__finance.state, '2026-11'));
  const barOf = (id, month = '2026-11') => page.evaluate(([i, m]) =>
    window.__finance.lib.budget.bars(window.__finance.state, m).flatMap(g => g.items).find(x => x.id === i), [id, month]);
  const allBars = () => page.evaluate(() => window.__finance.lib.budget.bars(window.__finance.state, '2026-11').flatMap(g => g.items));
  const serverGet = async (query = '') => (await fetch(base + '/api/data' + query, { headers: { 'x-app-key': key } })).json();
  // Nothing pending on this device, status Synced, and the newest save on the server has this note.
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
  // Puts a limit row near the top of the viewport (above the floating buttons) for screenshots.
  const showRow = (id, pg = page) => pg.evaluate(i => {
    const row = document.querySelector(`#budget .cover-slot[data-item="${i}"]`).closest('.bar-row');
    window.scrollTo(0, row.getBoundingClientRect().top + window.scrollY - 150);
  }, id);
  const addGroceries = async (amt, note) => {
    await page.locator('#fab').click();
    await sheet().waitFor();
    await sheet().locator('input[name="amt"]').fill(String(amt));
    await sheet().locator('select[name="item"]').selectOption('i-groc');
    await sheet().locator('input[name="note"]').fill(note);
    await sheet().getByRole('button', { name: 'Save', exact: true }).click();
    await sheetGone();
    await undoSays(`Added ${note} $${amt.toLocaleString('en-CA')}`);
  };
  const openCover = async (id, pg = page) => {
    await coverBtn(id, pg).click();
    await sheet(pg).waitFor();
    await sheet(pg).locator('.cover-result').waitFor();
  };
  const sheetLines = (pg = page) => sheet(pg).locator('.cover-line').allTextContents().then(l => l.map(clean));
  // Visible text with his data (data-user) left out: no dash or hyphen of any kind.
  const noDashes = (sel, pg = page) => pg.evaluate(s => {
    const bad = [];
    for (const el of document.querySelectorAll(s)) {
      const c = el.cloneNode(true);
      for (const u of c.querySelectorAll('[data-user]')) u.remove();
      const t = c.textContent.replace(/\s+/g, ' ');
      if (/[-‐-―−]/.test(t)) bad.push(t.trim());
      for (const a of c.querySelectorAll('[aria-label]')) if (/[-‐-―−]/.test(a.getAttribute('aria-label'))) bad.push(a.getAttribute('aria-label'));
    }
    return bad;
  }, sel);
  const smallTargets = (sel, pg = page) => pg.evaluate(s => [...document.querySelectorAll(s)]
    .map(el => ({ t: el.textContent.trim().slice(0, 40), r: el.getBoundingClientRect() }))
    .filter(x => x.r.width > 0 && (x.r.width < 44 || x.r.height < 44))
    .map(x => `${x.t} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`), sel);
  // Test setup through the app's own act (no undo bar). src is the body of a function of (s, core).
  const act = (lbl, src) => page.evaluate(([l, body]) => {
    const f = window.__finance;
    const fn = new Function('s', 'core', body); // eslint-disable-line no-new-func
    f.act(l, s => fn(s, f.lib.core), { undo: false });
  }, [lbl, src]);

  await step('opens on the Nov 14 sample and syncs', async () => {
    await open();
    await waitSynced();
    assert.equal(await total(), 1344, 'hand sum of the limits');
  });

  await step('Cover it shows exactly on the orange and red items of the month (Cat food and Gas), never on green', async () => {
    assert.equal(clean(await coverBtn('i-catfood').textContent()), 'Cover it · move room from Clothing and shoes to Cat food');
    assert.equal(clean(await coverBtn('i-gas').textContent()), 'Cover it · move room from Clothing and shoes to Gas');
    assert.equal(await coverBtn('i-catfood').locator('.sr-only').count(), 1, 'the item name is for screen readers only');
    assert.equal(await coverBtn('i-groc').count(), 0, 'Groceries is green (70%)');
    assert.equal(clean(await slot('i-groc').textContent()), '', 'nothing moved yet');
    // Every slot agrees with lib/budget.js: a button exactly when the bar is orange or red and there is room somewhere.
    const want = await page.evaluate(() => {
      const f = window.__finance, s = f.state;
      return f.lib.budget.bars(s, '2026-11').flatMap(g => g.items)
        .filter(i => (i.cls === 'orange' || i.cls === 'red') && f.lib.budget.coverSuggestion(s, '2026-11', i.id)?.from.length)
        .map(i => i.id).sort();
    });
    const got = await page.evaluate(() => [...document.querySelectorAll('#budget .cover-btn')].map(b => b.dataset.cover).sort());
    assert.deepEqual(got, want);
    assert.deepEqual(got, ['i-catfood', 'i-gas']);
  });

  await step('two expenses push Groceries past its limit: red, and Cover it names Clothing and shoes', async () => {
    await addGroceries(100, 'Costco');
    await addGroceries(50, 'Metro');
    const g = await barOf('i-groc');
    assert.equal(g.spent, 428.65);
    assert.equal(g.cls, 'red');
    assert.match(await page.locator('.bar-hit[data-item="i-groc"] .fill').getAttribute('class'), /\bred\b/);
    assert.equal(clean(await coverBtn('i-groc').locator('span').first().textContent()), 'Cover it · move room from Clothing and shoes');
    const sug = await page.evaluate(() => window.__finance.lib.budget.coverSuggestion(window.__finance.state, '2026-11', 'i-groc'));
    assert.deepEqual(sug, { to: 'i-groc', needed: 30, from: [{ itemId: 'i-cloth', amt: 30 }], total: 30, partial: false });
    const box = await coverBtn('i-groc').boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, `Cover it is ${box.width}x${box.height}`);
    await showRow('i-groc');
    await shot('button');
  });

  let beforeMove = null;
  await step('the sheet: two amphorae pouring, the move in plain words, "This covers it", the month after', async () => {
    beforeMove = await canon();
    await openCover('i-groc');
    assert.equal(clean(await sheet().locator('h2').textContent()), 'Cover Groceries');
    assert.deepEqual(await sheetLines(), ['Move $30 from Clothing and shoes to Groceries']);
    assert.deepEqual((await sheet().locator('.cover-left').allTextContents()).map(clean), ['Clothing and shoes after: $0 of $120']);
    assert.equal(clean(await sheet().locator('.cover-result').textContent()), 'This covers it');
    assert.equal(clean(await sheet().locator('.cover-after .nm').textContent()), 'Groceries after');
    assert.equal(clean(await sheet().locator('.cover-after .amt').textContent()), '$428.65 of $430');
    assert.match(await sheet().locator('.cover-after .fill').getAttribute('class'), /\borange\b/);
    assert.equal(clean(await sheet().locator('.cover-month').textContent()), 'Room moves for November 2026 only. Your limits still add up to $1,344.');
    // The pour: two amphorae, drawn aria-hidden, the source tips and the ink moves (transform and opacity only).
    const art = sheet().locator('.cover-art svg.pour');
    assert.equal(await art.getAttribute('aria-hidden'), 'true');
    assert.equal(await art.locator('clipPath').count(), 2, 'two amphorae');
    const anim = await page.evaluate(() => ['.pour-tilt', '.pour-stream', '.pour-src-ink', '.pour-dst-ink']
      .map(s => getComputedStyle(document.querySelector('dialog.sheet[open] ' + s)).animationName));
    assert.deepEqual(anim, ['cover-tilt', 'cover-show', 'cover-lower', 'cover-rise']);
    assert.ok(await page.evaluate(() => document.querySelector('dialog.sheet[open]').contains(document.activeElement)), 'focus is in the sheet');
    assert.equal(await sheet().locator('.cover-raise').count(), 0, 'no raise yet: Groceries got no room in Sep or Oct');
    assert.deepEqual(await noDashes('dialog.sheet[open]'), []);
    assert.deepEqual(await smallTargets('dialog.sheet[open] button'), []);
    assert.equal(await canon(), beforeMove, 'opening the sheet changes nothing');
    await sleep(600);
    await shot('sheet');
  });

  await step('Escape closes it with no change and focus goes back to Cover it', async () => {
    await page.keyboard.press('Escape');
    await sheetGone();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'cover-i-groc');
    assert.equal(await canon(), beforeMove);
  });

  await step('Move it: one move, totalLimits unchanged, Groceries no longer red, no limit below its spent', async () => {
    await openCover('i-groc');
    await sheet().getByRole('button', { name: 'Move it', exact: true }).click();
    await sheetGone();
    await undoSays(MOVE);
    const s = await state();
    const moves = s.months['2026-11'].moves;
    assert.equal(moves.length, 1);
    const { id, ...mv } = moves[0];
    assert.ok(id, 'the move has an id');
    assert.deepEqual(mv, { date: '2026-11-14', from: 'i-cloth', to: 'i-groc', amt: 30 });
    assert.equal(await total(), 1344, 'totalLimits is the same before and after');
    const g = await barOf('i-groc');
    assert.equal(g.limit, 430);
    assert.equal(g.baseLimit, 400, 'the base limit is untouched');
    assert.notEqual(g.cls, 'red');
    assert.doesNotMatch(await page.locator('.bar-hit[data-item="i-groc"] .fill').getAttribute('class'), /\bred\b/);
    for (const b of await allBars()) {
      if (b.limit > 0 || b.baseLimit > 0) assert.ok(b.limit >= b.spent, `${b.name}: limit ${b.limit} is below spent ${b.spent}`);
    }
    const c = await barOf('i-cloth');
    assert.equal(c.limit, 120);
    assert.equal(clean(await page.locator('.bar-hit[data-item="i-cloth"] .amt').textContent()), '$0 of $120', 'a source keeps "of", never "no limit"');
    assert.equal(clean(await page.locator('.bar-hit[data-item="i-groc"] .amt').textContent()), '$428.65 of $430');
    assert.equal(clean(await slot('i-groc').locator('.cover-note').textContent()), '+$30 moved in');
    assert.equal(clean(await slot('i-cloth').locator('.cover-note').textContent()), '$30 moved out');
    assert.equal(await page.locator('#budget .cover-note').count(), 2, 'notes only where moves changed a limit');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'cover-i-groc', 'focus stays on the row (Groceries is orange, so Cover it is still there)');
    await showRow('i-groc');
    await shot('done');
    await page.locator('#undoBtn').focus(); // pauses the undo bar's timer while the save lands
  });

  await step('the move is saved with its own note in the history', async () => {
    await waitSaved(MOVE);
    const doc = await serverGet();
    assert.equal(doc.months['2026-11'].moves.length, 1);
    assert.equal(doc.months['2026-11'].moves[0].amt, 30);
  });

  await step('Undo removes the move: Groceries red again, no notes, total still 1,344', async () => {
    await page.locator('#undoBtn').click();
    await undoSays(`Undid "${MOVE}"`);
    const s = await state();
    assert.deepEqual(s.months['2026-11'].moves, []);
    assert.equal((await barOf('i-groc')).cls, 'red');
    assert.equal((await barOf('i-cloth')).limit, 150);
    assert.equal(await total(), 1344);
    assert.equal(await page.locator('#budget .cover-note').count(), 0);
    assert.equal(await canon(), beforeMove, 'exactly the state before the move');
  });

  await step('History lists the move and its undo', async () => {
    await waitSaved(`Undid "${MOVE}"`);
    const notes = (await serverGet('?history=1')).versions.map(v => v.note);
    assert.ok(notes.includes(MOVE), 'server notes: ' + notes.join(' | '));
    if (await page.locator('#historyBtn').count()) {
      await page.locator('#historyBtn').click();
      await sheet().locator('.hist-list').waitFor();
      const shown = (await sheet().locator('.hist-note').allTextContents()).map(clean);
      assert.equal(shown[0], `Undid "${MOVE}"`);
      assert.ok(shown.includes(MOVE), 'History sheet notes: ' + shown.join(' | '));
      await page.keyboard.press('Escape');
      await sheetGone();
    }
  });

  await step('raise: topped up Sep, Oct and Nov gives "Make it $480", which raises the base limit for real', async () => {
    await act('Test setup: Groceries topped up in Sep and Oct', `
      const sep = core.getMonth(s, '2026-09'), oct = core.getMonth(s, '2026-10');
      sep.moves.push({ id: 'mv-sep', date: '2026-09-21', from: 'i-cloth', to: 'i-groc', amt: 90 });
      oct.moves.push({ id: 'mv-oct', date: '2026-10-19', from: 'i-kylie', to: 'i-groc', amt: 120 });`);
    assert.equal(await slot('i-groc').locator('.cover-raise').count(), 0, 'Nov has no top up yet');
    await openCover('i-groc');
    await sheet().getByRole('button', { name: 'Move it', exact: true }).click();
    await sheetGone();
    await undoSays(MOVE);
    const r = await page.evaluate(() => window.__finance.lib.budget.raiseSuggestion(window.__finance.state, '2026-11', 'i-groc'));
    assert.deepEqual(r, { itemId: 'i-groc', months: ['2026-09', '2026-10', '2026-11'], newLimit: 480 });
    const raise = slot('i-groc').locator('.cover-raise');
    assert.equal(clean(await raise.locator('p').textContent()), 'Groceries topped up Sep, Oct and Nov. Make it $480?');
    assert.equal(clean(await raise.locator('.cover-raise-btn').textContent()), 'Make it $480 for Groceries');
    assert.deepEqual(await smallTargets('#budget .cover-slot button'), []);
    assert.deepEqual(await noDashes('#budget .cover-slot'), []);
    // In the sheet too, when it applies already.
    await openCover('i-groc');
    assert.equal(clean(await sheet().locator('.cover-raise p').textContent()), 'Groceries topped up Sep, Oct and Nov. Make it $480?');
    await page.keyboard.press('Escape');
    await sheetGone();

    const totalBefore = await total();
    await raise.locator('.cover-raise-btn').click();
    await undoSays('Raised Groceries limit to $480');
    const item = (await state()).budget.flatMap(g => g.items).find(i => i.id === 'i-groc');
    assert.equal(item.limit, 480);
    assert.equal(item.raisedAt, '2026-11');
    assert.equal((await barOf('i-groc')).limit, 510, 'base 480 plus the $30 moved in this month');
    assert.equal(await total(), totalBefore + 80, 'a raise is the one change that adds to the total');
    assert.equal(await slot('i-groc').locator('.cover-raise').count(), 0, 'the same top ups never ask twice');
    assert.equal(clean(await page.locator('.bar-hit[data-item="i-groc"] .amt').textContent()), '$428.65 of $510');
    const focused = await page.evaluate(() => document.activeElement?.closest('.bar-row')?.querySelector('.cover-slot')?.dataset.item);
    assert.equal(focused, 'i-groc', 'focus stays on the Groceries row');

    await page.locator('#undoBtn').click();
    await undoSays('Undid "Raised Groceries limit to $480"');
    assert.equal((await state()).budget.flatMap(g => g.items).find(i => i.id === 'i-groc').limit, 400);
    await raise.waitFor();
  });

  await step('"Not now" hides the raise on this device for the month, also after a reload', async () => {
    const before = await canon();
    await slot('i-groc').getByRole('button', { name: 'Not now' }).click();
    assert.equal(await slot('i-groc').locator('.cover-raise').count(), 0);
    assert.equal(await canon(), before, 'Not now changes no data');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('finance-raise-not-now'))), { 'i-groc': '2026-11' });
    await open();
    await waitSynced();
    assert.equal(await slot('i-groc').locator('.cover-raise').count(), 0);
    assert.equal(clean(await slot('i-groc').locator('.cover-note').textContent()), '+$30 moved in');
  });

  await step('a past month shows the moved notes but never offers Cover it', async () => {
    await act('Test setup: Cat food over in October', `
      core.getMonth(s, '2026-10').tx.push({ id: 'tx-oct-cat', date: '2026-10-12', item: 'i-catfood', amt: 45, note: 'Pet Valu', src: 'manual', merchant: 'Pet Valu', fp: '4500|pet valu', account: null });`);
    await page.locator('#prev').click();
    await page.waitForFunction(() => document.getElementById('monthLabel').textContent === 'October 2026');
    assert.equal((await barOf('i-catfood', '2026-10')).cls, 'red');
    assert.equal(await page.locator('#budget .cover-btn').count(), 0);
    assert.equal(await page.locator('#budget .cover-raise').count(), 0);
    assert.equal(clean(await slot('i-groc').locator('.cover-note').textContent()), '+$120 moved in');
    assert.equal(clean(await slot('i-kylie').locator('.cover-note').textContent()), '$120 moved out');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.getElementById('monthLabel').textContent === 'November 2026');
  });

  await step('category names are escaped in the button and the sheet', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1">Clothes & shoes';
    await act('Test setup: hostile name', `
      s.budget.flatMap(g => g.items).find(i => i.id === 'i-cloth').name = ${JSON.stringify(hostile)};`);
    // Groceries is orange after the $30 move: Cover it is back, naming the renamed source.
    assert.equal(clean(await coverBtn('i-groc').locator('span').first().textContent()), 'Cover it · move room from ' + hostile);
    assert.equal(await page.locator('#budget .cover-slot img').count(), 0);
    await openCover('i-groc');
    assert.ok((await sheetLines()).every(l => !l.includes('<img') || l.includes(hostile)));
    assert.ok((await sheetLines())[0].includes(hostile), 'the hostile name shows as text');
    assert.equal(await sheet().locator('img').count(), 0);
    await page.keyboard.press('Escape');
    await sheetGone();
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await act('Test setup: name back', `
      s.budget.flatMap(g => g.items).find(i => i.id === 'i-cloth').name = 'Clothing and shoes';`);
  });

  await step('not enough room anywhere: "This covers $285 of $1,500" from the three roomiest limits', async () => {
    await addGroceries(1500, 'Freezer');
    const sug = await page.evaluate(() => window.__finance.lib.budget.coverSuggestion(window.__finance.state, '2026-11', 'i-groc'));
    assert.deepEqual(sug, { to: 'i-groc', needed: 1500, from: [{ itemId: 'i-cloth', amt: 120 }, { itemId: 'i-eat', amt: 85 }, { itemId: 'i-kylie', amt: 80 }], total: 285, partial: true });
    await openCover('i-groc');
    assert.deepEqual(await sheetLines(), [
      'Move $120 from Clothing and shoes to Groceries',
      'Move $85 from Eating out to Groceries',
      'Move $80 from Dates with Kylie to Groceries',
    ]);
    assert.equal(clean(await sheet().locator('.cover-result').textContent()), 'This covers $285 of $1,500');
    assert.match(await sheet().locator('.cover-after .fill').getAttribute('class'), /\bred\b/, 'still over after a partial cover');
    await sheet().getByRole('button', { name: 'Move it', exact: true }).click();
    await sheetGone();
    await undoSays('Moved $285 Clothing and shoes, Eating out and Dates with Kylie → Groceries');
    assert.equal(await total(), 1344, 'still the same total');
    // The sources give at most their room; Groceries itself stays over (430 + 285 = 715 of 1,928.65).
    for (const b of await allBars()) {
      if (b.id !== 'i-groc' && (b.limit > 0 || b.baseLimit > 0)) assert.ok(b.limit >= b.spent, `${b.name}: limit ${b.limit} is below spent ${b.spent}`);
    }
    assert.equal((await barOf('i-groc')).limit, 715);
    for (const id of ['i-cloth', 'i-eat', 'i-kylie']) assert.equal((await barOf(id)).room, id === 'i-eat' ? 0.2 : 0, id + ' gave all its whole dollars');
    assert.equal((await state()).months['2026-11'].moves.length, 4, 'one move per source, plus the $30 one');
    await page.locator('#undoBtn').click();
    await undoSays('Undid "Moved $285 Clothing and shoes, Eating out and Dates with Kylie → Groceries"');
    assert.equal((await state()).months['2026-11'].moves.length, 1);
  });

  await step('reduced motion: the pour does not move, its end state is drawn', async () => {
    const pg = await freshPage({ reducedMotion: true });
    await pg.waitForFunction(() => /^Synced/.test(document.getElementById('status').textContent));
    await openCover('i-groc', pg);
    const names = await pg.evaluate(() => ['.pour-tilt', '.pour-stream', '.pour-src-ink', '.pour-dst-ink']
      .map(s => getComputedStyle(document.querySelector('dialog.sheet[open] ' + s)).animationName));
    assert.deepEqual(names, ['none', 'none', 'none', 'none']);
    assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('dialog.sheet[open] .pour-stream')).opacity), '1');
    await pg.keyboard.press('Escape');
    await sheetGone(pg);
  });

  await step('dark mode: the slot and the sheet', async () => {
    const pg = await freshPage({ dark: true });
    await pg.waitForFunction(() => /^Synced/.test(document.getElementById('status').textContent));
    assert.equal(await pg.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(16, 22, 58)');
    await showRow('i-groc', pg);
    await shot('dark-button', { page: pg });
    await openCover('i-groc', pg);
    await sleep(600);
    await shot('dark-sheet', { page: pg });
    await pg.keyboard.press('Escape');
    await sheetGone(pg);
  });

  await step('by keyboard: covering Cat food makes it green, Cover it goes and focus lands on its row', async () => {
    // Cat food 28 of 30 (orange) needs (28 / 0.75 - 30 + 0.01) = 7.34, so $10, from Clothing and shoes (most room).
    await page.locator('#cover-i-catfood').focus();
    await page.keyboard.press('Enter');
    await sheet().locator('.cover-result').waitFor();
    assert.deepEqual(await sheetLines(), ['Move $10 from Clothing and shoes to Cat food']);
    await sheet().getByRole('button', { name: 'Move it', exact: true }).focus();
    await page.keyboard.press('Enter');
    await sheetGone();
    await undoSays('Moved $10 Clothing and shoes → Cat food');
    assert.equal((await barOf('i-catfood')).cls, 'green', '28 of 40 is 70%');
    assert.equal(await coverBtn('i-catfood').count(), 0);
    assert.equal(clean(await slot('i-catfood').locator('.cover-note').textContent()), '+$10 moved in');
    await page.waitForFunction(() => document.activeElement?.matches('.bar-hit[data-item="i-catfood"]'), null, { timeout: 2000 })
      .catch(async () => { throw new Error('focus is on ' + await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))); });
    assert.equal(await total(), 1344);
  });

  await step('no confirm or alert anywhere', async () => {
    assert.equal(dialogs.length, 0, dialogs.join(', '));
  });
}
