// App shell: startup, routing, layout and bottom navigation.
import { h, clear, icon, errorState, friendlyError } from './ui.js';
import { init, sb, state, loadProfile, loadSports, refreshUnread, isAdmin, deleteAccount } from './api.js';
import { avatar } from './images.js';

const app = document.getElementById('app');

// route → [module path, export name, needs login]
const ROUTES = [
  [/^\/login$/, './pages/auth.js', 'loginPage', false],
  [/^\/signup$/, './pages/auth.js', 'signupPage', false],
  [/^\/forgot$/, './pages/auth.js', 'forgotPage', false],
  [/^\/reset$/, './pages/auth.js', 'resetPage', true],
  [/^\/welcome$/, './pages/auth.js', 'finishSignupPage', true],
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
  if (p?.needs_setup) return '/welcome';   // first Google sign-in: details still missing
  if (p && p.role === 'trainee' && !p.onboarded) return '/upload?welcome=1';
  return '/home';
}

function layout(path) {
  const unread = state.unread;
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'wordmark' }, 'CoachIt.'),
    h('div', { class: 'row' },
      isAdmin() && h('a', { class: 'btn ghost small', href: '#/admin' }, 'Admin'),
      h('a', { class: 'icon-btn', href: '#/notifications', 'aria-label': `Notifications${unread ? ` (${unread} new)` : ''}` },
        icon('bell'), unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null)));
  const main = h('main', { class: 'page', id: 'main' });
  const nav = h('nav', { class: 'bottom', 'aria-label': 'Main navigation' },
    NAV.map(([ic, href, label, prefixes]) => {
      const active = prefixes.some((p) => path === p || path.startsWith(p));
      const pic = ic === 'profile' && state.profile?.avatar_key ? avatar(state.profile, 28) : icon(ic);
      const n = ic === 'inbox' ? state.inboxUnread : 0;
      return h('a', { href: '#' + href, class: (active ? 'active ' : '') + ic, 'aria-current': active ? 'page' : null,
        'aria-label': n ? `${label} (${n} unread)` : null }, pic, label, n ? h('span', { class: 'badge' }, n > 99 ? '99+' : n) : null);
    }));
  clear(app).append(top, main, nav);
  return { main };
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
  if (state.user && state.profile?.deleting_at) return finishDeletionScreen();
  if (state.user && state.profile?.needs_setup && path !== '/welcome' && path !== '/reset') return go('/welcome');

  const params = path.match(re).slice(1);
  try {
    const page = await import(mod);
    if (seq !== routeSeq) return;   // a newer navigation started meanwhile
    if (!needsLogin || path === '/reset' || path === '/welcome') {
      const main = h('main', { class: 'page' });
      clear(app).append(main);
      const c = (await page[fn]({ main, params, query })) || null;
      if (seq === routeSeq) cleanup = c; else if (c) c();
    } else {
      const shell = layout(path);
      const c = (await page[fn]({ main: shell.main, params, query })) || null;
      if (seq === routeSeq) cleanup = c; else if (c) c();
    }
    if (seq === routeSeq) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    clear(app).append(h('main', { class: 'page' }, errorState(friendlyError(e), () => route())));
  }
}

// Account deletion was started but did not finish (page closed, network): finish it now.
async function finishDeletionScreen() {
  const main = h('main', { class: 'page' }, h('div', { class: 'state' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Finishing account deletion...')));
  clear(app).append(main);
  try {
    await deleteAccount();
    await sb.auth.signOut();
    import('./ui.js').then(({ toast }) => toast('Your account was deleted.'));
  } catch (e) {
    clear(main).append(h('div', { class: 'state error' },
      h('p', null, h('strong', null, 'Your account is being deleted')),
      h('p', null, friendlyError(e)),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => finishDeletionScreen() }, 'Try again'),
        h('button', { class: 'btn secondary', onclick: () => sb.auth.signOut() }, 'Sign out'))));
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
    const inbox = document.querySelector('nav.bottom a.inbox');
    if (inbox) {
      inbox.querySelector('.badge')?.remove();
      if (state.inboxUnread) inbox.append(h('span', { class: 'badge' }, state.inboxUnread > 99 ? '99+' : state.inboxUnread));
      inbox.setAttribute('aria-label', state.inboxUnread ? `Inbox (${state.inboxUnread} unread)` : 'Inbox');
    }
  } catch {}
}

async function start() {
  try {
    await init();
  } catch (e) {
    clear(app).append(h('main', { class: 'page' }, errorState(
      e.message === 'SERVER_NOT_CONFIGURED'
        ? 'The site isn\'t connected to the database yet. Finish the settings step in the setup guide.'
        : friendlyError(e), () => location.reload())));
    return;
  }
  try {
    if (state.user) {
      // A saved session whose account no longer exists here: sign out instead of showing broken pages.
      if (!(await loadProfile())) { await sb.auth.signOut(); state.user = null; state.session = null; }
      else await refreshUnread();
    }
  } catch (e) { console.error(e); }
  // The saved session may have been rejected while loading (e.g. it belongs to another setup).
  if (state.user && !(await sb.auth.getSession()).data.session) { state.user = null; state.session = null; state.profile = null; }
  await loadSports().catch((e) => console.error(e));

  // Arrived from an email link (password recovery / signup confirmation)
  if (sb.auth.detected.type === 'recovery') location.hash = '#/reset';
  else if (sb.auth.detected.error) {
    const prov = { google: 'Google' }[sb.auth.detected.provider];
    const msg = prov
      ? `Signing in with ${prov} didn't finish (${sb.auth.detected.error}). Try again, or sign in with email.`
      : 'This link is invalid or has expired. You can request a new one.';
    setTimeout(() => import('./ui.js').then(({ toast }) => toast(msg, 'err')), 300);
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    const wasIn = !!state.user;
    state.session = session;
    state.user = session?.user || null;
    if (event === 'SIGNED_OUT') { state.profile = null; state.unread = 0; state.inboxUnread = 0; return go('/login'); }
    if (event === 'SIGNED_IN' && !wasIn) {
      await loadProfile().catch(() => {});
      await refreshUnread().catch(() => {});
      if (!state.sports.length) await loadSports().catch(() => {});
      if (!location.hash.startsWith('#/reset')) go(defaultRoute());
    }
  });

  window.addEventListener('hashchange', route);
  route();
  setInterval(() => { if (state.user && document.visibilityState === 'visible') refreshBadge(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.user) refreshBadge(); });
}

start();
