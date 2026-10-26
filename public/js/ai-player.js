// AI coach feedback on the video itself: frames for the AI (with a 0–100 grid), and a player that
// runs the AI's script over the video: slow motion, pauses, zoom and drawings.
// Without the video, the player shows the saved frames instead (same drawings).
import { h } from './ui.js';
import { frameLabel } from './ai-text.js';

export const FULL = { x: 0, y: 0, w: 1, h: 1 };
export const MARGIN = { top: 24, left: 24, bottom: 24 };   // grid labels around each frame sent to the AI
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtT = (t) => Number(t).toFixed(2) + 's';

export function seekTo(v, t) {
  return new Promise((r) => {
    if (Math.abs(v.currentTime - t) < 0.0005 && v.readyState >= 2) return r();
    v.addEventListener('seeked', () => r(), { once: true });
    v.currentTime = t;
  });
}

// ---------- frames for the AI ----------
// With a takeoff: 8 overview frames + the action at 5 fps from 1.5 s before to 3.5 s after.
// Without: 24 frames across the clip (plus 8 overview frames if a zoom box is set).
export function planFrames(d, takeoff, crop) {
  const out = [];
  const zoomKind = crop ? 'zoom' : 'overview';
  if (takeoff != null) {
    for (let i = 0; i < 8; i++) out.push({ t: d * (i + 0.5) / 8, kind: 'overview' });
    const a = Math.max(0, takeoff - 1.5), b = Math.min(d - 0.05, takeoff + 3.5);
    for (let t = a; t <= b + 1e-6; t += 0.2) out.push({ t, kind: zoomKind });
  } else {
    if (crop) for (let i = 0; i < 8; i++) out.push({ t: d * (i + 0.5) / 8, kind: 'overview' });
    for (let i = 0; i < 24; i++) out.push({ t: d * (i + 0.5) / 24, kind: zoomKind });
  }
  out.sort((x, y) => x.t - y.t || (x.kind === 'overview' ? -1 : 1));
  return out.slice(0, 60).map((f, i) => ({ ...f, t: +f.t.toFixed(3), n: i + 1, crop: f.kind === 'zoom' ? crop : FULL }));
}

const toBlob = (cv) => new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8));

// Draws each planned frame (cropped for zoom frames) with the grid and a "F07 · 3.40s" label.
export async function extractFrames(src, plan, onStep = () => {}) {
  const v = h('video', { muted: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous' });
  v.src = src;
  await new Promise((r, j) => { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', () => j(new Error('VIDEO_LOAD_FAILED')), { once: true }); });
  const VW = v.videoWidth, VH = v.videoHeight, out = [];
  for (const f of plan) {
    await seekTo(v, f.t);
    const c = f.crop, sw = c.w * VW, sh = c.h * VH;
    const s = Math.min((f.kind === 'zoom' ? 800 : 640) / Math.max(sw, sh), 2.5);
    const W = Math.round(sw * s), H = Math.round(sh * s);
    const cv = h('canvas'); cv.width = W + MARGIN.left; cv.height = H + MARGIN.top + MARGIN.bottom;
    const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    x.drawImage(v, c.x * VW, c.y * VH, sw, sh, MARGIN.left, MARGIN.top, W, H);
    x.font = '11px system-ui, sans-serif'; x.fillStyle = '#000'; x.textBaseline = 'middle';
    for (let k = 0; k <= 10; k++) {
      const gx = MARGIN.left + W * k / 10, gy = MARGIN.top + H * k / 10;
      x.lineWidth = 1;
      x.strokeStyle = 'rgba(0,0,0,.35)';
      x.beginPath(); x.moveTo(gx + 0.5, MARGIN.top); x.lineTo(gx + 0.5, MARGIN.top + H); x.moveTo(MARGIN.left, gy + 0.5); x.lineTo(MARGIN.left + W, gy + 0.5); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.45)';
      x.beginPath(); x.moveTo(gx - 0.5, MARGIN.top); x.lineTo(gx - 0.5, MARGIN.top + H); x.moveTo(MARGIN.left, gy - 0.5); x.lineTo(MARGIN.left + W, gy - 0.5); x.stroke();
      x.textAlign = k === 0 ? 'left' : k === 10 ? 'right' : 'center'; x.fillText(String(k * 10), gx, MARGIN.top / 2);
      x.textAlign = 'right'; x.fillText(String(k * 10), MARGIN.left - 3, clamp(gy, MARGIN.top + 6, MARGIN.top + H - 6));
    }
    x.font = '600 13px system-ui, sans-serif'; x.textAlign = 'left';
    x.fillText(`${frameLabel(f.n)} · ${fmtT(f.t)} · ${f.kind === 'zoom' ? 'zoom' : 'overview'}`, MARGIN.left, MARGIN.top + H + MARGIN.bottom / 2);
    out.push({ ...f, margin: MARGIN, size: { w: W, h: H }, blob: await toBlob(cv) });
    onStep(out.length, plan.length);
  }
  return { frames: out, video: { width: VW, height: VH, duration: v.duration } };
}

// ---------- drawing ----------
// Shapes are in grid units (0–100) of a crop (normalized video coords). toPx maps them to canvas
// pixels; s is the zoom scale, so lines keep the same width on screen.
export function drawShapes(ctx, shapes, toPx, s = 1, handles = false) {
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

// ---------- the stage: a video (or the saved frames) with a drawing layer that zooms with it ----------
// frameSrc(frame) → URL of a saved frame image (for frames mode).
export class Stage {
  constructor({ frames = [], videoSrc = null, frameSrc = null }) {
    this.frames = frames; this.frameSrc = frameSrc;
    this.el = h('div', { class: 'ai-stage' });
    this.zoomEl = h('div', { class: 'ai-zoom' });
    this.canvas = h('canvas');
    this.caption = h('div', { class: 'ai-caption', dir: 'auto' });
    this.badge = h('div', { class: 'ai-badge' });
    this.scale = 1; this.overlay = null; this.frameImgs = {};
    this.video = h('video', { playsInline: true, muted: true, preload: 'auto', crossOrigin: 'anonymous' });
    this.zoomEl.append(this.video, this.canvas);
    this.el.append(this.zoomEl, this.caption, this.badge);
    this.ctx = this.canvas.getContext('2d');
    this.mode = videoSrc ? 'video' : 'frames';
    this.ready = videoSrc ? this.setVideo(videoSrc) : (this.toFramesMode(), Promise.resolve(false));
    this.ro = new ResizeObserver(() => this.redraw()); this.ro.observe(this.el);
  }
  setVideo(src) {
    this.mode = 'video';
    if (!this.video.isConnected) this.zoomEl.prepend(this.video);
    return new Promise((resolve) => {
      this.video.addEventListener('loadedmetadata', () => { this.setAspect(this.video.videoWidth / this.video.videoHeight); resolve(true); }, { once: true });
      this.video.addEventListener('error', () => { this.toFramesMode(); resolve(false); }, { once: true });
      this.video.src = src;
    });
  }
  toFramesMode() { this.mode = 'frames'; this.video.remove(); if (this.frames.length) this.setAspect(9 / 16); }
  setAspect(ar) { this.el.style.aspectRatio = String(ar); this.el.style.maxWidth = `calc(64vh * ${ar})`; }
  size() { return { W: this.el.clientWidth, H: this.el.clientHeight }; }
  frame(n) { return this.frames[n - 1]; }
  destroy() { this.ro.disconnect(); this.video.pause(); this.video.removeAttribute('src'); }

  frameImage(f) {
    if (!this.frameImgs[f.file]) {
      this.frameImgs[f.file] = Promise.resolve(this.frameSrc(f)).then((src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }));
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

  // overlay: { t, frameN, crop, shapes, title, text, badge, editable }
  async show(o) {
    this.overlay = o;
    if (this.mode === 'video') {
      this.video.pause(); this.video.controls = false;
      await seekTo(this.video, o.t);
      this.zoom(o.crop);
    } else {
      const f = this.frame(o.frameN || 1);
      const im = f && await this.frameImage(f);
      if (im) {
        const m = f.margin || MARGIN;
        this.frameRect = { sx: m.left, sy: m.top, sw: im.naturalWidth - m.left, sh: im.naturalHeight - m.top - m.bottom, im };
        this.setAspect(this.frameRect.sw / this.frameRect.sh);
      }
    }
    this.setCaption(o.title, o.text);
    this.badge.textContent = o.badge || ''; this.badge.classList.toggle('show', !!o.badge);
    this.redraw();
  }
  clear() { this.overlay = null; this.zoom(null); this.setCaption(); this.badge.classList.remove('show'); this.redraw(); }
  setCaption(title, text) {
    this.caption.replaceChildren(...(title ? [h('b', null, title)] : []), text || '');
    this.caption.classList.toggle('show', !!(title || text));
  }
  toPx(p, crop) {
    const { W, H } = this.size();
    if (this.mode === 'frames') return { x: p.x / 100 * W, y: p.y / 100 * H };
    const c = crop || FULL;
    return { x: (c.x + p.x / 100 * c.w) * W, y: (c.y + p.y / 100 * c.h) * H };
  }
  fromClient(ev, crop) {
    const r = this.canvas.getBoundingClientRect();
    const nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
    if (this.mode === 'frames') return { x: clamp(nx * 100, 0, 100), y: clamp(ny * 100, 0, 100) };
    const c = crop || FULL;
    return { x: clamp((nx - c.x) / c.w * 100, 0, 100), y: clamp((ny - c.y) / c.h * 100, 0, 100) };
  }
  redraw() {
    const { W, H } = this.size(); if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (this.mode === 'frames' && this.frameRect) { const r = this.frameRect; ctx.drawImage(r.im, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H); }
    if (this.extraDraw) this.extraDraw(ctx, W, H);
    const o = this.overlay; if (!o) return;
    drawShapes(ctx, o.shapes || [], (p) => this.toPx(p, o.crop), this.mode === 'video' ? this.scale : 1, !!o.editable);
  }
}

// ---------- the script player ----------
// overlayFor(i) → the overlay of step i. mark(i) highlights step i in the list (-1 = none).
export function scriptPlayer({ stage, steps, frames, overlayFor, mark, holdUntilClick }) {
  let playing = null, skipHold = null;
  const frameOf = (n) => frames[n - 1];
  const holdMs = (s) => clamp(2500 + (s.title.length + s.text.length) * 55, 3500, 11000);
  const waitHold = (ms) => new Promise((r) => {
    let done = false; const fin = () => { if (!done) { done = true; skipHold = null; r(); } };
    skipHold = fin; if (!holdUntilClick()) setTimeout(fin, ms);
  });
  function stop() {
    if (playing) { playing.cancel = true; playing = null; }
    if (stage.mode === 'video') { stage.video.pause(); stage.video.playbackRate = 1; }
    if (skipHold) skipHold();
    stage.clear(); mark(-1);
  }
  async function play() {
    stop();
    const me = playing = { cancel: false };
    if (stage.mode === 'frames') {           // flipbook of the saved frames
      for (const [i, s] of steps.entries()) {
        if (me.cancel) return;
        mark(i);
        if (s.kind === 'pause') { await stage.show(overlayFor(i)); await waitHold(holdMs(s)); }
        else {
          for (let n = s.from_frame; n <= s.to_frame && !me.cancel; n++) {
            const next = frameOf(Math.min(n + 1, s.to_frame));
            await stage.show({ t: frameOf(n).t, frameN: n, shapes: [], title: s.title, text: s.text, badge: `×${s.rate}` });
            await sleep(clamp((next.t - frameOf(n).t) / s.rate * 1000, 150, 1500));
          }
        }
      }
      if (!me.cancel) { stage.clear(); mark(-1); playing = null; }
      return;
    }
    const v = stage.video;
    const events = [];
    steps.forEach((s, i) => {
      if (s.kind === 'pause') events.push({ t: frameOf(s.from_frame).t, type: 'pause', i });
      else { events.push({ t: frameOf(s.from_frame).t, type: 'slow', i }); events.push({ t: frameOf(s.to_frame).t, type: 'normal', i }); }
    });
    events.sort((x, y) => x.t - y.t);
    v.controls = false; v.playbackRate = 1;
    await seekTo(v, 0);
    let k = 0, slow = null;
    await v.play().catch(() => {});
    while (!me.cancel) {
      await new Promise((r) => requestAnimationFrame(r));
      if (me.cancel) return;
      while (k < events.length && v.currentTime >= events[k].t - 0.02) {
        const ev = events[k++], s = steps[ev.i];
        mark(ev.i);
        if (ev.type === 'slow') { slow = s; v.playbackRate = s.rate; stage.setCaption(s.title, s.text); stage.badge.textContent = `×${s.rate}`; stage.badge.classList.add('show'); }
        else if (ev.type === 'normal') { slow = null; v.playbackRate = 1; stage.setCaption(); stage.badge.classList.remove('show'); }
        else {
          await stage.show(overlayFor(ev.i));
          await waitHold(holdMs(s));
          if (me.cancel) return;
          stage.overlay = null; stage.zoom(null); stage.redraw();
          if (slow) { stage.setCaption(slow.title, slow.text); stage.badge.textContent = `×${slow.rate}`; } else { stage.setCaption(); stage.badge.classList.remove('show'); }
          await sleep(450);
          v.playbackRate = slow ? slow.rate : 1;
          await v.play().catch(() => {});
        }
      }
      if (v.ended) { stage.clear(); mark(-1); playing = null; v.controls = true; return; }
    }
  }
  return { play, stop, next: () => skipHold && skipHold() };
}
