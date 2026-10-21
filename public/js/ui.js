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
export const loading = (text = 'טוען…') =>
  h('div', { class: 'state', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, text));
export const empty = (title, text, action) =>
  h('div', { class: 'state empty' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '○'), h('p', null, h('strong', null, title)), text && h('p', null, text), action);
export const errorState = (text, retry) =>
  h('div', { class: 'state error', role: 'alert' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '!'), h('p', null, text),
    retry && h('button', { class: 'btn secondary', onclick: retry }, 'ניסיון חוזר'));
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
export const confirmDialog = (title, text, okText = 'אישור', cancelText = 'ביטול') =>
  modal((close) => [
    h('h2', null, title),
    text && h('p', null, text),
    h('div', { class: 'btn-row', style: { marginTop: '1rem' } },
      h('button', { class: 'btn', onclick: () => close(true) }, okText),
      h('button', { class: 'btn secondary', onclick: () => close(false) }, cancelText)),
  ]);

// ---------- Buttons with busy state ----------
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), ' רגע…');
  try { return await fn(); }
  finally { btn.disabled = false; btn.replaceChildren(...old); }
}

// ---------- Formatting ----------
const dtf = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => (d ? dtf.format(new Date(d)) : '');
export function timeLeft(deadline) {
  const ms = new Date(deadline) - Date.now();
  if (ms <= 0) return 'הזמן עבר';
  const hrs = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
  if (hrs >= 48) return `נותרו ${Math.floor(hrs / 24)} ימים`;
  if (hrs >= 1) return `נותרו ${hrs} שע׳ ו־${mins} דק׳`;
  return `נותרו ${mins} דק׳`;
}
export const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(0) + 'MB' : Math.ceil(b / 1024) + 'KB');

export const STATUS = {
  pending: 'ממתינה לניתוח',
  draft: 'בעבודה / טיוטה',
  completed: 'הושלמה',
  declined: 'סורבה',
  expired: 'זמן התגובה עבר',
};
export const DECLINE = { unclear: 'סרטון לא ברור', not_my_field: 'לא התחום שלי', video_problem: 'בעיה בסרטון' };
export const POLICY = {
  none: 'ללא הודעות המשך',
  one: 'הודעת המשך אחת מהמתאמן, עם אפשרות תשובה',
  chat24: 'צ׳אט למשך 24 שעות משליחת הניתוח',
  unlimited: 'צ׳אט ללא הגבלת זמן',
};

// ---------- Errors → Hebrew ----------
const ERR = {
  NOT_AUTHENTICATED: 'צריך להתחבר מחדש.',
  ACCOUNT_DISABLED: 'החשבון הושבת על ידי מנהל.',
  COACH_FULL: 'למאמן אין כרגע מקום פנוי. בחרו מאמן אחר או נסו מאוחר יותר.',
  COACH_NOT_AVAILABLE: 'המאמן אינו זמין לקבלת בקשות.',
  SELF_REQUEST: 'אי אפשר לשלוח בקשה לעצמך.',
  EXPIRED: 'זמן התגובה לבקשה עבר. אי אפשר לשלוח ניתוח.',
  NOT_OPEN: 'הבקשה כבר אינה פתוחה לעבודה.',
  EMPTY_ANALYSIS: 'יש להוסיף לפחות רכיב תגובה אחד (טקסט, קול או וידאו).',
  NOT_FOUND: 'הפריט לא נמצא או שאין לך הרשאה לצפות בו.',
  TOO_LARGE: 'הקובץ גדול מהמותר.',
  BAD_TYPE: 'סוג הקובץ אינו נתמך.',
  BAD_SPORT: 'יש לבחור ענף ספורט.',
  TITLE_REQUIRED: 'יש למלא את שם התרגיל.',
  FORBIDDEN: 'אין לך הרשאה לפעולה זו.',
  FORBIDDEN_FIELD: 'אין לך הרשאה לשנות שדה זה.',
  EMPTY_MESSAGE: 'ההודעה ריקה.',
  CANNOT_DISABLE_SELF: 'אי אפשר להשבית את החשבון שלך.',
  SERVER_NOT_CONFIGURED: 'השרת עדיין לא הוגדר במלואו (חסרים מפתחות). ראו מדריך ההקמה.',
  ONE_USED: 'כבר שלחת את הודעת ההמשך היחידה בבקשה זו.',
  ONE_REPLIED: 'כבר השבת להודעת ההמשך.',
  WAIT_TRAINEE: 'אפשר להשיב רק אחרי שהמתאמן שולח הודעת המשך.',
  POLICY_NONE: 'בבקשה זו אין הודעות המשך.',
  CHAT24_ENDED: '24 השעות להתכתבות הסתיימו.',
  NETWORK: 'אין חיבור לרשת. בדקו את החיבור ונסו שוב.',
  'Invalid login credentials': 'מייל או סיסמה שגויים.',
  'Email not confirmed': 'המייל עדיין לא אומת. בדקו את תיבת הדואר.',
  'User already registered': 'כבר קיים חשבון עם המייל הזה.',
};
export function friendlyError(e) {
  const msg = (e && (e.message || e.error_description || e.error)) || String(e || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return ERR.NETWORK;
  for (const [k, v] of Object.entries(ERR)) if (msg.includes(k)) return v;
  if (/Password should be at least/i.test(msg)) return 'הסיסמה קצרה מדי (לפחות 8 תווים).';
  if (/rate limit/i.test(msg)) return 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.';
  if (/duplicate key.*username|profiles_username_key/i.test(msg)) return 'שם המשתמש תפוס.';
  return 'משהו השתבש. נסו שוב. (' + msg.slice(0, 120) + ')';
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
  back: '<path d="m9 6 6 6-6 6"/>',
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
