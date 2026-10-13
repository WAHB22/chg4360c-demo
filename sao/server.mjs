// SAO local server, phase 1: serves the world page and its vendored libraries.
// Binds to 127.0.0.1 only. Phase 2 adds GET /state, POST /order and GET /memory.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.SAO_PORT || 3210);

// URL prefix -> folder on disk. Anything else is a 404.
const ROOTS = [
  ['/vendor/three/', join(here, 'node_modules/three/')],
  ['/vendor/cinzel/', join(here, 'node_modules/@fontsource/cinzel/')],
  ['/vendor/alegreya/', join(here, 'node_modules/@fontsource/alegreya/')],
  ['/', join(here, 'public/')],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function locate(urlPath) {
  for (const [prefix, dir] of ROOTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length) || 'index.html';
    const file = resolve(dir, normalize(rel));
    // Refuse anything that escapes its root folder.
    return file.startsWith(resolve(dir) + sep) ? file : null;
  }
  return null;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = locate(path);
  if (!file) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SAO running at http://${HOST}:${PORT}`);
});
