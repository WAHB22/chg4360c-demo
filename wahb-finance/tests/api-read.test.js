// api/read.js with a fake Anthropic client and the in memory blob fake. No network, no real keys.

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

import handler, { ROWS_SCHEMA, SYSTEM, MODEL, cleanRows, defaultAnthropicFactory, setAnthropicFactory, torontoDay, validRow } from '../api/read.js';
import { setBlobApi } from '../api/_store.js';
import { createFakeBlob } from './helpers/api-fake-blob.js';
import { callApi, useEnv } from './helpers/api-harness.js';
import { rows as OCT31 } from './fixtures/oct31.js';

const KEY = 'device-key-for-tests';
const PUB = 'vercel_blob_rw_publicstore_fakesecret';
const PRIV = 'vercel_blob_rw_privatestore_fakesecret';
const HOST = 'wahb-finance.example';
const MB = 1024 * 1024;
const LIMIT_MSG = 'You have used all 30 reads for today. They reset at midnight. CSV files still work.';

// A few bytes that stand in for a screenshot / a PDF. Their content does not matter to the handler.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex').toString('base64');
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');

let cleanup = null;
afterEach(() => { if (cleanup) cleanup(); cleanup = null; mock.timers.reset(); mock.restoreAll(); });

const message = (over = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: MODEL,
  content: [{ type: 'text', text: JSON.stringify({ rows: OCT31 }) }],
  stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 10, output_tokens: 10 }, ...over,
});

function setup({ env = {}, stores = { [PUB]: 'public' }, reply = message(), latency } = {}) {
  const fake = createFakeBlob({ stores, latency });
  setBlobApi(fake.api);
  const calls = [];
  setAnthropicFactory(() => ({
    beta: { messages: { create: async params => { calls.push(params); return typeof reply === 'function' ? reply(params) : reply; } } },
  }));
  const restore = useEnv({
    APP_KEY: KEY, ANTHROPIC_API_KEY: 'test-only-not-a-real-key', VERCEL_ENV: 'preview',
    BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined, ...env,
  });
  cleanup = () => { restore(); setBlobApi(); setAnthropicFactory(); };
  return { fake, calls };
}

const headers = (extra = {}) => ({ 'x-app-key': KEY, origin: `https://${HOST}`, 'x-forwarded-host': HOST, host: 'internal.host', ...extra });
const file = (extra = {}) => ({ name: 'notif.png', type: 'image/png', data: PNG, uploadDate: '2026-10-31', ...extra });
const post = (body = file(), h = headers()) => callApi(handler, { method: 'POST', url: '/api/read', headers: h, body });
const counterPaths = fake => fake.pathnames(PUB, 'finance-meta/');
const readsIn = (fake, day, token = PUB) => fake.pathnames(token, `finance-meta/reads/${day}/`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Fails instead of hanging when the awaited thing never happens.
function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`${what} did not happen within ${ms} ms`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
const captureLogs = () => {
  const logs = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) mock.method(console, m, (...a) => logs.push(a.map(String).join(' ')));
  return logs;
};

/* ---------- gatekeeping ---------- */

test('401 without the device key', async () => {
  const { fake, calls } = setup();
  for (const h of [headers({ 'x-app-key': undefined }), headers({ 'x-app-key': 'nope' })]) {
    if (h['x-app-key'] === undefined) delete h['x-app-key'];
    const r = await post(file(), h);
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: 'This device is not set up' });
  }
  const restore = useEnv({ APP_KEY: undefined });
  assert.equal((await post()).status, 401);
  restore();
  assert.equal(calls.length, 0);
  assert.equal(fake.calls.length, 0);
});

test('403 unless the request comes from the app itself', async () => {
  const { calls } = setup();
  const cases = [
    headers({ origin: undefined }),
    headers({ origin: 'https://evil.example' }),
    headers({ origin: `https://${HOST}.evil.example` }),
    headers({ origin: `http://${HOST}:8080` }),
    headers({ origin: 'null' }),
  ];
  for (const h of cases) {
    if (h.origin === undefined) delete h.origin;
    const r = await post(file(), h);
    assert.equal(r.status, 403, String(h.origin));
    assert.deepEqual(r.json, { error: 'Uploads only from the app itself' });
  }
  // Without x-forwarded-host the Host header is used (local dev server).
  const local = await post(file(), { 'x-app-key': KEY, origin: 'http://127.0.0.1:4321', host: '127.0.0.1:4321' });
  assert.equal(local.status, 200);
  assert.equal(calls.length, 1);
});

test('405 on anything but POST', async () => {
  setup();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const r = await callApi(handler, { method, url: '/api/read', headers: headers() });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'POST');
  }
});

test('415 for types other than JPEG, PNG, WebP, GIF and PDF', async () => {
  const { calls } = setup();
  for (const type of ['text/plain', 'image/heic', 'image/svg+xml', 'text/csv', '', undefined]) {
    const r = await post(file({ type }));
    assert.equal(r.status, 415, String(type));
  }
  assert.equal(calls.length, 0);
});

test('400 when the body or the base64 data is not readable', async () => {
  const { calls } = setup();
  for (const body of ['{oops', '"just text"', JSON.stringify(file({ data: '' })), JSON.stringify(file({ data: '***not base64***' })), JSON.stringify(file({ data: 42 }))]) {
    const r = await post(body);
    assert.equal(r.status, 400, body.slice(0, 40));
  }
  assert.equal(calls.length, 0);
});

test('413 when the decoded file is over 10 MB; exactly 10 MB is read', async () => {
  const { calls, fake } = setup();
  const over = await post(file({ data: Buffer.alloc(10 * MB + 1, 7).toString('base64') }));
  assert.equal(over.status, 413);
  assert.deepEqual(over.json, { error: 'That file is over 10 MB' });
  assert.equal(calls.length, 0);
  assert.deepEqual(counterPaths(fake), [], 'a rejected file uses no read');

  const exact = await post(file({ type: 'application/pdf', data: Buffer.alloc(10 * MB, 7).toString('base64') }));
  assert.equal(exact.status, 200);
  assert.equal(calls.length, 1);
});

test('503 without ANTHROPIC_API_KEY, and no read is used up', async () => {
  const { calls, fake } = setup({ env: { ANTHROPIC_API_KEY: undefined } });
  const r = await post();
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: 'Reading screenshots is not set up yet. CSV files still work.' });
  assert.equal(calls.length, 0);
  assert.deepEqual(counterPaths(fake), []);
});

/* ---------- daily limit ---------- */

test('the 31st read in a Toronto day gets 429; one blob per read under finance-meta/reads/<Toronto day>/', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup();
  for (let i = 1; i <= 30; i++) {
    const r = await post();
    assert.equal(r.status, 200, `read ${i}`);
  }
  const blocked = await post();
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: LIMIT_MSG });
  assert.equal(calls.length, 30, 'Claude is not called for the 31st');
  assert.equal(readsIn(fake, '2026-11-14').length, 30);
  assert.deepEqual(counterPaths(fake).filter(p => !p.startsWith('finance-meta/reads/2026-11-14/')), []);
  for (const p of counterPaths(fake)) assert.ok(fake.text(PUB, p).length < 100, 'a tiny blob');

  // Refused reads leave the count where it is.
  assert.equal((await post()).status, 429);
  assert.equal(readsIn(fake, '2026-11-14').length, 30);

  // 23:30 in Toronto (04:30 UTC the next day) is still Nov 14.
  mock.timers.setTime(Date.parse('2026-11-15T04:30:00Z'));
  assert.equal(torontoDay(), '2026-11-14');
  assert.equal((await post()).status, 429);

  // 00:30 in Toronto: a new day, a new folder.
  mock.timers.setTime(Date.parse('2026-11-15T05:30:00Z'));
  assert.equal(torontoDay(), '2026-11-15');
  assert.equal((await post()).status, 200);
  assert.equal(readsIn(fake, '2026-11-15').length, 1);
  assert.equal(readsIn(fake, '2026-11-14').length, 30);
  assert.equal(calls.length, 31);
});

test('torontoDay follows daylight saving time', () => {
  assert.equal(torontoDay(new Date('2026-07-01T03:59:00Z')), '2026-06-30'); // EDT, UTC-4
  assert.equal(torontoDay(new Date('2026-07-01T04:00:00Z')), '2026-07-01');
  assert.equal(torontoDay(new Date('2026-01-01T04:59:00Z')), '2025-12-31'); // EST, UTC-5
  assert.equal(torontoDay(new Date('2026-01-01T05:00:00Z')), '2026-01-01');
});

test('the day folder is the Toronto date, not the UTC one (summer and winter time)', async () => {
  const cases = [
    ['2026-07-01T03:30:00Z', '2026-06-30'], // 23:30 EDT
    ['2026-07-01T04:30:00Z', '2026-07-01'],
    ['2026-01-01T04:30:00Z', '2025-12-31'], // 23:30 EST
    ['2026-01-01T05:30:00Z', '2026-01-01'],
  ];
  for (const [now, day] of cases) {
    mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
    const { fake } = setup();
    assert.equal((await post()).status, 200);
    assert.deepEqual(counterPaths(fake).map(p => p.split('/')[2]), [day], now);
    cleanup(); cleanup = null;
    mock.timers.reset();
  }
});

test('a day that started with reads from another device: the count comes from the folder, whatever the names', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup();
  for (let i = 0; i < 29; i++) fake.seed(PUB, `finance-meta/reads/2026-11-14/${1_794_000_000_000 + i}-elsewhere${i}.json`, '{}');
  assert.equal((await post()).status, 200);
  const r = await post();
  assert.equal(r.status, 429);
  assert.deepEqual(r.json, { error: LIMIT_MSG });
  assert.equal(calls.length, 1);
  assert.equal(readsIn(fake, '2026-11-14').length, 30);
});

test('the count is taken with list, never get or head: reads back to back work even when get serves an old CDN copy', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup();
  // A public store answers get() from a CDN copy that can be up to 60 s old: here every pathname keeps its first answer.
  const cdn = new Map();
  setBlobApi({
    ...fake.api,
    get: async (p, o) => {
      if (!cdn.has(p)) {
        const r = await fake.api.get(p, o);
        cdn.set(p, r && r.stream ? { ...r, text: await new Response(r.stream).text() } : null);
      }
      const c = cdn.get(p);
      return c && { ...c, stream: new Response(c.text).body };
    },
  });
  for (let i = 1; i <= 6; i++) {
    const r = await post();
    assert.equal(r.status, 200, `read ${i}: ${JSON.stringify(r.json)}`);
  }
  assert.equal(calls.length, 6);
  assert.equal(readsIn(fake, '2026-11-14').length, 6);
  const meta = fake.calls.filter(c => (c.pathname || c.prefix || '').startsWith('finance-meta/'));
  assert.deepEqual([...new Set(meta.map(c => c.fn))].sort(), ['list', 'put']);
  for (const c of meta.filter(x => x.fn === 'put')) assert.equal(c.options.allowOverwrite, false, 'never overwrites a read');
});

test('concurrent reads never let more than 30 through (store calls with random latency)', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup({ latency: () => Math.floor(Math.random() * 15) });
  for (let i = 0; i < 10; i++) assert.equal((await post()).status, 200);
  // 35 more at once, in staggered waves, so some writes land while others are counting.
  const results = await Promise.all(Array.from({ length: 35 }, (_, i) => sleep((i % 5) * 4).then(() => post())));
  const statuses = results.map(r => r.status);
  assert.equal(statuses.filter(s => s === 200).length, 20, String(statuses));
  assert.equal(statuses.filter(s => s === 429).length, 15, String(statuses));
  assert.equal(calls.length, 30);
  assert.equal(readsIn(fake, '2026-11-14').length, 30);

  // A fresh day hit by 40 at once: exactly 30 get through, not fewer.
  mock.timers.setTime(Date.parse('2026-11-15T15:00:00Z'));
  const burst = await Promise.all(Array.from({ length: 40 }, () => post()));
  assert.equal(burst.filter(r => r.status === 200).length, 30);
  assert.equal(burst.filter(r => r.status === 429).length, 10);
  assert.equal(calls.length, 60);
});

test('a read whose write lands late cannot take a 31st place', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup();
  for (let i = 0; i < 29; i++) assert.equal((await post()).status, 200);
  let first = true;
  const release = fake.pause(c => c.fn === 'put' && c.pathname.startsWith('finance-meta/reads/') && first && !(first = false));
  const slow = post(); // counted 29, its write is held on the way to the store
  await within(fake.paused(), 2000, 'a held write of a read');
  const fast = await post(); // also counted 29, writes first
  assert.equal(fast.status, 200);
  release();
  const late = await slow;
  assert.equal(late.status, 429, 'the place it counted on was taken while its write was on the way');
  assert.equal(calls.length, 30);
  assert.equal(readsIn(fake, '2026-11-14').length, 30);
});

test('the reads go in the private store when there is one', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake } = setup({ stores: { [PUB]: 'public', [PRIV]: 'private' }, env: { PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV } });
  assert.equal((await post()).status, 200);
  assert.equal(readsIn(fake, '2026-11-14', PRIV).length, 1);
  assert.deepEqual(fake.pathnames(PUB), []);
  assert.ok(fake.calls.filter(c => c.fn === 'put').every(c => c.access === 'private'));
});

test('reads folders older than 2 days are deleted; the last 2 days, today and other files are kept', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake } = setup();
  for (const day of ['2026-10-30', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
    for (let i = 0; i < 3; i++) fake.seed(PUB, `finance-meta/reads/${day}/${i}.json`, '{}');
  }
  const others = ['finance-meta/read-count-2026-11-10.json', 'finance-meta/reads/notes/keep.json', 'finance-meta/other.json', 'finance-preview/data-1-abc.json'];
  for (const p of others) fake.seed(PUB, p, '{}');

  assert.equal((await post()).status, 200);
  const days = [...new Set(fake.pathnames(PUB, 'finance-meta/reads/').map(p => p.split('/')[2]))];
  assert.deepEqual(days, ['2026-11-12', '2026-11-13', '2026-11-14', 'notes']);
  for (const p of others) assert.equal(fake.text(PUB, p), '{}', p);
  assert.equal(readsIn(fake, '2026-11-12').length, 3);
  assert.equal(readsIn(fake, '2026-11-13').length, 3);
});

test('a cleanup that fails never fails the read', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup();
  fake.seed(PUB, 'finance-meta/reads/2026-11-01/a.json', '{}');
  captureLogs();
  fake.failNext('del', new Error('blob is down'));
  assert.equal((await post()).status, 200);
  assert.equal(fake.text(PUB, 'finance-meta/reads/2026-11-01/a.json'), '{}', 'still there, the next day tries again');

  mock.timers.setTime(Date.parse('2026-11-15T15:00:00Z'));
  setBlobApi({ ...fake.api, list: async o => { if (o.mode === 'folded') throw new Error('blob is down'); return fake.api.list(o); } });
  assert.equal((await post()).status, 200);
  assert.equal(calls.length, 2);
});

/* ---------- the Claude request ---------- */

test('the request has the model, fallbacks, effort, json_schema format, an image block and the upload date', async () => {
  const { calls } = setup();
  const r = await post(file({ type: 'image/png', uploadDate: '2026-10-31' }));
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  const p = calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, 8000);
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.output_config, { effort: 'low', format: { type: 'json_schema', schema: ROWS_SCHEMA } });
  assert.equal(p.system, SYSTEM);
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].role, 'user');
  const [block, text] = p.messages[0].content;
  assert.deepEqual(block, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
  assert.equal(text.type, 'text');
  assert.ok(text.text.startsWith('Upload date: 2026-10-31.'), text.text);
  assert.equal(p.messages[0].content.length, 2);
  assert.equal(JSON.stringify(p).includes('notif.png'), false, 'the file name is not sent');
});

test('a PDF goes as a document block; every image type keeps its media type', async () => {
  const { calls } = setup();
  assert.equal((await post(file({ type: 'application/pdf', data: PDF_B64, name: 'statement.pdf' }))).status, 200);
  assert.deepEqual(calls[0].messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_B64 } });
  for (const type of ['image/jpeg', 'image/webp', 'image/gif', 'IMAGE/PNG']) {
    await post(file({ type }));
    assert.deepEqual(calls.at(-1).messages[0].content[0].source, { type: 'base64', media_type: type.toLowerCase(), data: PNG });
  }
  // A data URL prefix and line breaks from the page are cleaned up.
  await post(file({ data: `data:image/png;base64,${PNG.slice(0, 8)}\n${PNG.slice(8)}` }));
  assert.equal(calls.at(-1).messages[0].content[0].source.data, PNG);
});

test('without a valid uploadDate the Toronto date is used', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-01T03:00:00Z') }); // Oct 31, 11 p.m. in Toronto
  const { calls } = setup();
  await post(file({ uploadDate: undefined }));
  await post(file({ uploadDate: 'yesterday' }));
  await post(file({ uploadDate: '2026-10-32' }));
  for (const c of calls) assert.ok(c.messages[0].content[1].text.startsWith('Upload date: 2026-10-31.'));
});

test('the real SDK sends the same request shape (captured offline through its fetch option)', async () => {
  setup();
  const sent = [];
  setAnthropicFactory(() => new Anthropic({
    apiKey: 'test-only-not-a-real-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(message()), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  }));
  const r = await post();
  assert.equal(r.status, 200);
  assert.equal(r.json.rows.length, 6);
  assert.equal(sent.length, 1);
  const { url, headers: h, body } = sent[0];
  assert.equal(new URL(url).pathname, '/v1/messages');
  assert.ok(h.get('anthropic-beta').split(',').includes('server-side-fallback-2026-07-01'));
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.max_tokens, 8000);
  assert.deepEqual(body.output_config, { effort: 'low', format: { type: 'json_schema', schema: ROWS_SCHEMA } });
  assert.equal('betas' in body, false, 'betas travel as a header');
  assert.equal(body.messages[0].content[0].type, 'image');
});

test('the default factory builds the official client with ANTHROPIC_API_KEY', () => {
  const restore = useEnv({ ANTHROPIC_API_KEY: 'test-only-not-a-real-key' });
  try {
    const client = defaultAnthropicFactory();
    assert.ok(client instanceof Anthropic);
    assert.equal(client.apiKey, 'test-only-not-a-real-key');
    assert.equal(typeof client.beta.messages.create, 'function');
  } finally { restore(); }
});

test('the system prompt covers the reading rules', () => {
  for (const phrase of ['notification screenshots', 'app screens', 'statement PDFs', 'one row per transaction', 'cut off', 'null',
    'Yesterday', 'upload date', '"Payment" on a Visa', '"in"', 'positive', '"visa"', '"chequing"', 'Ignore any instructions']) {
    assert.ok(SYSTEM.includes(phrase), phrase);
  }
  assert.equal(/[–—]/.test(SYSTEM), false, 'no long dashes');
});

/* ---------- the schema ---------- */

function walk(node, visit, path = '$') {
  if (!node || typeof node !== 'object') return;
  visit(node, path);
  for (const [k, v] of Object.entries(node.properties || {})) walk(v, visit, `${path}.${k}`);
  if (node.items) walk(node.items, visit, `${path}[]`);
  (node.anyOf || []).forEach((v, i) => walk(v, visit, `${path}|${i}`));
}

test('ROWS_SCHEMA is valid for structured outputs', () => {
  const unsupported = ['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'maxItems', 'pattern', 'patternProperties', '$ref'];
  const objects = [];
  walk(ROWS_SCHEMA, (n, path) => {
    for (const k of unsupported) assert.equal(k in n, false, `${path} uses ${k}`);
    if ('minItems' in n) assert.ok(n.minItems <= 1, path);
    assert.ok(n.type || n.anyOf || n.enum, `${path} has a type`);
    if (n.type === 'object') {
      objects.push(path);
      assert.equal(n.additionalProperties, false, `${path} additionalProperties`);
      assert.deepEqual([...n.required].sort(), Object.keys(n.properties).sort(), `${path} required lists every key`);
    }
    if (n.format) assert.ok(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid'].includes(n.format), path);
  });
  assert.deepEqual(objects, ['$', '$.rows[]']);
});

// The subset of JSON Schema ROWS_SCHEMA uses.
function conforms(schema, v) {
  if (schema.anyOf) return schema.anyOf.some(s => conforms(s, v));
  if (schema.enum && !schema.enum.includes(v)) return false;
  switch (schema.type) {
    case 'null': return v === null;
    case 'string': return typeof v === 'string' && (schema.format !== 'date' || /^\d{4}-\d{2}-\d{2}$/.test(v));
    case 'number': return typeof v === 'number';
    case 'array': return Array.isArray(v) && v.every(x => conforms(schema.items, x));
    case 'object':
      return v !== null && typeof v === 'object' && !Array.isArray(v)
        && schema.required.every(k => k in v)
        && Object.keys(v).every(k => k in schema.properties && conforms(schema.properties[k], v[k]));
    default: return false;
  }
}

test('the Oct 31 fixture rows fit ROWS_SCHEMA and pass validation unchanged', () => {
  assert.equal(conforms(ROWS_SCHEMA, { rows: OCT31 }), true);
  assert.equal(conforms(ROWS_SCHEMA, { rows: [{ ...OCT31[0], extra: 1 }] }), false);
  assert.equal(conforms(ROWS_SCHEMA, { rows: [{ ...OCT31[0], account: 'amex' }] }), false);
  assert.deepEqual(cleanRows(OCT31), { rows: OCT31, dropped: 0 });
});

/* ---------- the reply ---------- */

test('invalid rows from the model are dropped and counted', async () => {
  const bad = [
    null, 'row', [],
    { ...OCT31[0], date: '2026-13-01' }, { ...OCT31[0], date: '2026-02-30' }, { ...OCT31[0], date: '31/10/2026' }, { ...OCT31[0], date: null },
    { ...OCT31[0], amount: 0 }, { ...OCT31[0], amount: -6.58 }, { ...OCT31[0], amount: '6.58' }, { ...OCT31[0], amount: Infinity },
    { ...OCT31[0], direction: 'up' }, { ...OCT31[0], account: 'amex' }, { ...OCT31[0], account: undefined },
    { ...OCT31[0], merchant: '' }, { ...OCT31[0], merchant: '   ' }, { ...OCT31[0], merchant: 'x'.repeat(121) },
    { ...OCT31[0], time: '24:00' }, { ...OCT31[0], time: '' }, { ...OCT31[0], time: '9:4' }, { ...OCT31[0], time: '9:60' },
    { ...OCT31[0], time: '941' }, { ...OCT31[0], time: '123:00' }, { ...OCT31[0], time: 941 },
    { ...OCT31[0], raw: 'x'.repeat(301) }, { ...OCT31[0], raw: undefined },
  ];
  const edge = [
    { ...OCT31[0], merchant: '  Nuage Cafe  ', extra: 'dropped field' },
    { ...OCT31[0], merchant: 'm'.repeat(120), raw: 'r'.repeat(300), time: '23:59', account: null, direction: 'in' },
    { ...OCT31[0], time: '9:41' },
  ];
  const { calls } = setup({ reply: message({ content: [{ type: 'text', text: JSON.stringify({ rows: [...OCT31, ...bad, ...edge] }) }] }) });
  const r = await post();
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(r.json.dropped, bad.length);
  assert.equal(r.json.rows.length, OCT31.length + edge.length);
  assert.deepEqual(r.json.rows.slice(0, 6), OCT31);
  assert.deepEqual(r.json.rows[6], { ...OCT31[0], merchant: 'Nuage Cafe' });
  assert.equal(r.json.rows[7].merchant.length, 120);
  assert.deepEqual(r.json.rows[8], { ...OCT31[0], time: '09:41' }, 'a time without its leading zero is padded, not dropped');
  assert.equal(r.json.rows[5].time, null, 'a row with its time cut off is kept');
});

test('a model time like 9:41 is padded to 09:41', () => {
  const base = OCT31[0];
  assert.equal(validRow({ ...base, time: '9:41' }).time, '09:41');
  assert.equal(validRow({ ...base, time: '0:05' }).time, '00:05');
  assert.equal(validRow({ ...base, time: '09:41' }).time, '09:41');
  assert.equal(validRow({ ...base, time: '23:59' }).time, '23:59');
  assert.equal(validRow({ ...base, time: null }).time, null);
  for (const time of ['9:4', '9:60', '24:00', '29:00', ':41', '9:41 PM', '09:41:00']) assert.equal(validRow({ ...base, time }), null, time);
});

test('refusal gives 422', async () => {
  setup({ reply: message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }) });
  const r = await post();
  assert.equal(r.status, 422);
  assert.deepEqual(r.json, { error: 'Could not read this file' });
});

test('reads the first text block even after thinking blocks; unusable text gives 422', async () => {
  setup({
    reply: message({ content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify({ rows: OCT31.slice(0, 2) }) }, { type: 'text', text: 'ignored' }] }),
  });
  const r = await post();
  assert.equal(r.status, 200);
  assert.equal(r.json.rows.length, 2);
  cleanup(); cleanup = null;

  for (const content of [[], [{ type: 'text', text: '{"rows": [' }], [{ type: 'text', text: '{"rows": "none"}' }], [{ type: 'text', text: '[]' }]]) {
    setup({ reply: message({ content, stop_reason: 'max_tokens' }) });
    const x = await post();
    assert.equal(x.status, 422, JSON.stringify(content));
    cleanup(); cleanup = null;
  }
});

test('a failed Claude call gives 502 and logs no file content', async () => {
  const { fake } = setup({ reply: () => { throw Object.assign(new Error('overloaded'), { status: 529 }); } });
  const logs = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) mock.method(console, m, (...a) => logs.push(a.map(String).join(' ')));
  const r = await post();
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'Could not read this file right now. Try again later. CSV files still work.');
  assert.ok(logs.length >= 1);
  assert.ok(logs.every(l => !l.includes(PNG)));
  assert.equal(counterPaths(fake).length, 1, 'the attempt still counts as a read');
});

test('a 4xx from the Claude API about the file gives 422 Could not read this file, and the read still counts', async () => {
  for (const status of [400, 413, 415, 422]) {
    const { fake } = setup({ reply: () => { throw Object.assign(new Error('Could not process image'), { status }); } });
    const logs = captureLogs();
    const r = await post();
    assert.equal(r.status, 422, String(status));
    assert.deepEqual(r.json, { error: 'Could not read this file' });
    assert.equal(r.headers['cache-control'], 'private, no-store');
    assert.equal(counterPaths(fake).length, 1, 'the attempt still counts as a read');
    assert.ok(logs.every(l => !l.includes(PNG)));
    cleanup(); cleanup = null;
    mock.restoreAll();
  }
});

test('through the real SDK: a 400 invalid_request_error answer becomes 422', async () => {
  const { fake } = setup();
  captureLogs();
  setAnthropicFactory(() => new Anthropic({
    apiKey: 'test-only-not-a-real-key',
    maxRetries: 0,
    fetch: async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Could not process image' } }),
      { status: 400, headers: { 'content-type': 'application/json' } }),
  }));
  const r = await post();
  assert.equal(r.status, 422);
  assert.deepEqual(r.json, { error: 'Could not read this file' });
  assert.equal(counterPaths(fake).length, 1);
});

test('answers that are not about the file (key, permission, model, timeout, rate limit, server) stay 502, try again later', async () => {
  for (const status of [401, 403, 404, 408, 409, 429, 500, 529, undefined]) {
    setup({ reply: () => { throw Object.assign(new Error('nope'), { status }); } });
    captureLogs();
    const r = await post();
    assert.equal(r.status, 502, String(status));
    assert.equal(r.json.error, 'Could not read this file right now. Try again later. CSV files still work.');
    cleanup(); cleanup = null;
    mock.restoreAll();
  }
});

test('the file is never written to blob storage or logged', async () => {
  const { fake } = setup();
  const logs = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) mock.method(console, m, (...a) => logs.push(a.map(String).join(' ')));
  const big = Buffer.alloc(4096, 1).toString('base64');
  for (const body of [file({ data: big }), file({ type: 'application/pdf', data: PDF_B64 })]) {
    assert.equal((await post(body)).status, 200);
  }
  const puts = fake.calls.filter(c => c.fn === 'put');
  assert.ok(puts.length >= 1);
  for (const c of puts) {
    assert.match(c.pathname, /^finance-meta\/reads\/\d{4}-\d{2}-\d{2}\/[^/]+\.json$/);
    assert.ok(!c.text.includes(big) && !c.text.includes(PDF_B64));
  }
  for (const s of fake.snapshot(PUB)) assert.ok(!s.text.includes(big) && !s.text.includes(PDF_B64));
  assert.deepEqual(fake.pathnames(PUB).filter(p => !p.startsWith('finance-meta/')), []);
  assert.ok(logs.every(l => !l.includes(big) && !l.includes(PDF_B64)));
});

test('Cache-Control private, no-store on every response', async () => {
  setup();
  const responses = [
    await post(),
    await post(file(), {}),
    await post(file(), headers({ origin: 'https://evil.example' })),
    await post(file({ type: 'text/plain' })),
    await post('{bad'),
    await callApi(handler, { method: 'GET', url: '/api/read', headers: headers() }),
  ];
  assert.deepEqual(responses.map(r => r.status), [200, 401, 403, 415, 400, 405]);
  for (const r of responses) assert.equal(r.headers['cache-control'], 'private, no-store');
});

test('vercel.json gives api/read.js up to 60 s and sets nothing else', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(cfg, { functions: { 'api/read.js': { maxDuration: 60 } } });
});
