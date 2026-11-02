// End to end runner (docs/SPEC.md section 9, docs/UI.md).
//
//   node scripts/e2e.mjs            every tests/e2e/*.e2e.mjs in name order
//   node scripts/e2e.mjs import     only files whose name contains 'import' (00-core always runs)
//
// Each file gets a fresh dev server seeded with tests/fixtures/sample-nov.js (fresh data, nothing shared between files)
// and a fresh browser context at 390x844. A file exports:
//   export default async function ({ page, base, shot, step, assert, freshPage, startServer, server, allowErrors, open, waitSynced }) {}
// The run fails on any console error or page error, prints a summary and exits with code 1 on failure.
// Playwright is installed globally; it is loaded with createRequire (never npm installed here).

import { createRequire } from 'node:module';
import { readdir, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

import { startDevServer } from './dev-server.mjs';
import { setBlobApi } from '../api/_store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DIR = join(ROOT, 'tests', 'e2e');
const SHOTS = join(ROOT, 'screenshots');
const SEED = 'tests/fixtures/sample-nov.js';
const VIEWPORT = { width: 390, height: 844 };
const KEY = 'dev-key';
// Fonts come from Google: a failed font request is not a page error.
const ALWAYS_ALLOWED = [/fonts\.(googleapis|gstatic)\.com/];

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch { /* not next to the repo */ }
  for (const dir of ['/opt/node-tools/node_modules', process.env.NODE_PATH].filter(Boolean)) {
    try { return createRequire(pathToFileURL(join(dir, 'noop.js')).href)('playwright'); } catch { /* try the next */ }
  }
  try { return createRequire(pathToFileURL(join(process.execPath, '..', '..', 'lib', 'node_modules', 'noop.js')).href)('playwright'); } catch { /* none */ }
  throw new Error('Playwright is not installed globally. It is expected at /opt/node-tools/node_modules or on NODE_PATH.');
}

const nameOf = file => file.replace(/\.e2e\.mjs$/, '').replace(/^\d+[-_]?/, '');

async function main() {
  const filters = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const all = (await readdir(E2E_DIR)).filter(f => f.endsWith('.e2e.mjs')).sort();
  const files = filters.length ? all.filter(f => f.startsWith('00-core') || filters.some(x => f.includes(x))) : all;
  if (!files.length) { console.log('No e2e files match.'); process.exit(1); }
  await mkdir(SHOTS, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const results = [];
  let failedFiles = 0;

  for (const file of files) {
    const short = nameOf(file);
    console.log(`\n${file}`);
    const steps = [];
    const errors = [];
    const allowed = [...ALWAYS_ALLOWED];
    const contexts = [];
    const extraServers = [];
    let server = null;

    const watch = (pg, tag) => {
      pg.on('console', msg => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        const url = (msg.location() && msg.location().url) || '';
        if (allowed.some(re => re.test(text) || re.test(url))) return;
        errors.push(`[console${tag}] ${text}${url ? ' (' + url + ')' : ''}`);
      });
      pg.on('pageerror', err => {
        const text = String(err && (err.stack || err.message) || err);
        if (allowed.some(re => re.test(text))) return;
        errors.push(`[pageerror${tag}] ${text}`);
      });
    };
    const newContext = async (opts = {}) => {
      const ctx = await browser.newContext({
        viewport: opts.viewport || VIEWPORT,
        deviceScaleFactor: opts.deviceScaleFactor || 1,
        colorScheme: opts.dark ? 'dark' : 'light',
        reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
        hasTouch: !!opts.touch,
        isMobile: !!opts.mobile,
      });
      contexts.push(ctx);
      if (opts.offline) await ctx.setOffline(true);
      ctx.setDefaultTimeout(10000);
      return ctx;
    };

    try {
      server = await startDevServer({ port: 0, seed: SEED, log: false });
      const base = server.url;
      const ctx = await newContext();
      const page = await ctx.newPage();
      watch(page, '');

      // Opens the page with the device key and the sample's date. open(page, {key:false}) opens without a key.
      const open = async (pg = page, { key = true, today = '2026-11-14', path = '/' } = {}) => {
        const q = new URLSearchParams();
        if (key) q.set('key', typeof key === 'string' ? key : KEY);
        if (today) q.set('today', today);
        const qs = q.toString();
        await pg.goto(base + path + (qs ? '?' + qs : ''));
        await pg.waitForFunction(() => {
          const main = document.getElementById('main'), ns = document.getElementById('notsetup');
          return (main && !main.hidden) || (ns && !ns.hidden);
        });
        return pg;
      };
      const waitSynced = (pg = page, timeout = 15000) =>
        pg.waitForFunction(() => /^Synced/.test(document.getElementById('status')?.textContent || ''), null, { timeout });

      const shot = async (name, opts = {}) => {
        const pg = opts.page || page;
        const path = join(SHOTS, `${short}-${name}.png`);
        await pg.screenshot({ path, fullPage: !!opts.fullPage, animations: 'disabled' });
        console.log(`  shot  screenshots/${short}-${name}.png`);
        return path;
      };
      const step = async (name, fn) => {
        const t = Date.now();
        try {
          await fn();
          steps.push({ name, ok: true });
          console.log(`  ok    ${name} (${Date.now() - t} ms)`);
        } catch (e) {
          steps.push({ name, ok: false, error: e });
          console.log(`  FAIL  ${name}\n        ${String(e && e.message || e).split('\n').join('\n        ')}`);
        }
      };
      // A second dev server with another seed. The in memory store is global to this process, so while it runs
      // every server here (base included) serves its data; close() puts the previous store back.
      const startServer = async ({ seed = SEED } = {}) => {
        const prevApi = server.fake.api;
        const other = await startDevServer({ port: 0, seed, log: false });
        extraServers.push(other);
        const close = async () => { await other.close(); setBlobApi(prevApi); };
        return { ...other, close };
      };
      // A new page in its own context: {dark, offline, reducedMotion, viewport, seed, key, today, open}.
      // It opens the page (with the key unless key: false) and then goes offline when offline: true.
      // With open: false it is not navigated. Returns the page (with .base and .server).
      const freshPage = async (opts = {}) => {
        let pageBase = base, srv = server;
        if (opts.seed) { srv = await startServer({ seed: opts.seed }); pageBase = srv.url; }
        const c = await newContext({ ...opts, offline: false });
        const pg = await c.newPage();
        watch(pg, opts.dark ? ' dark' : opts.offline ? ' offline' : ' fresh');
        pg.base = pageBase;
        pg.server = srv;
        if (opts.open !== false) {
          const q = new URLSearchParams();
          if (opts.key !== false) q.set('key', typeof opts.key === 'string' ? opts.key : KEY);
          if (opts.today !== null) q.set('today', opts.today || '2026-11-14');
          await pg.goto(pageBase + '/?' + q.toString());
          await pg.waitForFunction(() => !document.getElementById('main')?.hidden || !document.getElementById('notsetup')?.hidden);
        }
        if (opts.offline) await c.setOffline(true);
        return pg;
      };
      const allowErrors = re => { allowed.push(re instanceof RegExp ? re : new RegExp(String(re))); };

      const mod = await import(pathToFileURL(join(E2E_DIR, file)).href);
      if (typeof mod.default !== 'function') throw new Error(`${file} has no default export function`);
      await mod.default({ page, base, shot, step, assert, freshPage, startServer, server, allowErrors, open, waitSynced, key: KEY });
    } catch (e) {
      steps.push({ name: 'file setup or uncaught error', ok: false, error: e });
      console.log(`  FAIL  ${String(e && e.stack || e)}`);
    } finally {
      for (const c of contexts) await c.close().catch(() => {});
      for (const s of extraServers) await s.close().catch(() => {});
      if (server) await server.close().catch(() => {});
    }

    for (const err of errors) console.log(`  ERROR ${err}`);
    const failed = steps.filter(s => !s.ok).length + errors.length;
    if (failed) failedFiles++;
    results.push({ file, steps: steps.length, failed: steps.filter(s => !s.ok).length, errors: errors.length });
  }

  await browser.close();
  console.log('\nSummary');
  for (const r of results) {
    const state = r.failed || r.errors ? 'FAIL' : 'ok  ';
    console.log(`  ${state}  ${r.file}: ${r.steps - r.failed}/${r.steps} steps passed${r.errors ? `, ${r.errors} console or page errors` : ''}`);
  }
  console.log(failedFiles ? `\n${failedFiles} of ${results.length} files failed.` : `\nAll ${results.length} files passed.`);
  process.exit(failedFiles ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
