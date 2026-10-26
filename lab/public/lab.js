// AI coach lab page: prepare a video → frames → Claude → play the AI's script → review it.
import { renderText, frameLabel } from '/core.js';

const $app = document.getElementById('app');
const $status = document.getElementById('status');
const $reviewer = document.getElementById('reviewer');
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const MARGIN = { top: 24, left: 24, bottom: 24 }; // grid labels around each frame sent to the AI
let cfg = null;

// ---------- small helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const api = async (url, opts) => { const r = await fetch(url, opts); const b = await r.json(); if (!r.ok) throw new Error(b.error || r.status); return b; };
const fmtT = (t) => t.toFixed(2) + 's';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const status = (msg) => { $status.textContent = msg || ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

$reviewer.value = store.get('lab-reviewer') || '';
$reviewer.addEventListener('input', () => store.set('lab-reviewer', $reviewer.value.trim()));

async function ndjson(url, body, onLine) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) { last = JSON.parse(l); onLine(last); } }
  }
  return last;
}
const progressText = (p) => p.phase === 'writing' ? `Claude כותב… ${p.chars} תווים` : `Claude חושב… ${p.chars ? p.chars + ' תווים' : ''}`;

function seekTo(v, t) {
  return new Promise((r) => {
    if (Math.abs(v.currentTime - t) < 0.0005 && v.readyState >= 2) return r();
    v.addEventListener('seeked', () => r(), { once: true });
    v.currentTime = t;
  });
}

// ---------- drawing ----------
// Shapes are stored in grid units (0–100) of a crop rectangle (normalized video coords).
// toPx maps a grid point to canvas pixels; s is the zoom scale (keeps lines the same width on screen).
function drawShapes(ctx, shapes, toPx, s = 1, handles = false) {
  const lw = 3 / s, out = lw + 3 / s;
  const stroke = (path) => { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.lineWidth = out; path(); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; path(); ctx.stroke(); };
  const text = (str, x, y) => {
    if (!str) return;
    ctx.font = `600 ${15 / s}px system-ui, sans-serif`; ctx.direction = 'rtl';
    const w = ctx.measureText(str).width, pad = 4 / s, hgt = 20 / s;
    ctx.fillStyle = 'rgba(0,0,0,.82)'; ctx.fillRect(x - w / 2 - pad, y - hgt / 2, w + pad * 2, hgt);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str, x, y + 1 / s);
  };
  for (const d of shapes) {
    const P = d.points.map(toPx);
    if (d.shape === 'arrow' || d.shape === 'line') {
      const [a, b] = P;
      stroke(() => {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        if (d.shape === 'arrow') {
          const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 16 / s;
          ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - L * Math.cos(ang - 0.45), b.y - L * Math.sin(ang - 0.45));
          ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - L * Math.cos(ang + 0.45), b.y - L * Math.sin(ang + 0.45));
        }
      });
      if (d.shape === 'arrow') text(d.label, b.x, b.y - 18 / s); else text(d.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 16 / s);
    } else if (d.shape === 'circle') {
      const [c, e] = P; const r = Math.max(6 / s, Math.hypot(e.x - c.x, e.y - c.y));
      stroke(() => { ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); });
      text(d.label, c.x, c.y - r - 14 / s);
    } else if (d.shape === 'angle') {
      const [a, v, b] = P;
      stroke(() => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(v.x, v.y); ctx.lineTo(b.x, b.y); });
      const a1 = Math.atan2(a.y - v.y, a.x - v.x), a2 = Math.atan2(b.y - v.y, b.x - v.x);
      let diff = a2 - a1; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      stroke(() => { ctx.beginPath(); ctx.arc(v.x, v.y, 22 / s, a1, a1 + diff, diff < 0); });
      const deg = Math.round(Math.abs(diff) * 180 / Math.PI), mid = a1 + diff / 2;
      text(`${d.label ? d.label + ' ' : ''}${deg}°`, v.x - Math.cos(mid) * 40 / s, v.y - Math.sin(mid) * 40 / s);
    } else if (d.shape === 'label') {
      const [p] = P;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 / s;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      text(d.label, p.x, p.y - 18 / s);
    }
    if (handles) for (const q of P) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 / s; ctx.beginPath(); ctx.arc(q.x, q.y, 7 / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
}

// ---------- the stage: a video (or, without the video, the saved frames) with a drawing layer ----------
class Stage {
  constructor(run, videoUrl) {
    this.run = run;
    this.el = h('div', { class: 'stage' });
    this.zoomEl = h('div', { class: 'zoom' });
    this.canvas = h('canvas');
    this.caption = h('div', { class: 'caption' });
    this.badge = h('div', { class: 'badge' });
    this.scale = 1; this.overlay = null; this.mode = 'video';
    this.video = h('video', { playsinline: true, muted: true, preload: 'auto', src: videoUrl });
    this.zoomEl.append(this.video, this.canvas);
    this.el.append(this.zoomEl, this.caption, this.badge);
    this.ctx = this.canvas.getContext('2d');
    this.ready = new Promise((resolve) => {
      this.video.addEventListener('loadedmetadata', () => { this.setAspect(this.video.videoWidth / this.video.videoHeight); resolve(true); }, { once: true });
      this.video.addEventListener('error', () => { this.toFramesMode(); resolve(false); }, { once: true });
    });
    new ResizeObserver(() => this.redraw()).observe(this.el);
    this.frameImgs = {};
  }
  setAspect(ar) { this.ar = ar; this.el.style.aspectRatio = String(ar); this.el.style.maxWidth = `calc(66vh * ${ar})`; }
  toFramesMode() { this.mode = 'frames'; this.video.remove(); }
  size() { return { W: this.el.clientWidth, H: this.el.clientHeight }; }
  frame(n) { return this.run.frames[n - 1]; }

  async frameImage(f) {
    if (!this.frameImgs[f.file]) {
      this.frameImgs[f.file] = new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = `/runs/${encodeURIComponent(this.run.id)}/frames/${f.file}`; });
    }
    return this.frameImgs[f.file];
  }

  zoom(crop) {
    if (this.mode !== 'video' || !crop || (crop.w >= 0.98 && crop.h >= 0.98)) { this.scale = 1; this.zoomEl.style.transform = ''; return; }
    const { W, H } = this.size();
    const s = clamp(0.9 / Math.max(crop.w, crop.h), 1, 4);
    const cx = (crop.x + crop.w / 2) * W, cy = (crop.y + crop.h / 2) * H;
    const tx = clamp(W / 2 - s * cx, W - s * W, 0), ty = clamp(H / 2 - s * cy, H - s * H, 0);
    this.scale = s; this.zoomEl.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  // overlay: { t, frameN, crop, shapes, title, text, editable }
  async show(o) {
    this.overlay = o;
    if (this.mode === 'video') {
      this.video.pause(); this.video.controls = false;
      await seekTo(this.video, o.t);
      this.zoom(o.crop);
    } else {
      const f = this.frame(o.frameN || 1);
      const im = await this.frameImage(f);
      const m = f.margin || MARGIN;
      this.frameRect = { sx: m.left, sy: m.top, sw: im.naturalWidth - m.left, sh: im.naturalHeight - m.top - m.bottom, im };
      this.setAspect(this.frameRect.sw / this.frameRect.sh);
    }
    this.setCaption(o.title, o.text);
    this.badge.textContent = o.badge || ''; this.badge.classList.toggle('show', !!o.badge);
    this.redraw();
  }
  clear() {
    this.overlay = null; this.zoom(null); this.setCaption(); this.badge.classList.remove('show');
    this.redraw();
  }
  setCaption(title, text) {
    this.caption.replaceChildren(...(title ? [h('b', {}, title)] : []), text || '');
    this.caption.classList.toggle('show', !!(title || text));
  }

  // Grid point → canvas pixel, for the current overlay.
  toPx(p, crop) {
    const { W, H } = this.size();
    if (this.mode === 'frames') return { x: p.x / 100 * W, y: p.y / 100 * H };
    const c = crop || FULL;
    return { x: (c.x + p.x / 100 * c.w) * W, y: (c.y + p.y / 100 * c.h) * H };
  }
  fromClient(ev, crop) { // pointer → grid point of the overlay's crop
    const r = this.canvas.getBoundingClientRect();
    const nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
    if (this.mode === 'frames') return { x: clamp(nx * 100, 0, 100), y: clamp(ny * 100, 0, 100) };
    const c = crop || FULL;
    return { x: clamp((nx - c.x) / c.w * 100, 0, 100), y: clamp((ny - c.y) / c.h * 100, 0, 100) };
  }

  redraw() {
    const { W, H } = this.size(); if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(W * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (this.mode === 'frames' && this.frameRect) { const r = this.frameRect; ctx.drawImage(r.im, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H); }
    if (this.extraDraw) this.extraDraw(ctx, W, H);
    const o = this.overlay; if (!o) return;
    drawShapes(ctx, o.shapes || [], (p) => this.toPx(p, o.crop), this.mode === 'video' ? this.scale : 1, !!o.editable);
  }
}

// ---------- home ----------
async function home() {
  cfg = await api('/api/state');
  status(cfg.mock ? 'מצב בדיקה: בלי קריאות ל־Claude' : cfg.hasKey ? '' : 'אין מפתח API: ראו lab/README.md');
  const runs = await api('/api/runs');

  const vidSel = h('select', {}, cfg.videos.length ? cfg.videos.map((v) => h('option', { value: v.name }, `${v.name} (${(v.size / 1e6).toFixed(1)}MB)`)) : h('option', { value: '' }, 'אין סרטונים ב־lab/videos'));
  const drop = h('div', { class: 'drop' }, 'גררו לכאן סרטון (נשמר ב־lab/videos, לא עולה לגיט)');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0]; if (!f) return;
    drop.textContent = `מעלה ${f.name}…`;
    try { await api(`/api/videos?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }); location.hash = `#/new/${encodeURIComponent(f.name)}`; }
    catch (err) { drop.textContent = 'שגיאה: ' + err.message; }
  });

  const rerunModel = h('select', {}, cfg.models.map((m) => h('option', { value: m.key }, m.label)));
  const rerunEffort = h('select', {}, cfg.efforts.map((e) => h('option', { value: e, selected: e === 'medium' }, e)));
  const rerunMsg = h('div', { class: 'progress' });
  const originals = runs.filter((r) => !r.parent && !r.mock);
  const rerunAll = h('button', {
    disabled: !originals.length,
    onclick: async () => {
      const est = originals.reduce((s, r) => s + (r.cost || 0), 0);
      if (!confirm(`להריץ שוב ${originals.length} ניתוחים עם הכרטיסים הנוכחיים? עלות משוערת ~$${est.toFixed(2)}`)) return;
      rerunAll.disabled = true;
      for (const [i, r] of originals.entries()) {
        const last = await ndjson(`/api/runs/${encodeURIComponent(r.id)}/rerun`, { model: rerunModel.value, effort: rerunEffort.value },
          (p) => { rerunMsg.textContent = `${i + 1}/${originals.length} · ${r.video} · ${p.type === 'progress' ? progressText(p) : p.type}`; });
        if (last?.type === 'error') rerunMsg.textContent = `שגיאה ב־${r.id}: ${last.message}`;
      }
      route();
    },
  }, `הרץ שוב את כל המקוריים (${originals.length})`);

  $app.replaceChildren(
    h('div', { class: 'card' },
      h('h2', {}, 'ניתוח חדש'),
      h('div', { class: 'row' }, vidSel, h('button', { class: 'primary', disabled: !cfg.videos.length, onclick: () => { location.hash = `#/new/${encodeURIComponent(vidSel.value)}`; } }, 'המשך')),
      drop),
    h('div', { class: 'card' },
      h('h2', {}, `ניתוחים (${runs.length})`),
      h('div', { class: 'row muted' }, `נשמרים ב־${cfg.runsDir}. אחרי שינוי בכרטיסים: הרצה חוזרת על אותם פריימים.`),
      h('div', { class: 'row' }, 'מודל:', rerunModel, 'effort:', rerunEffort, rerunAll), rerunMsg,
      runs.length ? h('table', {},
        h('tr', {}, ['תאריך', 'סרטון', 'תרגיל', 'מודל', 'עלות', 'זמן', 'ביקורות', ''].map((x) => h('th', {}, x))),
        runs.map((r) => h('tr', {},
          h('td', {}, new Date(r.created).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }), r.parent ? h('div', { class: 'muted' }, 'הרצה חוזרת') : null),
          h('td', {}, r.video),
          h('td', {}, r.trick || 'לא נאמר', h('div', { class: 'muted' }, 'זוהה: ' + (r.identified || '—'))),
          h('td', {}, r.mock ? 'בדיקה' : `${r.model} · ${r.effort}`),
          h('td', {}, r.cost != null ? '$' + r.cost.toFixed(3) : '—'),
          h('td', {}, r.seconds != null ? Math.round(r.seconds) + 's' : '—'),
          h('td', {}, r.reviews.length ? r.reviews.map((v) => h('span', { class: 'tag' }, `${v.reviewer}: ${v.score ?? '?'}/5`)) : h('span', { class: 'muted' }, 'עוד לא')),
          h('td', {}, h('a', { href: `#/run/${encodeURIComponent(r.id)}` }, 'פתח')),
        ))) : h('p', { class: 'muted' }, 'עוד אין ניתוחים.')),
  );
}

// ---------- prepare a new analysis ----------
function planFrames(d, takeoff, crop) {
  const out = [];
  const zoomKind = crop ? 'zoom' : 'overview';
  if (takeoff != null) {
    for (let i = 0; i < 8; i++) out.push({ t: d * (i + 0.5) / 8, kind: 'overview' });
    const a = Math.max(0, takeoff - 1.5), b = Math.min(d - 0.05, takeoff + 3.5);
    for (let t = a; t <= b + 1e-6; t += 0.2) out.push({ t, kind: zoomKind });
  } else {
    const n = 24;
    if (crop) for (let i = 0; i < 8; i++) out.push({ t: d * (i + 0.5) / 8, kind: 'overview' });
    for (let i = 0; i < n; i++) out.push({ t: d * (i + 0.5) / n, kind: zoomKind });
  }
  out.sort((x, y) => x.t - y.t || (x.kind === 'overview' ? -1 : 1));
  return out.map((f, i) => ({ ...f, t: +f.t.toFixed(3), n: i + 1, crop: f.kind === 'zoom' ? crop : FULL }));
}

async function extractFrames(url, plan, onStep) {
  const v = h('video', { muted: true, playsinline: true, preload: 'auto', src: url });
  await new Promise((r, j) => { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', () => j(new Error('video failed to load')), { once: true }); });
  const VW = v.videoWidth, VH = v.videoHeight, out = [];
  for (const f of plan) {
    await seekTo(v, f.t);
    const c = f.crop;
    const sw = c.w * VW, sh = c.h * VH;
    const long = f.kind === 'zoom' ? 800 : 640;
    const s = Math.min(long / Math.max(sw, sh), 2.5);
    const W = Math.round(sw * s), H = Math.round(sh * s);
    const cv = h('canvas'); cv.width = W + MARGIN.left; cv.height = H + MARGIN.top + MARGIN.bottom;
    const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    x.drawImage(v, c.x * VW, c.y * VH, sw, sh, MARGIN.left, MARGIN.top, W, H);
    x.font = '11px system-ui, sans-serif'; x.fillStyle = '#000'; x.textBaseline = 'middle';
    for (let k = 0; k <= 10; k++) {
      const gx = MARGIN.left + W * k / 10, gy = MARGIN.top + H * k / 10;
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(gx + 0.5, MARGIN.top); x.lineTo(gx + 0.5, MARGIN.top + H); x.moveTo(MARGIN.left, gy + 0.5); x.lineTo(MARGIN.left + W, gy + 0.5); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.45)';
      x.beginPath(); x.moveTo(gx - 0.5, MARGIN.top); x.lineTo(gx - 0.5, MARGIN.top + H); x.moveTo(MARGIN.left, gy - 0.5); x.lineTo(MARGIN.left + W, gy - 0.5); x.stroke();
      x.textAlign = k === 0 ? 'left' : k === 10 ? 'right' : 'center'; x.fillText(String(k * 10), gx, MARGIN.top / 2);
      x.textAlign = 'right'; x.fillText(String(k * 10), MARGIN.left - 3, clamp(gy, MARGIN.top + 6, MARGIN.top + H - 6));
    }
    x.font = '600 13px system-ui, sans-serif'; x.textAlign = 'left';
    x.fillText(`${frameLabel(f.n)} · ${fmtT(f.t)} · ${f.kind === 'zoom' ? 'zoom' : 'overview'}`, MARGIN.left, MARGIN.top + H + MARGIN.bottom / 2);
    out.push({ ...f, margin: MARGIN, size: { w: W, h: H }, data: cv.toDataURL('image/jpeg', 0.82).split(',')[1] });
    onStep(out.length, plan.length);
  }
  return { frames: out, video: { width: VW, height: VH, duration: v.duration } };
}

async function prepare(name) {
  cfg = cfg || await api('/api/state');
  const url = `/videos/${encodeURIComponent(name)}`;
  const stage = new Stage({ id: '', frames: [] }, url);
  stage.video.controls = true;
  let takeoff = null, crop = null, dragging = null;
  const sport = cfg.sports[0];
  const trickSel = h('select', {}, h('option', { value: '' }, 'לא בטוח/ה (ה־AI יזהה)'), sport.tricks.map((t) => h('option', { value: t.file }, t.title)));
  const question = h('textarea', {}, 'מה אפשר לשפר?');
  const modelSel = h('select', {}, cfg.models.map((m) => h('option', { value: m.key }, m.label)));
  const effortSel = h('select', {}, cfg.efforts.map((e) => h('option', { value: e, selected: e === 'medium' }, e)));
  const info = h('div', { class: 'muted' });
  const msg = h('div', { class: 'progress' });

  const refresh = () => {
    const d = stage.video.duration || 0;
    const plan = d ? planFrames(d, takeoff, crop) : [];
    info.textContent = `המראה: ${takeoff != null ? fmtT(takeoff) : 'לא סומנה'} · זום: ${crop ? 'מסומן' : 'אין'} · ${plan.length} פריימים`
      + (plan.length ? ` (${plan.filter((f) => f.kind === 'overview').length} סקירה, ${plan.filter((f) => f.kind === 'zoom').length} זום)` : '');
    stage.redraw();
  };
  stage.extraDraw = (ctx, W, H) => {
    if (!crop) return;
    ctx.setLineDash([6, 4]); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeRect(crop.x * W, crop.y * H, crop.w * W, crop.h * H);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.strokeRect(crop.x * W, crop.y * H, crop.w * W, crop.h * H); ctx.setLineDash([]);
  };
  const norm = (e) => { const r = stage.canvas.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
  stage.canvas.addEventListener('pointerdown', (e) => { if (!stage.el.classList.contains('picking')) return; dragging = norm(e); stage.canvas.setPointerCapture(e.pointerId); });
  stage.canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return; const p = norm(e);
    crop = { x: Math.min(p.x, dragging.x), y: Math.min(p.y, dragging.y), w: Math.abs(p.x - dragging.x), h: Math.abs(p.y - dragging.y) };
    refresh();
  });
  stage.canvas.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = null; stage.el.classList.remove('picking'); stage.video.controls = true; pickBtn.classList.remove('on');
    if (!crop || crop.w < 0.06 || crop.h < 0.06) crop = null;
    else { // keep a little room around the action
      const pad = 0.04, b = crop;
      const x = clamp(b.x - pad, 0, 1), y = clamp(b.y - pad, 0, 1);
      crop = { x, y, w: clamp(b.x + b.w + pad, 0, 1) - x, h: clamp(b.y + b.h + pad, 0, 1) - y };
    }
    refresh();
  });

  const pickBtn = h('button', { onclick: () => { stage.video.pause(); stage.video.controls = false; stage.el.classList.add('picking'); pickBtn.classList.add('on'); } }, 'סמן אזור פעולה (זום)');
  const go = h('button', {
    class: 'primary',
    onclick: async () => {
      go.disabled = true;
      try {
        const plan = planFrames(stage.video.duration, takeoff, crop);
        const { frames, video } = await extractFrames(url, plan, (i, n) => { msg.textContent = `מכין פריימים ${i}/${n}`; });
        msg.textContent = 'שולח ל־Claude…';
        const last = await ndjson('/api/analyze', {
          video: { name, ...video }, sport: sport.id, trick: trickSel.value, question: question.value.trim(),
          model: modelSel.value, effort: effortSel.value, takeoff, crop, frames,
        }, (p) => { if (p.type === 'progress') msg.textContent = progressText(p); });
        if (last?.type === 'done') location.hash = `#/run/${encodeURIComponent(last.id)}`;
        else { msg.replaceChildren(h('div', { class: 'error' }, 'שגיאה: ' + (last?.message || 'אין תשובה'))); go.disabled = false; }
      } catch (e) { msg.replaceChildren(h('div', { class: 'error' }, 'שגיאה: ' + e.message)); go.disabled = false; }
    },
  }, 'נתח');

  $app.replaceChildren(h('div', { class: 'grid2' },
    h('div', {}, stage.el, h('div', { class: 'controls' },
      h('button', { onclick: () => { stage.video.pause(); takeoff = +stage.video.currentTime.toFixed(3); refresh(); } }, 'סמן המראה כאן'),
      pickBtn,
      h('button', { onclick: () => { crop = null; takeoff = null; refresh(); } }, 'נקה סימונים')), info),
    h('div', {},
      h('div', { class: 'card' },
        h('h2', {}, name),
        h('div', { class: 'row' }, h('label', {}, 'ענף:', h('b', {}, sport.name))),
        h('div', { class: 'row' }, h('label', {}, 'תרגיל:', trickSel)),
        h('div', {}, 'שאלת המתאמן:', question),
        h('div', { class: 'row' }, h('label', {}, 'מודל:', modelSel), h('label', {}, 'effort:', effortSel)),
        h('p', { class: 'muted' }, 'כדי לקבל זום: עצרו את הסרטון ברגע ההמראה, לחצו "סמן המראה כאן", ואז גררו מלבן סביב הרוכב והקייט. בלי סימון ההמראה, נשלחים פריימים לאורך כל הסרטון.'),
        go, msg)),
  ));
  const ok = await stage.ready;
  if (!ok) { $app.replaceChildren(h('div', { class: 'error' }, `הסרטון ${name} לא נמצא ב־lab/videos.`)); return; }
  refresh();
}

// ---------- a run: play the AI's script and review it ----------
async function runView(id) {
  cfg = cfg || await api('/api/state');
  const { run, reviews } = await api(`/api/runs/${encodeURIComponent(id)}`);
  const a = run.analysis;
  const me = () => $reviewer.value.trim();
  const blank = () => ({
    reviewer: me(), run_id: run.id, overall: { score: null, send: null, notes: '' },
    steps: a.steps.map(() => ({ verdict: null, comment: '', draw: null })),
    fixes: a.fixes.map(() => ({ verdict: null, comment: '' })), missed: [],
  });
  let review = (me() && reviews[me()]) ? reviews[me()] : blank();
  review.steps = a.steps.map((_, i) => review.steps?.[i] || { verdict: null, comment: '', draw: null });
  review.fixes = a.fixes.map((_, i) => review.fixes?.[i] || { verdict: null, comment: '' });

  let saveTimer = null;
  const saveMsg = h('span', { class: 'muted' });
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!me()) { saveMsg.textContent = 'כתבו את השם שלכם למעלה כדי לשמור'; return; }
      review.reviewer = me();
      try { await api(`/api/runs/${encodeURIComponent(run.id)}/review`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(review) }); saveMsg.textContent = 'נשמר ' + new Date().toLocaleTimeString('he-IL'); }
      catch (e) { saveMsg.textContent = 'שמירה נכשלה: ' + e.message; }
    }, 600);
  };

  const stage = new Stage(run, `/videos/${encodeURIComponent(run.video?.name || '')}`);
  const hasVideo = await stage.ready;
  const frameOf = (n) => run.frames[n - 1];
  const stepShapes = (i) => review.steps[i].draw || a.steps[i].draw;
  const overlayFor = (i, editable = false) => {
    const s = a.steps[i], f = frameOf(s.from_frame);
    return {
      t: f.t, frameN: s.from_frame, crop: f.crop || FULL, shapes: stepShapes(i), editable,
      title: s.title, text: s.text, badge: `${frameLabel(s.from_frame)} · ${fmtT(f.t)}${s.kind === 'slowmo' ? ` → ${fmtT(frameOf(s.to_frame).t)} · ×${s.rate}` : ''}`,
    };
  };

  // --- editing drawings (AI steps and missed points) ---
  let edit = null; // { shapes (array we mutate), crop, onChange }
  let tool = null, dragIdx = null, newShape = null;
  const nearest = (pt) => {
    let best = null;
    edit.shapes.forEach((d, si) => d.points.forEach((p, pi) => {
      const a1 = stage.toPx(p, edit.crop), b1 = stage.toPx(pt, edit.crop); const dist = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      if (dist < 16 && (!best || dist < best.dist)) best = { si, pi, dist };
    }));
    return best;
  };
  stage.canvas.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    const pt = stage.fromClient(e, edit.crop);
    stage.canvas.setPointerCapture(e.pointerId);
    if (tool === 'delete') { const n = nearest(pt); if (n) { edit.shapes.splice(n.si, 1); edit.onChange(); } return; }
    if (tool === 'label') { const label = prompt('טקסט:'); if (label) { edit.shapes.push({ shape: 'label', points: [pt], label }); edit.onChange(); } return; }
    if (tool) { newShape = { shape: tool, points: [pt, { ...pt }], label: '' }; edit.shapes.push(newShape); stage.redraw(); return; }
    dragIdx = nearest(pt);
  });
  stage.canvas.addEventListener('pointermove', (e) => {
    if (!edit) return;
    const pt = stage.fromClient(e, edit.crop);
    if (newShape) { newShape.points[1] = pt; stage.redraw(); }
    else if (dragIdx) { edit.shapes[dragIdx.si].points[dragIdx.pi] = pt; stage.redraw(); }
  });
  stage.canvas.addEventListener('pointerup', () => {
    if (!edit) return;
    if (newShape) { const l = prompt('תווית (אפשר להשאיר ריק):', ''); newShape.label = l || ''; newShape = null; edit.onChange(); }
    else if (dragIdx) { dragIdx = null; edit.onChange(); }
  });
  const round = (shapes) => shapes.forEach((d) => d.points.forEach((p) => { p.x = +p.x.toFixed(1); p.y = +p.y.toFixed(1); }));
  const toolBar = (onReset) => {
    const btns = [['arrow', 'חץ'], ['line', 'קו'], ['circle', 'עיגול'], ['label', 'תווית'], ['delete', 'מחק צורה']].map(([k, label]) => {
      const b = h('button', { onclick: () => { tool = tool === k ? null : k; btns.forEach((x) => x.classList.toggle('on', x.dataset.k === tool)); } }, label);
      b.dataset.k = k; return b;
    });
    return h('div', { class: 'tools' }, h('span', { class: 'muted' }, 'גררו נקודות, או הוסיפו:'), btns, onReset ? h('button', { onclick: onReset }, 'חזרה לציור של ה־AI') : null);
  };
  const stopEdit = () => { edit = null; tool = null; stage.el.classList.remove('editing'); };

  // --- step list ---
  let active = -1;
  const stepEls = [];
  const selectStep = async (i, editing = false) => {
    stopScript(); stopEdit(); active = i;
    stepEls.forEach((el, k) => el.classList.toggle('active', k === i));
    const o = overlayFor(i, editing);
    if (editing) {
      if (!review.steps[i].draw) review.steps[i].draw = JSON.parse(JSON.stringify(a.steps[i].draw));
      o.shapes = review.steps[i].draw;
      edit = { shapes: o.shapes, crop: o.crop, onChange: () => { round(o.shapes); stage.redraw(); save(); } };
      stage.el.classList.add('editing');
    }
    await stage.show(o);
  };
  const verdictBtns = (obj, onChange) => {
    const opts = [['right', '✓ נכון'], ['fix', '✎ צריך תיקון'], ['wrong', '✗ שגוי']];
    const bs = opts.map(([k, l]) => h('button', { class: obj.verdict === k ? 'on' : '', onclick: () => { obj.verdict = obj.verdict === k ? null : k; bs.forEach((b, j) => b.classList.toggle('on', opts[j][0] === obj.verdict)); onChange(); } }, l));
    return h('div', { class: 'verdicts' }, bs);
  };
  const stepList = h('ol', { class: 'steps' }, a.steps.map((s, i) => {
    const r = review.steps[i];
    let editBox = null;
    const editBtn = h('button', {
      onclick: async () => {
        if (editBox) { editBox.remove(); editBox = null; editBtn.classList.remove('on'); stopEdit(); return selectStep(i); }
        await selectStep(i, true); editBtn.classList.add('on');
        editBox = toolBar(() => { review.steps[i].draw = null; save(); selectStep(i, true); });
        el.append(editBox);
      },
    }, 'ערוך ציור');
    const el = h('li', { class: 'step' },
      h('div', { class: 'head', onclick: () => selectStep(i) },
        h('span', { class: 'tag' }, s.kind === 'pause' ? 'עצירה' : `האטה ×${s.rate}`), h('b', {}, s.title),
        h('span', { class: 'muted' }, frameLabel(s.from_frame))),
      h('div', {}, s.text),
      s.fix_index >= 0 ? h('div', { class: 'muted' }, `מדגים תיקון ${s.fix_index + 1}`) : null,
      h('div', { class: 'row' }, verdictBtns(r, save), s.kind === 'pause' ? editBtn : null),
      h('textarea', { placeholder: 'הערה (מה לא נכון, מה היית אומר/ת)', oninput: (e) => { r.comment = e.target.value; save(); } }, r.comment || ''));
    stepEls.push(el);
    return el;
  }));

  // --- missed points ---
  const missedList = h('ol', { class: 'steps' });
  const renderMissed = () => missedList.replaceChildren(...review.missed.map((m, i) => {
    let editBox = null;
    const show = async (editing) => {
      stopScript(); stopEdit(); stepEls.forEach((x) => x.classList.remove('active'));
      const o = { t: m.t, frameN: m.frame_n, crop: m.crop || FULL, shapes: m.draw, editable: editing, title: 'נקודה שה־AI פספס', text: m.text, badge: fmtT(m.t) };
      if (editing) { edit = { shapes: m.draw, crop: o.crop, onChange: () => { round(m.draw); stage.redraw(); save(); } }; stage.el.classList.add('editing'); }
      await stage.show(o);
    };
    const editBtn = h('button', { onclick: async () => {
      if (editBox) { editBox.remove(); editBox = null; editBtn.classList.remove('on'); stopEdit(); return show(false); }
      await show(true); editBtn.classList.add('on'); editBox = toolBar(null); li.append(editBox);
    } }, 'צייר');
    const li = h('li', { class: 'step' },
      h('div', { class: 'head', onclick: () => show(false) }, h('b', {}, `נקודה ${i + 1}`), h('span', { class: 'muted' }, fmtT(m.t))),
      h('textarea', { placeholder: 'מה ה־AI היה צריך לומר כאן?', oninput: (e) => { m.text = e.target.value; save(); } }, m.text || ''),
      h('div', { class: 'row' }, editBtn, h('button', { onclick: () => { if (confirm('למחוק את הנקודה?')) { review.missed.splice(i, 1); save(); renderMissed(); } } }, 'מחק')));
    return li;
  }));
  renderMissed();
  const addMissed = h('button', {
    onclick: () => {
      stopScript();
      let t, frame_n = null;
      if (stage.mode === 'video') t = +stage.video.currentTime.toFixed(3);
      else { const o = stage.overlay; frame_n = o?.frameN || 1; t = frameOf(frame_n).t; }
      review.missed.push({ t, frame_n, crop: stage.mode === 'frames' ? (frameOf(frame_n).crop || FULL) : FULL, text: '', draw: [] });
      save(); renderMissed();
    },
  }, '+ נקודה שה־AI פספס (ברגע הנוכחי)');

  // --- fixes + overall ---
  const fixList = h('ol', {}, a.fixes.map((f, i) => {
    const r = review.fixes[i];
    return h('li', { class: 'fix' }, h('b', {}, f.issue), h('div', { class: 'muted' }, f.what_we_see), h('div', {}, 'מה לעשות: ' + f.drill),
      verdictBtns(r, save), h('textarea', { placeholder: 'הערה', oninput: (e) => { r.comment = e.target.value; save(); } }, r.comment || ''));
  }));
  const scoreBtns = [1, 2, 3, 4, 5].map((n) => h('button', { class: review.overall.score === n ? 'on' : '', onclick: () => { review.overall.score = n; scoreBtns.forEach((b, j) => b.classList.toggle('on', j + 1 === n)); save(); } }, String(n)));
  const sendOpts = [['yes', 'כן, כמו שהוא'], ['edits', 'עם תיקונים'], ['no', 'לא']];
  const sendBtns = sendOpts.map(([k, l]) => h('button', { class: review.overall.send === k ? 'on' : '', onclick: () => { review.overall.send = k; sendBtns.forEach((b, j) => b.classList.toggle('on', sendOpts[j][0] === k)); save(); } }, l));

  // --- script playback ---
  let playing = null; // { cancel }
  const holdBox = h('input', { type: 'checkbox' });
  let skipHold = null;
  function stopScript() {
    if (playing) { playing.cancel = true; playing = null; }
    if (stage.mode === 'video') { stage.video.pause(); stage.video.playbackRate = 1; }
    if (skipHold) skipHold();
    stage.clear();
  }
  const holdMs = (s) => clamp(2500 + (s.title.length + s.text.length) * 55, 3500, 11000);
  const waitHold = (ms) => new Promise((r) => {
    let done = false; const fin = () => { if (!done) { done = true; skipHold = null; r(); } };
    skipHold = fin; if (!holdBox.checked) setTimeout(fin, ms);
  });

  async function playScript() {
    stopScript(); stopEdit(); active = -1; stepEls.forEach((x) => x.classList.remove('active'));
    const me2 = playing = { cancel: false };
    const mark = (i) => stepEls.forEach((x, k) => x.classList.toggle('active', k === i));
    if (stage.mode === 'frames') { // flipbook of the saved frames
      for (const [i, s] of a.steps.entries()) {
        if (me2.cancel) return;
        mark(i);
        if (s.kind === 'pause') { await stage.show(overlayFor(i)); await waitHold(holdMs(s)); }
        else {
          for (let n = s.from_frame; n <= s.to_frame && !me2.cancel; n++) {
            const next = frameOf(Math.min(n + 1, s.to_frame));
            await stage.show({ t: frameOf(n).t, frameN: n, shapes: [], title: s.title, text: s.text, badge: `×${s.rate}` });
            await sleep(clamp((next.t - frameOf(n).t) / s.rate * 1000, 150, 1500));
          }
        }
      }
      if (!me2.cancel) { stage.clear(); playing = null; }
      return;
    }
    const v = stage.video;
    const events = [];
    a.steps.forEach((s, i) => {
      if (s.kind === 'pause') events.push({ t: frameOf(s.from_frame).t, type: 'pause', i });
      else { events.push({ t: frameOf(s.from_frame).t, type: 'slow', i }); events.push({ t: frameOf(s.to_frame).t, type: 'normal', i }); }
    });
    events.sort((x, y) => x.t - y.t);
    v.controls = false; v.playbackRate = 1;
    await seekTo(v, 0);
    let k = 0, slow = null;
    await v.play();
    while (!me2.cancel) {
      await new Promise((r) => requestAnimationFrame(r));
      if (me2.cancel) return;
      while (k < events.length && v.currentTime >= events[k].t - 0.02) {
        const ev = events[k++], s = a.steps[ev.i];
        mark(ev.i);
        if (ev.type === 'slow') { slow = s; v.playbackRate = s.rate; stage.setCaption(s.title, s.text); stage.badge.textContent = `×${s.rate}`; stage.badge.classList.add('show'); }
        else if (ev.type === 'normal') { slow = null; v.playbackRate = 1; stage.setCaption(); stage.badge.classList.remove('show'); }
        else {
          await stage.show(overlayFor(ev.i));
          await waitHold(holdMs(s));
          if (me2.cancel) return;
          stage.overlay = null; stage.zoom(null); stage.redraw();
          if (slow) { stage.setCaption(slow.title, slow.text); stage.badge.textContent = `×${slow.rate}`; } else { stage.setCaption(); stage.badge.classList.remove('show'); }
          await sleep(450);
          v.playbackRate = slow ? slow.rate : 1;
          await v.play();
        }
      }
      if (v.ended) { mark(-1); stage.clear(); playing = null; v.controls = true; return; }
    }
  }

  const u = run.result?.usage || {};
  const head = h('div', { class: 'card' },
    h('h2', {}, `${run.video?.name} · ${run.trick?.title || 'תרגיל לא נאמר'}`),
    h('div', { class: 'muted' },
      `${run.model} · effort ${run.effort} · ${run.result?.seconds?.toFixed(0) ?? '?'}s · ~$${run.result?.cost_usd_est ?? 0}`
      + ` · in ${u.input_tokens ?? 0} (+cache ${u.cache_read_input_tokens ?? 0}/${u.cache_creation_input_tokens ?? 0}) · out ${u.output_tokens ?? 0}`
      + ` · ${run.frames.length} פריימים · כרטיסים ${run.cards_hash}`),
    h('div', {}, h('b', {}, 'זוהה: '), `${a.trick_identified} (ביטחון ${a.trick_confidence}) · verdict: ${a.verdict}`),
    run.parent ? h('div', {}, 'הרצה חוזרת של ', h('a', { href: `#/run/${encodeURIComponent(run.parent)}` }, run.parent)) : null,
    hasVideo ? null : h('div', { class: 'error' }, `הסרטון ${run.video?.name} לא נמצא ב־lab/videos במחשב הזה, אז מוצגים הפריימים שנשמרו. כדי לראות את הסרטון: שימו אותו ב־lab/videos באותו שם.`));

  $app.replaceChildren(head, h('div', { class: 'grid2' },
    h('div', {},
      stage.el,
      h('div', { class: 'controls' },
        h('button', { class: 'primary', onclick: playScript }, '▶ הפעל משוב AI'),
        h('button', { onclick: () => { stopScript(); if (stage.mode === 'video') stage.video.controls = true; } }, '⏹ עצור'),
        h('button', { onclick: () => skipHold && skipHold() }, 'המשך ⏭'),
        h('label', {}, holdBox, 'לעצור עד לחיצה'),
        addMissed),
      h('details', {}, h('summary', {}, 'הניתוח הכתוב'), h('div', { class: 'written' }, renderText(a)))),
    h('div', {},
      h('div', { class: 'card' }, h('h3', {}, 'ציון כללי'), h('div', { class: 'row' }, 'איכות:', scoreBtns), h('div', { class: 'row' }, 'לשלוח למתאמן?', sendBtns),
        h('textarea', { placeholder: 'הערות כלליות', oninput: (e) => { review.overall.notes = e.target.value; save(); } }, review.overall.notes || ''), saveMsg),
      h('div', { class: 'card' }, h('h3', {}, `התסריט (${a.steps.length} צעדים)`), stepList),
      h('div', { class: 'card' }, h('h3', {}, 'תיקונים'), fixList),
      h('div', { class: 'card' }, h('h3', {}, 'מה ה־AI פספס'), missedList),
      h('div', { class: 'card' }, h('h3', {}, 'ביקורות אחרות'),
        Object.values(reviews).filter((r) => r.reviewer !== me()).map((r) => h('div', {}, `${r.reviewer}: ${r.overall?.score ?? '?'}/5 · ${r.overall?.notes || ''}`)),
        Object.keys(reviews).filter((n) => n !== me()).length ? null : h('div', { class: 'muted' }, 'אין')),
    )));
  if (stage.mode === 'video') stage.video.controls = true;
  else if (a.steps.length) selectStep(0);
}

// ---------- router ----------
async function route() {
  const [, page, arg] = location.hash.split('/');
  try {
    if (page === 'new' && arg) await prepare(decodeURIComponent(arg));
    else if (page === 'run' && arg) await runView(decodeURIComponent(arg));
    else await home();
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'error' }, 'שגיאה: ' + e.message));
  }
}
window.addEventListener('hashchange', route);
route();
