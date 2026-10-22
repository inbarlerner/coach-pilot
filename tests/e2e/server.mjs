// Local stand-in for the production setup, used only for automated end-to-end tests:
//   :8000  "Supabase" gateway
//            /auth/v1    → real Supabase Auth (GoTrue) on :9999
//            /rest/v1    → PostgREST on :3000
//            /storage/v1 → a small Supabase Storage emulator (below)
//   :8788  the site (public/) + Cloudflare Pages Functions (functions/api/*) run in Node
//
// The storage emulator behaves like Supabase Storage where it matters for security:
// every object operation runs AS THE SIGNED-IN USER against storage.objects through
// PostgREST, so the access rules from supabase/003_storage.sql decide what is allowed.
// Bucket limits (size, types) are read from storage.buckets, as Supabase does.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANON = process.env.ANON_KEY;
const env = { SUPABASE_URL: 'http://127.0.0.1:8000', SUPABASE_PUBLISHABLE_KEY: ANON };
const FILES = '/var/tmp/e2e/bucket';
const SIGN_SECRET = crypto.randomBytes(32);
fs.mkdirSync(FILES, { recursive: true });

const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
const cors = (res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-upsert, cache-control');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  res.setHeader('access-control-expose-headers', 'content-range, content-length, accept-ranges');
};
const sendJson = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
const storageErr = (res, http, code, error, message) => sendJson(res, http, { statusCode: String(code), error, message });

function bucketConfig(id) {
  const out = execFileSync('psql', ['-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', 'e2e', '-At', '-c',
    `select coalesce(file_size_limit, 0) || '|' || array_to_string(coalesce(allowed_mime_types, '{}'), ',') from storage.buckets where id = '${id.replace(/'/g, '')}'`]).toString().trim();
  if (!out) return null;
  const [limit, types] = out.split('|');
  return { limit: Number(limit), types: types ? types.split(',') : [] };
}
// Storage table access as the user (RLS applies).
async function asUser(token, method, query, body, prefer) {
  const r = await fetch('http://127.0.0.1:3000/objects?' + query, {
    method,
    headers: {
      authorization: 'Bearer ' + token, 'accept-profile': 'storage', 'content-profile': 'storage',
      'content-type': 'application/json', ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}
const pgQuote = (v) => '"' + v.replace(/"/g, '\\"') + '"';
const fileFor = (name) => path.join(FILES, name.replace(/\//g, '__'));
const sign = (name, exp) => crypto.createHmac('sha256', SIGN_SECRET).update(name + '|' + exp).digest('hex');
const subOf = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub || null; } catch { return null; } };

function serveFile(req, res, name) {
  const f = fileFor(name);
  if (!fs.existsSync(f)) return storageErr(res, 400, 404, 'not_found', 'Object not found');
  const buf = fs.readFileSync(f), type = fs.readFileSync(f + '.type', 'utf8');
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const s = Number(m[1]), e = m[2] ? Number(m[2]) : buf.length - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${buf.length}`, 'content-length': e - s + 1 });
    return res.end(req.method === 'HEAD' ? undefined : buf.subarray(s, e + 1));
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': buf.length });
  return res.end(req.method === 'HEAD' ? undefined : buf);
}

async function storage(req, res, p) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  let m;
  // Signed download (no session needed; the signature is the permission)
  if ((m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'GET') {
    const u = new URL(req.url, 'http://x');
    const [exp, sig] = (u.searchParams.get('token') || '').split('.');
    const name = decodeURIComponent(m[2]);
    if (!sig || sign(name, exp) !== sig) return storageErr(res, 400, 400, 'InvalidSignature', 'The signature is invalid');
    if (Date.now() / 1000 > Number(exp)) return storageErr(res, 400, 400, 'InvalidJWT', 'jwt expired');
    return serveFile(req, res, name);
  }
  if ((m = p.match(/^\/object\/public\/([^/]+)\/(.+)$/))) return storageErr(res, 400, 404, 'not_found', 'Bucket not found'); // bucket is private
  if (!token) return storageErr(res, 400, 403, 'Unauthorized', 'headers must have required property authorization');
  // Create signed URL — the object must be readable by this user
  if ((m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const name = decodeURIComponent(m[2]);
    const r = await asUser(token, 'GET', `bucket_id=eq.${m[1]}&name=eq.${encodeURIComponent(name)}&select=name`);
    if (!r.ok || !r.data.length) return storageErr(res, 400, 404, 'not_found', 'Object not found');
    const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn || 60);
    return sendJson(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${exp}.${sign(name, exp)}` });
  }
  // Authenticated download
  if ((m = p.match(/^\/object\/authenticated\/([^/]+)\/(.+)$/)) && req.method === 'GET') {
    const name = decodeURIComponent(m[2]);
    const r = await asUser(token, 'GET', `bucket_id=eq.${m[1]}&name=eq.${encodeURIComponent(name)}&select=name`);
    if (!r.ok || !r.data.length) return storageErr(res, 400, 404, 'not_found', 'Object not found');
    return serveFile(req, res, name);
  }
  // Upload
  if ((m = p.match(/^\/object\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
    const bucket = m[1], name = decodeURIComponent(m[2]);
    const cfg = bucketConfig(bucket);
    if (!cfg) return storageErr(res, 400, 404, 'Bucket not found', 'Bucket not found');
    const body = await readBody(req);
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (cfg.limit && body.length > cfg.limit) return storageErr(res, 413, 413, 'Payload too large', 'The object exceeded the maximum allowed size');
    if (cfg.types.length && !cfg.types.includes(type)) return storageErr(res, 400, 415, 'invalid_mime_type', `mime type ${type} is not supported`);
    const r = await asUser(token, 'POST', '', { bucket_id: bucket, name, owner_id: subOf(token), metadata: { size: body.length, mimetype: type } });
    if (!r.ok) {
      if (r.data?.code === '23505') return storageErr(res, 400, 409, 'Duplicate', 'The resource already exists');
      return storageErr(res, 400, 403, 'Unauthorized', r.data?.message || 'new row violates row-level security policy');
    }
    fs.writeFileSync(fileFor(name), body); fs.writeFileSync(fileFor(name) + '.type', type);
    return sendJson(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
  }
  // Remove
  if ((m = p.match(/^\/object\/([^/]+)$/)) && req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
    if (!prefixes.length) return sendJson(res, 200, []);
    const r = await asUser(token, 'DELETE', `bucket_id=eq.${m[1]}&name=in.(${prefixes.map((x) => encodeURIComponent(pgQuote(x))).join(',')})`, null, 'return=representation');
    if (!r.ok) return storageErr(res, 400, 400, 'Error', r.data?.message || 'delete failed');
    for (const o of r.data) { fs.rmSync(fileFor(o.name), { force: true }); fs.rmSync(fileFor(o.name) + '.type', { force: true }); }
    return sendJson(res, 200, r.data);
  }
  return storageErr(res, 404, 404, 'not_found', 'Route not found');
}

// ---------- :8000 Supabase gateway ----------
http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/storage/v1/')) {
    try { return await storage(req, res, u.pathname.slice('/storage/v1'.length)); }
    catch (e) { return storageErr(res, 500, 500, 'internal', String(e)); }
  }
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

console.log('e2e servers up: 8000 (supabase: auth, rest, storage), 8788 (site)');
