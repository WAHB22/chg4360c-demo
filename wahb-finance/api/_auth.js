// Request helpers shared by the api/ handlers: device key, same origin check, JSON body, responses.
// Files starting with '_' in api/ are helpers, not routes.

import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = s => createHash('sha256').update(String(s), 'utf8').digest();

// Node lowercases header names; a repeated header can arrive as an array.
export function header(req, name) {
  const v = req && req.headers ? req.headers[name.toLowerCase()] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

// Fails closed: without APP_KEY on the server no request is ever accepted.
// Both sides are hashed first so the comparison is constant time and length safe.
export function checkKey(req) {
  const want = process.env.APP_KEY;
  const got = header(req, 'x-app-key');
  if (!want || typeof got !== 'string' || !got) return false;
  return timingSafeEqual(sha256(want), sha256(got));
}

export function sameOrigin(req) {
  const origin = header(req, 'origin');
  const host = String(header(req, 'x-forwarded-host') || header(req, 'host') || '').split(',')[0].trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// Vercel gives req.body already parsed for application/json, a string for text/plain, a Buffer for octet streams.
// Its getter throws on invalid JSON, so reading it stays inside the try.
export function readJson(req) {
  let body;
  try {
    body = req.body;
  } catch {
    throw new SyntaxError('Invalid JSON');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') return JSON.parse(body);
  if (body && typeof body === 'object') return body;
  throw new SyntaxError('Missing JSON body');
}

// Size in bytes of the request body as it arrived (or as JSON when the platform already parsed it).
export function bodyBytes(req, parsed) {
  const declared = Number(header(req, 'content-length')) || 0;
  let raw;
  try { raw = req.body; } catch { raw = undefined; }
  const actual = typeof raw === 'string' ? Buffer.byteLength(raw)
    : Buffer.isBuffer(raw) ? raw.length
    : Buffer.byteLength(JSON.stringify(parsed ?? raw ?? null));
  return Math.max(declared, actual);
}

export const NO_STORE = 'private, no-store';

export function send(res, status, obj) {
  res.setHeader('Cache-Control', NO_STORE);
  return res.status(status).json(obj);
}
