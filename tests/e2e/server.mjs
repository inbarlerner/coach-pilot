// Local stand-in for the production setup, used only for automated end-to-end tests:
//   :8000  "Supabase" gateway  → real Supabase Auth (GoTrue) :9999 + PostgREST :3000
//   :8788  the site (public/)  + Cloudflare Pages Functions (functions/api/*) run in Node
//   :8001  S3-compatible bucket that VERIFIES SigV4 signatures like R2 does
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presign } from '../../functions/_lib/sigv4.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = {
  SUPABASE_URL: 'http://127.0.0.1:8000',
  SUPABASE_ANON_KEY: process.env.ANON_KEY,
  R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: 'TESTKEY', R2_SECRET_ACCESS_KEY: 'TESTSECRET', R2_BUCKET: 'media',
  R2_TEST_ENDPOINT: 'http://127.0.0.1:8001',
};
const BUCKET_DIR = '/var/tmp/e2e/bucket';
fs.mkdirSync(BUCKET_DIR, { recursive: true });

const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
const cors = (res, origin = '*') => {
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-headers', 'authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  res.setHeader('access-control-expose-headers', 'content-range, content-length, accept-ranges');
};

// ---------- :8000 Supabase gateway ----------
http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let target;
  if (req.url.startsWith('/auth/v1/')) target = 'http://127.0.0.1:9999' + req.url.slice('/auth/v1'.length);
  else if (req.url.startsWith('/rest/v1/')) target = 'http://127.0.0.1:3000' + req.url.slice('/rest/v1'.length);
  else return res.writeHead(404).end();
  const body = await readBody(req);
  const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
  try {
    const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'manual' });
    const out = Buffer.from(await r.arrayBuffer());
    const h = {};
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k) && !k.startsWith('access-control')) h[k] = v; });
    res.writeHead(r.status, h).end(out);
  } catch (e) { res.writeHead(502).end(String(e)); }
}).listen(8000, '127.0.0.1');

// ---------- :8001 signature-verifying bucket ----------
async function verify(req, body) {
  const u = new URL(req.url, 'http://127.0.0.1:8001');
  const q = Object.fromEntries(u.searchParams);
  const sig = q['X-Amz-Signature'];
  if (!sig) return 'missing signature';
  const d = q['X-Amz-Date'];
  const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
  if (Date.now() > date.getTime() + Number(q['X-Amz-Expires']) * 1000) return 'expired';
  const signed = q['X-Amz-SignedHeaders'].split(';');
  const headers = {};
  for (const n of signed) if (n !== 'host') headers[n] = n === 'content-length' ? String(body.length) : req.headers[n] || '';
  const expected = await presign({
    method: req.method, host: '127.0.0.1:8001', protocol: 'http', path: decodeURIComponent(u.pathname),
    accessKeyId: 'TESTKEY', secretAccessKey: 'TESTSECRET', expires: Number(q['X-Amz-Expires']), headers, date,
  });
  return new URL(expected).searchParams.get('X-Amz-Signature') === sig ? null : 'signature mismatch';
}
http.createServer(async (req, res) => {
  cors(res, req.headers.origin || '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const body = await readBody(req);
  const bad = await verify(req, body);
  if (bad) return res.writeHead(403, { 'content-type': 'text/plain' }).end('AccessDenied: ' + bad);
  const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/media\//, '');
  const file = path.join(BUCKET_DIR, key.replace(/\//g, '__'));
  if (req.method === 'PUT') { fs.writeFileSync(file, body); fs.writeFileSync(file + '.type', req.headers['content-type'] || ''); return res.writeHead(200).end(); }
  if (req.method === 'DELETE') { fs.rmSync(file, { force: true }); fs.rmSync(file + '.type', { force: true }); return res.writeHead(204).end(); }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    const buf = fs.readFileSync(file), type = fs.readFileSync(file + '.type', 'utf8');
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const s = Number(m[1]), e = m[2] ? Number(m[2]) : buf.length - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${buf.length}`, 'content-length': e - s + 1 });
      return res.end(req.method === 'HEAD' ? undefined : buf.subarray(s, e + 1));
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': buf.length });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  res.writeHead(405).end();
}).listen(8001, '127.0.0.1');

// ---------- :8788 site + Pages Functions ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:8788');
  if (u.pathname.startsWith('/api/')) {
    const modPath = path.join(ROOT, 'functions', u.pathname + '.js');
    if (!fs.existsSync(modPath)) return res.writeHead(404).end();
    const mod = await import(modPath);
    const fn = mod['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()];
    if (!fn) return res.writeHead(405).end();
    const body = await readBody(req);
    const request = new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const r = await fn({ request, env });
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    return res.writeHead(r.status, h).end(Buffer.from(await r.arrayBuffer()));
  }
  let p = path.join(ROOT, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(ROOT, 'public', 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(fs.readFileSync(p));
}).listen(8788, '127.0.0.1');

console.log('e2e servers up: 8000 (supabase), 8001 (bucket), 8788 (site)');
