// Full-screen viewer for a coach watching a trainee's video.
// The video fills the screen. Two quick taps on the right half jump 3 s forward, on the left half 3 s back.
// Hold to play at 0.25×. Round buttons on the left: play/pause, 0.5× speed, pencil (draw on one frame).
// Buttons at the bottom open the response panel (write, voice, video).
import { h, clear, icon } from './ui.js';

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

export function coachViewer({ src, title, onClose, onAction }) {
  const video = h('video', { class: 'viewer-video', src, playsInline: true, preload: 'auto' });
  const ink = h('canvas', { class: 'viewer-ink', 'aria-hidden': 'true' });
  const tap = h('div', { class: 'viewer-tap', 'aria-hidden': 'true' });
  const hint = h('div', { class: 'viewer-hint', 'aria-live': 'polite' });
  const ctx = ink.getContext('2d');
  const prevOverflow = document.body.style.overflow;
  let base = 1, held = false, holdTimer = null, hintTimer = null, raf = 0;
  let drawing = false, strokes = [], stroke = null;
  let lastTap = { side: null, at: 0 }, downSide = null;

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
  const bottom = h('div', { class: 'viewer-bottom' },
    [['write', 'Write', 'text'], ['voice', 'Voice', 'mic'], ['video', 'Video', 'camera']].map(([kind, label, ic]) =>
      h('button', { type: 'button', onclick: () => openSheet(kind) }, icon(ic), label)));
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-label': 'Video viewer' },
    video, ink, tap, hint, top, rail, bottom, sheet);

  document.body.style.overflow = 'hidden';
  video.addEventListener('play', syncPlay);
  video.addEventListener('pause', syncPlay);
  function syncPlay() { clear(playBtn).append(video.paused ? icon('play') : icon('pause')); }

  // ---------- Tap zones: double tap to skip, hold for 0.25× ----------
  const sideOf = (e) => (e.clientX < window.innerWidth / 2 ? 'left' : 'right');
  tap.addEventListener('pointerdown', (e) => {
    capture(tap, e);
    downSide = sideOf(e);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { held = true; applyRate(); showHint(`${SLOW_RATE}×`, true); }, HOLD_MS);
  });
  tap.addEventListener('pointerup', () => {
    clearTimeout(holdTimer);
    if (held) { endHold(); return; }
    const now = Date.now();
    if (lastTap.side === downSide && now - lastTap.at < DOUBLE_TAP_MS) {
      skip(downSide === 'left' ? -SKIP_SEC : SKIP_SEC);
      lastTap = { side: null, at: 0 };
    } else {
      lastTap = { side: downSide, at: now };
    }
  });
  tap.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (held) endHold(); });
  function endHold() { held = false; applyRate(); showHint('', true); }

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
  const pointOf = (e) => { const r = ink.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  ink.addEventListener('pointerdown', (e) => { capture(ink, e); stroke = { t: video.currentTime, pts: [pointOf(e)] }; });
  ink.addEventListener('pointermove', (e) => { if (stroke) stroke.pts.push(pointOf(e)); });
  const endStroke = () => { if (stroke && stroke.pts.length > 1) strokes.push(stroke); stroke = null; };
  ink.addEventListener('pointerup', endStroke);
  ink.addEventListener('pointercancel', endStroke);
  function undo() {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (Math.abs(strokes[i].t - video.currentTime) <= FRAME_TOLERANCE) { strokes.splice(i, 1); return; }
    }
  }
  function paint() {
    raf = requestAnimationFrame(paint);
    const r = ink.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (ink.width !== Math.round(r.width * dpr) || ink.height !== Math.round(r.height * dpr)) {
      ink.width = Math.round(r.width * dpr);
      ink.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of stroke ? [...strokes, stroke] : strokes) {
      if (s !== stroke && Math.abs(s.t - video.currentTime) > FRAME_TOLERANCE) continue;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * r.width, y * r.height) : ctx.moveTo(x * r.width, y * r.height)));
      ctx.stroke();
    }
  }

  // ---------- Response panel ----------
  function openSheet(kind) { setDrawing(false); video.pause(); sheet.hidden = false; onAction && onAction(kind); }
  function closeSheet() { sheet.hidden = true; }

  function destroy() {
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    clearTimeout(hintTimer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.body.style.overflow = prevOverflow;
    el.remove();
  }

  paint();
  return { el, sheetBody, destroy };
}
