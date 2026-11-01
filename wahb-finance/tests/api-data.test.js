// api/data.js and api/_store.js against the in memory blob fake. No network, no real tokens.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/data.js';
import { listVersions, setBlobApi, storeConfig, withLock, writeVersion, PREVIEW_NOTE } from '../api/_store.js';
import { checkKey, sameOrigin, readJson } from '../api/_auth.js';
import { createFakeBlob } from './helpers/api-fake-blob.js';
import { callApi, makeFetch, makeReqRes, useEnv } from './helpers/api-harness.js';

const KEY = 'device-key-for-tests';
const PUB = 'vercel_blob_rw_publicstore_fakesecret';
const PRIV = 'vercel_blob_rw_privatestore_fakesecret';
const MB = 1024 * 1024;

let cleanup = null;
afterEach(() => { if (cleanup) cleanup(); cleanup = null; });

function setup({ env = {}, stores = { [PUB]: 'public' }, pageSize, latency } = {}) {
  const fake = createFakeBlob({ stores, pageSize, latency });
  setBlobApi(fake.api);
  const restore = useEnv({
    APP_KEY: KEY, VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: PUB, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined, ...env,
  });
  cleanup = () => { restore(); setBlobApi(); };
  return fake;
}

const auth = { 'x-app-key': KEY };
const get = (q = '', headers = auth) => callApi(handler, { method: 'GET', url: '/api/data' + q, headers });
const put = (body, headers = auth) => callApi(handler, { method: 'PUT', url: '/api/data', headers, body });
const doc = (extra = {}) => ({
  version: 2, settings: { payPlan: 1300 }, bills: [{ id: 'b1', name: 'Rent', amt: 587.5, freq: 'monthly', day: 1 }],
  budget: [], accounts: [], goals: [], months: {}, buildB: { keepMe: [1, 2, 3] }, ...extra,
});

// Saves written the way the old page did: `finance/data-<ms>` plus the random suffix Vercel added.
function seedLegacy(fake, token, count, { start = Date.UTC(2026, 9, 1), pretty = false } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const ts = start + i * 3600_000;
    const pathname = `finance/data-${ts}-Rnd${String(i).padStart(3, '0')}Xy.json`;
    const d = doc({ note: `old save ${i}`, savedAt: new Date(ts).toISOString(), version: 1 });
    const text = pretty ? JSON.stringify(d, null, 2) : JSON.stringify(d);
    fake.seed(token, pathname, text, { uploadedAt: ts });
    out.push({ pathname, text, doc: d });
  }
  return out; // oldest first
}

// What crypto.randomUUID() gives: 8-4-4-4-12 lowercase hex, version 4.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const writes = (fake, token) => fake.calls.filter(c => (c.fn === 'put' || c.fn === 'del') && (!token || c.token === token));
const writtenPaths = c => c.pathnames || [c.pathname];

/* ---------- auth ---------- */

test('401 on GET and PUT without a key or with a wrong key', async () => {
  setup();
  for (const headers of [{}, { 'x-app-key': 'wrong' }, { 'x-app-key': KEY + 'x' }, { 'x-app-key': '' }]) {
    const g = await get('', headers);
    assert.equal(g.status, 401);
    assert.deepEqual(g.json, { error: 'This device is not set up' });
    const p = await put(doc(), headers);
    assert.equal(p.status, 401);
    assert.deepEqual(p.json, { error: 'This device is not set up' });
  }
});

test('401 when APP_KEY is not set on the server (fails closed)', async () => {
  const fake = setup({ env: { APP_KEY: undefined } });
  for (const headers of [{}, { 'x-app-key': 'undefined' }, { 'x-app-key': '' }, { 'x-app-key': KEY }]) {
    assert.equal((await get('', headers)).status, 401);
    assert.equal((await put(doc(), headers)).status, 401);
  }
  assert.equal(fake.calls.length, 0, 'no storage call before the key check');
});

test('checkKey, sameOrigin and readJson helpers', () => {
  const restore = useEnv({ APP_KEY: 'abc' });
  try {
    assert.equal(checkKey({ headers: { 'x-app-key': 'abc' } }), true);
    assert.equal(checkKey({ headers: { 'x-app-key': ['abc', 'zzz'] } }), true);
    assert.equal(checkKey({ headers: { 'x-app-key': 'abcd' } }), false);
    assert.equal(checkKey({ headers: {} }), false);
  } finally { restore(); }
  assert.equal(sameOrigin({ headers: { origin: 'https://a.example', host: 'a.example' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://a.example', 'x-forwarded-host': 'a.example', host: 'internal' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://evil.example', host: 'a.example' } }), false);
  assert.equal(sameOrigin({ headers: { host: 'a.example' } }), false);
  assert.equal(sameOrigin({ headers: { origin: 'null', host: 'a.example' } }), false);
  assert.deepEqual(readJson({ body: { a: 1 } }), { a: 1 });
  assert.deepEqual(readJson({ body: '{"a":1}' }), { a: 1 });
  assert.throws(() => readJson({ body: '{nope' }));
  assert.throws(() => readJson({ body: undefined }));
});

/* ---------- store config ---------- */

test('storeConfig picks the private store when it exists, and finance/ only in production', () => {
  assert.deepEqual(storeConfig({ BLOB_READ_WRITE_TOKEN: 'p' }), { primary: { token: 'p', access: 'public' }, legacy: null, prefix: 'finance-preview/' });
  assert.deepEqual(storeConfig({ BLOB_READ_WRITE_TOKEN: 'p', PRIVATE_BLOB_READ_WRITE_TOKEN: 's', VERCEL_ENV: 'production' }),
    { primary: { token: 's', access: 'private' }, legacy: { token: 'p', access: 'public' }, prefix: 'finance/' });
  assert.deepEqual(storeConfig({ PRIVATE_BLOB_READ_WRITE_TOKEN: 's', VERCEL_ENV: 'production' }).legacy, null);
  for (const VERCEL_ENV of [undefined, '', 'preview', 'development', 'Production', 'prod']) {
    assert.equal(storeConfig({ BLOB_READ_WRITE_TOKEN: 'p', VERCEL_ENV }).prefix, 'finance-preview/');
  }
});

/* ---------- GET / PUT ---------- */

test('GET on an empty store gives {empty:true}', async () => {
  const fake = setup();
  const r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { empty: true });
  assert.deepEqual(fake.pathnames(PUB), [], 'nothing left behind (the seeding lock is released)');
});

test('PUT then GET round trip keeps every field, sets savedAt and note, drops baseSavedAt', async () => {
  setup();
  const before = Date.now();
  const p = await put({ ...doc(), savedAt: null, baseSavedAt: null, note: 'Added Costco $182.40' });
  assert.equal(p.status, 200);
  assert.equal(p.json.ok, true);
  assert.ok(Date.parse(p.json.savedAt) >= before);

  const g = await get();
  assert.equal(g.status, 200);
  assert.deepEqual(g.json, { ...doc(), savedAt: p.json.savedAt, note: 'Added Costco $182.40' });
  assert.equal('baseSavedAt' in g.json, false);
});

test('PUT note defaults to Saved and is cut at 200 characters', async () => {
  setup();
  const a = await put(doc({ savedAt: null }));
  assert.equal((await get()).json.note, 'Saved');
  await put(doc({ baseSavedAt: a.json.savedAt, note: 'x'.repeat(250) }));
  assert.equal((await get()).json.note, 'x'.repeat(200));
});

test('PUT accepts a non null base when there are no versions yet', async () => {
  setup();
  const r = await put(doc({ savedAt: '2026-11-01T12:00:00.000Z' }));
  assert.equal(r.status, 200);
});

test('409 when the base savedAt is stale, with the latest doc in the body', async () => {
  setup();
  const a = await put(doc({ savedAt: null, note: 'A' }));
  const b = await put(doc({ baseSavedAt: a.json.savedAt, note: 'B', months: { '2026-11': { tx: [{ id: 't1', amt: 5 }] } } }));
  assert.equal(b.status, 200);

  const c = await put(doc({ baseSavedAt: a.json.savedAt, note: 'C' }));
  assert.equal(c.status, 409);
  assert.equal(c.json.error, 'conflict');
  assert.equal(c.json.latest.savedAt, b.json.savedAt);
  assert.equal(c.json.latest.note, 'B');
  assert.deepEqual(c.json.latest.months, { '2026-11': { tx: [{ id: 't1', amt: 5 }] } });

  // base falls back to savedAt when baseSavedAt is absent; null base with versions present is stale too
  assert.equal((await put(doc({ savedAt: a.json.savedAt }))).status, 409);
  assert.equal((await put(doc({ savedAt: null }))).status, 409);
  assert.equal((await put(doc({ savedAt: b.json.savedAt }))).status, 200);
});

test('savedAt always moves forward, even for saves in the same millisecond', async () => {
  setup();
  let base = null;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const r = await put(doc({ baseSavedAt: base }));
    assert.equal(r.status, 200);
    seen.push(r.json.savedAt);
    base = r.json.savedAt;
  }
  assert.deepEqual([...seen].sort(), seen);
  assert.equal(new Set(seen).size, seen.length);
});

test('history lists the last 10 versions newest first, and version= returns one of them', async () => {
  const fake = setup();
  let base = null;
  const saved = [];
  for (let i = 1; i <= 3; i++) {
    const r = await put(doc({ baseSavedAt: base, note: `Save ${i}`, n: i }));
    base = r.json.savedAt;
    saved.push(base);
  }
  const h = await get('?history=1');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.versions.map(v => v.note), ['Save 3', 'Save 2', 'Save 1']);
  assert.deepEqual(h.json.versions.map(v => v.savedAt), [...saved].reverse());
  for (const v of h.json.versions) assert.match(v.id, new RegExp(`^finance-preview/data-\\d{13}-${UUID}\\.json$`));

  const v = await get('?version=' + encodeURIComponent(h.json.versions[2].id));
  assert.equal(v.status, 200);
  assert.equal(v.json.note, 'Save 1');
  assert.equal(v.json.n, 1);
  assert.equal(v.json.savedAt, saved[0]);

  // Only this prefix's data files
  const bad = ['finance/data-1.json', 'finance-preview/lock.json', 'finance-preview/data-1/../../finance/data-1.json',
    'finance-preview/data-1.json/x', '', 'data-1.json', 'finance-preview/data-.json'];
  for (const id of bad) {
    const r = await get('?version=' + encodeURIComponent(id));
    assert.equal(r.status, 400, id);
  }
  const gone = await get('?version=' + encodeURIComponent('finance-preview/data-123-abcdef.json'));
  assert.equal(gone.status, 404);
  assert.equal(fake.calls.filter(c => c.fn === 'get' && !c.pathname.startsWith('finance-preview/')).length, 0);
});

test('keeps only the last 10 versions (and follows list pagination)', async () => {
  const fake = setup({ pageSize: 3 });
  let base = null;
  const saved = [];
  for (let i = 1; i <= 13; i++) {
    const r = await put(doc({ baseSavedAt: base, note: `Save ${i}` }));
    assert.equal(r.status, 200);
    base = r.json.savedAt;
    saved.push(base);
  }
  const files = fake.pathnames(PUB, 'finance-preview/data-');
  assert.equal(files.length, 10);
  const h = await get('?history=1');
  assert.deepEqual(h.json.versions.map(v => v.note), Array.from({ length: 10 }, (_, i) => `Save ${13 - i}`));
  assert.equal((await get()).json.note, 'Save 13');
  assert.ok(fake.calls.some(c => c.fn === 'list' && c.options.cursor), 'used the cursor');
});

/* ---------- lock ---------- */

test('two PUTs racing on the same base: exactly one 200 and one 409', async () => {
  setup();
  const a = await put(doc({ savedAt: null, note: 'start' }));
  for (let round = 0; round < 5; round++) {
    const latest = (await get()).json;
    const results = await Promise.all([
      put(doc({ baseSavedAt: latest.savedAt, note: `left ${round}` })),
      put(doc({ baseSavedAt: latest.savedAt, note: `right ${round}` })),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const lost = results.find(r => r.status === 409);
    assert.equal(lost.json.error, 'conflict');
    assert.ok(lost.json.latest && Array.isArray(lost.json.latest.bills), 'latest doc in the 409 body');
    const won = results.find(r => r.status === 200);
    assert.equal((await get()).json.savedAt, won.json.savedAt);
    assert.equal(lost.json.latest.savedAt, won.json.savedAt, 'the 409 already holds the winner');
    assert.equal(lost.json.latest.note, won === results[0] ? `left ${round}` : `right ${round}`);
  }
  assert.ok(a.status === 200);
});

test('a PUT that arrives while another holds the lock waits for it, then gets 409 with the save that just landed', async () => {
  const fake = setup();
  const first = await put(doc({ savedAt: null, note: 'first' }));

  const release = fake.pause(c => c.fn === 'put' && c.pathname.includes('/data-'));
  const slow = put(doc({ baseSavedAt: first.json.savedAt, note: 'slow' }));
  await fake.paused();

  // The second PUT is driven by hand so the lock can be read at the moment it answers.
  const { req, res, done } = makeReqRes({ method: 'PUT', url: '/api/data', headers: auth, body: doc({ baseSavedAt: first.json.savedAt, note: 'blocked' }) });
  let lockAtAnswer = 'not answered';
  const end = res.end.bind(res);
  res.end = data => { lockAtAnswer = fake.text(PUB, 'finance-preview/lock.json'); return end(data); };
  const blocked = handler(req, res);

  await sleep(500);
  assert.equal(res.headersSent, false, 'still waiting while the other save holds the lock');
  const polls = fake.calls.filter(c => c.fn === 'head' && c.pathname === 'finance-preview/lock.json').length;
  assert.ok(polls >= 3, `checked the lock again while waiting (${polls} times)`);

  release();
  assert.equal((await slow).status, 200);
  await blocked;
  const out = await done;
  const json = JSON.parse(out.body);
  assert.equal(out.status, 409);
  assert.equal(json.error, 'conflict');
  assert.equal(json.latest.note, 'slow', 'latest already holds the save that won');
  assert.equal(lockAtAnswer, null, 'the lock was released before the 409 went out');

  const notes = [];
  for (const p of fake.pathnames(PUB, 'finance-preview/data-')) notes.push(fake.json(PUB, p).note);
  assert.deepEqual(notes.sort(), ['first', 'slow']);
  assert.equal(fake.text(PUB, 'finance-preview/lock.json'), null, 'lock released');
});

test('two devices saving at the same moment (with network latency): exactly one 409, and its latest already holds the winner', async () => {
  const fake = setup({ latency: () => 5 + Math.floor(Math.random() * 25) });
  const start = await put(doc({ savedAt: null, note: 'start' }));
  for (let round = 0; round < 3; round++) {
    const base = (await get()).json.savedAt;
    const results = await Promise.all(['phone', 'laptop'].map(who => put(doc({ baseSavedAt: base, note: `${who} ${round}`, who }))));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const won = results.find(r => r.status === 200), lost = results.find(r => r.status === 409);
    assert.equal(lost.json.latest.savedAt, won.json.savedAt, 'the 409 carries the save that won, not the one both started from');
    // The loser replays on top of that latest and gets in on the first try: no second 409.
    const replay = await put({ ...lost.json.latest, baseSavedAt: lost.json.latest.savedAt, note: `replay ${round}` });
    assert.equal(replay.status, 200);
  }
  assert.equal(start.status, 200);
  assert.equal(fake.text(PUB, 'finance-preview/lock.json'), null);
});

test('a lock held by a save that never finishes: the PUT waits about 3 s, polling about every 150 ms, then 409 with the newest doc', async () => {
  const fake = setup();
  const saved = await put(doc({ savedAt: null, note: 'saved before the crash' }));
  fake.seed(PUB, 'finance-preview/lock.json', '{"at":"now"}', { uploadedAt: Date.now() - 1000 });
  const t0 = Date.now();
  const blocked = await put(doc({ baseSavedAt: saved.json.savedAt, note: 'blocked' }));
  const waited = Date.now() - t0;
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'conflict');
  assert.equal(blocked.json.latest.note, 'saved before the crash');
  assert.equal(blocked.json.latest.savedAt, saved.json.savedAt);
  assert.ok(waited >= 2800 && waited < 6000, `waited ${waited} ms`);
  // 1 try plus a check every 150 ms: about 21 (fewer when a busy machine stretches the timers).
  const polls = fake.calls.filter(c => c.fn === 'head' && c.pathname === 'finance-preview/lock.json').length;
  assert.ok(polls >= 8 && polls <= 22, `${polls} lock checks`);
  assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 1, 'nothing written');
  assert.equal(fake.text(PUB, 'finance-preview/lock.json'), '{"at":"now"}', 'the held lock is left alone');
});

test('a lock older than the lease is taken over at once', async () => {
  const fake = setup();
  fake.seed(PUB, 'finance-preview/lock.json', '{"at":"long ago"}', { uploadedAt: Date.now() - 31_000 });
  const t0 = Date.now();
  const ok = await put(doc({ savedAt: null }));
  assert.equal(ok.status, 200);
  assert.ok(Date.now() - t0 < 1000, 'no wait');
  assert.equal(fake.text(PUB, 'finance-preview/lock.json'), null);
});

test('withLock without a wait: two takeovers of the same stale lock, one wins through ifMatch', async () => {
  const fake = setup();
  fake.seed(PUB, 'finance-preview/lock.json', '{}', { uploadedAt: Date.now() - 60_000 });
  const cfg = storeConfig();
  let inside = 0;
  const results = await Promise.allSettled([1, 2].map(() => withLock(cfg, async () => { inside++; return 'ran'; }, { waitMs: 0 })));
  assert.equal(inside, 1);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find(r => r.status === 'rejected').reason.conflict, true);
  assert.ok(fake.calls.some(c => c.fn === 'put' && c.options.ifMatch), 'takeover used ifMatch');
});

test('withLock waits for a held lock: callers run one at a time and all of them run', async () => {
  setup({ latency: 3 });
  const cfg = storeConfig();
  let inside = 0, most = 0, ran = 0;
  const results = await Promise.all([1, 2, 3].map(n => withLock(cfg, async () => {
    inside++; most = Math.max(most, inside);
    await sleep(60);
    inside--; ran++;
    return n;
  })));
  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(ran, 3);
  assert.equal(most, 1, 'never two at once');
});

test('withLock releases the lock when fn throws', async () => {
  const fake = setup();
  const cfg = storeConfig();
  await assert.rejects(withLock(cfg, async () => { throw new Error('inside'); }), /inside/);
  assert.equal(fake.text(PUB, 'finance-preview/lock.json'), null);
  assert.equal(await withLock(cfg, async () => 7), 7);
});

/* ---------- version names ---------- */

test('version pathnames are data-<ms>-<uuid>.json: unguessable on a public store, the same on a private one', async () => {
  for (const [stores, env, token] of [
    [{ [PUB]: 'public' }, {}, PUB],
    [{ [PUB]: 'public', [PRIV]: 'private' }, { PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV }, PRIV],
  ]) {
    const fake = setup({ stores, env });
    const before = Date.now();
    let base = null;
    for (let i = 0; i < 3; i++) base = (await put(doc({ baseSavedAt: base, note: `save ${i}` }))).json.savedAt;
    const names = fake.pathnames(token, 'finance-preview/data-');
    assert.equal(names.length, 3);
    for (const p of names) {
      const m = new RegExp(`^finance-preview/data-(\\d{13})-(${UUID})\\.json$`).exec(p);
      assert.ok(m, p);
      assert.ok(Number(m[1]) >= before && Number(m[1]) <= Date.now() + 10, 'the ms is the save time');
    }
    assert.equal(new Set(names.map(p => p.split('-').slice(2).join('-'))).size, 3, 'a new UUID each time');
    // Ordered by the ms, whatever the UUID: history and GET still agree on the newest.
    const h = await get('?history=1');
    assert.deepEqual(h.json.versions.map(v => v.note), ['save 2', 'save 1', 'save 0']);
    const one = await get('?version=' + encodeURIComponent(h.json.versions[1].id));
    assert.equal(one.status, 200);
    assert.equal(one.json.note, 'save 1');
    cleanup(); cleanup = null;
  }
});

test('versions sort by the ms in the name for all three shapes: <ms>.json (build B), <ms>-<Vercel suffix>, <ms>-<uuid>', async () => {
  const fake = setup();
  const t = Date.now() + 3_600_000; // written by an instance whose clock runs an hour ahead of this one
  const shapes = [
    [`finance-preview/data-${t + 3000}.json`, 'B'],
    [`finance-preview/data-${t + 1000}-Ab3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1.json`, 'old Vercel suffix'],
    [`finance-preview/data-${t + 2000}-0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d.json`, 'uuid'],
  ];
  // uploadedAt deliberately in the opposite order: the name decides.
  shapes.forEach(([p, note], i) => fake.seed(PUB, p, JSON.stringify(doc({ note, savedAt: new Date(t + i).toISOString() })), { uploadedAt: t + 10_000 - i * 1000 }));
  const versions = await listVersions(storeConfig());
  assert.deepEqual(versions.map(v => v.ts), [t + 3000, t + 2000, t + 1000]);
  assert.equal((await get()).json.note, 'B');
  // A new save from this (slower) clock still sorts first, and has a uuid name.
  const p = await writeVersion(storeConfig(), doc({ note: 'new' }), versions[0].ts);
  assert.match(p, new RegExp(`^finance-preview/data-${t + 3001}-${UUID}\\.json$`));
  assert.equal((await listVersions(storeConfig()))[0].pathname, p);
});

/* ---------- preview isolation and seeding ---------- */

test('preview writes only under finance-preview/ and leaves finance/ byte for byte untouched', async () => {
  for (const VERCEL_ENV of ['preview', undefined, 'development', 'staging']) {
    const fake = setup({ env: { VERCEL_ENV } });
    seedLegacy(fake, PUB, 12, { pretty: true });
    fake.seed(PUB, 'finance/lock.json', '{"held":false}');
    fake.seed(PUB, 'finance/notes.txt', 'not a save');
    const before = fake.snapshot(PUB, 'finance/');

    const g = await get();
    assert.equal(g.status, 200);
    let base = g.json.savedAt;
    for (let i = 0; i < 12; i++) {
      const r = await put({ ...g.json, baseSavedAt: base, note: `preview save ${i}` });
      assert.equal(r.status, 200);
      base = r.json.savedAt;
    }
    const h = await get('?history=1');
    await get('?version=' + encodeURIComponent(h.json.versions[3].id));
    assert.equal((await get('?version=' + encodeURIComponent('finance/data-1.json'))).status, 400);

    assert.deepEqual(fake.snapshot(PUB, 'finance/'), before, `finance/ unchanged (VERCEL_ENV=${VERCEL_ENV})`);
    for (const c of writes(fake)) {
      for (const p of writtenPaths(c)) assert.ok(p.startsWith('finance-preview/'), `${c.fn} ${p}`);
    }
    assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 10);
    cleanup(); cleanup = null;
  }
});

test('preview seeding copies the newest finance/ doc once, noted as a preview copy', async () => {
  const fake = setup();
  const legacy = seedLegacy(fake, PUB, 4);
  const newest = legacy[legacy.length - 1].doc;

  const g = await get();
  assert.equal(g.status, 200);
  assert.deepEqual(g.json, { ...newest, note: PREVIEW_NOTE });
  assert.equal(PREVIEW_NOTE, 'Preview copy of live data');
  assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 1);

  await get();
  await get('?history=1');
  assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 1, 'only once');

  // The copy keeps the live savedAt, so the first preview save from it is not a conflict.
  assert.equal((await put({ ...g.json, baseSavedAt: g.json.savedAt })).status, 200);
});

test('preview seeding with a private store: prefers finance/ in the private store, else the legacy one', async () => {
  const stores = { [PUB]: 'public', [PRIV]: 'private' };
  const env = { PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV };

  let fake = setup({ stores, env });
  const fromLegacy = seedLegacy(fake, PUB, 3);
  assert.equal((await get()).json.note, PREVIEW_NOTE);
  assert.equal((await get()).json.savedAt, fromLegacy[2].doc.savedAt);
  assert.equal(fake.pathnames(PRIV, 'finance-preview/data-').length, 1);
  assert.deepEqual(fake.pathnames(PUB, 'finance-preview/'), [], 'nothing written to the public store');
  cleanup(); cleanup = null;

  fake = setup({ stores, env });
  seedLegacy(fake, PUB, 3);
  const inPrivate = seedLegacy(fake, PRIV, 2, { start: Date.UTC(2026, 9, 20) });
  assert.equal((await get()).json.savedAt, inPrivate[1].doc.savedAt);
  assert.equal(writes(fake, PUB).length, 0);
});

/* ---------- production move to the private store ---------- */

test('production with an empty private store copies the last 10 public saves, same pathnames and bytes, deletes nothing', async () => {
  const fake = setup({
    stores: { [PUB]: 'public', [PRIV]: 'private' },
    env: { VERCEL_ENV: 'production', PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV },
  });
  const legacy = seedLegacy(fake, PUB, 12, { pretty: true });
  fake.seed(PUB, 'finance/other.txt', 'ignore me');
  const before = fake.snapshot(PUB);

  const g = await get();
  assert.equal(g.status, 200);
  assert.deepEqual(g.json, legacy[11].doc);

  const newest10 = legacy.slice(2);
  assert.deepEqual(fake.pathnames(PRIV, 'finance/data-'), newest10.map(l => l.pathname).sort());
  for (const l of newest10) assert.equal(fake.text(PRIV, l.pathname), l.text, 'same bytes');
  assert.deepEqual(fake.snapshot(PUB), before, 'public store untouched');
  assert.equal(writes(fake, PUB).length, 0, 'no put or del on the public store');

  // Saving from the newest copy works; pruning only touches the private store.
  const p = await put({ ...g.json, baseSavedAt: g.json.savedAt, note: 'first private save' });
  assert.equal(p.status, 200);
  assert.equal(fake.pathnames(PRIV, 'finance/data-').length, 10);
  assert.equal((await get()).json.note, 'first private save');
  assert.deepEqual(fake.snapshot(PUB), before);

  // A second GET does not copy again.
  await get();
  assert.equal(fake.pathnames(PRIV, 'finance/data-').length, 10);
});

test('production: a PUT reaching an empty private store first still copies the public saves before checking the base', async () => {
  const fake = setup({
    stores: { [PUB]: 'public', [PRIV]: 'private' },
    env: { VERCEL_ENV: 'production', PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV },
  });
  const legacy = seedLegacy(fake, PUB, 3);
  const stale = await put(doc({ baseSavedAt: legacy[0].doc.savedAt }));
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.json.latest, legacy[2].doc);
  assert.equal(fake.pathnames(PRIV, 'finance/data-').length, 3);

  const ok = await put(doc({ baseSavedAt: legacy[2].doc.savedAt, note: 'after move' }));
  assert.equal(ok.status, 200);
  assert.equal(fake.pathnames(PRIV, 'finance/data-').length, 4);
  assert.equal(fake.pathnames(PUB, 'finance/data-').length, 3);
});

test('production with versions already in the private store copies nothing', async () => {
  const fake = setup({
    stores: { [PUB]: 'public', [PRIV]: 'private' },
    env: { VERCEL_ENV: 'production', PRIVATE_BLOB_READ_WRITE_TOKEN: PRIV },
  });
  seedLegacy(fake, PUB, 5);
  const mine = seedLegacy(fake, PRIV, 1, { start: Date.UTC(2026, 10, 1) });
  assert.deepEqual((await get()).json, mine[0].doc);
  assert.equal(fake.pathnames(PRIV, 'finance/data-').length, 1);
});

test('production without a private store reads and writes finance/ in the public store as before', async () => {
  const fake = setup({ env: { VERCEL_ENV: 'production' } });
  const legacy = seedLegacy(fake, PUB, 2);
  assert.deepEqual((await get()).json, legacy[1].doc);
  const r = await put({ ...legacy[1].doc, baseSavedAt: legacy[1].doc.savedAt, note: 'live save' });
  assert.equal(r.status, 200);
  assert.equal(fake.pathnames(PUB, 'finance/data-').length, 3);
  assert.equal(fake.pathnames(PUB, 'finance-preview/').length, 0);
});

/* ---------- headers, bad input, methods ---------- */

test('Cache-Control private, no-store on every response', async () => {
  const fake = setup();
  const ok = await put(doc({ savedAt: null }));
  const responses = [
    ok,
    await get(),
    await get('?history=1'),
    await get('?version=bad'),
    await get('?version=finance-preview/data-1-abcdef.json'),
    await get('', {}),
    await put('{not json'),
    await put(doc({ savedAt: null })),
    await callApi(handler, { method: 'POST', url: '/api/data', headers: auth, body: doc() }),
    await callApi(handler, { method: 'DELETE', url: '/api/data', headers: {} }),
  ];
  fake.failNext('list', new Error('blob is down'));
  const restoreLog = silenceConsoleError();
  responses.push(await get());
  restoreLog();
  assert.deepEqual(responses.map(r => r.status), [200, 200, 200, 400, 404, 401, 400, 409, 405, 401, 500]);
  for (const r of responses) assert.equal(r.headers['cache-control'], 'private, no-store', `status ${r.status}`);
});

function silenceConsoleError() {
  const orig = console.error;
  console.error = () => {};
  return () => { console.error = orig; };
}

test('400 on an invalid body', async () => {
  setup();
  const bad = ['{not json', '[1,2]', '"text"', '{}', JSON.stringify({ bills: 'no' }), JSON.stringify({ bills: {} }), 'null'];
  for (const body of bad) {
    const r = await put(body);
    assert.equal(r.status, 400, body);
    assert.deepEqual(r.json, { error: 'Invalid data' });
  }
  for (const body of [[1], { bills: null }, { budget: [] }]) {
    assert.equal((await put(body)).status, 400);
  }
  assert.equal((await put('{"bills":[]}')).status, 200, 'a raw JSON string is parsed like Vercel does');
});

test('400 when the body is over 1 MB', async () => {
  const fake = setup();
  const big = doc({ savedAt: null, filler: 'x'.repeat(MB) });
  const asObject = await put(big);
  assert.equal(asObject.status, 400);
  assert.deepEqual(asObject.json, { error: 'That save is over 1 MB' });
  assert.equal((await put(JSON.stringify(big))).status, 400);
  assert.equal((await put(doc({ savedAt: null }), { ...auth, 'content-length': String(MB + 1) })).status, 400);
  assert.equal(fake.pathnames(PUB, 'finance-preview/data-').length, 0);

  const justUnder = await put(doc({ savedAt: null, filler: 'x'.repeat(MB - 2000) }));
  assert.equal(justUnder.status, 200);
});

test('405 on other methods (after the key check)', async () => {
  setup();
  for (const method of ['POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const r = await callApi(handler, { method, url: '/api/data', headers: auth, body: method === 'POST' ? doc() : undefined });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, 'GET, PUT');
    assert.equal((await callApi(handler, { method, url: '/api/data', headers: {} })).status, 401);
  }
});

test('500 with a plain message when storage fails, and no request body in the log', async () => {
  const fake = setup();
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    fake.failNext('list', new Error('blob is down'));
    const r = await put(doc({ savedAt: null, secret: 'SENSITIVE-AMOUNT-123' }));
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'Something went wrong on the server. Try again.' });
  } finally { console.error = orig; }
  assert.ok(logged.length > 0);
  assert.ok(logged.every(l => !l.includes('SENSITIVE')));
});

/* ---------- harness ---------- */

test('makeFetch serves the handler as a fetch function returning Response objects', async () => {
  setup();
  const fetch = makeFetch({ '/api/data': handler });
  const empty = await fetch('/api/data', { headers: auth, cache: 'no-store' });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await empty.json(), { empty: true });

  const saved = await fetch('/api/data', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(doc({ savedAt: null })) });
  assert.equal(saved.status, 200);
  const { savedAt } = await saved.json();
  const back = await (await fetch('http://localhost/api/data?history=1', { headers: auth })).json();
  assert.equal(back.versions[0].savedAt, savedAt);

  const broken = await fetch('/api/data', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(broken.status, 400);
  assert.equal((await fetch('/api/nothing', { headers: auth })).status, 404);
  assert.equal((await listVersions(storeConfig())).length, 1);
});
