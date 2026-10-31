// Settings → Appearance: 'light' (the default) or 'dark', kept on this device only.
// The inline script in index.html applies a saved Dark before the first paint.
const KEY = 'theme';
const BAR = { light: '#FFFFFF', dark: '#00432F' };   // browser bar colour = screen colour

export function getTheme() {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

export function setTheme(t) {
  try { t === 'dark' ? localStorage.setItem(KEY, 'dark') : localStorage.removeItem(KEY); } catch {}
  const root = document.documentElement;
  if (t === 'dark') root.dataset.theme = 'dark'; else delete root.dataset.theme;
  const bar = document.querySelector('meta[name=theme-color]');
  if (bar) bar.content = BAR[t];
}
