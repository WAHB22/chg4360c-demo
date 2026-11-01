// GET / PUT the finance data, its history and old versions (spec section 8.3).

import { bodyBytes, checkKey, readJson, send } from './_auth.js';
import { ensureSeeded, listVersions, prune, readVersion, storeConfig, withLock, writeVersion } from './_store.js';

const MAX_BYTES = 1024 * 1024;
const KEEP = 10;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function queryOf(req) {
  if (isObj(req.query)) return req.query;
  return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
}
const one = v => (Array.isArray(v) ? v[0] : v);

// Newest readable version doc, or null. A blob deleted or damaged between list and read is skipped.
async function newestDoc(cfg, versions) {
  for (const v of versions || await listVersions(cfg)) {
    try {
      const doc = await readVersion(cfg, v.pathname);
      if (isObj(doc)) return doc;
    } catch { /* try the next one */ }
  }
  return null;
}

// The version list, after seeding an empty prefix under the lock. If a save holds the lock, use what is there now
// (no wait: a GET never queues behind a save).
async function versionsSeeded(cfg) {
  const versions = await listVersions(cfg);
  if (versions.length) return versions;
  try {
    if (!await withLock(cfg, () => ensureSeeded(cfg), { waitMs: 0 })) return versions;
  } catch (e) {
    if (!e || !e.conflict) throw e;
  }
  return listVersions(cfg);
}

async function getData(req, res, cfg) {
  const versions = await versionsSeeded(cfg);
  const q = queryOf(req);

  if (one(q.history) === '1') {
    const list = versions.slice(0, KEEP);
    const docs = await Promise.all(list.map(v => readVersion(cfg, v.pathname).catch(() => null)));
    const history = list.map((v, i) => ({
      id: v.pathname,
      savedAt: (docs[i] && docs[i].savedAt) || v.uploadedAt,
      note: (docs[i] && typeof docs[i].note === 'string') ? docs[i].note : '',
    }));
    return send(res, 200, { versions: history });
  }

  const version = one(q.version);
  if (version !== undefined) {
    // Only names this prefix writes: no other prefix, no '..', no nested paths.
    const ok = new RegExp('^' + escapeRe(cfg.prefix) + 'data-[A-Za-z0-9-]+\\.json$').test(String(version));
    if (!ok) return send(res, 400, { error: 'Unknown version' });
    const doc = await readVersion(cfg, String(version));
    return doc ? send(res, 200, doc) : send(res, 404, { error: 'That version is no longer kept' });
  }

  const doc = await newestDoc(cfg, versions);
  return send(res, 200, doc || { empty: true });
}

// Never goes backwards and never repeats the newest savedAt, even within one millisecond.
function nextSavedAt(newest) {
  const prev = newest ? Date.parse(newest.savedAt) : NaN;
  const now = Date.now();
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
}

async function putData(req, res, cfg) {
  let body;
  try {
    body = readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid data' });
  }
  if (!isObj(body) || !Array.isArray(body.bills)) return send(res, 400, { error: 'Invalid data' });
  if (bodyBytes(req, body) > MAX_BYTES) return send(res, 400, { error: 'That save is over 1 MB' });

  const base = body.baseSavedAt ?? body.savedAt ?? null;
  // A save that finds the lock held waits for it (withLock polls, up to about 3 s), then checks its base against
  // what the other save just wrote. So two devices saving at once get exactly one 409, and its `latest` already
  // holds the other device's change: the replay on top of it goes through. Only a lock still held when the wait
  // runs out (a stuck save) answers 409 with the newest doc there is.
  // The answer is sent only after withLock has released the lock: a client that saves again
  // the moment it hears back (a 409 replay, or actions made during the save) must not meet it.
  let answer;
  try {
    answer = await withLock(cfg, async () => {
      let versions = await listVersions(cfg);
      if (!versions.length && await ensureSeeded(cfg)) versions = await listVersions(cfg);
      const newest = await newestDoc(cfg, versions);
      if (newest && newest.savedAt !== base) return [409, { error: 'conflict', latest: newest }];

      delete body.baseSavedAt;
      body.savedAt = nextSavedAt(newest);
      body.note = String(body.note || 'Saved').slice(0, 200);
      await writeVersion(cfg, body, versions.length ? versions[0].ts : undefined);
      try { await prune(cfg, KEEP); } catch { /* the next save prunes again */ }
      return [200, { ok: true, savedAt: body.savedAt }];
    });
  } catch (e) {
    if (!e || !e.conflict) throw e;
    answer = [409, { error: 'conflict', latest: await newestDoc(cfg).catch(() => null) }];
  }
  return send(res, ...answer);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!checkKey(req)) return send(res, 401, { error: 'This device is not set up' });
    const cfg = storeConfig();
    if (req.method === 'GET') return await getData(req, res, cfg);
    if (req.method === 'PUT') return await putData(req, res, cfg);
    res.setHeader('Allow', 'GET, PUT');
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    // Error name and message only: never the request body.
    console.error('api/data failed:', e && e.name, e && e.message);
    return send(res, 500, { error: 'Something went wrong on the server. Try again.' });
  }
}
