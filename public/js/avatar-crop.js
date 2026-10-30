// Profile photo editor, shown after choosing a photo: the circle stays still and the photo moves under it.
// Drag to position; zoom with a pinch, the slider, the mouse wheel or +/-. Arrow keys move the photo.
// Resolves to a square JPEG of what is inside the circle (the app shows it round), or null when cancelled.
import { h, toast } from './ui.js';

const OUT = 400;          // saved size in px, as before
const MAX_ZOOM = 4;       // times the smallest zoom that still fills the circle
const STEP = 16;          // px per arrow key press

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('BAD_IMAGE')); };
    img.src = URL.createObjectURL(file);
  });
}

export async function cropAvatar(file) {
  let img;
  try { img = await loadImage(file); } catch { toast('This image could not be read. Try a JPEG or PNG.', 'err'); return null; }
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) { URL.revokeObjectURL(img.src); toast('This image could not be read. Try a JPEG or PNG.', 'err'); return null; }

  return new Promise((resolve) => {
    const before = document.activeElement;
    const pic = h('img', { src: img.src, alt: '', class: 'acrop-img', draggable: false });
    const ring = h('div', { class: 'acrop-ring', 'aria-hidden': 'true' });
    const stage = h('div', { class: 'acrop-stage', tabindex: '0', role: 'application',
      'aria-label': 'Photo position. Drag, or use the arrow keys to move it and + or - to zoom.' }, pic, ring);
    const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Zoom' });
    const cancel = h('button', { type: 'button', class: 'btn secondary' }, 'Cancel');
    const use = h('button', { type: 'button', class: 'btn' }, 'Use photo');
    const sheet = h('div', { class: 'acrop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acrop_t', tabindex: '-1' },
      h('h2', { id: 'acrop_t' }, 'Move and zoom'),
      h('p', { class: 'acrop-hint' }, 'Drag the photo to place it in the circle. Pinch or use the slider to zoom.'),
      stage,
      h('label', { class: 'acrop-zoom' }, h('span', { 'aria-hidden': 'true' }, '−'), slider, h('span', { 'aria-hidden': 'true' }, '+')),
      h('div', { class: 'btn-row' }, cancel, use));
    document.body.append(sheet);
    document.body.classList.add('no-scroll');

    // Layout, in stage pixels: the circle (cx, cy, D) is fixed; the photo's top-left is (x, y) at scale s.
    let size = 0, D = 0, cx = 0, cy = 0, minS = 1, s = 1, x = 0, y = 0;
    const clamp = () => {
      s = Math.min(minS * MAX_ZOOM, Math.max(minS, s));
      x = Math.min(cx, Math.max(cx + D - W * s, x));   // the photo always covers the circle
      y = Math.min(cy, Math.max(cy + D - H * s, y));
    };
    const draw = () => {
      clamp();
      pic.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      slider.value = String(Math.log(s / minS) / Math.log(MAX_ZOOM));
    };
    // Zoom to scale ns, keeping the photo point under (px, py) in place.
    const zoomAt = (ns, px = cx + D / 2, py = cy + D / 2) => {
      ns = Math.min(minS * MAX_ZOOM, Math.max(minS, ns));
      x = px - (px - x) * (ns / s); y = py - (py - y) * (ns / s); s = ns;
      draw();
    };
    const layout = () => {
      const r = stage.getBoundingClientRect();
      if (!r.width) return;
      const old = size ? { u: (cx + D / 2 - x) / s, v: (cy + D / 2 - y) / s, z: s / minS } : null;
      size = r.width; D = Math.round(size * 0.84); cx = cy = (size - D) / 2;
      minS = D / Math.min(W, H);
      if (old) { s = minS * old.z; x = cx + D / 2 - old.u * s; y = cy + D / 2 - old.v * s; }
      else { s = minS; x = cx + (D - W * s) / 2; y = cy + (D - H * s) / 2; }   // start centred, just filling the circle
      ring.style.cssText = `left:${cx}px; top:${cy}px; width:${D}px; height:${D}px`;
      draw();
    };
    const watch = new ResizeObserver(layout);
    watch.observe(stage);

    // ---------- Touch and mouse: one finger drags, two fingers pinch ----------
    const pts = new Map();
    let gesture = null;
    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const startGesture = () => {
      const [a, b] = [...pts.values()];
      gesture = b
        ? { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, x, y }
        : { pinch: false, px: a.x, py: a.y, x, y };
    };
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, local(e)); startGesture();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const [a, b] = [...pts.values()];
      if (gesture.pinch && b) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ns = Math.min(minS * MAX_ZOOM, Math.max(minS, gesture.s * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d)));
        // the photo point that was under the fingers' midpoint follows it
        x = mx - (gesture.mx - gesture.x) * (ns / gesture.s); y = my - (gesture.my - gesture.y) * (ns / gesture.s); s = ns;
        draw();
      } else if (!gesture.pinch) {
        x = gesture.x + a.x - gesture.px; y = gesture.y + a.y - gesture.py;
        draw();
      }
    });
    const lift = (e) => { if (pts.delete(e.pointerId) && pts.size) startGesture(); };
    stage.addEventListener('pointerup', lift);
    stage.addEventListener('pointercancel', lift);
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(s * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });
    slider.addEventListener('input', () => zoomAt(minS * MAX_ZOOM ** Number(slider.value)));

    // ---------- Keyboard ----------
    stage.addEventListener('keydown', (e) => {
      const move = { ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] }[e.key];
      if (move) { e.preventDefault(); x += move[0]; y += move[1]; draw(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(s * 1.1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(s / 1.1); }
    });
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);

    const close = (v) => {
      watch.disconnect();
      document.removeEventListener('keydown', esc);
      document.body.classList.remove('no-scroll');
      sheet.remove();
      URL.revokeObjectURL(img.src);
      before?.focus?.();
      resolve(v);
    };
    cancel.onclick = () => close(null);
    use.onclick = () => {
      const side = D / s;                              // circle size in photo pixels
      const out = Math.max(1, Math.min(OUT, Math.round(side)));
      const c = document.createElement('canvas');
      c.width = c.height = out;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (cx - x) / s, (cy - y) / s, side, side, 0, 0, out, out);
      c.toBlob((b) => (b ? close(b) : toast('This image could not be read. Try a JPEG or PNG.', 'err')), 'image/jpeg', 0.85);
    };
    requestAnimationFrame(() => sheet.focus({ preventScroll: true }));   // keyboard users Tab to the photo next
  });
}
