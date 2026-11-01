// Blob storage wrapper: which store and prefix to use, versions, seeding and the save lock.
// The blob functions are injected (setBlobApi) so tests and the dev server run on an in memory fake.

import { randomUUID } from 'node:crypto';
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
// A save that finds the lock held waits for it: it checks again every LOCK_POLL_MS, for up to LOCK_WAIT_MS.
export const LOCK_POLL_MS = 150;
export const LOCK_WAIT_MS = 3000;

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

// 'finance/data-1731596400000-<uuid>.json' -> 1731596400000. Also 'data-<ms>.json' (build B) and the
// legacy 'data-<ms>-<Vercel random suffix>.json': whatever follows the ms is ignored.
const tsOf = (pathname, uploadedAt) => {
  const m = /data-(\d{10,})/.exec(pathname);
  return m ? Number(m[1]) : new Date(uploadedAt).getTime();
};

// Every blob under a prefix in one store, following list() pagination, in the order list gives them.
async function listAll(store, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await api.list(opts(store, { prefix, limit: 1000, ...(cursor ? { cursor } : {}) }));
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// Every blob under a prefix in one store, newest first.
async function listIn(store, prefix) {
  const out = (await listAll(store, prefix)).map(b => (
    { pathname: b.pathname, ts: tsOf(b.pathname, b.uploadedAt), uploadedAt: new Date(b.uploadedAt).toISOString(), size: b.size }
  ));
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

// `data-<ms>-<uuid>.json`: the ms keeps the versions in order, the UUID makes the name unguessable. That matters
// while the versions sit in a public store, where anyone holding a blob's URL can read it. Same names in a private store.
export async function writeVersion(cfg, doc, after) {
  const pathname = `${cfg.prefix}data-${nextTs(after)}-${randomUUID()}.json`;
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
 Daily read limit: one tiny blob per read, `finance-meta/reads/<day>/read-NN.json`, in the primary store and
 shared by preview and production. NN is the read's place in the day, 01 up to the limit. A read lists the day's
 folder (list is an API call, never a CDN copy, unlike get on a public store) and claims the next place with
 allowOverwrite:false. The store itself then makes sure each place goes to exactly one read, so concurrent reads
 can never get more than `limit` through; a read that finds its place taken tries the next one.
 Folders older than 2 days are deleted by the first read of each day, best effort.
 -> {ok:true, count} counted as read number `count`; {ok:false, count} every place for the day is taken.
*/
export const READS_ROOT = 'finance-meta/reads/';
export const readsFolder = day => `${READS_ROOT}${day}/`;
const readPath = (day, n) => `${readsFolder(day)}read-${String(n).padStart(2, '0')}.json`;
const KEEP_READ_DAYS = 2;

export async function incrementReadCount(cfg, day, limit) {
  const taken = (await listAll(cfg.primary, readsFolder(day))).length;
  for (let n = taken + 1; n <= limit; n++) {
    try {
      await api.put(readPath(day, n), JSON.stringify({ at: new Date().toISOString() }), opts(cfg.primary, {
        addRandomSuffix: false, allowOverwrite: false, contentType: JSON_TYPE,
      }));
    } catch (e) {
      if (isWriteConflict(e)) continue; // another read got this place first
      throw e;
    }
    if (n === 1) {
      try { await pruneReads(cfg, day); } catch { /* the next day tries again */ }
    }
    return { ok: true, count: n };
  }
  return { ok: false, count: Math.max(taken, limit) };
}

// 'YYYY-MM-DD' minus n calendar days.
const dayMinus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

// Deletes the reads folders of days before (today - KEEP_READ_DAYS). Nothing else under finance-meta/ is touched.
async function pruneReads(cfg, today) {
  const cutoff = dayMinus(today, KEEP_READ_DAYS);
  const folders = new Set();
  let cursor;
  do {
    const page = await api.list(opts(cfg.primary, { prefix: READS_ROOT, mode: 'folded', limit: 1000, ...(cursor ? { cursor } : {}) }));
    for (const f of page.folders || []) folders.add(f);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  for (const folder of folders) {
    const day = folder.slice(READS_ROOT.length).replace(/\/$/, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= cutoff) continue;
    const old = (await listAll(cfg.primary, folder)).map(b => b.pathname).filter(p => p.startsWith(folder));
    if (old.length) await api.del(old, opts(cfg.primary));
  }
}

const conflictError = () => Object.assign(new Error('Another save is in progress'), { conflict: true });

/*
 Save lock on `${prefix}lock.json`. head() gives its ETag and age. A missing lock is taken with
 allowOverwrite:false; a lock older than the lease (a crashed holder) is taken over with ifMatch.
 A fresh lock, an existing blob or an ETag mismatch mean someone else holds it: withLock checks again every
 pollMs for up to waitMs (a save in progress takes well under a second), then throws {conflict:true}.
 waitMs 0 gives up at once. The lock is deleted (ifMatch our ETag) when fn settles, so the next save can take it at once.
*/
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One try: the put result when we now hold the lock, null when someone else does.
async function tryLock(cfg, pathname) {
  let meta = null;
  try {
    meta = await api.head(pathname, opts(cfg.primary));
  } catch (e) {
    if (!(e instanceof BlobNotFoundError)) throw e;
  }
  if (meta && Date.now() - new Date(meta.uploadedAt).getTime() < LOCK_LEASE_MS) return null;

  const body = JSON.stringify({ at: new Date().toISOString(), id: randomUUID() });
  try {
    return await api.put(pathname, body, opts(cfg.primary, {
      addRandomSuffix: false, contentType: JSON_TYPE, ...(meta ? { ifMatch: meta.etag } : { allowOverwrite: false }),
    }));
  } catch (e) {
    if (isWriteConflict(e)) return null;
    throw e;
  }
}

export async function withLock(cfg, fn, { waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS } = {}) {
  const pathname = cfg.prefix + 'lock.json';
  const deadline = Date.now() + waitMs;
  // Counted as well as timed, so a clock that stands still (a test's mocked Date) still ends the wait.
  const tries = Math.floor(waitMs / pollMs) + 1;
  let mine;
  for (let i = 1; !(mine = await tryLock(cfg, pathname)); i++) {
    if (i >= tries || Date.now() >= deadline) throw conflictError();
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  try {
    return await fn();
  } finally {
    try { await api.del(pathname, opts(cfg.primary, { ifMatch: mine.etag })); } catch { /* the lease expires on its own */ }
  }
}
