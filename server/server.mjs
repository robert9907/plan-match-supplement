// Google Cloud Run host for Plan Match Supplement.
//
// Vercel serves this app as static files (dist/) plus five serverless
// functions (api/*.ts). Cloud Run has no such split, so this one small
// Node server does both jobs, mirroring vercel.json exactly:
//   - redirects, security headers, and the SPA rewrite to index.html
//   - /api/<name> → the compiled handler in build/api/<name>.js, called
//     with a request/response pair that carries the Vercel helpers the
//     handlers use (req.query, req.body, res.status().json/send/end)
//
// Vercel keeps deploying from main untouched — it never sees this file.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const API_DIR = path.join(ROOT, 'build', 'api');
const PORT = Number(process.env.PORT || 8080);

const vercel = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
const REDIRECTS = new Map(vercel.redirects.map((r) => [r.source, r]));
const HEADERS = vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? [];

// Same set Vercel exposes: api/<name>.ts, never api/_lib/*.
const API_NAMES = new Set(['enroll', 'medsup-rates', 'rates', 'scan-label', 'scan-mbi']);
const handlers = new Map();
async function loadHandler(name) {
  if (!handlers.has(name)) {
    const mod = await import(pathToFileURL(path.join(API_DIR, `${name}.js`)).href);
    const limit = mod.config?.api?.bodyParser?.sizeLimit;
    handlers.set(name, { fn: mod.default, maxBody: parseSize(limit) ?? 1024 * 1024 });
  }
  return handlers.get(name);
}

function parseSize(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(kb|mb)$/i.exec(String(s ?? ''));
  if (!m) return null;
  return Math.floor(Number(m[1]) * (m[2].toLowerCase() === 'mb' ? 1024 * 1024 : 1024));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
};

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(Object.assign(new Error('Body exceeded size limit'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(buf, contentType) {
  if (!buf.length) return undefined;
  const ct = String(contentType || '').toLowerCase();
  const text = buf.toString('utf8');
  if (ct.includes('application/json')) return JSON.parse(text);
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  if (ct.startsWith('text/')) return text;
  return buf;
}

function withHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    if (body === undefined || body === null) { res.end(); return res; }
    if (Buffer.isBuffer(body) || typeof body === 'string') { res.end(body); return res; }
    return res.json(body);
  };
  return res;
}

async function handleApi(name, req, res, url) {
  const { fn, maxBody } = await loadHandler(name);
  req.query = Object.fromEntries(url.searchParams);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    try {
      req.body = parseBody(await readBody(req, maxBody), req.headers['content-type']);
    } catch (e) {
      res.statusCode = e.status || 400;
      res.end(JSON.stringify({ error: e.status === 413 ? 'Request too large' : 'Invalid request body' }));
      return;
    }
  }
  await fn(req, withHelpers(res));
}

async function serveFile(res, file, method) {
  const ext = path.extname(file).toLowerCase();
  const data = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate');
  res.end(method === 'HEAD' ? undefined : data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    for (const h of HEADERS) res.setHeader(h.key, h.value);

    const r = REDIRECTS.get(p);
    if (r) {
      res.statusCode = r.permanent ? 308 : 307;
      res.setHeader('Location', r.destination + url.search);
      res.end();
      return;
    }

    if (p === '/healthz') { res.statusCode = 200; res.end('ok'); return; }

    if (p === '/api' || p.startsWith('/api/')) {
      const name = p.slice(5).replace(/\/+$/, '');
      if (!API_NAMES.has(name)) { res.statusCode = 404; res.end('Not found'); return; }
      await handleApi(name, req, res, url);
      return;
    }

    // Static files from dist/; anything else falls back to the SPA shell
    // (vercel.json: everything except api/ and assets/ → /index.html).
    const rel = path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, '');
    const file = path.join(DIST, rel);
    if (file.startsWith(DIST + path.sep)) {
      const s = await stat(file).catch(() => null);
      if (s?.isFile()) { await serveFile(res, file, req.method); return; }
    }
    if (p.startsWith('/assets/')) { res.statusCode = 404; res.end('Not found'); return; }
    await serveFile(res, path.join(DIST, 'index.html'), req.method);
  } catch (err) {
    console.error('[server]', req.method, req.url, err);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => console.log(`plan-match-supplement listening on ${PORT}`));
