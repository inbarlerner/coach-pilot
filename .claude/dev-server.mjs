// Local preview of the site: serves public/ and answers /api/config like Cloudflare Pages does.
// Supabase settings come from SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY if set,
// otherwise from the live site's public /api/config. That means the LIVE database.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8788);
const LIVE = 'https://coach-pilot-5jk.pages.dev/api/config';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

let config = null;
async function getConfig() {
  if (process.env.SUPABASE_URL) {
    return { supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || null };
  }
  if (!config) config = await (await fetch(LIVE)).json();
  return config;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/config') {
    try {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(await getConfig()));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Could not load config: ' + e.message }));
    }
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, local: true }));
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';   // like Cloudflare Pages: /privacy → privacy.html
  if (!fs.existsSync(file)) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`coach-pilot local: http://localhost:${PORT}/`));
