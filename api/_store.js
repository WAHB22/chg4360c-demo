// Blob storage wrapper: which store and prefix to use, versions, seeding and the save lock.
// The blob functions are injected (setBlobApi) so tests and the dev server run on an in memory fake.

import * as vercelBlob from '@vercel/blob';
import { BlobError, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';

const REAL = Object.freeze({
  put: vercelBlob.put, list: vercelBlob.list, del: vercelBlob.del, get: vercelBlob.get, head: vercelBlob.head,
});
let api = REAL;

// {put, list, del, get, head}. Passing nothing restores the real '@vercel/blob' functions.
export function setBlobApi(next) {
  api = next ? { ...REAL, ...next } : REAL;
}

export const LIVE_PREFIX = 'finance/';
export const PREVIEW_PREFIX = 'finance-preview/';
export const PREVIEW_NOTE = 'Preview copy of live data';
const JSON_TYPE = 'application/json';
const LOCK_LEASE_MS = 30_000;

export function storeConfig(env = process.env) {
  const priv = env.PRIVATE_BLOB_READ_WRITE_TOKEN;
  const pub = env.BLOB_READ_WRITE_TOKEN;
  const primary = priv ? { token: priv, access: 'private' } : { token: pub, access: 'public' };
  const legacy = priv && pub ? { token: pub, access: 'public' } : null;
  // Only an explicit production deploy may touch finance/. Local, preview and anything unknown use the preview prefix.
  const prefix = env.VERCEL_ENV === 'production' ? LIVE_PREFIX : PREVIEW_PREFIX;
  return { primary, legacy, prefix };
}

const opts = (store, more) => ({ token: store.token, access: store.access, ...more });

// 'finance/data-1731596400000-ab12cd.json' -> 1731596400000 (legacy names carry a random suffix after it)
const tsOf = (pathname, uploadedAt) => {
  const m = /data-(\d{10,})/.exec(pathname);
  return m ? Number(m[1]) : new Date(uploadedAt).getTime();
};

// Every blob under a prefix in one store, following list() pagination, newest first.
async function listIn(store, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await api.list(opts(store, { prefix, limit: 1000, ...(cursor ? { cursor } : {}) }));
    for (const b of page.blobs) {
      out.push({ pathname: b.pathname, ts: tsOf(b.pathname, b.uploadedAt), uploadedAt: new Date(b.uploadedAt).toISOString(), size: b.size });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.ts - a.ts || b.uploadedAt.localeCompare(a.uploadedAt) || b.pathname.localeCompare(a.pathname));
}

async function readText(store, pathname) {
  const r = await api.get(pathname, opts(store, { useCache: false }));
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return new Response(r.stream).text();
}

// Node's JSON.parse error quotes the text around the bad token, which would put money data in the log.
function parseStored(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError('A stored blob is not valid JSON');
  }
}

// Only `data-*.json` blobs are versions; anything else under the prefix is left alone.
const listData = async (store, prefix) => (await listIn(store, prefix + 'data-')).filter(v => v.pathname.endsWith('.json'));

export function listVersions(cfg) {
  return listData(cfg.primary, cfg.prefix);
}

// Parsed JSON, or null when the blob is gone.
export async function readVersion(cfg, pathname) {
  const text = await readText(cfg.primary, pathname);
  return text == null ? null : parseStored(text);
}

// Strictly increasing within one instance, so two saves in the same millisecond still sort.
// `after` (the newest version's ts) keeps the order right when another instance's clock ran ahead.
let lastTs = 0;
const nextTs = after => (lastTs = Math.max(Date.now(), lastTs + 1, Number.isFinite(after) ? after + 1 : 0));
const random6 = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

export async function writeVersion(cfg, doc, after) {
  const pathname = `${cfg.prefix}data-${nextTs(after)}-${random6()}.json`;
  await api.put(pathname, JSON.stringify(doc), opts(cfg.primary, { addRandomSuffix: false, contentType: JSON_TYPE }));
  return pathname;
}

export async function prune(cfg, keep = 10) {
  const old = (await listVersions(cfg)).slice(keep).map(v => v.pathname);
  if (old.length) await api.del(old, opts(cfg.primary));
  return old;
}

// Fills an empty prefix once. Returns true when it copied something. Never deletes, never writes outside cfg.prefix.
export async function ensureSeeded(cfg) {
  if ((await listVersions(cfg)).length) return false;

  if (cfg.prefix !== LIVE_PREFIX) {
    // Preview: one copy of the newest live save, from the primary store first, else the legacy store.
    // A damaged or non object save is skipped, so it cannot block every preview GET and PUT.
    for (const store of [cfg.primary, cfg.legacy].filter(Boolean)) {
      for (const v of await listData(store, LIVE_PREFIX)) {
        const text = await readText(store, v.pathname);
        if (text == null) continue;
        let doc;
        try { doc = parseStored(text); } catch { continue; }
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
        doc.note = PREVIEW_NOTE;
        await writeVersion(cfg, doc);
        return true;
      }
    }
    return false;
  }

  if (!cfg.legacy) return false;
  // Production moving to the private store: copy the last 10 public saves, same pathnames, same bytes.
  let copied = 0;
  for (const v of (await listData(cfg.legacy, LIVE_PREFIX)).slice(0, 10)) {
    const text = await readText(cfg.legacy, v.pathname);
    if (!text) continue; // gone, or empty (put refuses an empty body)
    await api.put(v.pathname, text, opts(cfg.primary, { addRandomSuffix: false, contentType: JSON_TYPE }));
    copied++;
  }
  return copied > 0;
}

// "already exists" (put without overwrite) and an ETag mismatch both mean someone else got there first.
export function isWriteConflict(e) {
  return e instanceof BlobPreconditionFailedError || (e instanceof BlobError && /already exists/i.test(e.message));
}

/*
 Daily read counter `finance-meta/read-count-<day>.json` = {count} in the primary store.
 get() for the count and ETag, then put with ifMatch (allowOverwrite:false for the first read of the day).
 Retries up to 3 times (4 tries in all, spec 8.4) when another read changed it first.
 -> {ok:true, count} counted; {ok:false, count} the limit was already reached; {ok:false, busy:true} still racing.
*/
export const readCountPath = day => `finance-meta/read-count-${day}.json`;
const COUNT_RETRIES = 3;

export async function incrementReadCount(cfg, day, limit) {
  const pathname = readCountPath(day);
  for (let attempt = 0; attempt <= COUNT_RETRIES; attempt++) {
    const r = await api.get(pathname, opts(cfg.primary, { useCache: false }));
    let count = 0, etag = null;
    if (r && r.statusCode === 200 && r.stream) {
      count = Number((parseStored(await new Response(r.stream).text()) || {}).count) || 0;
      etag = r.blob.etag;
    }
    if (count >= limit) return { ok: false, count };
    try {
      await api.put(pathname, JSON.stringify({ count: count + 1 }), opts(cfg.primary, {
        addRandomSuffix: false, contentType: JSON_TYPE, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      }));
      return { ok: true, count: count + 1 };
    } catch (e) {
      if (!isWriteConflict(e)) throw e;
    }
  }
  return { ok: false, busy: true };
}

const conflictError = () => Object.assign(new Error('Another save is in progress'), { conflict: true });

/*
 Save lock on `${prefix}lock.json`. head() gives its ETag and age. A missing lock is taken with
 allowOverwrite:false; a lock older than the lease (a crashed holder) is taken over with ifMatch.
 A fresh lock, an existing blob or an ETag mismatch throw {conflict:true}. The lock is deleted
 (ifMatch our ETag) when fn settles, so the next save can take it at once.
*/
export async function withLock(cfg, fn) {
  const pathname = cfg.prefix + 'lock.json';
  let meta = null;
  try {
    meta = await api.head(pathname, opts(cfg.primary));
  } catch (e) {
    if (!(e instanceof BlobNotFoundError)) throw e;
  }
  if (meta && Date.now() - new Date(meta.uploadedAt).getTime() < LOCK_LEASE_MS) throw conflictError();

  const body = JSON.stringify({ at: new Date().toISOString(), id: random6() });
  let mine;
  try {
    mine = await api.put(pathname, body, opts(cfg.primary, {
      addRandomSuffix: false, contentType: JSON_TYPE, ...(meta ? { ifMatch: meta.etag } : { allowOverwrite: false }),
    }));
  } catch (e) {
    if (isWriteConflict(e)) throw conflictError();
    throw e;
  }
  try {
    return await fn();
  } finally {
    try { await api.del(pathname, opts(cfg.primary, { ifMatch: mine.etag })); } catch { /* the lease expires on its own */ }
  }
}
