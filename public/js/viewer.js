// Full-screen viewer for a coach watching a trainee's video.
// The video fills the screen. One tap plays or pauses; two quick taps on one side jump 3 s.
// Hold to play at 0.25×; release to go back to 1×. Round buttons on the left: play/pause, 0.5× speed,
// pencil (hold for colours; tap to draw on the paused frame). The bar under the video shows where we are;
// a dot marks each frame with drawings, and tapping it opens a line to explain that frame.
// Buttons at the bottom open the response panel (write, voice, video) when the coach can respond here.
// Drawings are stored normalized to the video picture, so they line up on any screen.
import { h, clear, icon, toast } from './ui.js';
import { mediaUrl, coverUrl, q, sb, state } from './api.js';
import { coverImg } from './images.js';
import { go } from './app.js';

const SKIP_SEC = 3;
const SLOW_RATE = 0.25;
const HALF_RATE = 0.5;
const HOLD_MS = 350;
const COLOR_HOLD_MS = 500;
const DOUBLE_TAP_MS = 300;
const FRAME_TOLERANCE = 0.12;   // seconds: a drawing belongs to the frame it was drawn on
export const COLORS = ['#ffd60a', '#ff3b30', '#ffffff', '#34c759', '#0a84ff', '#ff9f0a'];
const DEFAULT_COLOR = COLORS[0];
const NOTE_MAX = 300;

// Pointer capture throws for synthetic or already-ended pointers; the viewer still works without it.
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };
const roundButton = (label, content, onclick) =>
  h('button', { type: 'button', class: 'viewer-round', 'aria-label': label, title: label, onclick }, content);
const round = (n, step = 10000) => Math.round(n * step) / step;
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Saved drawings: { strokes, notes }. Older saves were a plain list of strokes.
export function readDrawings(raw) {
  let d = raw;
  if (typeof raw === 'string') { try { d = JSON.parse(raw); } catch { d = null; } }
  if (Array.isArray(d)) return { strokes: d, notes: [] };
  return { strokes: Array.isArray(d?.strokes) ? d.strokes : [], notes: Array.isArray(d?.notes) ? d.notes : [] };
}
export const isEmptyDrawings = (d) => !d.strokes.length && !d.notes.length;

// Where the video picture sits inside its box (object-fit: contain).
export function contentBox(cw, ch, vw, vh) {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
  const s = Math.min(cw / vw, ch / vh), w = vw * s, hh = vh * s;
  return { x: (cw - w) / 2, y: (ch - hh) / 2, w, h: hh };
}

// Draw the strokes that belong to the frame at `time`. Strokes are normalized to the video picture.
export function paintStrokes(ctx, strokes, time, box) {
  ctx.lineWidth = Math.max(3, box.w / 180); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (Math.abs(s.t - time) > FRAME_TOLERANCE) continue;
    ctx.strokeStyle = s.c || DEFAULT_COLOR;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => {
      const px = box.x + x * box.w, py = box.y + y * box.h;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
}

// Keeps a canvas the same size as its element on screen (retina aware) and clears it.
function fitCanvas(canvas, rect) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), hgt = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return ctx;
}

export function coachViewer({ src, title, onClose, onAction, respond = true, drawings, onDrawingsChange }) {
  const video = h('video', { class: 'viewer-video', src, playsInline: true, preload: 'auto' });
  const ink = h('canvas', { class: 'viewer-ink', 'aria-hidden': 'true' });
  const tap = h('div', { class: 'viewer-tap', 'aria-hidden': 'true' });
  const hint = h('div', { class: 'viewer-hint', 'aria-live': 'polite' });
  const start = readDrawings(drawings || { strokes: [], notes: [] });
  let strokes = start.strokes.slice(), notes = start.notes.slice(), stroke = null;
  let color = DEFAULT_COLOR, paletteOpen = false, longPressed = false, colorTimer = null;
  let base = 1, held = false, holdTimer = null, hintTimer = null, raf = 0;
  let drawing = false, pendingTap = null, downSide = null, noteAt = null;
  const prevOverflow = document.body.style.overflow;

  const playBtn = roundButton('Play or pause', icon('play'), () => togglePlay());
  const speedBtn = roundButton('Half speed', '0.5×', toggleSpeed);
  speedBtn.setAttribute('aria-pressed', 'false');
  const pencilBtn = roundButton('Draw on this frame (hold to choose a colour)', icon('pencil'), () => {
    if (longPressed) { longPressed = false; return; }
    setDrawing(!drawing);
  });
  pencilBtn.setAttribute('aria-pressed', 'false');
  pencilBtn.addEventListener('pointerdown', () => {
    longPressed = false;
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => { longPressed = true; togglePalette(true); }, COLOR_HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) pencilBtn.addEventListener(ev, () => clearTimeout(colorTimer));
  const undoBtn = roundButton('Undo the last drawing on this frame', '↶', undo);
  undoBtn.classList.add('viewer-undo');

  const palette = h('div', { class: 'viewer-palette', hidden: true, role: 'group', 'aria-label': 'Drawing colour' },
    COLORS.map((c) => h('button', {
      type: 'button', class: 'viewer-swatch', 'aria-label': `Colour ${c}`, style: { background: c },
      onclick: () => pickColor(c),
    })));
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

  // Progress bar: where we are in the video, with a dot for every frame that has drawings or a note.
  const track = h('div', { class: 'viewer-track', role: 'slider', 'aria-label': 'Video position', tabindex: '0' },
    h('div', { class: 'viewer-fill' }));
  const marks = h('div', { class: 'viewer-marks' });
  const timeLabel = h('span', { class: 'viewer-time' }, '0:00 / 0:00');
  const scrub = h('div', { class: 'viewer-scrub' },
    h('div', { class: 'viewer-track-wrap' }, track, marks), timeLabel);
  const noteInput = h('input', { type: 'text', class: 'viewer-note-input', maxlength: NOTE_MAX,
    placeholder: 'Why did you mark this frame?', 'aria-label': 'Explanation for this frame' });
  noteInput.addEventListener('input', () => setNote(noteAt, noteInput.value));
  const noteRow = h('div', { class: 'viewer-note', hidden: true }, noteInput);
  const actions = respond ? h('div', { class: 'viewer-actions' },
    [['write', 'Write', 'text'], ['voice', 'Voice', 'mic'], ['video', 'Video', 'camera']].map(([kind, label, ic]) =>
      h('button', { type: 'button', onclick: () => openSheet(kind) }, icon(ic), label))) : null;
  const bottom = h('div', { class: 'viewer-bottom' }, noteRow, scrub, actions);
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-label': 'Video viewer' },
    video, ink, tap, hint, top, rail, palette, bottom, sheet);

  document.body.style.overflow = 'hidden';
  video.addEventListener('play', () => { syncPlay(); hideNote(); });
  video.addEventListener('pause', syncPlay);
  video.addEventListener('timeupdate', () => { paint(); showProgress(); });
  video.addEventListener('seeked', paint);
  video.addEventListener('loadedmetadata', () => { showProgress(); renderMarks(); });
  video.addEventListener('durationchange', () => { showProgress(); renderMarks(); });
  function syncPlay() { clear(playBtn).append(video.paused ? icon('play') : icon('pause')); }
  function togglePlay() { if (video.paused) video.play().catch(() => {}); else video.pause(); }

  // ---------- Progress bar and frame marks ----------
  const fill = track.firstChild;
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
  function showProgress() {
    const d = duration();
    fill.style.width = d ? `${(video.currentTime / d) * 100}%` : '0%';
    timeLabel.textContent = `${clock(video.currentTime)} / ${clock(d)}`;
    track.setAttribute('aria-valuetext', timeLabel.textContent);
  }
  function markTimes() { return [...new Set([...strokes, ...notes].map((s) => round(s.t, 10)))].sort((a, b) => a - b); }
  function renderMarks() {
    const d = duration();
    clear(marks).append(markTimes().map((t) => h('button', {
      type: 'button', class: 'viewer-mark' + (t === noteAt ? ' on' : ''),
      'aria-label': `Frame at ${clock(t)}`, title: `Frame at ${clock(t)}`,
      style: { left: d ? `${(t / d) * 100}%` : '0%' },
      onclick: (e) => { e.stopPropagation(); seekTo(t); video.pause(); openNote(t); },
    })));
  }
  function seekTo(t) { video.currentTime = Math.max(0, Math.min(duration() || t, t)); showProgress(); }
  const seekFromX = (e) => {
    const r = track.getBoundingClientRect();
    if (duration()) seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration());
  };
  track.addEventListener('pointerdown', (e) => { capture(track, e); seekFromX(e); });
  track.addEventListener('pointermove', (e) => { if (e.buttons) seekFromX(e); });

  // ---------- Explanation for a frame ----------
  function openNote(t) {
    noteAt = t;
    noteInput.value = notes.find((n) => round(n.t, 10) === t)?.text || '';
    noteRow.hidden = false;
    renderMarks();
  }
  function hideNote() {
    if (noteAt === null) return;
    noteAt = null;
    noteRow.hidden = true;
    renderMarks();
  }
  function setNote(t, text) {
    if (t === null) return;
    const clean = text.trim();
    notes = notes.filter((n) => round(n.t, 10) !== t);
    if (clean) notes.push({ t, text: clean.slice(0, NOTE_MAX) });
    emit();
    renderMarks();
  }

  // ---------- Tap zones: one tap plays or pauses, two quick taps skip, hold for 0.25× ----------
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

  // ---------- Colour ----------
  function togglePalette(on) {
    paletteOpen = on;
    palette.hidden = !on;
  }
  function pickColor(c) {
    color = c;
    pencilBtn.style.color = c;
    togglePalette(false);
  }

  // ---------- Pencil: a drawing lives on the frame it was drawn on and disappears once playback leaves it ----------
  function setDrawing(on) {
    drawing = on;
    el.classList.toggle('drawing', on);
    pencilBtn.setAttribute('aria-pressed', String(on));
    pencilBtn.style.color = on ? color : '';
    if (on) { video.pause(); togglePalette(false); }
  }
  // Position as a fraction of the video picture (not of the screen), so it matches on every device.
  const pointOf = (e) => {
    const r = ink.getBoundingClientRect();
    const b = contentBox(r.width, r.height, video.videoWidth, video.videoHeight);
    return [round((e.clientX - r.left - b.x) / b.w), round((e.clientY - r.top - b.y) / b.h)];
  };
  ink.addEventListener('pointerdown', (e) => { capture(ink, e); stroke = { t: round(video.currentTime, 100), c: color, pts: [pointOf(e)] }; });
  ink.addEventListener('pointermove', (e) => { if (stroke) stroke.pts.push(pointOf(e)); });
  const endStroke = () => {
    if (stroke && stroke.pts.length > 1) { strokes.push(stroke); emit(); renderMarks(); }
    stroke = null;
    paint();
  };
  ink.addEventListener('pointerup', endStroke);
  ink.addEventListener('pointercancel', endStroke);
  function undo() {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (Math.abs(strokes[i].t - video.currentTime) <= FRAME_TOLERANCE) {
        strokes.splice(i, 1);
        emit();
        renderMarks();
        paint();
        return;
      }
    }
  }
  function emit() { onDrawingsChange?.({ strokes: strokes.slice(), notes: notes.slice() }); }
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
    clearTimeout(colorTimer);
    clearTimeout(pendingTap?.timer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.body.style.overflow = prevOverflow;
    el.remove();
  }

  renderMarks();
  loop();
  return { el, sheetBody, destroy, drawings: () => ({ strokes: strokes.slice(), notes: notes.slice() }) };
}

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

// Read-only drawings of a finished analysis: the video with the coach's drawings at their frames,
// and the coach's explanation for each frame.
export function drawingsReview(item, videoId) {
  const d = readDrawings(item.body);
  if (isEmptyDrawings(d)) return null;
  const times = [...new Set([...d.strokes, ...d.notes].map((s) => round(s.t, 10)))].sort((a, b) => a - b);
  const video = h('video', { controls: true, playsInline: true, preload: 'metadata', class: 'review-video' });
  const canvas = h('canvas', { class: 'review-ink', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'review-stage' }, video, canvas);
  const note = h('p', { class: 'review-note' });
  const showNote = (t) => {
    const n = d.notes.find((x) => round(x.t, 10) === t);
    note.textContent = n ? n.text : '';
    note.hidden = !n;
  };
  const frames = h('div', { class: 'row', style: { marginTop: '.5rem' } }, times.map((t) =>
    h('button', { type: 'button', class: 'btn secondary small', onclick: () => { video.pause(); video.currentTime = t; showNote(t); paint(); } },
      'Frame ' + clock(t))));
  const paint = () => {
    const r = canvas.getBoundingClientRect();
    const ctx = fitCanvas(canvas, r);
    const b = contentBox(r.width, r.height, video.videoWidth, video.videoHeight);
    paintStrokes(ctx, d.strokes, video.currentTime, b);
  };
  video.addEventListener('timeupdate', paint);
  video.addEventListener('seeked', paint);
  video.addEventListener('loadeddata', paint);
  mediaUrl('video', videoId).then((src) => { video.src = src; }).catch(() => {
    stage.replaceWith(h('p', { class: 'muted' }, 'The video is not available, so the drawings cannot be shown.'));
  });
  showNote(times[0]);
  return h('div', { class: 'card' },
    h('div', { class: 'label' }, 'Drawings on the video'),
    stage, frames, note);
}
