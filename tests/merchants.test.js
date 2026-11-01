import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMerchant, fingerprint, similarMerchant, prettyMerchant,
  RULES, BILL_ALIASES, hasKeyword, classifyMerchant, matchBill, interacNote,
} from '../lib/merchants.js';
import { freshState, row, itemName } from './helpers/import-helpers.js';

const classify = (state, merchant, amount = 10, more = {}) => classifyMerchant(state, row(merchant, amount, more));
const category = (state, merchant, more) => {
  const c = classify(state, merchant, 10, more);
  return { kind: c.kind, item: itemName(state, c.itemId), catSource: c.catSource };
};

test('the four original helpers keep their behaviour', () => {
  assert.equal(normalizeMerchant('COSTCO WHOLESALE W1234 MONTREAL QC'), 'costco wholesale w1234');
  assert.equal(normalizeMerchant('SQ *NUAGE CAFÉ #12 MTL'), 'nuage cafe');
  assert.equal(normalizeMerchant('Sammi & Soupe Dumpling'), 'sammi soupe dumpling');
  assert.equal(fingerprint(-182.4, 'Costco'), '18240|costco');
  assert.equal(similarMerchant('costco', 'costco wholesale w1234'), true);
  assert.equal(similarMerchant('', 'anything'), true);
  assert.equal(similarMerchant('nuage cafe', 'tim hortons'), false);
  assert.equal(prettyMerchant('NUAGE CAFE MONTREAL QC'), 'Nuage Cafe');
});

test('keywords match whole words only', () => {
  assert.equal(hasKeyword('shell c12345', 'shell'), true);
  assert.equal(hasKeyword('seashells gift', 'shell'), false);
  assert.equal(hasKeyword('pho lien', 'pho'), true);
  assert.equal(hasKeyword('phone repair', 'pho'), false);
  assert.equal(hasKeyword('metro plus', 'metro'), true);
  assert.equal(hasKeyword('metropolis', 'metro'), false);
  assert.equal(hasKeyword('bell canada', 'bell'), true);
  assert.equal(hasKeyword('campbell soup', 'bell'), false);
  assert.equal(hasKeyword('uber eats', 'uber eats'), true);
  assert.equal(hasKeyword('uber eatsy', 'uber eats'), false);
});

test('RULES are ordered as in the spec, first match wins', () => {
  assert.deepEqual(RULES.slice(0, 4).map(r => r.kind), ['notspending', 'pay', 'income', 'bill']);
  assert.deepEqual(RULES.slice(4).map(r => r.item), [
    'Takeout and delivery', 'Lyft', 'Uber', 'Activities', 'Groceries', 'Coffee and snacks', 'Eating out', 'Gas', 'Cat food',
  ]);
  assert.deepEqual(RULES[3].words, Object.keys(BILL_ALIASES));
  // Uber Eats is checked before Uber, so a delivery is never a ride.
  const s = freshState();
  assert.equal(category(s, 'UBER* EATS').item, 'Takeout and delivery');
  assert.equal(category(s, 'UBER* TRIP').item, 'Uber');
});

test('every category rule group with a realistic CIBC merchant', () => {
  const s = freshState();
  const cases = {
    'COSTCO WHOLESALE W1234 MONTREAL QC': 'Groceries',
    'WALMART SUPERCENTER #3011': 'Groceries',
    'METRO PLUS #123 MONTREAL': 'Groceries',
    'SUPER C #6012': 'Groceries',
    'TIM HORTONS #2231': 'Coffee and snacks',
    'NUAGE CAFE MONTREAL QC': 'Coffee and snacks',
    'STARBUCKS 04512': 'Coffee and snacks',
    'KOICHI RAMEN': 'Eating out',
    "MCDONALD'S #4312": 'Eating out',
    'PHO LIEN': 'Eating out',
    'BOBINO BAGEL': 'Eating out',
    'PETRO-CANADA 98765': 'Gas',
    'SHELL C12345': 'Gas',
    'ESSO CIRCLE K': 'Gas',
    'UBER* EATS': 'Takeout and delivery',
    'DOORDASH*KOICHI': 'Takeout and delivery',
    'SKIPTHEDISHES.COM': 'Takeout and delivery',
    'UBER* TRIP': 'Uber',
    'LYFT *RIDE': 'Lyft',
    'PET VALU #123': 'Cat food',
    'MONDOU #45': 'Cat food',
    'EPLV BILLETTERIE BIO': 'Activities',
    'ESPACE POUR LA VIE': 'Activities',
    'CINEPLEX #7123': 'Activities',
    'MUSEE DES BEAUX ARTS': 'Activities',
  };
  for (const [merchant, item] of Object.entries(cases)) {
    assert.deepEqual(category(s, merchant), { kind: 'expense', item, catSource: 'rule' }, merchant);
  }
});

test('Visa payments and own account transfers are not spending', () => {
  const s = freshState();
  for (const m of ['PAYMENT THANK YOU/PAIEMENT MERCI', 'Payment', 'PAIEMENT', 'INTERNET TRANSFER 000000123456',
    'TRANSFER TO SAVINGS', 'VIREMENT ENTRE COMPTES', 'PMT RECU CIBC VISA']) {
    for (const direction of ['in', 'out']) {
      const c = classify(s, m, 100, { direction });
      assert.equal(c.kind, 'notspending', `${m} ${direction}`);
      assert.equal(c.itemId, null);
    }
  }
  // Interac e-Transfers are not own account transfers.
  assert.equal(classify(s, 'E-TRANSFER TO Kylie', 40, { direction: 'out' }).kind, 'expense');
  assert.equal(classify(s, 'INTERAC E-TRANSFER FROM KYLIE', 40, { direction: 'in', account: 'chequing' }).kind, 'income');
});

test('pay and Interac income need money in', () => {
  const s = freshState();
  const pay = classify(s, 'BOBINO PAYROLL', 1300, { direction: 'in', account: 'chequing' });
  assert.equal(pay.kind, 'pay');
  assert.equal(pay.note, 'Bobino pay');
  assert.equal(classify(s, 'DIRECT DEPOSIT', 1300, { direction: 'in', account: 'chequing' }).kind, 'pay');
  assert.equal(classify(s, 'DEPOT DIRECT PAIE', 1300, { direction: 'in', account: 'chequing' }).kind, 'pay');

  const etr = classify(s, 'E-TRANSFER RECEIVED Kylie', 40, { direction: 'in', account: 'chequing' });
  assert.equal(etr.kind, 'income');
  assert.equal(etr.note, 'Interac e-Transfer from Kylie');
  assert.equal(etr.itemId, null);
  assert.equal(interacNote('VIREMENT INTERAC DE KYLIE SMITH'), 'Interac e-Transfer from Kylie Smith');
  assert.equal(interacNote('INTERAC E-TRANSFER 000123456'), 'Interac e-Transfer');
});

test('CIBC chequing descriptions', () => {
  const s = freshState();
  const cheq = (m, direction = 'out', amount = 10) => classify(s, m, amount, { direction, account: 'chequing' });
  assert.equal(itemName(s, cheq('Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1').itemId), 'Coffee and snacks');
  // A debit card refund is not an e-Transfer.
  const refund = cheq('Point of Sale - Interac REFUND 000001234567 COSTCO WHOLESAL', 'in', 20);
  assert.equal(refund.kind, 'refund');
  assert.equal(itemName(s, refund.itemId), 'Groceries');
  const etr = cheq('Internet Banking E-TRANSFER 105372806372 Kylie', 'in', 40);
  assert.equal(etr.kind, 'income');
  assert.equal(etr.note, 'Interac e-Transfer from Kylie');
  assert.equal(cheq('Internet Banking INTERNET TRANSFER 000000123456').kind, 'notspending');
  assert.equal(cheq('Electronic Funds Transfer PAY BOBINO INC', 'in', 1300).kind, 'pay');
  assert.equal(cheq('Electronic Funds Transfer PREAUTHORIZED DEBIT BELL CANADA', 'out', 89.43).billMatch.billId, 'b-net');
});

test('bill keywords give a bill with its match', () => {
  const s = freshState();
  const cases = [
    ['BELL CANADA', 89.43, 'b-net'],
    ['NETFLIX.COM', 27.11, 'b-netflix'],
    ['SPOTIFY P1A2B3', 14.44, 'b-spot'],
    ['APPLE.COM/BILL', 4.59, 'b-icloud'],
    ['ANTHROPIC', 100, 'b-claude'],
    ['CLAUDE.AI SUBSCRIPTION', 100, 'b-claude'],
    ['ABC 3843-AF', 31.58, 'b-gym'],
    ['ABC FITNESS', 31.58, 'b-gym'],
  ];
  for (const [m, amt, billId] of cases) {
    const c = classify(s, m, amt);
    assert.equal(c.kind, 'bill', m);
    assert.equal(c.billMatch.billId, billId, m);
    assert.equal(c.itemId, null);
  }
});

test('false positive guards', () => {
  const s = freshState();
  assert.deepEqual(category(s, 'CAMPBELL SOUP CO'), { kind: 'expense', item: null, catSource: null });
  assert.deepEqual(category(s, 'PHONE EXPERTS'), { kind: 'expense', item: null, catSource: null });
  assert.deepEqual(category(s, 'METROPOLIS BOUTIQUE'), { kind: 'expense', item: null, catSource: null });
  assert.deepEqual(category(s, 'SEASHELLS GIFT SHOP'), { kind: 'expense', item: null, catSource: null });
  // A meal at Taco Bell must never tick the Bell bills.
  assert.deepEqual(category(s, 'TACO BELL #123'), { kind: 'expense', item: 'Eating out', catSource: 'rule' });
});

test('merchant memory wins over rules, but never over not spending', () => {
  const s = freshState();
  s.merchantMap = { 'costco wholesale w1234': 'i-prep', 'netflix com': 'i-toys', payment: 'i-groc' };
  assert.deepEqual(category(s, 'COSTCO WHOLESALE W1234 MONTREAL QC'), { kind: 'expense', item: 'Meal prep supplies', catSource: 'memory' });
  assert.deepEqual(category(s, 'NETFLIX.COM'), { kind: 'expense', item: 'Toys', catSource: 'memory' });
  assert.equal(classify(s, 'Payment', 100, { direction: 'in' }).kind, 'notspending');
  // A remembered item that was deleted no longer counts.
  s.merchantMap['tim hortons'] = 'i-gone';
  assert.deepEqual(category(s, 'TIM HORTONS #2231'), { kind: 'expense', item: 'Coffee and snacks', catSource: 'rule' });
});

test('unknown merchants and missing items get no category', () => {
  const s = freshState();
  assert.deepEqual(category(s, 'AMZN MKTP CA*2K4'), { kind: 'expense', item: null, catSource: null });
  // A rule whose item he deleted asks for a category instead of guessing.
  s.budget[2].items = s.budget[2].items.filter(i => i.name !== 'Lyft');
  assert.deepEqual(category(s, 'LYFT *RIDE'), { kind: 'expense', item: null, catSource: null });
  // A bill keyword whose bill is gone falls through to the other rules.
  s.bills = s.bills.filter(b => b.id !== 'b-netflix');
  assert.deepEqual(category(s, 'NETFLIX.COM'), { kind: 'expense', item: null, catSource: null });
});

test('money in that is not pay, income or a transfer', () => {
  const s = freshState();
  assert.deepEqual(category(s, 'COSTCO WHOLESALE W1234', { direction: 'in', account: 'visa' }), { kind: 'refund', item: 'Groceries', catSource: 'rule' });
  assert.deepEqual(category(s, 'BOUTIQUE XYZ', { direction: 'in', account: 'visa' }), { kind: 'refund', item: null, catSource: null });
  const inc = classify(s, 'GST CREDIT CANADA', 80, { direction: 'in', account: 'chequing' });
  assert.equal(inc.kind, 'income');
  assert.equal(inc.note, 'Gst Credit Canada');
  assert.equal(classify(s, 'BOUTIQUE XYZ', 5, { direction: 'in', account: null }).kind, 'income');
  // Bills are money out: a Netflix credit on the Visa is a refund, not a tick.
  assert.equal(classify(s, 'NETFLIX.COM', 27.11, { direction: 'in', account: 'visa' }).kind, 'refund');
});

test('works on v1 and on data with no budget or bills', () => {
  assert.deepEqual(classifyMerchant({}, row('COSTCO', 10)), { kind: 'expense', itemId: null, catSource: null, billMatch: null, note: 'Costco' });
  assert.equal(matchBill({}, row('BELL CANADA', 89.43)), null);
});

test('matchBill tells the two Bell bills apart by amount', () => {
  const s = freshState();
  const internet = matchBill(s, row('BELL CANADA', 89.43, { date: '2026-11-21' }));
  assert.deepEqual(internet, { billId: 'b-net', date: '2026-11-22', key: 'b-net@2026-11-22', billAmt: 89.43, diffPct: 0 });
  const phone = matchBill(s, row('BELL CANADA', 90.83, { date: '2026-11-21' }));
  assert.deepEqual(phone, { billId: 'b-phone', date: '2026-11-18', key: 'b-phone@2026-11-18', billAmt: 90.83, diffPct: 0 });
  assert.equal(matchBill(s, row('BELL MOBILITE', 89.10)).billId, 'b-net');
  assert.equal(matchBill(s, row('BELL MOBILITE', 91.50)).billId, 'b-phone');
});

test('matchBill picks the nearest Gym occurrence (every 2 weeks from Sep 3)', () => {
  const s = freshState();
  const at = date => matchBill(s, row('ABC 3843-AF', 31.58, { date }));
  assert.equal(at('2026-11-13').date, '2026-11-12');
  assert.equal(at('2026-11-24').date, '2026-11-26');
  assert.equal(at('2026-10-30').date, '2026-10-29');
  assert.equal(at('2026-12-01').date, '2026-11-26');
  assert.equal(at('2026-11-19').date, '2026-11-12'); // 7 days either way: the earlier one
  assert.equal(at('2026-11-24').key, 'b-gym@2026-11-26');
});

test('matchBill looks into the neighbouring months', () => {
  const s = freshState();
  // Spotify is due the 6th: a charge on Oct 31 belongs to Nov 6.
  assert.equal(matchBill(s, row('SPOTIFY P1A2B3', 14.44, { date: '2026-10-31' })).key, 'b-spot@2026-11-06');
  assert.equal(matchBill(s, row('SPOTIFY P1A2B3', 14.44, { date: '2026-11-29' })).key, 'b-spot@2026-12-06');
});

test('Claude Max at $139.84 still matches by keyword and reports the difference', () => {
  const s = freshState();
  const m = matchBill(s, row('ANTHROPIC', 139.84, { date: '2026-11-04' }));
  assert.equal(m.billId, 'b-claude');
  assert.equal(m.billAmt, 100);
  assert.equal(m.diffPct, 39.84);
  assert.equal(m.key, 'b-claude@2026-11-04');
});

test('a bill name token counts only within 5%', () => {
  const s = freshState();
  s.bills.push({ id: 'b-vid', name: 'Videotron', amt: 45, freq: 'monthly', day: 10, note: '' });
  const near = matchBill(s, row('VIDEOTRON LTEE', 47.25, { date: '2026-11-10' }));
  assert.equal(near.billId, 'b-vid');
  assert.equal(near.diffPct, 5);
  assert.equal(matchBill(s, row('VIDEOTRON LTEE', 47.26, { date: '2026-11-10' })), null);
  assert.equal(classify(s, 'VIDEOTRON LTEE', 45, { date: '2026-11-10' }).kind, 'bill');
  assert.equal(matchBill(s, row('COSTCO WHOLESALE', 45)), null);
});

test('a bill with no date set matches the undated key of that month', () => {
  const s = freshState();
  const m = matchBill(s, row('MANGA PLUS', 5.64, { date: '2026-11-20' }));
  assert.deepEqual(m, { billId: 'b-manga', date: '2026-11-??', key: 'b-manga@2026-11-??', billAmt: 5.64, diffPct: 0 });
});
