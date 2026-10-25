// App shell: startup, routing, layout and bottom navigation.
import { h, clear, icon, errorState, friendlyError } from './ui.js';
import { init, sb, state, loadProfile, loadSports, refreshUnread, isAdmin } from './api.js';

const app = document.getElementById('app');

// route → [module path, export name, needs login]
const ROUTES = [
  [/^\/login$/, './pages/auth.js', 'loginPage', false],
  [/^\/signup$/, './pages/auth.js', 'signupPage', false],
  [/^\/forgot$/, './pages/auth.js', 'forgotPage', false],
  [/^\/reset$/, './pages/auth.js', 'resetPage', true],
  [/^\/home$/, './pages/home.js', 'homePage', true],
  [/^\/search$/, './pages/search.js', 'searchPage', true],
  [/^\/upload$/, './pages/upload.js', 'uploadPage', true],
  [/^\/inbox$/, './pages/inbox.js', 'inboxPage', true],
  [/^\/r\/([0-9a-f-]{36})$/, './pages/request.js', 'requestPage', true],
  [/^\/v\/([0-9a-f-]{36})$/, './pages/video.js', 'videoPage', true],
  [/^\/u\/([a-z0-9_.]+)$/, './pages/profile.js', 'profilePage', true],
  [/^\/me$/, './pages/profile.js', 'mePage', true],
  [/^\/settings$/, './pages/settings.js', 'settingsPage', true],
  [/^\/notifications$/, './pages/notifications.js', 'notificationsPage', true],
  [/^\/admin$/, './pages/admin.js', 'adminPage', true],
  [/^\/admin\/lab$/, './pages/ailab.js', 'aiLabPage', true],
  [/^\/admin\/lab\/new$/, './pages/ailab.js', 'aiLabNewPage', true],
  [/^\/admin\/lab\/([0-9a-f-]{36})$/, './pages/ailab.js', 'aiLabRunPage', true],
  [/^\/admin\/feedback$/, './pages/ailab.js', 'aiFeedbackPage', true],
];
const NAV = [ // RTL: first = rightmost
  ['profile', '/me', 'פרופיל', ['/me', '/u/', '/settings', '/admin']],
  ['inbox', '/inbox', 'אינבוקס', ['/inbox', '/r/']],
  ['upload', '/upload', 'העלאה', ['/upload']],
  ['search', '/search', 'חיפוש', ['/search']],
  ['home', '/home', 'בית', ['/home', '/v/']],
];

let cleanup = null;
let routeSeq = 0;   // the latest navigation wins if two overlap

export function go(path) {
  if (location.hash === '#' + path) route();
  else location.hash = path;
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

export function defaultRoute() {
  if (!state.user) return '/login';
  const p = state.profile;
  if (p && p.role === 'trainee' && !p.onboarded) return '/upload?welcome=1';
  return '/home';
}

function layout(path, title) {
  const unread = state.unread;
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'title' }, title || ''),
    h('div', { class: 'row' },
      isAdmin() && h('a', { class: 'btn ghost small', href: '#/admin' }, 'ניהול'),
      h('a', { class: 'icon-btn', href: '#/notifications', 'aria-label': `התראות${unread ? ` (${unread} חדשות)` : ''}` },
        icon('bell'), unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null)));
  const main = h('main', { class: 'page', id: 'main' });
  const nav = h('nav', { class: 'bottom', 'aria-label': 'ניווט ראשי' },
    NAV.map(([ic, href, label, prefixes]) => {
      const active = prefixes.some((p) => path === p || path.startsWith(p));
      return h('a', { href: '#' + href, class: (active ? 'active ' : '') + ic, 'aria-current': active ? 'page' : null }, icon(ic), label);
    }));
  clear(app).append(top, main, nav);
  return { main, setTitle: (t) => { top.querySelector('.title').textContent = t; } };
}

async function route() {
  const seq = ++routeSeq;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const { path, query } = parseHash();
  if (path === '/' || path === '') return go(defaultRoute());

  const match = ROUTES.find(([re]) => re.test(path));
  if (!match) return go(defaultRoute());
  const [re, mod, fn, needsLogin] = match;
  if (needsLogin && !state.user) return go('/login');
  if (!needsLogin && state.user && path !== '/forgot') return go(defaultRoute());

  if (state.user && state.profile?.disabled) return disabledScreen();

  const params = path.match(re).slice(1);
  try {
    const page = await import(mod);
    if (seq !== routeSeq) return;   // a newer navigation started meanwhile
    if (!needsLogin || path === '/reset') {
      const main = h('main', { class: 'page' });
      clear(app).append(main);
      const c = (await page[fn]({ main, params, query })) || null;
      if (seq === routeSeq) cleanup = c; else if (c) c();
    } else {
      const shell = layout(path);
      const c = (await page[fn]({ main: shell.main, setTitle: shell.setTitle, params, query })) || null;
      if (seq === routeSeq) cleanup = c; else if (c) c();
    }
    if (seq === routeSeq) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    clear(app).append(h('main', { class: 'page' }, errorState(friendlyError(e), () => route())));
  }
}

function disabledScreen() {
  clear(app).append(h('main', { class: 'page' },
    h('div', { class: 'state error' }, h('p', null, h('strong', null, 'החשבון הושבת')),
      h('p', null, 'החשבון הושבת על ידי מנהל המערכת. לבירור אפשר לפנות למנהל הפיילוט.'),
      h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'יציאה'))));
}

export async function refreshBadge() {
  try {
    await refreshUnread();
    const bell = document.querySelector('.topbar .icon-btn');
    if (!bell) return;
    bell.querySelector('.badge')?.remove();
    if (state.unread) bell.append(h('span', { class: 'badge' }, state.unread > 99 ? '99+' : state.unread));
    bell.setAttribute('aria-label', `התראות${state.unread ? ` (${state.unread} חדשות)` : ''}`);
  } catch {}
}

async function start() {
  try {
    await init();
  } catch (e) {
    clear(app).append(h('main', { class: 'page' }, errorState(
      e.message === 'SERVER_NOT_CONFIGURED'
        ? 'האתר עדיין לא חובר למסד הנתונים. יש להשלים את שלב ההגדרות במדריך ההקמה.'
        : friendlyError(e), () => location.reload())));
    return;
  }
  try {
    await loadSports();
    if (state.user) { await loadProfile(); await refreshUnread(); }
  } catch (e) { console.error(e); }

  // Arrived from an email link (password recovery / signup confirmation)
  if (sb.auth.detected.type === 'recovery') location.hash = '#/reset';
  else if (sb.auth.detected.error) {
    setTimeout(() => import('./ui.js').then(({ toast }) => toast('הקישור אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש.', 'err')), 300);
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    const wasIn = !!state.user;
    state.session = session;
    state.user = session?.user || null;
    if (event === 'SIGNED_OUT') { state.profile = null; state.unread = 0; return go('/login'); }
    if (event === 'SIGNED_IN' && !wasIn) {
      await loadProfile().catch(() => {});
      await refreshUnread().catch(() => {});
      if (!location.hash.startsWith('#/reset')) go(defaultRoute());
    }
  });

  window.addEventListener('hashchange', route);
  route();
  setInterval(() => { if (state.user && document.visibilityState === 'visible') refreshBadge(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.user) refreshBadge(); });
}

start();
