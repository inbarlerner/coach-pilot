// Profile photos and video covers: avatar display, image resizing, cover images. (Cover editing: video-editor.js.)
import { h } from './ui.js';
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

// Cover image for a video tile or player (signed link resolved later).
export function coverImg(urlPromise, alt = '') {
  const img = h('img', { alt, class: 'cover', loading: 'lazy' });
  img.hidden = true;
  Promise.resolve(urlPromise).then((u) => { if (u) { img.src = u; img.hidden = false; } }).catch(() => {});
  img.onerror = () => { img.hidden = true; };
  return img;
}
