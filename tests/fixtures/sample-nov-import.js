// The November sample as the import tests were written against it (synthetic, not his real data).
// Identical to sample-nov.js except that Costco $182.40 (t1) is dated Nov 2, before the Nov 6 pay period.
// sample-nov.js dates it Nov 6 so that every November purchase falls inside the pay period (SPEC 5.3 check 1);
// the import duplicate tests measure their 3 day window from a Costco entry on Nov 2 ("3 days is a duplicate,
// 4 days is not"), so they keep that date here. Used through tests/helpers/import-helpers.js freshState().
import nov from './sample-nov.js';

const doc = JSON.parse(JSON.stringify(nov));
doc.months['2026-11'].tx.find(t => t.id === 't1').date = '2026-11-02';

export default doc;
