// Full-screen viewer for a coach watching a trainee's video.
// The video fills the screen. Two quick taps on the right half jump 3 s forward, on the left half 3 s back.
// Hold to play at 0.25×. Round buttons on the left: play/pause, 0.5× speed, pencil (draw on one frame).
// Buttons at the bottom open the response panel (write, voice, video) when the coach can respond here.
// Drawings are stored normalized to the video frame, so they line up on any screen.
import { h, clear, icon, toast } from './ui.js';
import { mediaUrl, coverUrl, q, sb, state } from './api.js';
import { coverImg } from './images.js';
import { go } from './app.js';

const SKIP_SEC = 3;
const SLOW_RATE = 0.25;
const HALF_RATE = 0.5;
const HOLD_MS = 350;
const DOUBLE_TAP_MS = 300;
const FRAME_TOLERANCE = 0.12;   // seconds: a drawing belongs to the frame it was drawn on
const INK = '#ffd60a';

// Pointer capture throws for synthetic or already-ended pointers; the viewer still works without it.
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };
const roundButton = (label, content, onclick) =>
  h('button', { type: 'button', class: 'viewer-round', 'aria-label': label, title: label, onclick }, content);

// Where the video picture sits inside its box (object-fit: contain).
export function contentBox(cw, ch, vw, vh) {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
  const s = Math.min(cw / vw, ch / vh), w = vw * s, hh = vh * s;
  return { x: (cw - w) / 2, y: (ch - hh) / 2, w, h: hh };
}

// Draw the strokes that belong to the frame at `time`. Strokes are normalized to the video picture.
export function paintStrokes(ctx, strokes, time, box) {
  ctx.lineWidth = Math.max(3, box.w / 180); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  for (const s of strokes) {
    if (Math.abs(s.t - time) > FRAME_TOLERANCE) continue;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => {
      const px = box.x + x * box.w, py = box.y + y * box.h;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
}

// Keeps a canvas the same size as its element on screen (retina aware).
function fitCanvas(canvas, rect) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), hgt = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return ctx;
}

export function coachViewer({ src, title, onClose, onAction, respond = true, drawings = [], onDrawingsChange }) {
  const video = h('video', { class: 'viewer-video', src, playsInline: true, preload: 'auto' });
  const ink = h('canvas', { class: 'viewer-ink', 'aria-hidden': 'true' });
  const tap = h('div', { class: 'viewer-tap', 'aria-hidden': 'true' });
  const hint = h('div', { class: 'viewer-hint', 'aria-live': 'polite' });
  const prevOverflow = document.body.style.overflow;
  let strokes = drawings.slice(), stroke = null;
  let base = 1, held = false, holdTimer = null, hintTimer = null, raf = 0;
  let drawing = false;
  let pendingTap = null, downSide = null;

  const playBtn = roundButton('Play or pause', icon('play'), () => (video.paused ? video.play() : video.pause()));
  const speedBtn = roundButton('Half speed', '0.5×', toggleSpeed);
  speedBtn.setAttribute('aria-pressed', 'false');
  const pencilBtn = roundButton('Draw on this frame', icon('pencil'), () => setDrawing(!drawing));
  pencilBtn.setAttribute('aria-pressed', 'false');
  const undoBtn = roundButton('Undo the last drawing on this frame', '↶', undo);
  undoBtn.classList.add('viewer-undo');

  const rail = h('div', { class: 'viewer-rail' }, playBtn, speedBtn, pencilBtn, undoBtn);
  const top = h('div', { class: 'viewer-top' },
    roundButton('Back to the request', icon('back'), () => onClose()),
    h('span', { class: 'title' }, title));
  const sheetBody = h('div');
  const sheet = h('div', { class: 'viewer-sheet', hidden: true },
    h('div', { class: 'row between', style: { marginBottom: '.5rem' } },
      h('strong', null, 'Your response'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: closeSheet }, 'Close')),
    sheetBody);
  // Progress bar: where we are in the video, with a dot for every frame that has a drawing.
  const track = h('div', { class: 'viewer-track', role: 'slider', 'aria-label': 'Video position', tabindex: '0' },
    h('div', { class: 'viewer-fill' }));
  const marks = h('div', { class: 'viewer-marks' });
  const timeLabel = h('span', { class: 'viewer-time' }, '0:00 / 0:00');
  const scrub = h('div', { class: 'viewer-scrub' },
    h('div', { class: 'viewer-track-wrap' }, track, marks), timeLabel);
  const actions = respond ? h('div', { class: 'viewer-actions' },
    [['write', 'Write', 'text'], ['voice', 'Voice', 'mic'], ['video', 'Video', 'camera']].map(([kind, label, ic]) =>
      h('button', { type: 'button', onclick: () => openSheet(kind) }, icon(ic), label))) : null;
  const bottom = h('div', { class: 'viewer-bottom' }, scrub, actions);
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-label': 'Video viewer' },
    video, ink, tap, hint, top, rail, bottom, sheet);

  // ---------- Progress bar ----------
  const fill = track.firstChild;
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
  function showProgress() {
    const d = duration();
    fill.style.width = d ? `${(video.currentTime / d) * 100}%` : '0%';
    timeLabel.textContent = `${clock(video.currentTime)} / ${clock(d)}`;
    track.setAttribute('aria-valuetext', timeLabel.textContent);
  }
  function renderMarks() {
    const d = duration();
    const times = [...new Set(strokes.map((s) => round(s.t, 10)))];
    clear(marks).append(times.map((t) => h('button', {
      type: 'button', class: 'viewer-mark', 'aria-label': `Drawing at ${clock(t)}`, title: `Drawing at ${clock(t)}`,
      style: { left: d ? `${(t / d) * 100}%` : '0%' },
      onclick: (e) => { e.stopPropagation(); seekTo(t); video.pause(); },
    })));
  }
  function seekTo(t) { video.currentTime = Math.max(0, Math.min(duration() || t, t)); showProgress(); }
  const seekFromX = (e) => {
    const r = track.getBoundingClientRect();
    if (duration()) seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration());
  };
  track.addEventListener('pointerdown', (e) => { capture(track, e); seekFromX(e); });
  track.addEventListener('pointermove', (e) => { if (e.buttons) seekFromX(e); });
  video.addEventListener('loadedmetadata', () => { showProgress(); renderMarks(); });
  video.addEventListener('durationchange', () => { showProgress(); renderMarks(); });

  document.body.style.overflow = 'hidden';
  video.addEventListener('play', syncPlay);
  video.addEventListener('pause', syncPlay);
  video.addEventListener('timeupdate', () => { paint(); showProgress(); });
  video.addEventListener('seeked', paint);
  function syncPlay() { clear(playBtn).append(video.paused ? icon('play') : icon('pause')); }

  // ---------- Tap zones: double tap to skip, hold for 0.25× ----------
  const sideOf = (e) => (e.clientX < window.innerWidth / 2 ? 'left' : 'right');
  tap.addEventListener('pointerdown', (e) => {
    capture(tap, e);
    downSide = sideOf(e);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { held = true; applyRate(); showHint(`${SLOW_RATE}×`, true); }, HOLD_MS);
  });
  // One tap plays or pauses. Two quick taps on the same side skip 3 s.
  tap.addEventListener('pointerup', () => {
    clearTimeout(holdTimer);
    if (held) { endHold(); return; }
    const now = Date.now();
    if (pendingTap && pendingTap.side === downSide && now - pendingTap.at < DOUBLE_TAP_MS) {
      clearTimeout(pendingTap.timer);
      pendingTap = null;
      skip(downSide === 'left' ? -SKIP_SEC : SKIP_SEC);
      return;
    }
    if (pendingTap) { clearTimeout(pendingTap.timer); togglePlay(); }
    const timer = setTimeout(() => { pendingTap = null; togglePlay(); }, DOUBLE_TAP_MS);
    pendingTap = { side: downSide, at: now, timer };
  });
  tap.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (held) endHold(); });
  // After a long press the video goes back to normal speed (1×), and the 0.5× toggle is off.
  function endHold() {
    held = false;
    base = 1;
    speedBtn.setAttribute('aria-pressed', 'false');
    applyRate();
    showHint('', true);
  }
  function togglePlay() { if (video.paused) video.play().catch(() => {}); else video.pause(); }

  function skip(sec) {
    const max = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(max, video.currentTime + sec));
    showHint(sec > 0 ? `+${sec}s` : `${sec}s`);
  }
  function showHint(text, sticky) {
    clearTimeout(hintTimer);
    hint.textContent = text;
    hint.classList.toggle('show', !!text);
    if (text && !sticky) hintTimer = setTimeout(() => hint.classList.remove('show'), 600);
  }

  // ---------- Speed ----------
  function applyRate() { video.playbackRate = held ? SLOW_RATE : base; }
  function toggleSpeed() {
    base = base === 1 ? HALF_RATE : 1;
    speedBtn.setAttribute('aria-pressed', String(base === HALF_RATE));
    applyRate();
  }

  // ---------- Pencil: a drawing lives on the frame it was drawn on and disappears once playback leaves it ----------
  function setDrawing(on) {
    drawing = on;
    el.classList.toggle('drawing', on);
    pencilBtn.setAttribute('aria-pressed', String(on));
    if (on) video.pause();
  }
  // Position as a fraction of the video picture (not of the screen), so it matches on every device.
  const pointOf = (e) => {
    const r = ink.getBoundingClientRect();
    const b = contentBox(r.width, r.height, video.videoWidth, video.videoHeight);
    return [round((e.clientX - r.left - b.x) / b.w), round((e.clientY - r.top - b.y) / b.h)];
  };
  ink.addEventListener('pointerdown', (e) => { capture(ink, e); stroke = { t: round(video.currentTime, 100), pts: [pointOf(e)] }; });
  ink.addEventListener('pointermove', (e) => { if (stroke) stroke.pts.push(pointOf(e)); });
  const endStroke = () => {
    if (stroke && stroke.pts.length > 1) { strokes.push(stroke); onDrawingsChange?.(strokes.slice()); renderMarks(); }
    stroke = null;
    paint();
  };
  ink.addEventListener('pointerup', endStroke);
  ink.addEventListener('pointercancel', endStroke);
  function undo() {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (Math.abs(strokes[i].t - video.currentTime) <= FRAME_TOLERANCE) {
        strokes.splice(i, 1);
        onDrawingsChange?.(strokes.slice());
        renderMarks();
        paint();
        return;
      }
    }
  }
  function paint() {
    const r = ink.getBoundingClientRect();
    const ctx = fitCanvas(ink, r);
    const b = contentBox(r.width, r.height, video.videoWidth, video.videoHeight);
    paintStrokes(ctx, stroke ? [...strokes, stroke] : strokes, video.currentTime, b);
  }
  function loop() { raf = requestAnimationFrame(loop); paint(); }

  // ---------- Response panel ----------
  function openSheet(kind) { setDrawing(false); video.pause(); sheet.hidden = false; onAction && onAction(kind); }
  function closeSheet() { sheet.hidden = true; }

  function destroy() {
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    clearTimeout(hintTimer);
    clearTimeout(pendingTap?.timer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.body.style.overflow = prevOverflow;
    el.remove();
  }

  renderMarks();
  loop();
  return { el, sheetBody, destroy, drawings: () => strokes.slice() };
}

const round = (n, step = 10000) => Math.round(n * step) / step;
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// The card that opens the viewer. A coach with an open request for this video responds there;
// otherwise the video opens to watch and draw, without the response buttons.
export function coachWatchCard(video, { label = 'Watch full screen' } = {}) {
  return h('button', { type: 'button', class: 'viewer-card', onclick: () => watchAsCoach(video) },
    coverImg(coverUrl(video.cover_key)),
    h('span', { class: 'viewer-card-play' }, icon('play')),
    h('span', { class: 'viewer-card-label' }, label));
}

async function watchAsCoach(video) {
  try {
    const open = await q(sb.from('analysis_requests').select('id')
      .eq('video_id', video.id).eq('coach_id', state.user.id).in('status', ['pending', 'draft']).limit(1));
    if (open.length) return go('/r/' + open[0].id);
    const src = await mediaUrl('video', video.id);
    const viewer = coachViewer({ src, title: video.title, respond: false, onClose: () => viewer.destroy() });
    document.body.append(viewer.el);
  } catch (e) {
    toast('This video cannot be opened right now.', 'err');
  }
}

// Read-only drawings of a finished analysis: the video with the coach's drawings at their frames.
export function drawingsReview(item, videoId) {
  let list = [];
  try { list = JSON.parse(item.body) || []; } catch {}
  if (!list.length) return null;
  const times = [...new Set(list.map((s) => round(s.t, 10)))].sort((a, b) => a - b);
  const video = h('video', { controls: true, playsInline: true, preload: 'metadata', class: 'review-video' });
  const canvas = h('canvas', { class: 'review-ink', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'review-stage' }, video, canvas);
  const frames = h('div', { class: 'row', style: { marginTop: '.5rem' } }, times.map((t) =>
    h('button', { type: 'button', class: 'btn secondary small', onclick: () => { video.pause(); video.currentTime = t; paint(); } },
      'Frame ' + fmt(t))));
  const paint = () => {
    const r = canvas.getBoundingClientRect();
    const ctx = fitCanvas(canvas, r);
    const b = contentBox(r.width, r.height, video.videoWidth, video.videoHeight);
    paintStrokes(ctx, list, video.currentTime, b);
  };
  video.addEventListener('timeupdate', paint);
  video.addEventListener('seeked', paint);
  video.addEventListener('loadeddata', paint);
  mediaUrl('video', videoId).then((src) => { video.src = src; }).catch(() => {
    stage.replaceWith(h('p', { class: 'muted' }, 'The video is not available, so the drawings cannot be shown.'));
  });
  return h('div', { class: 'card' },
    h('div', { class: 'label' }, 'Drawings on the video'),
    stage, frames);
}
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.round((t % 1) * 10)}`;
