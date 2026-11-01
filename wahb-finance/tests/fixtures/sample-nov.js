// Synthetic sample for the Stage 3 acceptance test (not his real data).
// A version 1 doc shaped like his live save: the original default bills, groups and accounts, with fixed ids.
// November 2026: pay $1,300 on Nov 6; spending totals $647.00; bills ticked paid total $828.11;
// Netflix (Nov 16) and Phone + Crave (Nov 18) unpaid. Next pay is Nov 20 (Nov 6 + 14, an estimate).

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
      paid: {},
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
        { id: 't1', date: '2026-11-02', item: 'i-groc', amt: 182.40, note: 'Costco' },
        { id: 't2', date: '2026-11-03', item: 'i-catfood', amt: 28.00, note: 'Pet Valu' },
        { id: 't3', date: '2026-11-05', item: 'i-gas', amt: 58.00, note: 'Petro-Canada' },
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

// Hand calculated expectations (see docs/SPEC.md 5.3).
export const expect = {
  today: '2026-11-14',
  spentNov: 647.00,
  billsPaidNov: 828.11,
  billsDueBeforeNov20: 117.94,
  perDay: 0,
  days: 6,
  nextPay: '2026-11-20',
  afterSecondPay: { today: '2026-11-20', billsDue: 921.04, pool: 203.85, days: 14, perDay: 14, nextPay: '2026-12-04' },
};
