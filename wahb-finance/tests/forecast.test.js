import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, shortBillName, visaOwing } from '../lib/forecast.js';
import { clone, cents, fmt0, getMonth, shortDate } from '../lib/core.js';
import sample, { today, nextPay } from './fixtures/forecast-sample.js';

const run = (state = sample, t = today, np = nextPay) => forecast(state, t, { nextPay: np });
const at = (r, date) => r.points.find(p => p.date === date);
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1, `${msg}: ${actual} vs ${expected}`);
const addTx = (s, tx) => { getMonth(s, tx.date.slice(0, 7)).tx.push({ src: 'manual', fp: '', merchant: tx.note || '', ...tx }); return s; };
const DASHES = /[–—]| - /;

/* ---------- hand calculations ---------- */

test('hand calculations for today, the day before next pay and the end of the month', () => {
  const r = run();

  // dailySpend: non Visa tx dated Oct 16 .. Nov 14 (Oct 15 is outside the 30 days, Visa purchases never count)
  // 30.00 + 120.00 + 85.50 + 182.40 + 96.25 + 64.80 + 23.55 = 602.50; 602.50 / 30 = 20.0833, rounded to 20.08
  const daily = 20.08;
  assert.equal(r.dailySpend, daily);

  // Today, Nov 14. Balance entered Nov 12, so only Nov 13 and Nov 14 apply (actual tx, not the estimate):
  // 254.00 − 64.80 (Koichi Ramen, Nov 13) − 23.55 (Tim Hortons, Nov 14) = 165.65
  const todayBal = 254.00 - 64.80 - 23.55;
  near(at(r, '2026-11-14').bal, todayBal, 'today');
  assert.equal(at(r, '2026-11-14').bal, 165.65);

  // Day before next pay, Nov 19: five estimated days (Nov 15 .. 19), Netflix (Nov 16, ticked but still due that day), Phone + Crave (Nov 18)
  // 165.65 − 5 × 20.08 − 27.11 − 90.83 = 165.65 − 100.40 − 27.11 − 90.83 = −52.69
  const beforePay = todayBal - 5 * daily - 27.11 - 90.83;
  near(at(r, '2026-11-19').bal, beforePay, 'day before pay');
  assert.equal(at(r, '2026-11-19').bal, -52.69);

  // End of month, Nov 30: pay estimate on Nov 20, eleven estimated days (Nov 20 .. 30), Internet (Nov 22),
  // Visa payment on Nov 22 = 640.00 + 13.06 (Nov 11) + 100.63 (Nov 13) = 753.69 (the Nov 8 purchase is before the Visa asOf), Gym (Nov 26)
  // −52.69 + 1300 − 11 × 20.08 − 89.43 − 753.69 − 31.58 = −52.69 + 1300 − 220.88 − 89.43 − 753.69 − 31.58 = 151.73
  const visa = 640.00 + 13.06 + 100.63;
  const monthEndBal = beforePay + 1300 - 11 * daily - 89.43 - visa - 31.58;
  near(at(r, '2026-11-30').bal, monthEndBal, 'end of month');
  assert.equal(at(r, '2026-11-30').bal, 151.73);

  assert.deepEqual(r.start, { date: '2026-11-12', bal: 254 });
  assert.equal(r.end, '2026-11-30');
});

test('every point is the previous balance plus its events, in cents', () => {
  const r = run();
  let prev = cents(r.start.bal);
  for (const p of r.points) {
    const c = prev + p.events.reduce((s, e) => s + cents(e.amt), 0);
    assert.equal(cents(p.bal), c, p.date);
    assert.equal(p.bal, c / 100, p.date + ' rounded to cents');
    prev = c;
  }
});

test('today carries the events between the entered balance and today, with their dates', () => {
  const ev = at(run(), '2026-11-14').events;
  assert.deepEqual(ev.map(e => [e.date, e.type, e.label, e.amt, e.estimate]), [
    ['2026-11-13', 'spend', 'Koichi Ramen', -64.80, false],
    ['2026-11-14', 'spend', 'Tim Hortons', -23.55, false],
  ]);
});

test('no asOf means the balance is as of today: nothing before tomorrow applies', () => {
  const s = clone(sample);
  s.settings.chequing.asOf = null;
  const r = run(s);
  assert.deepEqual(r.start, { date: '2026-11-14', bal: 254 });
  assert.equal(at(r, '2026-11-14').bal, 254);
  assert.deepEqual(at(r, '2026-11-14').events, []);
  // 254 − 20.08 on Nov 15
  assert.equal(at(r, '2026-11-15').bal, 233.92);
});

test('an older balance picks up the logged pay and bills after it', () => {
  const s = clone(sample);
  s.settings.chequing = { bal: 254, asOf: '2026-11-05' };
  // 254 + 1300 (pay Nov 6) − 14.44 (Spotify Nov 6) − 96.25 (Walmart Nov 9) − 31.58 (Gym Nov 12) − 64.80 − 23.55 = 1323.38
  const expected = 254 + 1300 - 14.44 - 96.25 - 31.58 - 64.80 - 23.55;
  const p = at(run(s), '2026-11-14');
  near(p.bal, expected, 'today');
  assert.equal(p.bal, 1323.38);
  assert.equal(p.estimate, false);
  assert.ok(p.events.some(e => e.type === 'pay' && e.amt === 1300 && !e.estimate));
});

/* ---------- Visa ---------- */

test('a Visa purchase changes the forecast only through the Visa payment', () => {
  const base = run();
  const s = addTx(clone(sample), { id: 'x', date: '2026-11-14', item: 'i-eat', amt: 45.99, note: 'Pho Lien', account: 'visa' });
  const r = run(s);
  assert.equal(r.dailySpend, base.dailySpend);
  for (const p of r.points) {
    const b = at(base, p.date);
    const diff = (cents(b.bal) - cents(p.bal)) / 100;
    assert.equal(diff, p.date >= '2026-11-22' ? 45.99 : 0, p.date);
  }
  const pay = d => at(d, '2026-11-22').events.find(e => e.type === 'visa').amt;
  assert.equal(pay(base), -753.69);
  assert.equal(pay(r), -799.68); // 753.69 + 45.99
});

test('with no Visa due day a purchase changes nothing at all, and the marker shows the owing', () => {
  const off = clone(sample);
  off.settings.visaDueDay = null;
  const before = run(off);
  const after = run(addTx(clone(off), { id: 'x', date: '2026-11-14', item: 'i-eat', amt: 45.99, note: 'Pho Lien', account: 'visa' }));
  assert.deepEqual(after.points, before.points);
  assert.deepEqual(after.lowest, before.lowest);
  assert.ok(before.points.every(p => p.events.every(e => e.type !== 'visa')));
  assert.deepEqual(before.visaMarker, { amt: 753.69, text: 'Visa owing $753.69. Set its due date to include it.' });
  assert.deepEqual(after.visaMarker, { amt: 799.68, text: 'Visa owing $799.68. Set its due date to include it.' });
});

test('the Visa payment grows only for purchases dated after the Visa asOf', () => {
  const payFor = date => {
    const s = addTx(clone(sample), { id: 'x', date, item: 'i-eat', amt: 50, note: 'Pizza', account: 'visa' });
    return at(run(s), '2026-11-22').events.find(e => e.type === 'visa').amt;
  };
  assert.equal(payFor('2026-11-09'), -753.69); // before asOf Nov 10: already in the balance he typed
  assert.equal(payFor('2026-11-10'), -753.69); // on asOf: also already in it
  assert.equal(payFor('2026-11-11'), -803.69); // after: 753.69 + 50

  // A Visa account with no asOf: just its balance.
  const s = clone(sample);
  delete s.accounts[2].asOf;
  assert.equal(visaOwing(s), 640);
  assert.equal(at(run(s), '2026-11-22').events.find(e => e.type === 'visa').amt, -640);
});

test('visaMarker only when there is no due day and something is owed', () => {
  const s = clone(sample);
  assert.equal(run(s).visaMarker, null);
  s.settings.visaDueDay = null;
  delete s.accounts[2].asOf;
  assert.deepEqual(run(s).visaMarker, { amt: 640, text: 'Visa owing $640. Set its due date to include it.' });
  s.accounts[2].bal = 0;
  assert.equal(run(s).visaMarker, null);
  s.accounts[2].bal = null; // never entered
  assert.equal(run(s).visaMarker, null);
});

test('the Visa due day is clamped to the month and found in the range', () => {
  const s = clone(sample);
  s.settings.visaDueDay = 31; // November has 30 days
  assert.ok(at(run(s), '2026-11-30').events.some(e => e.type === 'visa' && e.amt === -753.69));
  s.settings.visaDueDay = 2; // Nov 2 is past; Dec 2 is in range only when the range reaches December
  assert.ok(run(s).points.every(p => p.events.every(e => e.type !== 'visa')));
  const late = run(s, '2026-11-28', { date: '2026-12-04', estimate: true });
  assert.ok(at(late, '2026-12-02').events.some(e => e.type === 'visa'));
});

/* ---------- estimates ---------- */

test('estimate flags sit exactly where dailySpend or an estimated pay is used', () => {
  const r = run();
  for (const p of r.points) {
    const usesEstimate = p.date > today; // dailySpend is used every day after today
    assert.equal(p.estimate, usesEstimate, p.date);
    assert.equal(p.estimate, p.events.some(e => e.estimate), p.date);
    for (const e of p.events) {
      const isEstimate = (e.type === 'spend' && e.label === 'Spending estimate') || (e.type === 'pay' && e.label === 'Pay estimate');
      assert.equal(e.estimate, isEstimate, `${p.date} ${e.label}`);
    }
  }
  const pays = r.points.flatMap(p => p.events.filter(e => e.type === 'pay').map(e => [p.date, e.amt, e.estimate]));
  assert.deepEqual(pays, [['2026-11-20', 1300, true]]);
  for (const e of r.points.flatMap(p => p.events)) if (e.estimate) assert.match(e.label, /estimate/);
});

test('a pay logged on the next pay date is not an estimate and is not doubled', () => {
  const s = clone(sample);
  getMonth(s, '2026-11').pays.push({ id: 'p-nov20', date: '2026-11-20', amt: 1312.40, hours: 70, note: '' });
  const r = run(s, today, { date: '2026-11-20', estimate: false });
  const ev = at(r, '2026-11-20').events.filter(e => e.type === 'pay');
  assert.deepEqual(ev.map(e => [e.label, e.amt, e.estimate]), [['Bobino pay', 1312.40, false]]);
  assert.equal(at(r, '2026-11-20').estimate, true); // still uses dailySpend that day
});

test('estimated pays repeat every 14 days inside the range', () => {
  const s = clone(sample);
  s.settings.chequing = { bal: 500, asOf: '2026-11-02' };
  const r = run(s, '2026-11-02', { date: '2026-11-06', estimate: true });
  const est = r.points.flatMap(p => p.events.filter(e => e.type === 'pay' && e.estimate).map(() => p.date));
  // Nov 6 has a logged pay, so only Nov 20 is an estimate
  assert.deepEqual(est, ['2026-11-20']);
  getMonth(s, '2026-11').pays.length = 0;
  const r2 = run(s, '2026-11-02', { date: '2026-11-06', estimate: true });
  assert.deepEqual(r2.points.flatMap(p => p.events.filter(e => e.type === 'pay').map(() => p.date)), ['2026-11-06', '2026-11-20']);
});

/* ---------- lowest and negative ---------- */

test('lowest point and its note', () => {
  const r = run();
  assert.deepEqual(r.lowest, { date: '2026-11-19', bal: -52.69, note: 'the day after Phone + Crave' });

  // A comfortable month: same shape, lowest still on Nov 19. 400 − 306.69 = 93.31
  const s = clone(sample);
  s.settings.chequing.bal = 400;
  const ok = run(s);
  assert.deepEqual(ok.lowest, { date: '2026-11-19', bal: 93.31, note: 'the day after Phone + Crave' });
  assert.equal(ok.negative, null);
  assert.equal(`Lowest: ${fmt0(ok.lowest.bal)} on ${shortDate(ok.lowest.date)}, ${ok.lowest.note}`, 'Lowest: $93 on Nov 19, the day after Phone + Crave');

  // Bill on the lowest day itself
  const s2 = clone(sample);
  s2.bills.find(b => b.id === 'b-phone').day = 19;
  assert.equal(run(s2).lowest.note, 'the day of Phone + Crave');

  // No pay coming: the balance only falls, lowest is the last day, no bill on it or the day before
  const none = run(sample, today, null);
  assert.equal(none.lowest.date, '2026-11-30');
  assert.equal(none.lowest.note, '');
});

test('lowest picks the earliest of equal balances', () => {
  const s = clone(sample);
  s.settings.chequing = { bal: 100, asOf: today };
  s.months = {}; // no spending, no pays
  s.bills = [{ id: 'b1', name: 'Hydro', amt: 40, freq: 'monthly', day: 16, note: '' }];
  s.accounts[2].bal = 0;
  const r = run(s, today, null);
  assert.equal(r.dailySpend, 0);
  assert.deepEqual(r.lowest, { date: '2026-11-16', bal: 60, note: 'the day of Hydro' });
});

test('negative dip: need rounded up to $10 and the savings text', () => {
  const r = run();
  // lowest −52.69 -> 52.69 -> 53 -> 60; first negative day is Nov 18 (165.65 − 4 × 20.08 − 27.11 − 90.83 = −32.61)
  assert.equal(at(r, '2026-11-17').bal, 78.30);
  assert.equal(at(r, '2026-11-18').bal, -32.61);
  assert.deepEqual(r.negative, { firstDate: '2026-11-18', need: 60, text: 'Move $60 from savings before Nov 18' });

  const s = clone(sample);
  s.accounts[1].bal = 35.50;
  assert.equal(run(s).negative.text, 'Move $35.50 from savings before Nov 18');
  s.accounts[1].bal = 0;
  assert.equal(run(s).negative.text, 'Short $60 on Nov 18');
  s.accounts[1].bal = null;
  assert.equal(run(s).negative.text, 'Short $60 on Nov 18');
  s.accounts = s.accounts.filter(a => a.id !== 'a-save');
  assert.equal(run(s).negative.text, 'Short $60 on Nov 18');

  // Exactly −50.00 at the lowest needs $50, not $60: 256.69 − 306.69 = −50.00
  const t = clone(sample);
  t.settings.chequing.bal = 256.69;
  assert.equal(run(t).lowest.bal, -50);
  assert.equal(run(t).negative.need, 50);
  t.settings.chequing.bal = 256.68; // −50.01 -> 60
  assert.equal(run(t).negative.need, 60);
});

test('UI strings have no dashes', () => {
  const s = clone(sample);
  s.settings.visaDueDay = null;
  const r = run(s);
  for (const text of [r.negative.text, r.visaMarker.text, r.lowest.note, ...r.points.flatMap(p => p.events.map(e => e.label))]) {
    assert.doesNotMatch(text, DASHES, text);
  }
});

/* ---------- missing and range ---------- */

test('missing chequing balance', () => {
  const s = clone(sample);
  s.settings.chequing = { bal: null, asOf: null };
  assert.deepEqual(run(s), { missing: 'chequing' });
  delete s.settings.chequing; // a v1 doc
  assert.deepEqual(run(s), { missing: 'chequing' });
  delete s.settings;
  assert.deepEqual(run(s), { missing: 'chequing' });
  const z = clone(sample);
  z.settings.chequing = { bal: 0, asOf: today }; // zero is a real balance
  assert.equal(run(z).points[0].bal, 0);
});

test('range spans max(next pay, end of month)', () => {
  const days = r => [r.points[0].date, r.points[r.points.length - 1].date, r.points.length];
  assert.deepEqual(days(run()), ['2026-11-14', '2026-11-30', 17]);
  assert.equal(run().end, '2026-11-30');

  const late = run(sample, '2026-11-28', { date: '2026-12-04', estimate: true });
  assert.deepEqual(days(late), ['2026-11-28', '2026-12-04', 7]);
  assert.equal(late.end, '2026-12-04');
  // December bills inside the range come out: Rent + Parking Dec 1, iCloud Dec 3; the pay estimate lands Dec 4
  assert.deepEqual(at(late, '2026-12-01').events.filter(e => e.type === 'bill').map(e => e.amt), [-587.50, -90]);
  assert.deepEqual(at(late, '2026-12-03').events.filter(e => e.type === 'bill').map(e => e.label), ['iCloud']);
  assert.ok(at(late, '2026-12-04').events.some(e => e.type === 'pay' && e.estimate && e.amt === 1300));

  const noPay = run(sample, today, null);
  assert.deepEqual(days(noPay), ['2026-11-14', '2026-11-30', 17]);
  assert.ok(noPay.points.every(p => p.events.every(e => e.type !== 'pay')));
  // Without the Nov 20 pay estimate the end is 1300 lower: 151.73 − 1300 = −1148.27
  assert.equal(at(noPay, '2026-11-30').bal, -1148.27);
});

test('does not change the state', () => {
  const s = clone(sample);
  run(s);
  assert.deepEqual(s, sample);
});

test('shortBillName', () => {
  assert.equal(shortBillName('Phone + Crave/Disney (Bell)'), 'Phone + Crave');
  assert.equal(shortBillName('Rent (my half)'), 'Rent');
  assert.equal(shortBillName('Gym (ABC)'), 'Gym');
  assert.equal(shortBillName('Claude Max'), 'Claude Max');
  assert.equal(shortBillName('(Bell)'), '(Bell)');
});
