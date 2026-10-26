// AI coach training lab: a local app for Inbar and Jenni. Not part of the product.
//   node lab/server.mjs        → http://localhost:8790
//   LAB_MOCK=1 node lab/server.mjs   (no API calls, canned analysis, for trying the UI)
// API key: ANTHROPIC_API_KEY, or the file ~/.config/coach-pilot/anthropic-key. Never in the repo.
// Videos: lab/videos/ (stay on this computer). Runs: lab/runs/ or LAB_RUNS_DIR.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  MODELS, EFFORTS, PROMPT_VERSION, buildSystem, buildUserContent, buildRequest, callClaude, costUsd, cleanAnalysis,
} from '../functions/_lib/ai-coach.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
const VIDEOS = path.join(HERE, 'videos');
const RUNS = path.resolve(process.env.LAB_RUNS_DIR || path.join(HERE, 'runs'));
const CARDS = path.join(ROOT, 'public/ai-coach/cards');
const DECISIONS = path.join(ROOT, 'public/ai-coach/coaching-decisions.md');
const PORT = Number(process.env.PORT || 8790);
const MOCK = process.env.LAB_MOCK === '1';
const SPORTS = { kitesurf: 'קייטסרפינג (טווין טיפ)' };
fs.mkdirSync(VIDEOS, { recursive: true });
fs.mkdirSync(RUNS, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.m4v': 'video/mp4', '.svg': 'image/svg+xml',
};
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  const f = process.env.ANTHROPIC_API_KEY_FILE || path.join(os.homedir(), '.config/coach-pilot/anthropic-key');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
}

// Cards: fundamentals first, then the tricks in name order. README is not a card.
function loadCards(sport) {
  const dir = path.join(CARDS, sport);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  files.sort((a, b) => (b === 'fundamentals.md') - (a === 'fundamentals.md'));
  return files.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const h = (text.match(/^#\s+(.+)$/m) || [, file])[1];
    const title = h.replace(/^Trick card:\s*/i, '').replace(/\s+—\s+.*$/, '').trim();
    return { file, title, text };
  });
}

const safe = (s) => typeof s === 'string' && /^[\w.\- א-ת()]+$/.test(s) && !s.includes('..');
const slug = (s) => s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9א-ת]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'video';
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

function serveFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const size = fs.statSync(file).size;
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) { // video seeking needs byte ranges
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function listRuns() {
  return fs.readdirSync(RUNS).filter((d) => fs.existsSync(path.join(RUNS, d, 'analysis.json'))).map((id) => {
    const r = readJson(path.join(RUNS, id, 'analysis.json'));
    const reviews = fs.readdirSync(path.join(RUNS, id)).filter((f) => /^review-.+\.json$/.test(f)).map((f) => {
      const v = readJson(path.join(RUNS, id, f), {});
      return { reviewer: v.reviewer, score: v.overall?.score ?? null, send: v.overall?.send ?? null };
    });
    return {
      id, created: r.created, parent: r.parent, video: r.video?.name, sport: r.sport, trick: r.trick?.title || null,
      identified: r.analysis?.trick_identified, model: r.model, effort: r.effort, cost: r.result?.cost_usd_est,
      seconds: r.result?.seconds, steps: r.analysis?.steps?.length || 0, mock: !!r.mock, reviews,
    };
  }).sort((a, b) => (a.created < b.created ? 1 : -1));
}

// Canned analysis for LAB_MOCK=1, built from the frames that were sent.
function mockAnalysis(frames) {
  const zoom = frames.filter((f) => f.kind === 'zoom');
  const pick = zoom.length ? zoom : frames;
  const at = (q) => pick[Math.min(pick.length - 1, Math.floor(q * pick.length))].n;
  return {
    verdict: 'ok', trick_identified: 'קפיצה (ניתוח לדוגמה)', trick_confidence: 'low',
    summary: 'זה ניתוח לדוגמה ממצב בדיקה. שום דבר לא נשלח ל־Claude.',
    strengths: ['עמידה יציבה לפני ההמראה', 'הקייט נשאר גבוה'],
    fixes: [
      { issue: 'ראש מוביל מוקדם יותר', what_we_see: 'הראש נשאר קדימה בהמראה', why: 'הראש מוביל את הסיבוב', drill: 'להסתכל לכיוון הסיבוב לפני הפופ', frames: `F${at(0.3)}` },
      { issue: 'לוח מתחת לגוף בנחיתה', what_we_see: 'הלוח מקדים את הגוף', why: 'נחיתה רכה ובטוחה', drill: 'לכופף ברכיים ולהביא את הלוח מתחת לירכיים', frames: `F${at(0.85)}` },
    ],
    steps: [
      { kind: 'slowmo', from_frame: at(0.1), to_frame: at(0.4), rate: 0.25, title: 'ההכנה להמראה', text: 'שימו לב לקצה הלוח לפני הפופ.', fix_index: -1, draw: [] },
      { kind: 'pause', from_frame: at(0.3), to_frame: at(0.3), rate: 1, title: 'הראש בהמראה', text: 'הראש עדיין קדימה. להסתכל לכיוון הסיבוב.', fix_index: 0,
        draw: [{ shape: 'circle', points: [{ x: 50, y: 40 }, { x: 58, y: 40 }], label: 'ראש' }, { shape: 'arrow', points: [{ x: 50, y: 40 }, { x: 35, y: 30 }], label: 'לכאן' }] },
      { kind: 'pause', from_frame: at(0.6), to_frame: at(0.6), rate: 1, title: 'באוויר', text: 'זווית ברך טובה.', fix_index: -1,
        draw: [{ shape: 'angle', points: [{ x: 45, y: 45 }, { x: 50, y: 60 }, { x: 47, y: 75 }], label: '' }, { shape: 'line', points: [{ x: 20, y: 80 }, { x: 80, y: 82 }], label: 'מים' }] },
      { kind: 'pause', from_frame: at(0.85), to_frame: at(0.85), rate: 1, title: 'הנחיתה', text: 'הלוח לפני הגוף. להביא אותו מתחת לירכיים.', fix_index: 1,
        draw: [{ shape: 'label', points: [{ x: 50, y: 70 }], label: 'לוח' }] },
    ],
    safety_note: 'אין הערת בטיחות במצב בדיקה.', cannot_judge: ['מצב בדיקה'], filming_tip: 'לצלם בהילוך איטי 120fps.',
  };
}

// Runs the analysis and writes the run folder. Streams NDJSON progress lines to the browser.
async function analyze(res, input, parent = null) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  const line = (o) => res.write(JSON.stringify(o) + '\n');
  try {
    const sport = input.sport in SPORTS ? input.sport : 'kitesurf';
    const modelKey = input.model in MODELS ? input.model : 'opus';
    const effort = EFFORTS.includes(input.effort) ? input.effort : 'medium';
    const cards = loadCards(sport);
    const trick = cards.find((c) => c.file === input.trick) || null;
    const decisions = fs.existsSync(DECISIONS) ? fs.readFileSync(DECISIONS, 'utf8') : '';
    const system = buildSystem({ sportName: SPORTS[sport], decisions, cards });
    const frames = input.frames;
    if (!Array.isArray(frames) || !frames.length || frames.length > 60) throw new Error('need 1–60 frames');
    const content = buildUserContent({ frames, sportName: SPORTS[sport], trickName: trick?.title, question: input.question, duration: input.video?.duration });

    let result, analysis;
    if (MOCK) {
      line({ type: 'progress', phase: 'thinking', chars: 0 });
      await new Promise((r) => setTimeout(r, 800));
      analysis = mockAnalysis(frames);
      result = { model: 'mock', seconds: 0.8, usage: {}, cost_usd_est: 0, stop_reason: 'end_turn' };
    } else {
      const key = apiKey();
      if (!key) throw new Error('No API key. Set ANTHROPIC_API_KEY or save it to ~/.config/coach-pilot/anthropic-key');
      const { body, beta } = buildRequest({ modelKey, effort, system, content });
      let last = 0;
      const out = await callClaude({
        apiKey: key, body, beta,
        onProgress: (p) => { if (p.chars - last > 400 || p.chars === 0) { last = p.chars; line({ type: 'progress', ...p }); } },
      });
      analysis = JSON.parse(out.text);
      result = { model: out.model, seconds: out.seconds, usage: out.usage, cost_usd_est: costUsd(out.usage, modelKey), stop_reason: out.stop_reason };
    }
    analysis = cleanAnalysis(analysis, frames.length);

    const created = new Date().toISOString();
    const id = `${created.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${slug(input.video?.name || 'video')}-${MOCK ? 'mock' : modelKey}`;
    const dir = path.join(RUNS, id);
    fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
    const frameMeta = frames.map((f) => {
      const file = `F${String(f.n).padStart(2, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, 'frames', file), Buffer.from(f.data, 'base64'));
      return { n: f.n, t: f.t, kind: f.kind, crop: f.crop, margin: f.margin, size: f.size, file };
    });
    const run = {
      id, created, parent, mock: MOCK, prompt_version: PROMPT_VERSION,
      cards_hash: crypto.createHash('sha256').update(system).digest('hex').slice(0, 12),
      video: input.video, sport, trick: trick ? { file: trick.file, title: trick.title } : null,
      question: input.question || '', takeoff: input.takeoff ?? null, crop: input.crop || null,
      model: MOCK ? 'mock' : modelKey, effort, frames: frameMeta, result, analysis,
    };
    fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(run, null, 2));
    line({ type: 'done', id, cost: result.cost_usd_est, seconds: result.seconds });
  } catch (e) {
    line({ type: 'error', message: e.message });
  }
  res.end();
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && p === '/api/state') {
      const sports = Object.entries(SPORTS).map(([id, name]) => ({
        id, name, tricks: loadCards(id).filter((c) => c.file !== 'fundamentals.md').map(({ file, title }) => ({ file, title })),
      }));
      const videos = fs.readdirSync(VIDEOS).filter((f) => VIDEO_EXT.test(f)).map((name) => ({ name, size: fs.statSync(path.join(VIDEOS, name)).size }));
      return send(res, 200, {
        hasKey: !!apiKey(), mock: MOCK, runsDir: path.relative(ROOT, RUNS) || RUNS, sports, videos,
        models: Object.entries(MODELS).map(([k, m]) => ({ key: k, label: m.label })), efforts: EFFORTS,
      });
    }
    if (req.method === 'GET' && p.startsWith('/videos/')) {
      const name = p.slice(8);
      if (!safe(name)) return send(res, 400, { error: 'bad name' });
      return serveFile(req, res, path.join(VIDEOS, name));
    }
    if (req.method === 'POST' && p === '/api/videos') { // drop a video on the page → saved to lab/videos
      const name = path.basename(url.searchParams.get('name') || '');
      if (!safe(name) || !VIDEO_EXT.test(name)) return send(res, 400, { error: 'bad file name' });
      fs.writeFileSync(path.join(VIDEOS, name), await readBody(req, 500e6));
      return send(res, 200, { ok: true, name });
    }
    if (req.method === 'GET' && p === '/api/runs') return send(res, 200, listRuns());
    let m = /^\/api\/runs\/([\w.\-א-ת]+)$/.exec(p);
    if (req.method === 'GET' && m) {
      const dir = path.join(RUNS, m[1]);
      const run = readJson(path.join(dir, 'analysis.json'));
      if (!run) return send(res, 404, { error: 'no such run' });
      const reviews = {};
      for (const f of fs.readdirSync(dir).filter((x) => /^review-.+\.json$/.test(x))) { const v = readJson(path.join(dir, f)); if (v) reviews[v.reviewer] = v; }
      return send(res, 200, { run, reviews });
    }
    m = /^\/runs\/([\w.\-א-ת]+)\/frames\/(F\d+\.jpg)$/.exec(p);
    if (req.method === 'GET' && m) return serveFile(req, res, path.join(RUNS, m[1], 'frames', m[2]));
    m = /^\/api\/runs\/([\w.\-א-ת]+)\/review$/.exec(p);
    if (req.method === 'PUT' && m) {
      const review = JSON.parse(await readBody(req, 2e6));
      const who = String(review.reviewer || '').trim();
      if (!/^[\w\- א-ת]{1,30}$/.test(who)) return send(res, 400, { error: 'reviewer name needed' });
      if (!fs.existsSync(path.join(RUNS, m[1], 'analysis.json'))) return send(res, 404, { error: 'no such run' });
      review.updated = new Date().toISOString();
      fs.writeFileSync(path.join(RUNS, m[1], `review-${who.replace(/\s+/g, '_')}.json`), JSON.stringify(review, null, 2));
      return send(res, 200, { ok: true, updated: review.updated });
    }
    if (req.method === 'POST' && p === '/api/analyze') return analyze(res, JSON.parse(await readBody(req, 60e6)));
    m = /^\/api\/runs\/([\w.\-א-ת]+)\/rerun$/.exec(p);
    if (req.method === 'POST' && m) { // same frames, current cards and prompt
      const opts = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      const src = readJson(path.join(RUNS, m[1], 'analysis.json'));
      if (!src) return send(res, 404, { error: 'no such run' });
      const frames = src.frames.map((f) => ({ ...f, data: fs.readFileSync(path.join(RUNS, m[1], 'frames', f.file)).toString('base64') }));
      return analyze(res, {
        video: src.video, sport: src.sport, trick: src.trick?.file, question: src.question, takeoff: src.takeoff, crop: src.crop,
        model: opts.model || src.model, effort: opts.effort || src.effort, frames,
      }, src.id);
    }
    if (req.method === 'GET' && p === '/core.js') return serveFile(req, res, path.join(ROOT, 'functions/_lib/ai-coach.js'));
    if (req.method === 'GET') {
      const file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
      if (!file.startsWith(PUBLIC)) return send(res, 400, { error: 'bad path' });
      return serveFile(req, res, file);
    }
    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message }); else res.end();
  }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} is busy: the lab is probably already running. Open http://localhost:${PORT}, or start another copy with PORT=${PORT + 1} node lab/server.mjs`);
  process.exit(1);
}).listen(PORT, () => {
  console.log(`AI coach lab → http://localhost:${PORT}${MOCK ? '  (mock mode: no API calls)' : ''}`);
  console.log(`videos: ${path.relative(process.cwd(), VIDEOS)} · runs: ${path.relative(process.cwd(), RUNS) || RUNS} · API key: ${apiKey() ? 'found' : 'MISSING'}`);
});
