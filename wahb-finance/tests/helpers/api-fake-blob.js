// In memory fake of the @vercel/blob 2.8.2 functions api/_store.js uses: put, list, del, get, head.
// Follows the real signatures, return shapes and errors (the real error classes, so instanceof checks match):
//   put(pathname, body, {access, token, addRandomSuffix=false, allowOverwrite=false, contentType, cacheControlMaxAge, ifMatch})
//     -> {url, downloadUrl, pathname, contentType, contentDisposition, etag}
//     existing pathname without allowOverwrite/ifMatch -> BlobError "This blob already exists ..."
//     ifMatch on a missing blob or a different ETag -> BlobPreconditionFailedError
//     ifMatch with allowOverwrite:false -> BlobError (contradictory, checked before any request, like the SDK)
//   head(urlOrPathname, {token}) -> {size, uploadedAt: Date, pathname, contentType, contentDisposition, url, downloadUrl, cacheControl, etag}
//     missing -> BlobNotFoundError
//   get(urlOrPathname, {access, token, useCache, ifNoneMatch}) -> null when missing, else
//     {statusCode: 200, stream: ReadableStream<Uint8Array>, headers: Headers, blob: {url, downloadUrl, pathname, contentType,
//      contentDisposition, cacheControl, size, uploadedAt: Date, etag}}  (304 with stream null when ifNoneMatch matches)
//   list({token, prefix, limit=1000, cursor, mode}) -> {blobs: [{url, downloadUrl, pathname, size, uploadedAt: Date, etag}], cursor, hasMore}
//     sorted by pathname, paginated (pageSize option forces small pages so callers must follow the cursor)
//   del(urlOrPathname | array, {token, ifMatch}) -> undefined; missing blobs are ignored; ifMatch mismatch -> BlobPreconditionFailedError
// Each token is its own store. A store has one access type: a call with the other access throws, so a wrong
// {token, access} pair in the code under test fails loudly. Nothing here touches the network.

import { createHash } from 'node:crypto';
import { BlobError, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';

export { BlobError, BlobNotFoundError, BlobPreconditionFailedError };

const ALREADY_EXISTS = 'This blob already exists, use `allowOverwrite: true` if you want to overwrite it. Or `addRandomSuffix: true` to generate a unique filename.';
const NO_TOKEN = 'No read-write token found. Either configure the `BLOB_READ_WRITE_TOKEN` environment variable, or pass a `token` option to your calls.';
const TYPES = { json: 'application/json', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' };

const yieldNow = () => new Promise(r => setImmediate(r));
const isPlainObject = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const randomSuffix = () => Array.from({ length: 30 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');

async function toBuffer(body) {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== 'undefined' && body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body && typeof body.getReader === 'function') return Buffer.from(await new Response(body).arrayBuffer());
  throw new BlobError('Unsupported body type in the fake');
}

/**
 * createFakeBlob({ stores: { [token]: 'public' | 'private' }, pageSize, now, latency })
 *   latency          ms each call takes on the "network" before the store acts on it: a number, or
 *                    (call) => ms for jitter. Default 0 (only a setImmediate yield, as before).
 *                    The store checks (exists, ETag) happen after the wait, like on the real server.
 *   fake.setLatency(latency) change it later
 *   fake.api         {put, list, del, get, head} to pass to setBlobApi
 *   fake.addStore(token, access)
 *   fake.seed(token, pathname, text, {uploadedAt, contentType})   write directly, no checks, no log entry
 *   fake.text(token, pathname) / fake.json(token, pathname)       read directly
 *   fake.pathnames(token, prefix = '')                            sorted pathnames
 *   fake.snapshot(token, prefix = '')                             [{pathname, text, etag, uploadedAt}] for byte for byte comparisons
 *   fake.calls        every call: {fn, token, access, pathname | pathnames | prefix, options}
 *   fake.pause(match) holds calls for which match(call) is true until the returned release() runs;
 *                     fake.paused() resolves once a call is waiting
 *   fake.failNext(fn, error) the next call of fn throws error
 *   fake.setClock(fn) source of uploadedAt (default Date.now)
 */
export function createFakeBlob({ stores = {}, pageSize = 1000, now = () => Date.now(), latency = 0 } = {}) {
  const data = new Map(); // token -> {access, storeId, blobs: Map<pathname, record>}
  const calls = [];
  const holds = [];
  const failures = new Map();
  let clock = now;
  let waiting = [];
  let held = 0;
  let etagSeq = 0;

  function addStore(token, access) {
    if (access !== 'public' && access !== 'private') throw new Error('access must be public or private');
    const storeId = String(token).split('_')[3] || 'fake' + (data.size + 1);
    data.set(token, { access, storeId, blobs: new Map() });
  }
  for (const [t, a] of Object.entries(stores)) addStore(t, a);

  function storeFor(options, { checkAccess }) {
    const token = options && options.token;
    if (!token) throw new BlobError(NO_TOKEN);
    const s = data.get(token);
    if (!s) throw new BlobError('Access denied, please provide a valid token for this resource.');
    if (checkAccess && options.access !== s.access) {
      throw new BlobError(`Fake: access "${options.access}" used on a ${s.access} store`);
    }
    return s;
  }
  const urlOf = (s, pathname) => `https://${s.storeId}.${s.access}.blob.vercel-storage.com/${pathname}`;
  const pathOf = urlOrPathname => {
    try { return new URL(urlOrPathname).pathname.slice(1); } catch { return String(urlOrPathname); }
  };
  const etagOf = buf => `"${createHash('md5').update(buf).update(String(++etagSeq)).digest('hex')}"`;

  async function enter(call) {
    calls.push(call);
    await yieldNow();
    const ms = typeof latency === 'function' ? latency(call) : latency;
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
    for (const h of holds) {
      if (h.active && h.match(call)) {
        held++;
        const w = waiting; waiting = []; w.forEach(r => r());
        await h.promise;
        held--;
      }
    }
    const err = failures.get(call.fn);
    if (err) { failures.delete(call.fn); throw err; }
  }

  async function put(pathname, body, options) {
    if (!body) throw new BlobError('body is required');
    if (isPlainObject(body)) throw new BlobError("Body must be a string, buffer or stream. You sent a plain JavaScript object, double check what you're trying to upload.");
    if (!pathname) throw new BlobError('pathname is required');
    if (pathname.includes('//')) throw new BlobError('pathname cannot contain "//", please encode it if needed');
    if (!options) throw new BlobError('missing options, see usage');
    if (options.access !== 'public' && options.access !== 'private') throw new BlobError('access must be "private" or "public", see https://vercel.com/docs/vercel-blob');
    if (options.ifMatch && options.allowOverwrite === false) {
      throw new BlobError('ifMatch and allowOverwrite: false are contradictory. ifMatch is used for conditional overwrites, which requires allowOverwrite to be true.');
    }
    const s = storeFor(options, { checkAccess: true });
    const buf = await toBuffer(body);
    await enter({ fn: 'put', token: options.token, access: options.access, pathname, options: { ...options, token: undefined }, text: buf.toString('utf8') });

    let finalPath = pathname;
    if (options.addRandomSuffix) {
      const dot = pathname.lastIndexOf('.');
      finalPath = dot > pathname.lastIndexOf('/') ? `${pathname.slice(0, dot)}-${randomSuffix()}${pathname.slice(dot)}` : `${pathname}-${randomSuffix()}`;
    }
    const existing = s.blobs.get(finalPath);
    if (options.ifMatch) {
      if (!existing || existing.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
    } else if (existing && !options.allowOverwrite) {
      throw new BlobError(ALREADY_EXISTS);
    }
    const ext = finalPath.split('.').pop().toLowerCase();
    const rec = {
      buf,
      etag: etagOf(buf),
      uploadedAt: new Date(clock()),
      contentType: options.contentType || TYPES[ext] || 'application/octet-stream',
      cacheControl: `public, max-age=${options.cacheControlMaxAge ?? 2592000}`,
    };
    s.blobs.set(finalPath, rec);
    return {
      url: urlOf(s, finalPath), downloadUrl: urlOf(s, finalPath) + '?download=1', pathname: finalPath,
      contentType: rec.contentType, contentDisposition: `inline; filename="${finalPath.split('/').pop()}"`, etag: rec.etag,
    };
  }

  function meta(s, pathname, rec) {
    return {
      url: urlOf(s, pathname), downloadUrl: urlOf(s, pathname) + '?download=1', pathname,
      contentDisposition: `inline; filename="${pathname.split('/').pop()}"`, cacheControl: rec.cacheControl,
      uploadedAt: new Date(rec.uploadedAt), etag: rec.etag,
    };
  }

  async function head(urlOrPathname, options) {
    const s = storeFor(options, { checkAccess: false });
    const pathname = pathOf(urlOrPathname);
    await enter({ fn: 'head', token: options.token, access: options.access, pathname, options: { ...options, token: undefined } });
    const rec = s.blobs.get(pathname);
    if (!rec) throw new BlobNotFoundError();
    return { ...meta(s, pathname, rec), size: rec.buf.length, contentType: rec.contentType };
  }

  async function get(urlOrPathname, options) {
    if (!urlOrPathname) throw new BlobError('url or pathname is required');
    if (!options) throw new BlobError('missing options, see usage');
    if (options.access !== 'public' && options.access !== 'private') throw new BlobError('access must be "private" or "public", see https://vercel.com/docs/vercel-blob');
    const s = storeFor(options, { checkAccess: true });
    const pathname = pathOf(urlOrPathname);
    await enter({ fn: 'get', token: options.token, access: options.access, pathname, options: { ...options, token: undefined } });
    const rec = s.blobs.get(pathname);
    if (!rec) return null;
    const headers = new Headers({ etag: rec.etag, 'content-type': rec.contentType, 'last-modified': rec.uploadedAt.toUTCString() });
    if (options.ifNoneMatch && options.ifNoneMatch === rec.etag) {
      return { statusCode: 304, stream: null, headers, blob: { ...meta(s, pathname, rec), contentType: null, size: null } };
    }
    const bytes = new Uint8Array(rec.buf);
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
    headers.set('content-length', String(bytes.length));
    return { statusCode: 200, stream, headers, blob: { ...meta(s, pathname, rec), contentType: rec.contentType, size: bytes.length } };
  }

  async function list(options = {}) {
    const s = storeFor(options, { checkAccess: false });
    const prefix = options.prefix || '';
    await enter({ fn: 'list', token: options.token, access: options.access, prefix, options: { ...options, token: undefined } });
    const limit = Math.min(options.limit || 1000, 1000, pageSize);
    const all = [...s.blobs.keys()].filter(p => p.startsWith(prefix)).sort();
    const start = options.cursor ? Number(Buffer.from(options.cursor, 'base64url').toString()) : 0;
    const page = all.slice(start, start + limit);
    const hasMore = start + limit < all.length;
    const blobs = page.map(p => {
      const rec = s.blobs.get(p);
      return { url: urlOf(s, p), downloadUrl: urlOf(s, p) + '?download=1', pathname: p, size: rec.buf.length, uploadedAt: new Date(rec.uploadedAt), etag: rec.etag };
    });
    const out = { cursor: hasMore ? Buffer.from(String(start + limit)).toString('base64url') : undefined, hasMore, blobs };
    if (options.mode === 'folded') {
      out.folders = [...new Set(page.map(p => p.slice(prefix.length)).filter(r => r.includes('/')).map(r => prefix + r.split('/')[0] + '/'))];
      out.blobs = blobs.filter(b => !b.pathname.slice(prefix.length).includes('/'));
    }
    return out;
  }

  async function del(urlOrPathname, options) {
    const items = Array.isArray(urlOrPathname) ? urlOrPathname : [urlOrPathname];
    if (options && options.ifMatch && items.length > 1) throw new BlobError('ifMatch can only be used when deleting a single URL.');
    const s = storeFor(options, { checkAccess: false });
    const pathnames = items.map(pathOf);
    await enter({ fn: 'del', token: options.token, access: options.access, pathnames, options: { ...options, token: undefined } });
    if (options.ifMatch) {
      const rec = s.blobs.get(pathnames[0]);
      if (!rec || rec.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
    }
    for (const p of pathnames) s.blobs.delete(p);
  }

  const storeOrThrow = token => {
    const s = data.get(token);
    if (!s) throw new Error('Fake: no store for that token');
    return s;
  };

  return {
    api: { put, list, del, get, head },
    calls,
    addStore,
    seed(token, pathname, text, { uploadedAt = clock(), contentType } = {}) {
      const s = storeOrThrow(token);
      const buf = Buffer.from(text, 'utf8');
      const ext = pathname.split('.').pop().toLowerCase();
      s.blobs.set(pathname, { buf, etag: etagOf(buf), uploadedAt: new Date(uploadedAt), contentType: contentType || TYPES[ext] || 'application/octet-stream', cacheControl: 'public, max-age=2592000' });
    },
    text(token, pathname) {
      const rec = storeOrThrow(token).blobs.get(pathname);
      return rec ? rec.buf.toString('utf8') : null;
    },
    json(token, pathname) {
      const t = this.text(token, pathname);
      return t == null ? null : JSON.parse(t);
    },
    pathnames(token, prefix = '') {
      return [...storeOrThrow(token).blobs.keys()].filter(p => p.startsWith(prefix)).sort();
    },
    snapshot(token, prefix = '') {
      const s = storeOrThrow(token);
      return this.pathnames(token, prefix).map(p => {
        const r = s.blobs.get(p);
        return { pathname: p, text: r.buf.toString('utf8'), etag: r.etag, uploadedAt: r.uploadedAt.toISOString() };
      });
    },
    pause(match) {
      let release;
      const h = { match, active: true, promise: new Promise(r => { release = r; }) };
      holds.push(h);
      return () => { h.active = false; release(); };
    },
    paused() {
      return held > 0 ? Promise.resolve() : new Promise(r => waiting.push(r));
    },
    failNext(fn, error) {
      failures.set(fn, error);
    },
    setClock(fn) {
      clock = fn;
    },
    setLatency(next) {
      latency = next;
    },
  };
}
