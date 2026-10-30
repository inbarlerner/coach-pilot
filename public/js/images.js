// Profile photos and video covers: avatar display and cover images. (Photo editor: avatar-crop.js; cover editing: video-editor.js.)
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

// Shown in place of a coach who deleted their account (their finished analyses stay with the trainee).
export const FORMER_COACH = Object.freeze({ first_name: 'Former', last_name: 'coach', username: null, avatar_key: null, languages: [] });

// Photo + name link, used wherever a person is shown. No username (former coach) → no link.
export function personLink(p, { size = 32, strong = true } = {}) {
  const name = (p?.first_name || '') + ' ' + (p?.last_name || '');
  const label = strong ? h('strong', null, name) : h('span', null, name);
  return p?.username ? h('a', { class: 'person', href: '#/u/' + p.username }, avatar(p, size), label)
    : h('span', { class: 'person' }, avatar(p, size), label);
}

// Cover image for a video tile or player (signed link resolved later).
export function coverImg(urlPromise, alt = '') {
  const img = h('img', { alt, class: 'cover', loading: 'lazy' });
  img.hidden = true;
  Promise.resolve(urlPromise).then((u) => { if (u) { img.src = u; img.hidden = false; } }).catch(() => {});
  img.onerror = () => { img.hidden = true; };
  return img;
}
