// Merchant text helpers, seeded category rules and bill matching. Pure ES module.
// normalizeMerchant / fingerprint / similarMerchant / prettyMerchant are shared by migrate, importer and duplicate checks:
// keep their behaviour stable (fingerprints are saved in his data).

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
