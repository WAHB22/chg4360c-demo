// His real example (Stage 1 acceptance), as rows the reader returns for CIBC Visa notification screenshots, Oct 31 2026.
// The second Payment's time is cut off in the screenshot, so time is null. Amounts only, no account numbers.
export const rows = [
  { date: '2026-10-31', time: '09:41', merchant: 'Nuage Cafe', amount: 6.58, direction: 'out', account: 'visa', raw: 'Nuage Cafe  $6.58' },
  { date: '2026-10-31', time: '12:15', merchant: 'Sammi & Soupe Dumpling', amount: 100.63, direction: 'out', account: 'visa', raw: 'Sammi & Soupe Dumpling  $100.63' },
  { date: '2026-10-31', time: '13:02', merchant: 'Payment', amount: 100.00, direction: 'in', account: 'visa', raw: 'Payment  $100.00' },
  { date: '2026-10-31', time: '15:20', merchant: 'EPLV Billetterie Bio', amount: 38.00, direction: 'out', account: 'visa', raw: 'EPLV Billetterie Bio  $38.00' },
  { date: '2026-10-31', time: '15:47', merchant: 'Espace Vego Biodome', amount: 13.06, direction: 'out', account: 'visa', raw: 'Espace Vego Biodome  $13.06' },
  { date: '2026-10-31', time: null, merchant: 'Payment', amount: 100.00, direction: 'in', account: 'visa', raw: 'Payment  $100.00' },
];

export const expect = {
  shown: 6,
  ticked: ['Nuage Cafe', 'Sammi & Soupe Dumpling', 'EPLV Billetterie Bio', 'Espace Vego Biodome'],
  categories: { 'Nuage Cafe': 'Coffee and snacks', 'Sammi & Soupe Dumpling': 'Eating out', 'EPLV Billetterie Bio': 'Activities', 'Espace Vego Biodome': 'Activities' },
  notSpending: 2,
};

export default { rows };
