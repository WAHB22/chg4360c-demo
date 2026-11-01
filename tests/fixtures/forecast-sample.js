// Synthetic sample for the Stage 5 forecast tests (not his real data). A version 2 doc.
// Today is Nov 14 2026. Chequing $254 entered on Nov 12. Visa owing $640 entered on Nov 10, due on the 22nd.
// Pays logged Oct 9, Oct 23 and Nov 6, so the next pay is Nov 20 (an estimate). Hand calculations are in tests/forecast.test.js.

const B = (id, name, amt, day, note = '') => ({ id, name, amt, freq: 'monthly', day, note });
const I = (id, name, limit) => ({ id, name, limit });
const T = (id, date, item, amt, note, account) => ({ id, date, item, amt, note, src: 'manual', fp: '', merchant: note, account });
const P = (id, date) => ({ id, date, amt: 1300, hours: null, note: '' });

export const today = '2026-11-14';
export const nextPay = { date: '2026-11-20', estimate: true };

export default {
  version: 2,
  settings: { payPlan: 1300, visaDueDay: 22, chequing: { bal: 254, asOf: '2026-11-12' } },
  bills: [
    B('b-rent', 'Rent (my half)', 587.50, 1),
    B('b-park', 'Parking (my half)', 90, 1),
    B('b-net', 'Internet (Bell)', 89.43, 22),
    B('b-phone', 'Phone + Crave/Disney (Bell)', 90.83, 18),
    B('b-spot', 'Spotify', 14.44, 6),
    B('b-netflix', 'Netflix', 27.11, 16),
    B('b-icloud', 'iCloud', 4.59, 3),
    B('b-claude', 'Claude Max', 100, 4),
    { id: 'b-gym', name: 'Gym (ABC)', amt: 31.58, freq: 'biweekly', anchor: '2026-09-03', note: '' },
    B('b-manga', 'Manga', 5.64, null, 'Add the date'),
  ],
  budget: [
    { id: 'g-food', name: 'Food', items: [I('i-groc', 'Groceries', 400), I('i-eat', 'Eating out', 150), I('i-coffee', 'Coffee and snacks', 50)] },
    { id: 'g-pers', name: 'Personal', items: [I('i-kylie', 'Dates with Kylie', 200), I('i-act', 'Activities', 0)] },
  ],
  accounts: [
    { id: 'a-cheq', name: 'Chequing', bal: 254, goal: 400, kind: 'asset' },
    { id: 'a-save', name: 'Savings', bal: 2150, goal: 1000, kind: 'asset' },
    { id: 'a-visa', name: 'Visa owing', bal: 640, limit: 2500, kind: 'debt', asOf: '2026-11-10' },
  ],
  goals: [{ id: 'j-h27', name: 'Hiver 2027 cushion', target: 12000, saved: 0 }],
  merchantMap: {},
  months: {
    '2026-10': {
      paid: { 'b-rent@2026-10-01': true, 'b-park@2026-10-01': true, 'b-phone@2026-10-18': true },
      tx: [
        T('t-o15', '2026-10-15', 'i-eat', 50.00, 'Bistro', 'chequing'), // 30 days before today: outside the window
        T('t-o16', '2026-10-16', 'i-coffee', 30.00, 'Cafe', 'chequing'), // first day of the window
        T('t-o20', '2026-10-20', 'i-kylie', 120.00, 'Cinema', 'chequing'),
        T('t-o28', '2026-10-28', 'i-groc', 85.50, 'Metro', 'chequing'),
        T('t-o31', '2026-10-31', 'i-coffee', 6.58, 'Nuage Cafe', 'visa'),
      ],
      pays: [P('p-oct9', '2026-10-09'), P('p-oct23', '2026-10-23')],
      moves: [],
    },
    '2026-11': {
      // Netflix (Nov 16) is ticked paid ahead of its date; Phone + Crave (Nov 18) and Internet (Nov 22) are not.
      paid: {
        'b-rent@2026-11-01': true, 'b-park@2026-11-01': true, 'b-icloud@2026-11-03': true,
        'b-claude@2026-11-04': true, 'b-spot@2026-11-06': true, 'b-gym@2026-11-12': true, 'b-netflix@2026-11-16': true,
      },
      tx: [
        T('t-n02', '2026-11-02', 'i-groc', 182.40, 'Costco', 'chequing'),
        T('t-n08', '2026-11-08', 'i-act', 38.00, 'EPLV Billetterie Bio', 'visa'), // before the Visa asOf: already in its balance
        T('t-n09', '2026-11-09', 'i-groc', 96.25, 'Walmart', null), // no account (older manual entry): counts as chequing
        T('t-n11', '2026-11-11', 'i-act', 13.06, 'Espace Vego Biodome', 'visa'),
        T('t-n13a', '2026-11-13', 'i-eat', 64.80, 'Koichi Ramen', 'chequing'),
        T('t-n13b', '2026-11-13', 'i-eat', 100.63, 'Sammi & Soupe Dumpling', 'visa'),
        T('t-n14', '2026-11-14', 'i-coffee', 23.55, 'Tim Hortons', 'chequing'),
      ],
      pays: [P('p-nov6', '2026-11-06')],
      moves: [],
    },
  },
  note: '',
  savedAt: '2026-11-14T15:00:00.000Z',
};
