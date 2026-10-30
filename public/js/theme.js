// Settings → Appearance. 'system' follows the phone; 'light' / 'dark' are kept on this device only.
// The inline script in index.html applies the saved choice before the first paint.
const KEY = 'theme';
const BAR = { light: '#FFFFFF', dark: '#00432F' };   // browser bar colour = screen colour

export function getTheme() {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}

export function setTheme(t) {
  try { t === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch {}
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => {
    m.content = t === 'system' ? (m.media.includes('dark') ? BAR.dark : BAR.light) : BAR[t];
  });
}
