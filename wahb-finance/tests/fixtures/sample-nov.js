// Synthetic sample for the Stage 3 acceptance test (not his real data), SPEC 5.3 check 1.
// A version 1 doc shaped like his live save: the original default bills, groups and accounts, with fixed ids.
// Paycheques Oct 9, Oct 23 and Nov 6; every October bill is ticked paid. November 2026: pay $1,300 on Nov 6;
// spending totals $647.00, all of it dated Nov 6 or later (inside the Nov 6 to Nov 19 pay period); bills ticked
// paid total $828.11; Netflix (Nov 16) and Phone + Crave (Nov 18) unpaid. Next pay is Nov 20 (Nov 6 + 14, an estimate).

const B = (id, name, amt, day, note = '') => ({ id, name, amt, freq: 'monthly', day, note });
const I = (id, name, limit) => ({ id, name, limit });

export default {
  version: 1,
  settings: { payPlan: 1300 },
  bills: [
    B('b-rent', 'Rent (my half)', 587.50, 1),
    B('b-park', 'Parking (my half)', 90, 1),
    B('b-net', 'Internet (Bell)', 89.43, 22),
    B('b-phone', 'Phone + Crave/Disney (Bell)', 90.83, 18),
    B('b-spot', 'Spotify', 14.44, 6),
    B('b-netflix', 'Netflix', 27.11, 16),
    B('b-icloud', 'iCloud', 4.59, 3),
    B('b-claude', 'Claude Max', 100, 4, 'Placeholder, check the CAD charge'),
    { id: 'b-gym', name: 'Gym (ABC)', amt: 31.58, freq: 'biweekly', anchor: '2026-09-03', note: '' },
    B('b-manga', 'Manga', 5.64, null, 'Add the date'),
  ],
  budget: [
    { id: 'g-food', name: 'Food', items: [I('i-groc', 'Groceries', 400), I('i-eat', 'Eating out', 150), I('i-coffee', 'Coffee and snacks', 50), I('i-takeout', 'Takeout and delivery', 50), I('i-prep', 'Meal prep supplies', 50), I('i-alc', 'Alcohol', 0)] },
    { id: 'g-pets', name: 'Pets', items: [I('i-catfood', 'Cat food', 30), I('i-litter', 'Litter', 15), I('i-toys', 'Toys', 10), I('i-vet', 'Vet', 0)] },
    { id: 'g-trans', name: 'Transport', items: [I('i-gas', 'Gas', 60), I('i-ins', 'Insurance', 0), I('i-wash', 'Car wash and maintenance', 0), I('i-uber', 'Uber', 0), I('i-lyft', 'Lyft', 0)] },
    { id: 'g-pers', name: 'Personal', items: [I('i-cloth', 'Clothing and shoes', 150), I('i-hair', 'Haircuts', 50), I('i-kylie', 'Dates with Kylie', 200), I('i-act', 'Activities', 0), I('i-volley', 'Volleyball', 104), I('i-school', 'School', 25), I('i-errors', 'Errors', 0)] },
  ],
  accounts: [
    { id: 'a-cheq', name: 'Chequing', bal: 420, goal: 400, kind: 'asset' },
    { id: 'a-save', name: 'Savings', bal: 2150, goal: 1000, kind: 'asset' },
    { id: 'a-visa', name: 'Visa owing', bal: 640, limit: 2500, kind: 'debt' },
  ],
  goals: [
    { id: 'j-a26', name: 'Automne 2026 gap', target: 10043, saved: 0 },
    { id: 'j-h27', name: 'Hiver 2027 cushion', target: 12000, saved: 0 },
    { id: 'j-a27', name: 'Automne 2027 cushion', target: 14000, saved: 0 },
  ],
  months: {
    '2026-10': {
      // Every dated October bill, so nothing from before the Nov 6 pay period is still owed.
      paid: {
        'b-rent@2026-10-01': true, 'b-park@2026-10-01': true, 'b-gym@2026-10-01': true, 'b-icloud@2026-10-03': true,
        'b-claude@2026-10-04': true, 'b-spot@2026-10-06': true, 'b-gym@2026-10-15': true, 'b-netflix@2026-10-16': true,
        'b-phone@2026-10-18': true, 'b-net@2026-10-22': true, 'b-gym@2026-10-29': true,
      },
      tx: [],
      pays: [
        { id: 'p-oct9', date: '2026-10-09', amt: 1300, hours: null, note: '' },
        { id: 'p-oct23', date: '2026-10-23', amt: 1300, hours: null, note: '' },
      ],
    },
    '2026-11': {
      paid: {
        'b-rent@2026-11-01': true,
        'b-park@2026-11-01': true,
        'b-icloud@2026-11-03': true,
        'b-claude@2026-11-04': true,
        'b-spot@2026-11-06': true,
        'b-gym@2026-11-12': true,
      },
      tx: [
        { id: 't1', date: '2026-11-06', item: 'i-groc', amt: 182.40, note: 'Costco' },
        { id: 't2', date: '2026-11-06', item: 'i-catfood', amt: 28.00, note: 'Pet Valu' },
        { id: 't3', date: '2026-11-07', item: 'i-gas', amt: 58.00, note: 'Petro-Canada' },
        { id: 't4', date: '2026-11-07', item: 'i-eat', amt: 64.80, note: 'Koichi Ramen' },
        { id: 't5', date: '2026-11-08', item: 'i-kylie', amt: 120.00, note: '' },
        { id: 't6', date: '2026-11-09', item: 'i-groc', amt: 96.25, note: 'Walmart' },
        { id: 't7', date: '2026-11-10', item: 'i-coffee', amt: 23.55, note: 'Tim Hortons' },
        { id: 't8', date: '2026-11-12', item: 'i-volley', amt: 74.00, note: '' },
      ],
      pays: [{ id: 'p-nov6', date: '2026-11-06', amt: 1300, hours: 64, note: '' }],
    },
  },
  savedAt: '2026-11-14T15:00:00.000Z',
};

// Hand calculated expectations (docs/SPEC.md 5.3, check 1). Today Nov 14, pay period Nov 6 to Nov 19.
//   income  = 1300 (the Nov 6 paycheque)
//   spending = 182.40 + 28 + 58 + 64.80 + 120 + 96.25 + 23.55 + 74 = 647.00 (every tx is dated Nov 6 to Nov 12)
//   bills Nov 6 to 19 = Spotify 14.44 + Gym 31.58 + Netflix 27.11 + Phone + Crave 90.83 = 163.96 (paid or not)
//   older unpaid (Oct 9 to Nov 5) = 0: all ticked
//   pool = 1300 - 647 - 163.96 - 0 = 489.04; perDay = floor(489.04 / 6) = floor(81.506) = 81
export const expect = {
  today: '2026-11-14',
  spentNov: 647.00,
  billsPaidNov: 828.11,
  earnedNov: 1300,
  period: { start: '2026-11-06', end: '2026-11-19' },
  nextPay: '2026-11-20',
  days: 6,
  income: 1300,
  spending: 647.00,
  billsTotal: 163.96,
  olderTotal: 0,
  pool: 489.04,
  perDay: 81,
  // Check 2: the same day with $1,200 spent since Nov 6 (553 more): 1300 - 1200 - 163.96 = -63.96, perDay 0.
  overspent: { extra: 553, spending: 1200, pool: -63.96, perDay: 0 },
};
