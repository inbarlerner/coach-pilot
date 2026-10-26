// Profile photos and video covers: avatar display, image resizing, frame capture, cover picker.
import { h, clear, toast, filePicker } from './ui.js';
import { avatarUrl } from './api.js';

// Round profile photo, or initials when there is none. `p` is any row with first_name, last_name, avatar_key.
export function avatar(p, size = 36) {
  const initials = ((p?.first_name || '').trim()[0] || '') + ((p?.last_name || '').trim()[0] || '');
  const el = h('span', { class: 'avatar', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px' }, 'aria-hidden': 'true' });
  const url = avatarUrl(p?.avatar_key);
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy' });
    img.onerror = () => { img.remove(); el.textContent = initials.toUpperCase(); };
    el.append(img);
  } else el.textContent = initials.toUpperCase() || '?';
  return el;
}

// Photo + name link, used wherever a person is shown.
export function personLink(p, { size = 32, strong = true } = {}) {
  const name = (p?.first_name || '') + ' ' + (p?.last_name || '');
  return h('a', { class: 'person', href: '#/u/' + p?.username }, avatar(p, size), strong ? h('strong', null, name) : h('span', null, name));
}

// ---------- Image helpers ----------
const canvasBlob = (canvas, quality = 0.82) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('BAD_IMAGE')); };
    img.src = url;
  });
}

// Draw an image/video frame into a JPEG. square: centre-crop to a square of `max` px; otherwise fit within `max` px wide.
async function toJpeg(source, w, h0, { max = 1280, square = false } = {}) {
  if (!w || !h0) throw new Error('BAD_IMAGE');
  const c = document.createElement('canvas');
  if (square) {
    const side = Math.min(w, h0), out = Math.min(max, side);
    c.width = c.height = out;
    c.getContext('2d').drawImage(source, (w - side) / 2, (h0 - side) / 2, side, side, 0, 0, out, out);
  } else {
    const scale = Math.min(1, max / Math.max(w, h0));
    c.width = Math.round(w * scale); c.height = Math.round(h0 * scale);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  }
  const blob = await canvasBlob(c);
  if (!blob) throw new Error('BAD_IMAGE');
  return blob;
}

export async function imageFileToJpeg(file, opts) {
  const img = await loadImage(file);
  try { return await toJpeg(img, img.naturalWidth, img.naturalHeight, opts); }
  finally { URL.revokeObjectURL(img.src); }
}

// A hidden <video> for grabbing frames from a local file or a (CORS-enabled) link.
function frameSource(src) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
  v.setAttribute('playsinline', '');
  v.src = src;
  const ready = new Promise((resolve, reject) => {
    v.addEventListener('loadeddata', () => resolve(v), { once: true });
    v.addEventListener('error', () => reject(new Error('VIDEO_UNREADABLE')), { once: true });
    setTimeout(() => reject(new Error('VIDEO_UNREADABLE')), 15000);
  }).then(knownDuration);
  return { v, ready };
}
// Browser recordings (WebM) often report no duration until the end is reached; find it once.
async function knownDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v;
  await new Promise((resolve) => {
    const done = () => { if (Number.isFinite(v.duration)) { v.removeEventListener('durationchange', done); resolve(); } };
    v.addEventListener('durationchange', done);
    v.currentTime = 1e7;
    setTimeout(resolve, 4000);
  });
  if (!Number.isFinite(v.duration)) Object.defineProperty(v, 'duration', { value: 0 });
  await seek(v, 0);
  return v;
}
function seek(v, t) {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || 0) - 0.05));
    setTimeout(done, 4000);
  });
}
export async function grabFrame(v, t) {
  if (t !== undefined) await seek(v, t);
  return toJpeg(v, v.videoWidth, v.videoHeight);
}

/**
 * Cover picker for a video. source: a File (new upload) or a signed link (existing video).
 * The user can pick a moment from the video or upload a photo. If they do neither,
 * getBlob() returns a random frame (or null if the browser cannot read the video).
 */
export function coverPicker(source, { current = null } = {}) {
  const src = source instanceof Blob ? URL.createObjectURL(source) : source;
  const { v, ready } = frameSource(src);
  let chosen = null;          // Blob the user picked
  const preview = h('div', { class: 'cover-preview' }, current ? h('img', { src: current, alt: 'Current cover' }) : h('span', { class: 'muted small' }, 'No cover yet'));
  const showBlob = (b) => {
    const url = URL.createObjectURL(b);
    clear(preview).append(h('img', { src: url, alt: 'Cover preview' }));
  };
  const status = h('p', { class: 'hint' }, 'Pick a moment from the video or upload a photo. If you skip this, a random frame from the video is used.');
  const panel = h('div');

  const pickFrame = h('button', { type: 'button', class: 'btn secondary small' }, 'Pick from video');
  const photo = filePicker({ id: 'cover_' + Math.random().toString(36).slice(2, 7), accept: 'image/*', label: 'Upload photo', onChange: async (f) => {
    if (!f) return;
    try { chosen = await imageFileToJpeg(f); showBlob(chosen); clear(panel); status.textContent = 'Photo selected as the cover.'; }
    catch { toast('This image could not be read. Try a JPEG or PNG.', 'err'); }
    photo.reset();
  } });
  pickFrame.onclick = async () => {
    clear(panel).append(h('p', { class: 'muted small' }, 'Loading video…'));
    try { await ready; } catch { clear(panel).append(h('p', { class: 'error-text' }, 'This video cannot be previewed in this browser. Upload a photo instead.')); return; }
    const dur = v.duration || 0;
    const slider = h('input', { type: 'range', min: 0, max: Math.max(dur, 0.1), step: 0.05, value: Math.min(dur / 2, dur), 'aria-label': 'Moment in the video' });
    const shown = h('video', { muted: true, playsInline: true, src, crossOrigin: 'anonymous', class: 'cover-scrub' });
    shown.setAttribute('playsinline', '');
    const sync = () => { shown.currentTime = Number(slider.value); };
    slider.addEventListener('input', sync);
    shown.addEventListener('loadeddata', sync, { once: true });
    const use = h('button', { type: 'button', class: 'btn small' }, 'Use this frame');
    use.onclick = async () => {
      try { chosen = await grabFrame(v, Number(slider.value)); showBlob(chosen); clear(panel); status.textContent = 'Frame selected as the cover.'; }
      catch { toast('Could not capture this frame. Try another moment or upload a photo.', 'err'); }
    };
    clear(panel).append(shown, slider, h('div', { class: 'btn-row' }, use, h('button', { type: 'button', class: 'btn secondary small', onclick: () => clear(panel) }, 'Cancel')));
  };

  const el = h('div', { class: 'cover-picker' }, preview, status, h('div', { class: 'row' }, pickFrame, photo), panel);
  el.chosen = () => !!chosen;
  el.getBlob = async () => {
    if (chosen) return chosen;
    try { await ready; return await grabFrame(v, (v.duration || 0) * (0.15 + Math.random() * 0.7)); }
    catch { return null; }
  };
  el.cleanup = () => { if (source instanceof Blob) URL.revokeObjectURL(src); v.removeAttribute('src'); v.load(); };
  return el;
}

// Cover image for a video tile or player (signed link resolved later).
export function coverImg(urlPromise, alt = '') {
  const img = h('img', { alt, class: 'cover', loading: 'lazy' });
  img.hidden = true;
  Promise.resolve(urlPromise).then((u) => { if (u) { img.src = u; img.hidden = false; } }).catch(() => {});
  img.onerror = () => { img.hidden = true; };
  return img;
}
