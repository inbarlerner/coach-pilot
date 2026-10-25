// App shell: startup, routing, layout and bottom navigation.
import { h, clear, icon, errorState, friendlyError } from './ui.js';
import { init, sb, state, loadProfile, loadSports, refreshUnread, isAdmin } from './api.js';
import { avatar } from './images.js';

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
];
const NAV = [ // left to right
  ['home', '/home', 'Home', ['/home', '/v/']],
  ['search', '/search', 'Search', ['/search']],
  ['upload', '/upload', 'Upload', ['/upload']],
  ['inbox', '/inbox', 'Inbox', ['/inbox', '/r/']],
  ['profile', '/me', 'Profile', ['/me', '/u/', '/settings', '/admin']],
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
      isAdmin() && h('a', { class: 'btn ghost small', href: '#/admin' }, 'Admin'),
      h('a', { class: 'icon-btn', href: '#/notifications', 'aria-label': `Notifications${unread ? ` (${unread} new)` : ''}` },
        icon('bell'), unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null)));
  const main = h('main', { class: 'page', id: 'main' });
  const nav = h('nav', { class: 'bottom', 'aria-label': 'Main navigation' },
    NAV.map(([ic, href, label, prefixes]) => {
      const active = prefixes.some((p) => path === p || path.startsWith(p));
      const pic = ic === 'profile' && state.profile?.avatar_key ? avatar(state.profile, 28) : icon(ic);
      return h('a', { href: '#' + href, class: (active ? 'active ' : '') + ic, 'aria-current': active ? 'page' : null }, pic, label);
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
    h('div', { class: 'state error' }, h('p', null, h('strong', null, 'Account disabled')),
      h('p', null, 'This account was disabled by an admin. Please contact the pilot admin.'),
      h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Sign out'))));
}

export async function refreshBadge() {
  try {
    await refreshUnread();
    const bell = document.querySelector('.topbar .icon-btn');
    if (!bell) return;
    bell.querySelector('.badge')?.remove();
    if (state.unread) bell.append(h('span', { class: 'badge' }, state.unread > 99 ? '99+' : state.unread));
    bell.setAttribute('aria-label', `Notifications${state.unread ? ` (${state.unread} new)` : ''}`);
  } catch {}
}

async function start() {
  try {
    await init();
  } catch (e) {
    clear(app).append(h('main', { class: 'page' }, errorState(
      e.message === 'SERVER_NOT_CONFIGURED'
        ? 'The site is not connected to the database yet. Finish the settings step in the setup guide.'
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
    setTimeout(() => import('./ui.js').then(({ toast }) => toast('This link is invalid or has expired. You can request a new one.', 'err')), 300);
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
