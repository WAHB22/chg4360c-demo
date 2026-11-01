// api/read.js with a fake Anthropic client and the in memory blob fake. No network, no real keys.

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';

import handler, { ROWS_SCHEMA, SYSTEM, MODEL, cleanRows, defaultAnthropicFactory, setAnthropicFactory, torontoDay } from '../api/read.js';
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

function setup({ env = {}, stores = { [PUB]: 'public' }, reply = message() } = {}) {
  const fake = createFakeBlob({ stores });
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

test('the 31st read in a Toronto day gets 429; the count lives in a blob per Toronto day', async () => {
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
  assert.deepEqual(fake.json(PUB, 'finance-meta/read-count-2026-11-14.json'), { count: 30 });

  // 23:30 in Toronto (04:30 UTC the next day) is still Nov 14.
  mock.timers.setTime(Date.parse('2026-11-15T04:30:00Z'));
  assert.equal(torontoDay(), '2026-11-14');
  assert.equal((await post()).status, 429);

  // 00:30 in Toronto: a new day, a new counter.
  mock.timers.setTime(Date.parse('2026-11-15T05:30:00Z'));
  assert.equal(torontoDay(), '2026-11-15');
  assert.equal((await post()).status, 200);
  assert.deepEqual(fake.json(PUB, 'finance-meta/read-count-2026-11-15.json'), { count: 1 });
  assert.deepEqual(fake.json(PUB, 'finance-meta/read-count-2026-11-14.json'), { count: 30 });
  assert.deepEqual(counterPaths(fake), ['finance-meta/read-count-2026-11-14.json', 'finance-meta/read-count-2026-11-15.json']);
});

test('torontoDay follows daylight saving time', () => {
  assert.equal(torontoDay(new Date('2026-07-01T03:59:00Z')), '2026-06-30'); // EDT, UTC-4
  assert.equal(torontoDay(new Date('2026-07-01T04:00:00Z')), '2026-07-01');
  assert.equal(torontoDay(new Date('2026-01-01T04:59:00Z')), '2025-12-31'); // EST, UTC-5
  assert.equal(torontoDay(new Date('2026-01-01T05:00:00Z')), '2026-01-01');
});

test('the counter goes in the private store when there is one', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake } = setup({ stores: { [PUB]: 'public', [PRIV]: 'private' }, env: { PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV } });
  assert.equal((await post()).status, 200);
  assert.deepEqual(fake.json(PRIV, 'finance-meta/read-count-2026-11-14.json'), { count: 1 });
  assert.deepEqual(fake.pathnames(PUB), []);
});

test('the counter retries when another read changed it first (already exists and ETag mismatch)', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake } = setup();
  const path = 'finance-meta/read-count-2026-11-14.json';
  let sneak = 2;
  setBlobApi({
    ...fake.api,
    // Right before each of the first two counter writes, another read lands first.
    put: async (p, body, o) => {
      if (p === path && sneak > 0) {
        sneak--;
        const cur = fake.json(PUB, p);
        fake.seed(PUB, p, JSON.stringify({ count: (cur ? cur.count : 0) + 5 }));
      }
      return fake.api.put(p, body, o);
    },
  });
  const r = await post();
  assert.equal(r.status, 200);
  assert.deepEqual(fake.json(PUB, path), { count: 11 });
  const puts = fake.calls.filter(c => c.fn === 'put' && c.pathname === path);
  assert.equal(puts.length, 3);
  assert.equal(puts[0].options.allowOverwrite, false, 'first write of the day never overwrites');
  assert.ok(puts[1].options.ifMatch && puts[2].options.ifMatch, 'later writes use ifMatch');
});

test('after the first try and 3 retries all lose the race, the read is refused without calling Claude', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  const { fake, calls } = setup();
  const path = 'finance-meta/read-count-2026-11-14.json';
  fake.seed(PUB, path, '{"count":3}');
  setBlobApi({
    ...fake.api,
    put: async (p, body, o) => {
      if (p === path) fake.seed(PUB, p, fake.text(PUB, p)); // a new ETag every time
      return fake.api.put(p, body, o);
    },
  });
  const r = await post();
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
  // Spec 8.4: "retry the increment up to 3 times on precondition failure" = 1 try + 3 retries.
  assert.equal(fake.calls.filter(c => c.fn === 'put').length, 4);
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
    { ...OCT31[0], time: '9:41' }, { ...OCT31[0], time: '24:00' }, { ...OCT31[0], time: '' },
    { ...OCT31[0], raw: 'x'.repeat(301) }, { ...OCT31[0], raw: undefined },
  ];
  const edge = [
    { ...OCT31[0], merchant: '  Nuage Cafe  ', extra: 'dropped field' },
    { ...OCT31[0], merchant: 'm'.repeat(120), raw: 'r'.repeat(300), time: '23:59', account: null, direction: 'in' },
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
  assert.equal(r.json.rows[5].time, null, 'a row with its time cut off is kept');
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
    assert.match(c.pathname, /^finance-meta\/read-count-\d{4}-\d{2}-\d{2}\.json$/);
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
