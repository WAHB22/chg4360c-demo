import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMerchant, fingerprint, similarMerchant, prettyMerchant,
  RULES, BILL_ALIASES, BILL_EXACT, hasKeyword, classifyMerchant, matchBill, interacNote, stripBankText,
} from '../lib/merchants.js';
import { freshState, row, itemName, hasDash } from './helpers/import-helpers.js';

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
  assert.deepEqual(RULES[3].exact, Object.keys(BILL_EXACT));
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

/* ---------- bill keywords need their full phrase ---------- */

test('a bare brand word never ticks a bill: Claude, Apple and Bell need their phrases', () => {
  const s = freshState();
  // Each at the exact amount of the bill it could be taken for, so a bill name match within 5% would show too.
  const notBills = [
    ['ST CLAUDE PHARMACIE', 100], ['CLAUDE', 100],
    ['APPLE STORE R123', 4.59], ['APPLE', 4.59], ['APPLE.COM/CA', 4.59],
    ['TACO BELL #123', 89.43], ['CAMPBELL SOUP CO', 89.43], ['BELL HELMETS SHOP', 90.83],
  ];
  for (const [m, amt] of notBills) {
    const c = classify(s, m, amt, { date: '2026-11-20' });
    assert.equal(c.kind, 'expense', m);
    assert.equal(c.billMatch, null, m);
    assert.equal(matchBill(s, row(m, amt, { date: '2026-11-20' })), null, m);
  }
  assert.equal(itemName(s, classify(s, 'TACO BELL #123', 89.43).itemId), 'Eating out');
  assert.equal(classify(s, 'ST CLAUDE PHARMACIE', 100).itemId, null, 'no category is guessed');

  const bills = [
    ['BELL CANADA', 89.43, 'b-net'], ['BELL', 89.43, 'b-net'], ['BELL #12', 90.83, 'b-phone'], ['BELL.CA', 89.43, 'b-net'],
    ['BELL.CA/MYBELL', 89.43, 'b-net'], ['BELL MOBILITY', 90.83, 'b-phone'], ['BELL MOBILITE', 90.83, 'b-phone'],
    ['BELL INTERNET', 89.43, 'b-net'], ['BELL MEDIA', 90.83, 'b-phone'],
    ['APPLE.COM/BILL', 4.59, 'b-icloud'], ['APPLE COM BILL', 4.59, 'b-icloud'], ['ITUNES.COM/BILL', 4.59, 'b-icloud'], ['ICLOUD', 4.59, 'b-icloud'],
    ['ANTHROPIC', 100, 'b-claude'], ['CLAUDE.AI SUBSCRIPTION', 100, 'b-claude'], ['CLAUDE AI', 100, 'b-claude'], ['CLAUDE MAX', 139.84, 'b-claude'],
    ['NETFLIX.COM', 27.11, 'b-netflix'], ['SPOTIFY P1A2B3', 14.44, 'b-spot'], ['ABC 3843-AF', 31.58, 'b-gym'], ['ABC FITNESS', 31.58, 'b-gym'],
  ];
  for (const [m, amt, billId] of bills) {
    const c = classify(s, m, amt, { date: '2026-11-20' });
    assert.equal(c.kind, 'bill', m);
    assert.equal(c.billMatch.billId, billId, m);
  }
});

/* ---------- CIBC bank text ---------- */

test('CIBC bank text is dropped from the merchant and the saved note, and what means something stays', () => {
  const cases = [
    ['Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1', 'tim hortons', 'Tim Hortons'],
    ['Point of Sale - Visa Debit RETAIL PURCHASE 000001234567 NUAGE CAFE MONTREAL QC', 'nuage cafe', 'Nuage Cafe'],
    ['Point of Sale - Visa Debit VISA DEBIT PURCHASE 000001234567 SQ *KOICHI RAMEN', 'koichi ramen', 'Koichi Ramen'],
    ['Point of Sale-Interac RETAIL PURCHASE 000001234567 MAXI & CIE #8812', 'maxi cie', 'Maxi & Cie'],
    ['POINT OF SALE – INTERAC RETAIL PURCHASE 000001234567 PETRO-CANADA 98765', 'petro canada 98765', 'Petro-canada 98765'],
    ['Point of Sale - INTERACTIVE TOYS', 'interactive toys', 'Interactive Toys'],
    ['Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESAL', 'costco wholesal', 'Costco Wholesal'],
    ['Point of Sale - Interac REFUND 000001234567 COSTCO WHOLESAL', 'costco wholesal', 'Costco Wholesal'],
    ['Electronic Funds Transfer PREAUTHORIZED DEBIT BELL CANADA', 'bell canada', 'Bell Canada'],
    ['Electronic Funds Transfer PAY BOBINO INC', 'bobino inc', 'Bobino Inc'],
    ['Internet Banking INTERNET BILL PAY 000000156789 VIDEOTRON LTEE', 'videotron ltee', 'Videotron Ltee'],
    ['INTERNET BILL PAY 000000156789 CIBC VISA', 'cibc visa', 'Cibc Visa'],
    ['Internet Banking INTERNET BILL PAY 000000156789 CIBC VISA', 'cibc visa', 'Cibc Visa'],
    // Own account transfers and e-Transfers keep the words that say so.
    ['Internet Banking INTERNET TRANSFER 000000123456', 'internet transfer 000000123456', 'Internet Transfer 000000123456'],
    ['INTERNET TRANSFER 000000123456', 'internet transfer 000000123456', 'Internet Transfer 000000123456'],
    ['Internet Banking E-TRANSFER 105372806372 Kylie', 'e transfer 105372806372 kylie', 'E-TRANSFER 105372806372 Kylie'],
    // Bank text with no merchant after it is kept whole, so the merchant is never empty.
    ['Electronic Funds Transfer PAY', 'electronic funds transfer pay', 'Electronic Funds Transfer PAY'],
  ];
  for (const [raw, norm, pretty] of cases) {
    assert.equal(normalizeMerchant(raw), norm, raw);
    assert.equal(prettyMerchant(raw), pretty, raw);
    assert.equal(hasDash(prettyMerchant(raw)), false, raw);
  }
  assert.equal(fingerprint(4.25, cases[0][0]), '425|tim hortons');
  assert.deepEqual(stripBankText('Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESAL'), { text: 'COSTCO WHOLESAL', refund: true });
  assert.deepEqual(stripBankText('Point of Sale - Interac RETAIL PURCHASE 000001234567 COSTCO WHOLESAL'), { text: 'COSTCO WHOLESAL', refund: false });
  // Lines without bank text are untouched (the fingerprints already in his data stay the same).
  for (const m of ['COSTCO WHOLESALE W1234 MONTREAL QC', 'E-TRANSFER RECEIVED Kylie', 'PAYMENT THANK YOU/PAIEMENT MERCI', 'Payment']) {
    assert.deepEqual(stripBankText(m), { text: m, refund: false });
  }
});

test('CIBC chequing lines after the bank text is dropped: same decisions as before', () => {
  const s = freshState();
  const cheq = (m, direction = 'out', amount = 10, more = {}) => classify(s, m, amount, { direction, account: 'chequing', ...more });
  const tim = cheq('Point of Sale - Interac RETAIL PURCHASE 000001234567 TIM HORTONS #1');
  assert.deepEqual([tim.kind, itemName(s, tim.itemId), tim.note], ['expense', 'Coffee and snacks', 'Tim Hortons']);
  assert.equal(cheq('Internet Banking INTERNET TRANSFER 000000123456').kind, 'notspending');
  assert.equal(cheq('Internet Banking INTERNET TRANSFER 000000123456', 'in').kind, 'notspending');
  assert.equal(cheq('Internet Banking INTERNET BILL PAY 000000156789 CIBC VISA', 'out', 500).kind, 'notspending');
  const etr = cheq('Internet Banking E-TRANSFER 105372806372 Kylie', 'in', 40);
  assert.deepEqual([etr.kind, etr.note], ['income', 'Interac e-Transfer from Kylie']);
  assert.equal(cheq('Internet Banking E-TRANSFER 105372806372 Kylie', 'out', 40).kind, 'expense');
  assert.equal(cheq('Electronic Funds Transfer PAY BOBINO INC', 'in', 1300).kind, 'pay');
  const bell = cheq('Electronic Funds Transfer PREAUTHORIZED DEBIT BELL CANADA', 'out', 90.83, { date: '2026-11-18' });
  assert.equal(bell.billMatch.key, 'b-phone@2026-11-18');
});

test('a RETAIL REFUND or REFUND code on money in is a refund in the merchant category, never income', () => {
  const s = freshState();
  const cheqIn = m => classify(s, m, 20, { direction: 'in', account: 'chequing' });
  const costco = cheqIn('Point of Sale - Interac RETAIL REFUND 000001234567 COSTCO WHOLESAL');
  assert.deepEqual([costco.kind, itemName(s, costco.itemId), costco.catSource, costco.note], ['refund', 'Groceries', 'rule', 'Costco Wholesal']);
  // An unknown store asks for a category instead of turning into income.
  for (const m of ['Point of Sale - Interac RETAIL REFUND 000001234567 BOUTIQUE XYZ', 'Point of Sale - Visa Debit REFUND 000001234567 BOUTIQUE XYZ',
    'RETAIL REFUND 000001234567 BOUTIQUE XYZ']) {
    const c = cheqIn(m);
    assert.deepEqual([c.kind, c.itemId, c.catSource, c.note], ['refund', null, null, 'Boutique Xyz'], m);
  }
  // A refund is never a paycheque or an e-Transfer, even when the store name has one of their words.
  assert.equal(cheqIn('Point of Sale - Interac RETAIL REFUND 000001234567 BOBINO BAGEL').kind, 'refund');
  // His remembered category wins, as for any refund.
  s.merchantMap = { 'boutique xyz': 'i-cloth' };
  const kept = cheqIn('Point of Sale - Interac RETAIL REFUND 000001234567 BOUTIQUE XYZ');
  assert.deepEqual([kept.kind, kept.itemId, kept.catSource], ['refund', 'i-cloth', 'memory']);
  // Without a refund code, money in on chequing from an unknown sender stays income; money out stays an expense.
  assert.equal(cheqIn('BOUTIQUE ABC').kind, 'income');
  assert.equal(classify(s, 'Point of Sale - Interac RETAIL REFUND 000001234567 BOUTIQUE ABC', 20, { direction: 'out', account: 'chequing' }).kind, 'expense');
});

test('the saved note never has a spaced hyphen or a dash', () => {
  assert.equal(prettyMerchant('BOUTIQUE - LE MARCHE'), 'Boutique Le Marche');
  assert.equal(prettyMerchant('CAFE – SOLEIL'), 'Cafe Soleil');
  assert.equal(prettyMerchant('CAFE—SOLEIL'), 'Cafe Soleil');
  assert.equal(prettyMerchant('LIBRAIRIE -- RAFFIN'), 'Librairie Raffin');
  assert.equal(prettyMerchant('Point of Sale - Interac'), 'Point of Sale Interac');
  // A hyphen inside a word is not a dash.
  assert.equal(prettyMerchant('PETRO-CANADA 98765'), 'Petro-canada 98765');
  assert.equal(prettyMerchant('ABC 3843-AF'), 'Abc 3843-af');
  for (const m of ['BOUTIQUE - LE MARCHE', 'CAFE – SOLEIL', 'X - ', ' - Y', 'Point of Sale - Visa Debit']) assert.equal(hasDash(prettyMerchant(m)), false, m);
});
