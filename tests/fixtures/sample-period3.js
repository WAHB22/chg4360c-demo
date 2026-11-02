// Synthetic sample for SPEC 5.3 check 3 (not his real data). A version 2 doc the dev server can seed:
//   node scripts/dev-server.mjs --seed tests/fixtures/sample-period3.js   then open /?today=2026-11-30 or 2026-12-01
// Same bills, groups, accounts and jars as sample-nov.js (the gym every 2 weeks from Nov 12).
// Paycheques of $1,300 on Nov 6 and Nov 20 (the only pays). Every bill before Nov 20 is ticked paid.
// Spending: $647 from Nov 6 to Nov 12 (the sample's purchases), then $300 since Nov 20. Nothing in December:
// nothing is spent or ticked on Dec 1. Internet (Nov 22) is ticked paid on time; the other bills of the period are not.

import nov from './sample-nov.js';

const copy = o => JSON.parse(JSON.stringify(o));
const T = (id, date, item, amt, note, fp, account = 'visa') => ({ id, date, item, amt, note, src: 'manual', fp, merchant: note, account });
const P = (id, date) => ({ id, date, amt: 1300, hours: null, note: '' });

export default {
  version: 2,
  settings: { payPlan: 1300, visaDueDay: 22, chequing: { bal: null, asOf: null } },
  bills: copy(nov.bills),
  budget: copy(nov.budget),
  accounts: copy(nov.accounts),
  goals: copy(nov.goals),
  merchantMap: {},
  months: {
    '2026-11': {
      paid: {
        'b-rent@2026-11-01': true, 'b-park@2026-11-01': true, 'b-icloud@2026-11-03': true, 'b-claude@2026-11-04': true,
        'b-spot@2026-11-06': true, 'b-gym@2026-11-12': true, 'b-netflix@2026-11-16': true, 'b-phone@2026-11-18': true,
        'b-net@2026-11-22': true,
      },
      tx: [
        // The first pay period (Nov 6 to Nov 19): 647.00, as in sample-nov.js.
        T('t1', '2026-11-06', 'i-groc', 182.40, 'Costco', '18240|costco'),
        T('t2', '2026-11-06', 'i-catfood', 28.00, 'Pet Valu', '2800|pet valu'),
        T('t3', '2026-11-07', 'i-gas', 58.00, 'Petro-Canada', '5800|petro canada', 'chequing'),
        T('t4', '2026-11-07', 'i-eat', 64.80, 'Koichi Ramen', '6480|koichi ramen'),
        T('t5', '2026-11-08', 'i-kylie', 120.00, '', '12000|'),
        T('t6', '2026-11-09', 'i-groc', 96.25, 'Walmart', '9625|walmart', 'chequing'),
        T('t7', '2026-11-10', 'i-coffee', 23.55, 'Tim Hortons', '2355|tim hortons'),
        T('t8', '2026-11-12', 'i-volley', 74.00, '', '7400|', 'chequing'),
        // Since Nov 20: 112.35 + 48.20 + 9.45 + 61.00 + 69.00 = 300.00
        T('t9', '2026-11-21', 'i-groc', 112.35, 'Maxi', '11235|maxi'),
        T('t10', '2026-11-23', 'i-eat', 48.20, 'Koichi Ramen', '4820|koichi ramen'),
        T('t11', '2026-11-25', 'i-coffee', 9.45, 'Tim Hortons', '945|tim hortons'),
        T('t12', '2026-11-27', 'i-gas', 61.00, 'Petro-Canada', '6100|petro canada', 'chequing'),
        T('t13', '2026-11-29', 'i-kylie', 69.00, 'Cinema', '6900|cinema'),
      ],
      pays: [P('p-nov6', '2026-11-06'), P('p-nov20', '2026-11-20')],
      moves: [],
    },
  },
  savedAt: '2026-11-30T15:00:00.000Z',
};

// Hand calculated expectations (docs/SPEC.md 5.3, check 3). Pay period Nov 20 to Dec 3 (next pay Dec 4, an estimate).
//   income   = 1300 (the Nov 20 paycheque; Nov 6 is before the period)
//   spending = 300.00 (every purchase dated Nov 20 to Dec 3)
//   bills Nov 20 to Dec 3 = Internet 89.43 (Nov 22) + Gym 31.58 (Nov 26) + Rent 587.50 (Dec 1) + Parking 90 (Dec 1)
//                         + iCloud 4.59 (Dec 3) = 803.10, paid or not. Claude Max (Dec 4) falls on pay day: next period.
//   older unpaid (Nov 6 to Nov 19) = 0: all ticked
//   pool = 1300 - 300 - 803.10 - 0 = 196.90 on both days
//   Nov 30: 4 days (Nov 30, Dec 1, 2, 3): floor(196.90 / 4) = floor(49.225) = 49
//   Dec 1:  3 days (Dec 1, 2, 3):          floor(196.90 / 3) = floor(65.633) = 65
export const expect = {
  period: { start: '2026-11-20', end: '2026-12-03' },
  nextPay: { date: '2026-12-04', estimate: true, lastPay: '2026-11-20' },
  income: 1300,
  spending: 300,
  billsTotal: 803.10,
  olderTotal: 0,
  pool: 196.90,
  days: { '2026-11-30': 4, '2026-12-01': 3 },
  perDay: { '2026-11-30': 49, '2026-12-01': 65 },
};
