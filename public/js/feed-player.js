// Full-screen player for the feed. A tap plays or pauses. Swiping down goes to the next video and up to the
// previous one. Swiping right brings in the video's analysis; swiping left goes back to the video.
// Keyboard: space plays or pauses, the arrows do the same as the swipes, Escape goes back.
// One <video> is reused for all the videos, so iPhones keep the sound on from one video to the next.
import { h, clear, icon, friendlyError, errorState, loading } from './ui.js';
import { sb, q, mediaUrl, coverUrl } from './api.js';
import { analysisItem, holdFeed, REMOVED_TEXT } from './components.js';
import { fillsScreen } from './viewer.js';

const NEXT_DIRECTION = 1;       // 1: a finger moving down goes to the next video. -1: a finger moving up does.
const AXIS_PX = 12;             // how far a finger moves before the swipe's direction is decided
const TAP_PX = 10;
const TAP_MS = 400;
const SWIPE_PX = 70;
const FLICK_SPEED = 0.5;        // px per ms: a quick flick counts even when it is short
const SLIDE_MS = 180;
const WHEEL_GAP_MS = 500;
const HINT_MS = 4000;
const HINT_KEY = 'coachit.feedPlayerHint';
const ITEM_ORDER = { text: 0, video: 1, audio: 2, drawing: 3 };

const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const slides = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

export function openFeedPlayer({ rows, index, startAt = 0, more, onClose }) {
  let i = index, seq = 0, muted = false, panelOpen = false, resumeAfterPanel = false, moving = false, closed = false, wheelAt = 0;
  const analyses = new Map();   // request id → its loaded items

  const video = h('video', { class: 'viewer-video fp-video', playsInline: true, loop: true, preload: 'auto' });
  video.setAttribute('playsinline', '');
  const tap = h('div', { class: 'viewer-tap', 'aria-hidden': 'true' });
  const state = h('div', { class: 'fp-state', 'aria-hidden': 'true', hidden: true }, icon('play'));
  const message = h('div', { class: 'fp-message', role: 'status', hidden: true });
  const title = h('span', { class: 'title' });
  const owner = h('span', { class: 'fp-owner' });
  const soundBtn = h('button', { type: 'button', class: 'viewer-round', onclick: () => setMuted(!muted) });
  const analysisBtn = h('button', { type: 'button', class: 'viewer-top-btn', onclick: () => openPanel() }, 'Analysis');
  const fill = h('div', { class: 'viewer-fill' });
  const track = h('div', { class: 'viewer-track', role: 'slider', 'aria-label': 'Video position', tabindex: '0' }, fill);
  const time = h('span', { class: 'viewer-time' }, '0:00 / 0:00');
  const hint = h('div', { class: 'fp-hint', hidden: true }, 'Swipe right for the analysis. Swipe down for the next video.');
  const panelBody = h('div');
  const panel = h('div', { class: 'fp-panel', role: 'region', 'aria-label': 'Analysis', hidden: true },
    h('button', { type: 'button', class: 'btn ghost small', onclick: () => closePanel() }, icon('back'), 'Back to video'),
    panelBody);
  const el = h('div', { class: 'viewer fp', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Video player' },
    video, tap, state, message,
    h('div', { class: 'viewer-top' },
      h('button', { type: 'button', class: 'viewer-round', 'aria-label': 'Back', title: 'Back', onclick: () => close() }, icon('back')),
      h('div', { class: 'fp-heading' }, title, owner),
      soundBtn, analysisBtn),
    h('div', { class: 'viewer-bottom' }, hint,
      h('div', { class: 'viewer-scrub' }, h('div', { class: 'viewer-track-wrap' }, track), time)),
    panel);

  // ---------- The current video ----------
  // No black bars when the clip's shape is close to the screen's (see fillsScreen).
  function fit() { video.classList.toggle('fp-fill', fillsScreen(video.videoWidth, video.videoHeight, el.clientWidth, el.clientHeight)); }
  video.addEventListener('loadedmetadata', fit);

  async function load(from = 0) {
    const r = rows[i], mine = ++seq;
    if (panelOpen) renderPanel();
    title.textContent = r.title;
    owner.textContent = r.owner_name;
    message.hidden = true;
    state.hidden = true;
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.classList.remove('fp-fill');
    video.load();
    showProgress();
    if (r.cover_key) coverUrl(r.cover_key).then((u) => { if (u && mine === seq) video.poster = u; });
    try {
      const url = await mediaUrl('video', r.video_id);
      if (mine !== seq) return;
      video.src = url;
      if (from) video.addEventListener('loadedmetadata', () => { video.currentTime = from; }, { once: true });
      if (!panelOpen) play();
    } catch (e) {
      if (mine !== seq) return;
      showMessage(e.message === 'FILE_REMOVED' ? REMOVED_TEXT : friendlyError(e));
    }
  }
  function showMessage(text) { message.textContent = text; message.hidden = false; state.hidden = true; }
  // Browsers may refuse sound until a tap on this page; then it plays muted and the sound button stays available.
  function play() {
    video.muted = muted;
    video.play().catch(() => {
      if (muted || !video.src) return;
      setMuted(true);
      video.play().catch(() => {});
    });
  }
  function togglePlay() { if (video.paused) play(); else video.pause(); }
  function setMuted(on) {
    muted = on;
    video.muted = on;
    const label = on ? 'Turn sound on' : 'Turn sound off';
    soundBtn.setAttribute('aria-label', label);
    soundBtn.title = label;
    clear(soundBtn).append(icon(on ? 'muted' : 'sound'));
  }
  video.addEventListener('play', () => { state.hidden = true; });
  video.addEventListener('pause', () => { state.hidden = panelOpen || !video.src || !message.hidden; });
  video.addEventListener('error', () => { if (video.src) showMessage('This video cannot play in this browser (the format may not be supported).'); });
  video.addEventListener('timeupdate', showProgress);
  video.addEventListener('durationchange', showProgress);
  video.addEventListener('loadedmetadata', () => {
    // Clips cut in the browser (WebM) may report no length until the end is reached; ask for it once.
    if (Number.isFinite(video.duration)) return;
    const back = video.currentTime;
    video.addEventListener('durationchange', () => { video.currentTime = back; }, { once: true });
    video.currentTime = 1e7;
  });

  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
  function showProgress() {
    const d = duration();
    fill.style.width = d ? `${(video.currentTime / d) * 100}%` : '0%';
    time.textContent = `${clock(video.currentTime || 0)} / ${clock(d)}`;
    track.setAttribute('aria-valuetext', time.textContent);
  }
  const seekFromX = (e) => {
    const r = track.getBoundingClientRect();
    if (duration()) video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration();
  };
  track.addEventListener('pointerdown', (e) => { capture(track, e); seekFromX(e); });
  track.addEventListener('pointermove', (e) => { if (e.buttons) seekFromX(e); });

  // ---------- Next and previous ----------
  async function move(step) {
    if (moving || closed) return;
    moving = true;
    try {
      if (step > 0 && i + 1 >= rows.length) await more();
      const target = i + step;
      const away = step * NEXT_DIRECTION > 0 ? '100%' : '-100%';   // the old video leaves the way the finger went
      if (closed) return;
      if (target < 0 || target >= rows.length) return await settle();
      if (slides()) {
        await slideTo(`translateY(${away})`);
        i = target;
        load();
        video.style.transition = 'none';
        video.style.transform = `translateY(${step * NEXT_DIRECTION > 0 ? '-100%' : '100%'})`;
        video.getBoundingClientRect();
        video.style.transition = '';
        await slideTo('');
      } else {
        i = target;
        load();
      }
    } finally { moving = false; }
  }
  function slideTo(transform) {
    return new Promise((done) => {
      video.classList.add('fp-sliding');
      video.style.transform = transform;
      setTimeout(() => { video.classList.remove('fp-sliding'); done(); }, SLIDE_MS);
    });
  }
  function settle() { return slideTo(''); }

  // ---------- Analysis ----------
  function openPanel(fromDrag) {
    if (closed) return;
    hint.hidden = true;
    if (!panelOpen) {
      panelOpen = true;
      resumeAfterPanel = !video.paused;
      video.pause();
      renderPanel();
    }
    panel.hidden = false;
    if (!fromDrag) panel.getBoundingClientRect();
    panel.classList.add('fp-sliding');
    panel.style.transform = 'translateX(0)';
    panel.scrollTop = fromDrag ? panel.scrollTop : 0;
    setTimeout(() => panel.classList.remove('fp-sliding'), SLIDE_MS);
  }
  function closePanel() {
    panel.classList.add('fp-sliding');
    panel.style.transform = '';
    panelOpen = false;
    panel.querySelectorAll('video, audio').forEach((m) => m.pause());
    setTimeout(() => { panel.classList.remove('fp-sliding'); if (!panelOpen) panel.hidden = true; }, SLIDE_MS);
    if (resumeAfterPanel) play();
    else state.hidden = !video.src || !message.hidden;
  }
  async function renderPanel() {
    const r = rows[i], forIndex = i;
    clear(panelBody);
    if (!r.request_id) return panelBody.append(h('h2', null, r.title), h('p', { class: 'muted' }, 'No analysis'));
    panelBody.append(h('h2', null, 'Analysis from ' + r.coach_name), h('p', { class: 'meta' }, r.title));
    const list = h('div', { class: 'stack' }, loading());
    panelBody.append(list);
    try {
      if (!analyses.has(r.request_id)) {
        const items = await q(sb.from('analysis_items').select('*').eq('request_id', r.request_id).order('created_at'));
        analyses.set(r.request_id, items.sort((a, b) => ITEM_ORDER[a.kind] - ITEM_ORDER[b.kind]));
      }
      if (forIndex !== i) return;
      clear(list).append(...analyses.get(r.request_id).map((it) => analysisItem(it, r.video_id)));
    } catch (e) {
      if (forIndex === i) clear(list).append(errorState(friendlyError(e), () => renderPanel()));
    }
  }

  // ---------- Swipes on the video ----------
  let drag = null;
  const startDrag = (e) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now(), axis: null });
  const quick = (dist, d) => Math.abs(dist) >= SWIPE_PX || Math.abs(dist) / Math.max(1, Date.now() - d.at) > FLICK_SPEED && Math.abs(dist) > AXIS_PX * 2;
  tap.addEventListener('pointerdown', (e) => {
    if (moving) return;
    capture(tap, e);
    drag = startDrag(e);
  });
  tap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.axis && Math.hypot(dx, dy) >= AXIS_PX) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x' && dx > 0) { panel.hidden = false; }
    }
    if (drag.axis === 'y') video.style.transform = `translateY(${dy}px)`;
    if (drag.axis === 'x' && dx > 0) panel.style.transform = `translateX(calc(-100% + ${dx}px))`;
  });
  tap.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag, dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag = null;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < TAP_PX && Date.now() - d.at < TAP_MS) togglePlay();
      return;
    }
    if (d.axis === 'y') {
      if (quick(dy, d)) move((dy > 0 ? 1 : -1) * NEXT_DIRECTION);
      else settle();
      return;
    }
    if (dx > 0 && quick(dx, d)) return openPanel(true);
    if (dx > 0) { panel.classList.add('fp-sliding'); panel.style.transform = ''; setTimeout(() => { panel.classList.remove('fp-sliding'); if (!panelOpen) panel.hidden = true; }, SLIDE_MS); }
  });
  tap.addEventListener('pointercancel', () => {
    drag = null;
    settle();
    if (!panelOpen) { panel.style.transform = ''; panel.hidden = true; }
  });

  // ---------- Swipes on the analysis: the panel scrolls up and down, and left takes it away ----------
  let pdrag = null;
  panel.addEventListener('pointerdown', (e) => {
    // Players and buttons keep their own dragging.
    if (e.target.closest('audio, video, button, a, input, textarea')) return;
    pdrag = startDrag(e);
  });
  panel.addEventListener('pointermove', (e) => {
    if (!pdrag || e.pointerId !== pdrag.id) return;
    const dx = e.clientX - pdrag.x, dy = e.clientY - pdrag.y;
    if (!pdrag.axis && Math.hypot(dx, dy) >= AXIS_PX) {
      pdrag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (pdrag.axis === 'x') capture(panel, e);
    }
    if (pdrag.axis === 'x') panel.style.transform = `translateX(${Math.min(0, dx)}px)`;
  });
  panel.addEventListener('pointerup', (e) => {
    if (!pdrag || e.pointerId !== pdrag.id) return;
    const d = pdrag, dx = e.clientX - d.x;
    pdrag = null;
    if (d.axis !== 'x') return;
    if (dx < 0 && quick(dx, d)) closePanel();
    else openPanel(true);
  });
  panel.addEventListener('pointercancel', () => { if (pdrag?.axis === 'x') openPanel(true); pdrag = null; });

  // ---------- Keyboard and mouse wheel ----------
  const onKey = (e) => {
    // The drawings viewer or a dialog on top keeps its own keys.
    if (document.querySelector('.viewer:not(.fp), .modal-back') || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') { e.preventDefault(); return panelOpen ? closePanel() : close(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); return openPanel(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); return panelOpen && closePanel(); }
    if (panelOpen) return;
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  };
  const onWheel = (e) => {
    if (panelOpen || Date.now() - wheelAt < WHEEL_GAP_MS || Math.abs(e.deltaY) < 10) return;
    wheelAt = Date.now();
    move(e.deltaY > 0 ? 1 : -1);
  };
  el.addEventListener('wheel', onWheel, { passive: true });
  // At the top of the page, iPhones treat a finger moving down as a pull on the page and cancel our swipe.
  // The analysis keeps its own scrolling.
  el.addEventListener('touchmove', (e) => { if (!e.target.closest('.fp-panel')) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', onKey);

  // ---------- Open and close. The phone's back button closes the player instead of leaving the feed. ----------
  const onPop = () => close(true);
  function close(fromHistory) {
    if (closed) return;
    destroy();
    if (fromHistory) return onClose?.(i);
    // Going back restores the old scroll position, so the feed moves to this video only after that.
    window.addEventListener('popstate', () => onClose?.(i), { once: true });
    history.back();
  }
  function destroy() {
    if (closed) return;
    closed = true;
    seq++;
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', fit);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    document.documentElement.classList.remove('fp-open');
    video.pause();
    video.removeAttribute('src');
    video.load();
    panel.querySelectorAll('video, audio').forEach((m) => m.pause());
    el.remove();
    holdFeed(false);
  }

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.classList.add('fp-open');
  holdFeed(true);
  history.pushState({ feedPlayer: true }, '');
  window.addEventListener('popstate', onPop);
  window.addEventListener('resize', fit);
  setMuted(false);
  document.body.append(el);
  soundBtn.focus({ preventScroll: true });
  try {
    if (!localStorage.getItem(HINT_KEY)) {
      localStorage.setItem(HINT_KEY, '1');
      hint.hidden = false;
      setTimeout(() => { hint.hidden = true; }, HINT_MS);
    }
  } catch {}
  load(startAt);
  return { destroy };
}
