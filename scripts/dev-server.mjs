// Local server (spec section 9): static files from the repo root, and /api/<name> served by api/<name>.js
// through a Vercel style req/res. Storage is an in memory blob fake and Claude is a fake that returns the
// Oct 31 sample rows for any file, so nothing here can reach real data, real storage or the real API.
//
//   node scripts/dev-server.mjs [--port 4321] [--seed tests/fixtures/sample-nov.js]
//
// From another script (e2e): const dev = await startDevServer({ port: 0 }); ... dev.url ... await dev.close();

import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { setBlobApi, storeConfig, writeVersion } from '../api/_store.js';
import { setAnthropicFactory } from '../api/read.js';
import { createFakeBlob } from '../tests/helpers/api-fake-blob.js';
import { queryOf, vercelParseBody } from '../tests/helpers/api-harness.js';
import { rows as SAMPLE_ROWS } from '../tests/fixtures/oct31.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 4.5 * 1024 * 1024; // Vercel's request body limit for functions
const FAKE_BLOB_TOKEN = 'vercel_blob_rw_devstore_inmemoryfake';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const fakeClaude = () => ({
  beta: {
    messages: {
      create: async params => {
        await new Promise(r => setTimeout(r, 300)); // feels like a real read
        return {
          id: 'msg_dev_fake', type: 'message', role: 'assistant', model: params.model,
          content: [{ type: 'text', text: JSON.stringify({ rows: SAMPLE_ROWS }) }],
          stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 0, output_tokens: 0 },
        };
      },
    },
  },
});

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'private, no-store');
  res.end(JSON.stringify(obj));
}

// Adds what Vercel's Node runtime gives a handler: req.query, a lazily parsed req.body, res.status/json/send.
function vercelize(req, res, url, buf) {
  req.query = queryOf(url.pathname + url.search);
  let parsed, done = false;
  Object.defineProperty(req, 'body', {
    configurable: true,
    get() {
      if (!done) { parsed = vercelParseBody(req.headers['content-type'], buf); done = true; }
      return parsed;
    },
  });
  res.status = n => { res.statusCode = n; return res; };
  res.json = obj => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = data => (data !== null && typeof data === 'object' && !Buffer.isBuffer(data) ? res.json(data) : (res.end(data), res));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => ok(size > MAX_BODY ? null : Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

const handlers = new Map();
async function loadHandler(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return null; // '_store' and friends are helpers, not routes
  if (!handlers.has(name)) {
    const file = join(ROOT, 'api', name + '.js');
    handlers.set(name, existsSync(file) ? (await import(pathToFileURL(file).href)).default : null);
  }
  return handlers.get(name);
}

async function serveApi(req, res, url, log) {
  const handler = await loadHandler(url.pathname.slice('/api/'.length).replace(/\/$/, ''));
  if (typeof handler !== 'function') return sendJson(res, 404, { error: 'Not found' });
  const buf = await readBody(req);
  if (buf === null) return sendJson(res, 413, { error: 'Request body is over the 4.5 MB limit' });
  vercelize(req, res, url, buf);
  const t = Date.now();
  try {
    await handler(req, res);
  } catch (e) {
    console.error(`${req.method} ${url.pathname} threw:`, e && e.message);
    if (!res.headersSent) sendJson(res, e && e.statusCode === 400 ? 400 : 500, { error: 'Server error' });
  }
  if (log) console.log(`${req.method} ${url.pathname}${url.search} ${res.statusCode} ${Date.now() - t} ms`);
}

async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'Bad path' }); }
  if (pathname.split('/').some(seg => seg.startsWith('.'))) return sendJson(res, 404, { error: 'Not found' }); // .git, .env
  let file = resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return sendJson(res, 404, { error: 'Not found' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.statusCode = 200;
    res.setHeader('content-type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

export async function startDevServer({ port = 4321, host = '127.0.0.1', seed = null, log = true } = {}) {
  process.env.APP_KEY ||= 'dev-key';
  process.env.VERCEL_ENV ||= 'preview';
  // The fake is the only storage and the only Claude. Real tokens from the shell are never handed to anything.
  process.env.BLOB_READ_WRITE_TOKEN = FAKE_BLOB_TOKEN;
  delete process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
  process.env.ANTHROPIC_API_KEY = 'dev-fake-anthropic-key';

  const fake = createFakeBlob({ stores: { [FAKE_BLOB_TOKEN]: 'public' } });
  setBlobApi(fake.api);
  setAnthropicFactory(fakeClaude);

  if (seed) {
    const mod = await import(pathToFileURL(resolve(process.cwd(), seed)).href);
    const doc = structuredClone(mod.default);
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.bills)) throw new Error(`--seed ${seed}: the default export is not a finance doc`);
    doc.savedAt ||= new Date().toISOString();
    doc.note ??= 'Sample data';
    await writeVersion(storeConfig(), doc);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const work = url.pathname.startsWith('/api/') ? serveApi(req, res, url, log) : serveStatic(req, res, url);
    work.catch(e => {
      console.error('dev server error:', e && e.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
    });
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const actual = server.address().port;
  return {
    server,
    fake,
    port: actual,
    url: `http://${host}:${actual}`,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

function argValue(args, name) {
  const i = args.findIndex(a => a === name || a.startsWith(name + '='));
  if (i < 0) return null;
  return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1] ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const port = Number(argValue(args, '--port') ?? 4321);
  const seed = argValue(args, '--seed');
  try {
    const dev = await startDevServer({ port, seed });
    console.log(`Dev server on ${dev.url}`);
    console.log(`Open ${dev.url}/?key=${process.env.APP_KEY} once to set up this browser.`);
    console.log(`Storage and Claude are in memory fakes${seed ? `, seeded from ${seed}` : ''}. Ctrl+C stops it.`);
    const stop = () => dev.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    console.error(e && e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port 4322.` : e);
    process.exit(1);
  }
}
