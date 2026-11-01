/*
 In process adapter for the api/*.js handlers: Vercel style req/res without a network or a port.

 Usage:

   import handler from '../api/data.js';
   import { setBlobApi } from '../api/_store.js';
   import { createFakeBlob } from './helpers/api-fake-blob.js';
   import { callApi, makeFetch, useEnv } from './helpers/api-harness.js';

   const fake = createFakeBlob({ stores: { 'vercel_blob_rw_pub_x': 'public' } });
   setBlobApi(fake.api);
   const restore = useEnv({ APP_KEY: 'k', VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_pub_x' });

   // One call: body may be an object (as Vercel hands over parsed JSON) or a raw string / Buffer
   // (parsed the way Vercel does for its content-type; invalid JSON makes req.body throw).
   const r = await callApi(handler, { method: 'PUT', url: '/api/data', headers: { 'x-app-key': 'k' }, body: { bills: [] } });
   r.status; r.headers['cache-control']; r.json;

   // A fetch compatible function, e.g. for lib/sync.js:
   //   createSync({ fetch: makeFetch({ '/api/data': handler }), ... })
   // Routes match on the URL pathname (relative URLs resolve against http://localhost). A single handler
   // instead of a map serves every path. Returns real Response objects.

   restore();       // puts process.env back
   setBlobApi();    // back to the real @vercel/blob functions

 makeReqRes(...) gives the raw {req, res, done} pair when a test needs to drive a handler by hand.
*/

const lower = h => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]));

// What Vercel's Node runtime does with a raw body (see @vercel/node getBodyParser): parse by content-type.
// Invalid JSON throws a 400 error from the req.body getter.
export function vercelParseBody(contentType, buf) {
  if (!contentType) return undefined;
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  const text = () => (Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? ''));
  if (type === 'application/json') {
    const s = text();
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
    }
  }
  if (type === 'application/octet-stream') return Buffer.isBuffer(buf) ? buf : Buffer.from(text());
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(text()));
  if (type === 'text/plain') return text();
  return undefined;
}

// Vercel's req.query: every search param, repeated ones as arrays.
export function queryOf(url) {
  const q = {};
  for (const [k, v] of new URL(url, 'http://localhost').searchParams) {
    q[k] = k in q ? [].concat(q[k], v) : v;
  }
  return q;
}

export function makeReqRes({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const h = lower(headers);
  const req = { method: method.toUpperCase(), url, headers: h, query: queryOf(url) };
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    h['content-type'] ??= 'application/json';
    h['content-length'] ??= String(buf.length);
    let parsed, done = false;
    Object.defineProperty(req, 'body', {
      enumerable: true,
      get() {
        if (!done) { parsed = vercelParseBody(h['content-type'], buf); done = true; }
        return parsed;
      },
    });
  } else if (body !== undefined) {
    h['content-type'] ??= 'application/json';
    req.body = body;
  }

  let finish;
  const done = new Promise(r => { finish = r; });
  const out = { status: 200, headers: {}, body: undefined };
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name, value) { out.headers[name.toLowerCase()] = value; return res; },
    getHeader(name) { return out.headers[name.toLowerCase()]; },
    removeHeader(name) { delete out.headers[name.toLowerCase()]; },
    status(n) { res.statusCode = n; return res; },
    json(obj) {
      if (!out.headers['content-type']) out.headers['content-type'] = 'application/json; charset=utf-8';
      return res.end(JSON.stringify(obj));
    },
    send(data) {
      if (data !== null && typeof data === 'object' && !Buffer.isBuffer(data)) return res.json(data);
      return res.end(data);
    },
    end(data) {
      if (res.headersSent) throw new Error('Response already sent');
      res.headersSent = true;
      out.status = res.statusCode;
      out.body = data === undefined ? '' : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      finish(out);
      return res;
    },
  };
  return { req, res, done };
}

// -> {status, headers (lowercase names), json (parsed body or null), text}
export async function callApi(handler, { method = 'GET', url = '/', headers = {}, body } = {}) {
  const { req, res, done } = makeReqRes({ method, url, headers, body });
  await handler(req, res);
  if (!res.headersSent) throw new Error(`Handler for ${method} ${url} returned without sending a response`);
  const out = await done;
  let json = null;
  try { json = out.body ? JSON.parse(out.body) : null; } catch { json = null; }
  return { status: out.status, headers: out.headers, json, text: out.body };
}

// fetch(input, init) -> Response, served by the handlers in process.
export function makeFetch(routes) {
  return async function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, 'http://localhost');
    const handler = typeof routes === 'function' ? routes : routes[u.pathname];
    const headers = {};
    new Headers(init.headers || (input && input.headers) || {}).forEach((v, k) => { headers[k] = v; });
    if (!handler) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    let body = init.body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      body = Buffer.from(await new Response(body).arrayBuffer());
    }
    const r = await callApi(handler, { method: init.method || 'GET', url: u.pathname + u.search, headers, body: body ?? undefined });
    return new Response(r.status === 204 || r.status === 304 ? null : r.text, { status: r.status, headers: r.headers });
  };
}

// Sets env vars (undefined deletes one) and returns a function that restores the previous values.
export function useEnv(vars) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
}
