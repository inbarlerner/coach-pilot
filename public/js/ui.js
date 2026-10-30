// Small DOM helpers, shared UI states and components.

// Conditional children like `cond && h(...)` may be false/null/undefined; never print them as text.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = proto[m];
    proto[m] = function (...nodes) {
      return orig.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false && n !== ''));
    };
  }
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { el.replaceChildren(); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- States ----------
export const loading = (text = 'Loading…') =>
  h('div', { class: 'state', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, text));
export const empty = (title, text, action) =>
  h('div', { class: 'state empty' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '○'), h('p', null, h('strong', null, title)), text && h('p', null, text), action);
export const errorState = (text, retry) =>
  h('div', { class: 'state error', role: 'alert' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '!'), h('p', null, text),
    retry && h('button', { class: 'btn secondary', onclick: retry }, 'Try again'));
export const successState = (title, text, ...actions) =>
  h('div', { class: 'state success', role: 'status' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '✓'), h('p', null, h('strong', null, title)), text && h('p', null, text), h('div', { class: 'btn-row', style: { width: '100%' } }, ...actions));

// Render an async section with loading / error / retry handling.
export async function section(container, loader, render) {
  clear(container).append(loading());
  try {
    const data = await loader();
    clear(container);
    const out = render(data);
    if (out) append(container, [out]);
  } catch (e) {
    console.error(e);
    clear(container).append(errorState(friendlyError(e), () => section(container, loader, render)));
  }
}

// ---------- Toast ----------
export function toast(text, kind = 'ok') {
  const t = h('div', { class: 't' + (kind === 'err' ? ' err' : '') }, text);
  document.getElementById('toast').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3500);
}

// ---------- Modal / confirm ----------
export function modal(build) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' });
    const box = h('div', { class: 'modal' });
    const close = (v) => { back.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    box.append(...[].concat(build(close)));
    back.append(box);
    document.body.append(back);
    const f = box.querySelector('input, select, textarea, button');
    f && f.focus();
  });
}
export const confirmDialog = (title, text, okText = 'OK', cancelText = 'Cancel', okClass = 'btn') =>
  modal((close) => [
    h('h2', null, title),
    text && h('p', null, text),
    h('div', { class: 'btn-row', style: { marginTop: 'var(--space-4)' } },
      h('button', { class: okClass, onclick: () => close(true) }, okText),
      h('button', { class: 'btn secondary', onclick: () => close(false) }, cancelText)),
  ]);
// For confirms that delete, decline or discard something.
export const confirmDanger = (title, text, okText, cancelText) => confirmDialog(title, text, okText, cancelText, 'btn danger');

// ---------- Buttons with busy state ----------
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const old = [...btn.childNodes];
  btn.style.minWidth = btn.offsetWidth + 'px';   // keeps its width; grows only if the busy text would not fit
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.replaceChildren(h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), ' One moment…');
  try { return await fn(); }
  finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.style.minWidth = ''; btn.replaceChildren(...old); }
}

// ---------- Formatting ----------
const dtf = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => (d ? dtf.format(new Date(d)) : '');
export function timeLeft(deadline) {
  const ms = new Date(deadline) - Date.now();
  if (ms <= 0) return 'time is up';
  const hrs = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
  if (hrs >= 48) return `${Math.floor(hrs / 24)} days left`;
  if (hrs >= 1) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}
export const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(0) + 'MB' : Math.ceil(b / 1024) + 'KB');

export const STATUS = {
  pending: 'Waiting for analysis',
  draft: 'In progress / draft',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Response time passed',
};
// The word always stays: our red and green are equally dark, so colour alone says nothing to color-blind users.
export const statusTag = (status) => h('span', { class: 'tag status-' + status }, STATUS[status]);
export const DECLINE = { unclear: 'Video is unclear', not_my_field: 'Not my field', video_problem: 'Problem with the video' };
export const POLICY = {
  none: 'No follow-up messages',
  one: 'One follow-up message from the trainee, with one reply',
  chat24: 'Chat for 24 hours after the analysis is sent',
  unlimited: 'Unlimited chat',
};

// ---------- Errors → plain English ----------
const ERR = {
  NOT_AUTHENTICATED: 'Please sign in again.',
  ACCOUNT_DISABLED: 'This account was disabled by an admin.',
  COACH_FULL: 'This coach has no free spot right now. Pick another coach or try later.',
  COACH_NOT_AVAILABLE: 'This coach is not taking requests.',
  SELF_REQUEST: 'You cannot send a request to yourself.',
  EXPIRED: 'The response time for this request has passed. The analysis can no longer be sent.',
  NOT_OPEN: 'This request is no longer open.',
  EMPTY_ANALYSIS: 'Add at least one part to the analysis (text, voice or video).',
  NOT_FOUND: 'Not found, or you do not have access to it.',
  TOO_LARGE: 'The file is larger than the pilot limit (50MB per video, 2MB per image). You can trim the video in your phone\'s gallery and try again.',
  BAD_TYPE: 'This file type is not supported. Upload an MP4, MOV or WebM video, a common audio file, or a JPEG/PNG image.',
  BAD_IMAGE: 'This image could not be read. Try a JPEG or PNG.',
  FILE_NOT_FOUND: 'The file was not found in storage. Try uploading it again.',
  UPLOAD_ABORTED: 'Upload cancelled.',
  FILE_REMOVED: 'This video was removed automatically to free up storage, so it cannot be sent for analysis.',
  BAD_SPORT: 'Choose a sport.',
  TITLE_REQUIRED: 'Enter a name for the drill.',
  FORBIDDEN: 'You do not have permission to do this.',
  FORBIDDEN_FIELD: 'You do not have permission to change this field.',
  EMPTY_MESSAGE: 'The message is empty.',
  CANNOT_DISABLE_SELF: 'You cannot disable your own account.',
  SERVER_NOT_CONFIGURED: 'The server is not fully set up yet (missing keys). See the setup guide.',
  ONE_USED: 'You already sent the one follow-up message for this request.',
  ONE_REPLIED: 'You already replied to the follow-up message.',
  WAIT_TRAINEE: 'You can reply only after the trainee sends a follow-up message.',
  POLICY_NONE: 'This request has no follow-up messages.',
  CHAT24_ENDED: 'The 24-hour chat window has ended.',
  ALREADY_COACH: 'This account is already registered as a coach.',
  BIO_REQUIRED: 'Write a short professional bio (at least 10 characters).',
  SPORTS_REQUIRED: 'Choose at least one sport you coach.',
  profiles_languages_check: 'Choose languages from the list.',
  NETWORK: 'No network connection. Check your connection and try again.',
  'Invalid login credentials': 'Wrong email or password.',
  'Email not confirmed': 'Your email is not confirmed yet. Check your inbox.',
  'User already registered': 'An account with this email already exists.',
};
export function friendlyError(e) {
  const msg = (e && (e.message || e.error_description || e.error)) || String(e || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return ERR.NETWORK;
  // Supabase Storage responses
  if (/exceeded the maximum allowed size|Payload too large|entity too large/i.test(msg)) return ERR.TOO_LARGE;
  if (/mime type|invalid_mime_type/i.test(msg)) return ERR.BAD_TYPE;
  if (/quota|exceed_storage_size/i.test(msg)) return 'The pilot storage (1GB) is full. Please contact the pilot admin.';
  if (/row-level security|Unauthorized/i.test(msg)) return 'You do not have access to this file.';
  if (/Object not found|not_found/i.test(msg)) return ERR.NOT_FOUND;
  for (const [k, v] of Object.entries(ERR)) if (msg.includes(k)) return v;
  if (/Password should be at least/i.test(msg)) return 'The password is too short (at least 8 characters).';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Try again in a few minutes.';
  if (/duplicate key.*username|profiles_username_key/i.test(msg)) return 'This username is taken.';
  return 'Something went wrong. Please try again. (' + msg.slice(0, 120) + ')';
}

// ---------- Icons (monochrome outline) ----------
const P = {
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  upload: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 10 4 4M21 10l-4 4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  text: '<path d="M5 6h14M12 6v13"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
};
export const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.innerHTML = P[name] || ''; return s;
};

export function tabs(names, active, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  for (const [key, label] of names) {
    bar.append(h('button', { role: 'tab', 'aria-selected': String(key === active), onclick: () => onChange(key) }, label));
  }
  return bar;
}

// Styled file picker (the native control looks different in every browser).
export function filePicker({ id, accept, label = 'Choose file', onChange }) {
  const input = h('input', { type: 'file', id, accept, class: 'visually-hidden' });
  const name = h('span', { class: 'muted' }, 'No file chosen');
  input.addEventListener('change', () => {
    name.textContent = input.files[0] ? input.files[0].name : 'No file chosen';
    onChange && onChange(input.files[0] || null, input);
  });
  const btn = h('label', { for: id, class: 'btn secondary', role: 'button', tabindex: '0',
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, label);
  const wrap = h('div', { class: 'file-pick' }, input, btn, name);
  wrap.input = input;
  wrap.reset = () => { input.value = ''; name.textContent = 'No file chosen'; };
  return wrap;
}
export const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
