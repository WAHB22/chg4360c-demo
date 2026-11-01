// Merchant text helpers, seeded category rules and bill matching. Pure ES module.
// normalizeMerchant / fingerprint / similarMerchant / prettyMerchant are shared by migrate, importer and duplicate checks:
// keep their behaviour stable (fingerprints are saved in his data).

import { addMonths, billKey, billOccurrences, cents, daysBetween, findItem, findItemByName, isISODate, monthOf } from './core.js';

const PREFIXES = /^(sq|tst|pp|sp|paypal|fs|ckm|dd|in)\s*\*\s*/i;
const PLACE_WORDS = new Set(['qc', 'on', 'ca', 'montreal', 'mtl', 'laval', 'gatineau', 'ottawa', 'longueuil', 'quebec']);

export function normalizeMerchant(raw) {
  let s = String(raw ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  s = s.replace(PREFIXES, '');
  s = s.replace(/#\s*\d+/g, ' ');
  s = s.replace(/[&'’`.,:;!?()\[\]{}"\/\\_*+|@-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean);
  while (words.length > 1 && PLACE_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function fingerprint(amt, merchantRaw) {
  return Math.round(Math.abs(Number(amt) || 0) * 100) + '|' + normalizeMerchant(merchantRaw);
}

// Inputs are normalized merchants. Unknown (empty) on either side counts as similar: same amount and date window decide.
export function similarMerchant(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const tb = new Set(b.split(' '));
  return a.split(' ').some(t => t.length >= 4 && /[a-z]/.test(t) && tb.has(t));
}

// 'NUAGE CAFE MONTREAL QC' -> 'Nuage Cafe'. Keeps accents and '&' from the raw text.
export function prettyMerchant(raw) {
  let s = String(raw ?? '').trim().replace(PREFIXES, '').replace(/#\s*\d+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = s.split(' ');
  while (words.length > 1 && PLACE_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) words.pop();
  s = words.join(' ');
  if (s === s.toUpperCase() || s === s.toLowerCase()) {
    s = s.toLowerCase().replace(/(^|[\s&(/])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
  }
  return s;
}

/* ---------- keyword matching ---------- */

// Whole word (or whole phrase) match on normalized text: 'shell' is not found in 'seashells', 'pho' not in 'phone'.
const wordRes = new Map();
export function hasKeyword(norm, kw) {
  let re = wordRes.get(kw);
  if (!re) {
    const body = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp('(?:^|[^\\p{L}\\p{N}])' + body + '(?=$|[^\\p{L}\\p{N}])', 'u');
    wordRes.set(kw, re);
  }
  return re.test(String(norm ?? ''));
}

// Bill keyword (as found in the merchant) -> words to look for in the bill name (spec 6.5).
export const BILL_ALIASES = Object.freeze({
  bell: ['bell'],
  netflix: ['netflix'],
  spotify: ['spotify'],
  apple: ['icloud', 'apple'],
  anthropic: ['claude'],
  claude: ['claude'],
  'abc 3843': ['gym', 'abc'],
  'abc fitness': ['gym', 'abc'],
});
// Merchants that contain a bill keyword but are not that bill (a Taco Bell meal must never tick the Bell bill).
const BILL_GUARDS = ['taco bell', 'apple store'];
const INTERAC = ['interac', 'e transfer', 'etransfer', 'virement interac'];

// Ordered seed rules (spec 6.4), first match wins. Keywords are already normalized.
// kind 'category' gives an expense (money out) or a refund (money in) in `item`.
// `unless` keywords stop a rule from matching; `exact` matches the whole normalized merchant.
export const RULES = Object.freeze([
  {
    kind: 'notspending',
    exact: ['payment', 'paiement'],
    words: ['payment thank you', 'paiement merci', 'pmt recu', 'cibc visa', 'visa payment', 'internet transfer',
      'transfer to', 'transfer from', 'virement entre comptes', 'own account'],
    unless: INTERAC, // an Interac e-Transfer to or from someone is not a transfer between his own accounts
  },
  // A Bobino Bagel refund is not a paycheque (rule 10 names Bobino Bagel as Eating out).
  { kind: 'pay', direction: 'in', words: ['bobino', 'payroll', 'paie', 'direct deposit', 'depot direct'], unless: ['bobino bagel'] },
  // CIBC debit card lines say Point of Sale Interac RETAIL PURCHASE: those are not e-Transfers.
  { kind: 'income', direction: 'in', words: INTERAC, unless: ['point of sale', 'retail purchase'] },
  { kind: 'bill', direction: 'out', words: Object.keys(BILL_ALIASES), unless: BILL_GUARDS },
  { kind: 'category', item: 'Takeout and delivery', words: ['uber eats', 'ubereats', 'doordash', 'skip the dishes', 'skipthedishes'] },
  { kind: 'category', item: 'Lyft', words: ['lyft'] },
  { kind: 'category', item: 'Uber', words: ['uber'] },
  {
    kind: 'category', item: 'Activities',
    words: ['billetterie', 'biodome', 'museum', 'musee', 'festival', 'cinema', 'cineplex', 'theatre', 'ticket', 'tickets',
      'admission', 'espace pour la vie', 'eplv'],
  },
  {
    kind: 'category', item: 'Groceries',
    words: ['costco', 'walmart', 'saveurs epicerie urbaine', 'iga', 'metro', 'maxi', 'provigo', 'super c', 'loblaws', 'adonis', 'epicerie'],
  },
  {
    kind: 'category', item: 'Coffee and snacks',
    words: ['tim hortons', 'beau biscuit', 'little victories', 'nuage', 'starbucks', 'second cup', 'cafe', 'coffee', 'boulangerie', 'patisserie'],
  },
  {
    kind: 'category', item: 'Eating out',
    words: ['bobino bagel', 'mcdonald', 'mcdonalds', 'maclaren', 'koichi ramen', 'restaurant', 'resto', 'bistro', 'brasserie', 'grill',
      'sushi', 'ramen', 'pho', 'pizza', 'burger', 'taco', 'dumpling', 'thai', 'shawarma', 'poke', 'diner', 'bbq'],
  },
  { kind: 'category', item: 'Gas', words: ['petro canada', 'petrocan', 'esso', 'shell', 'ultramar'] },
  { kind: 'category', item: 'Cat food', words: ['pet valu', 'mondou'] },
]);

const dirOf = row => (row?.direction === 'in' ? 'in' : 'out');

function ruleMatches(rule, norm, dir) {
  if (rule.direction && rule.direction !== dir) return false;
  if (rule.unless && rule.unless.some(k => hasKeyword(norm, k))) return false;
  return (rule.exact || []).includes(norm) || rule.words.some(k => hasKeyword(norm, k));
}
const firstRule = (kinds, norm, dir) => RULES.find(r => kinds.includes(r.kind) && ruleMatches(r, norm, dir)) || null;

// "Interac e-Transfer from Kylie" when a sender is visible, else "Interac e-Transfer". Data, not UI prose.
const INTERAC_WORDS = /(^|\s)(interac|virement|e-?\s?transfers?|etransfers?|transfers?|received|recu|reçu|from|de|du|autodeposit|auto|deposit|depot|dépôt|money|request|sent|internet|banking|electronic|funds)(?=\s|$)/giu;
export function interacNote(raw) {
  const sender = prettyMerchant(raw)
    .replace(/[*#:,;()\[\]]+/g, ' ')
    .split(/\s+/).filter(w => w && !/\d/.test(w)).join(' ') // reference numbers carry digits
    .replace(INTERAC_WORDS, ' ').replace(INTERAC_WORDS, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s./-]+|[\s./-]+$/g, '');
  return sender && /\p{L}/u.test(sender) ? 'Interac e-Transfer from ' + prettyMerchant(sender) : 'Interac e-Transfer';
}

// Remembered category for this merchant, only while that item still exists.
function memoryItem(state, norm) {
  const map = state && state.merchantMap;
  if (!norm || !map || typeof map !== 'object' || !Object.hasOwn(map, norm)) return null;
  const id = map[norm];
  return id != null && findItem(state, id) ? id : null;
}

/*
 Order of decisions (spec 6.4, with merchant memory placed where it can win over category rules):
 1. not spending (Visa payments, own account transfers), 2. pay, 3. Interac income: these never take a category.
 Then merchant memory, then bills (keyword, or a bill name match within 5%, money out only), then category rules,
 then the fallback: out -> expense with no category; in on Visa -> refund with no category; other in -> income.
 Money in that matches memory or a category rule is a refund in that category (a Costco refund lowers Groceries).
*/
export function classifyMerchant(state, row) {
  const merchant = row?.merchant ?? '';
  const norm = normalizeMerchant(merchant);
  const dir = dirOf(row);
  const res = (kind, more) => ({ kind, itemId: null, catSource: null, billMatch: null, note: prettyMerchant(merchant), ...more });

  const fixed = firstRule(['notspending', 'pay', 'income'], norm, dir);
  if (fixed?.kind === 'notspending') return res('notspending');
  if (fixed?.kind === 'pay') return res('pay', { note: 'Bobino pay' });
  if (fixed?.kind === 'income') return res('income', { note: interacNote(merchant) });

  const catKind = dir === 'out' ? 'expense' : 'refund';
  const remembered = memoryItem(state, norm);
  if (remembered) return res(catKind, { itemId: remembered, catSource: 'memory' });

  if (dir === 'out') {
    const billMatch = matchBill(state, row);
    if (billMatch) return res('bill', { billMatch });
  }

  const cat = firstRule(['category'], norm, dir);
  if (cat) {
    const item = findItemByName(state, cat.item);
    return res(catKind, { itemId: item ? item.id : null, catSource: item ? 'rule' : null });
  }

  if (dir === 'out') return res('expense');
  return row?.account === 'visa' ? res('refund') : res('income');
}

/* ---------- bill matching (spec 6.5) ---------- */

// Bill keywords present in a normalized merchant (none when a guard such as 'taco bell' is present).
function billKeywordsIn(norm) {
  if (BILL_GUARDS.some(g => hasKeyword(norm, g))) return [];
  return Object.keys(BILL_ALIASES).filter(k => hasKeyword(norm, k));
}

// Percent difference computed from whole cents, so 139.84 vs 100 is exactly 39.84.
function pctDiff(amount, billAmt) {
  const b = Math.abs(cents(billAmt)), a = Math.abs(cents(amount));
  if (b === 0) return a === 0 ? 0 : 100;
  return Math.abs(a - b) * 100 / b;
}

// The bill occurrence nearest to the row date, looking at the row's month and its neighbours (earlier wins a tie).
// A monthly bill with no day set gives that month's undated key ('YYYY-MM-??'), the same key the bills list ticks.
function nearestOccurrence(bill, date) {
  if (!isISODate(date)) return null;
  const m = monthOf(date);
  const all = [addMonths(m, -1), m, addMonths(m, 1)].flatMap(k => billOccurrences(bill, k));
  const dated = all.filter(d => !d.endsWith('??')).sort();
  if (!dated.length) return all.some(d => d.endsWith('??')) ? m + '-??' : null;
  let best = dated[0];
  for (const d of dated) if (Math.abs(daysBetween(date, d)) < Math.abs(daysBetween(date, best))) best = d;
  return best;
}

// Words that never identify a bill by name: CIBC chequing boilerplate ('Internet Banking E-TRANSFER ...' must not
// tick the 'Internet (Bell)' bill) and filler in bill names ('Half Price' is not 'Parking (my half)').
const NAME_NOISE = new Set(['internet', 'banking', 'electronic', 'funds', 'transfer', 'interac', 'point', 'sale',
  'retail', 'purchase', 'preauthorized', 'debit', 'deposit', 'payment', 'bill', 'half']);

export function matchBill(state, row) {
  const norm = normalizeMerchant(row?.merchant);
  const amount = Math.abs(Number(row?.amount) || 0);
  const terms = billKeywordsIn(norm).flatMap(k => BILL_ALIASES[k]);
  // A guard phrase ('taco bell') also blocks its words from the name match.
  const guarded = new Set(BILL_GUARDS.filter(g => hasKeyword(norm, g)).flatMap(g => g.split(' ')));
  const merchantTokens = new Set(norm.split(' ').filter(t => t.length >= 4 && /[a-z]/.test(t) && !NAME_NOISE.has(t) && !guarded.has(t)));

  const candidates = [];
  for (const bill of (state && state.bills) || []) {
    const nameTokens = normalizeMerchant(bill.name).split(' ');
    const diffPct = pctDiff(amount, bill.amt);
    const byKeyword = terms.some(t => nameTokens.includes(t));
    const byName = diffPct <= 5 && nameTokens.some(t => merchantTokens.has(t));
    if (byKeyword || byName) candidates.push({ bill, diffPct, gap: Math.abs(cents(amount) - cents(bill.amt)) });
  }
  // Closest amount wins (the two Bell bills are told apart this way). Stable sort keeps bill order on a tie.
  candidates.sort((x, y) => x.gap - y.gap);
  for (const { bill, diffPct } of candidates) {
    const date = nearestOccurrence(bill, row?.date);
    if (date) return { billId: bill.id, date, key: billKey(bill, date), billAmt: bill.amt, diffPct };
  }
  return null;
}
