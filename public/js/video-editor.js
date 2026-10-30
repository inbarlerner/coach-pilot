// Full-screen editor shown after choosing a video: trim the start and end (✓ goes on to the upload page,
// where coverChooser picks the cover). On an existing video it picks and frames the cover. ✕ cancels, ✓ confirms. Trimming (or a file over the size limit) re-records the chosen part in the
// browser at up to 1280px, which also makes it smaller. The cover is cropped to the profile tile (3:4).
import { h, clear, icon, toast } from './ui.js';
import { MAX_MB, sizeMB } from './api.js';
import { contentBox } from './viewer.js';

const MIN_CLIP = 1;               // seconds
const COVER_RATIO = 3 / 4;        // width / height of a profile tile
const COVER_MAX_W = 1080;
const EDGE = 0.05;                // seconds: closer than this to the start/end counts as untrimmed

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };
const canvasBlob = (c, q = 0.85) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));
const once = (el, ev) => new Promise((r) => el.addEventListener(ev, r, { once: true }));

// Browser recordings (WebM) may report no duration until the end is reached; find it once.
async function knownDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  v.currentTime = 1e7;
  await Promise.race([once(v, 'durationchange'), new Promise((r) => setTimeout(r, 4000))]);
  const d = Number.isFinite(v.duration) ? v.duration : 0;
  v.currentTime = 0;
  return d;
}

/**
 * Opens the editor. source: a File (new upload) or a link (existing video, cover only).
 * options.trim: show the trim bar (default true for files). options.cover: show the cover tools (default: when not trimming).
 * options.start/end: previous trim.
 * Resolves to { file, cover, start, end } or null when cancelled. file is the original file when it
 * was not trimmed and fits the limit; cover is a JPEG Blob (or null if no frame could be read).
 */
export function openVideoEditor(source, { trim = source instanceof Blob, cover: withCover = !trim, start: s0 = 0, end: e0 = null } = {}) {
  return new Promise((resolve) => {
    const isFile = source instanceof Blob;
    const src = isFile ? URL.createObjectURL(source) : source;
    const video = h('video', { class: 'ed-video', src, playsInline: true, preload: 'auto', muted: true });
    video.setAttribute('playsinline', '');
    if (!isFile) video.crossOrigin = 'anonymous';
    let duration = 0, start = s0, end = e0, cover = null, busyTrim = false;

    // ---------- Layout ----------
    const cancelBtn = h('button', { type: 'button', class: 'ed-round', 'aria-label': 'Cancel' }, '✕');
    const doneBtn = h('button', { type: 'button', class: 'ed-round ed-done', 'aria-label': withCover ? 'Done' : 'Next' }, '✓');
    const title = h('div', { class: 'ed-title' }, withCover ? (trim ? 'Edit video' : 'Cover image') : 'Trim video');
    const playBtn = h('button', { type: 'button', class: 'ed-play', 'aria-label': 'Play or pause' }, icon('play'));
    const stage = h('div', { class: 'ed-stage' }, video, playBtn);

    const range = h('div', { class: 'ed-range' });
    const head = h('div', { class: 'ed-head' });
    const hStart = h('div', { class: 'ed-handle start', role: 'slider', 'aria-label': 'Start of the clip', tabindex: '0' });
    const hEnd = h('div', { class: 'ed-handle end', role: 'slider', 'aria-label': 'End of the clip', tabindex: '0' });
    const track = h('div', { class: 'ed-track' }, range, head, hStart, hEnd);
    const trimInfo = h('div', { class: 'ed-info' });
    const sizeWarn = h('p', { class: 'ed-warn', hidden: true });
    const trimBox = trim ? h('section', { class: 'ed-section' }, h('div', { class: 'ed-label' }, 'Trim'), track, trimInfo, sizeWarn) : null;

    const coverThumb = h('div', { class: 'ed-cover-thumb' }, h('span', null, 'Auto'));
    const useFrame = h('button', { type: 'button', class: 'btn secondary small' }, 'Choose from video');
    const photoIn = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'ed_photo' });
    const photoBtn = h('label', { for: 'ed_photo', class: 'btn secondary small', role: 'button', tabindex: '0' }, 'Upload photo');
    const coverBox = h('section', { class: 'ed-section' },
      h('div', { class: 'ed-label' }, 'Cover'),
      h('div', { class: 'row', style: { gap: '.75rem', flexWrap: 'nowrap' } }, coverThumb,
        h('div', { class: 'stack', style: { flex: 1 } },
          h('p', { class: 'ed-hint' }, 'Pick a moment from the video, or upload a photo. Then place the frame: that part shows on your profile. If you skip this, a random frame is used.'),
          h('div', { class: 'row' }, useFrame, photoIn, photoBtn))));

    const progress = h('div', { class: 'ed-progress', hidden: true }, h('div', { class: 'spinner' }), h('p'));
    const el = h('div', { class: 'ed', role: 'dialog', 'aria-label': title.textContent },
      h('div', { class: 'ed-top' }, cancelBtn, title, doneBtn),
      h('div', { class: 'ed-body' }, stage, trimBox, withCover ? coverBox : null),
      progress);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.append(el);

    const finish = (result) => {
      video.pause();
      document.body.style.overflow = prevOverflow;
      el.remove();
      if (isFile) URL.revokeObjectURL(src);
      resolve(result);
    };

    // ---------- Playback ----------
    const syncPlay = () => clear(playBtn).append(icon(video.paused ? 'play' : 'pause'));
    playBtn.onclick = () => { if (video.paused) { if (video.currentTime >= end - 0.05) video.currentTime = start; video.play().catch(() => {}); } else video.pause(); };
    video.addEventListener('play', syncPlay);
    video.addEventListener('pause', syncPlay);
    video.addEventListener('timeupdate', () => {
      if (trim && end && video.currentTime >= end) { video.pause(); video.currentTime = end; }
      drawTrack();
    });
    video.addEventListener('loadedmetadata', async () => {
      duration = await knownDuration(video);
      if (end === null || end > duration) end = duration;
      start = Math.min(start, Math.max(0, end - MIN_CLIP));
      video.currentTime = start;
      drawTrack();
    }, { once: true });
    video.addEventListener('error', () => toast('This video can\'t be previewed in this browser.', 'err'));

    // ---------- Trim ----------
    function drawTrack() {
      if (!trim || !duration) return;
      const pct = (t) => `${(t / duration) * 100}%`;
      hStart.style.left = pct(start);
      hEnd.style.left = pct(end);
      range.style.left = pct(start);
      range.style.width = pct(end - start);
      head.style.left = pct(video.currentTime);
      trimInfo.textContent = `${clock(start)} to ${clock(end)} · ${(end - start).toFixed(1)}s of ${clock(duration)}`;
      const tooBig = isFile && source.size > MAX_MB * 1048576;
      sizeWarn.hidden = !tooBig;
      if (tooBig) sizeWarn.textContent = `This video is ${sizeMB(source.size)}MB. Keep only the part you need: it'll be made smaller to fit the ${MAX_MB}MB limit.`;
    }
    function dragHandle(handle, which) {
      handle.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(handle, e); video.pause(); handle.dragging = true; });
      handle.addEventListener('pointermove', (e) => {
        if (!handle.dragging || !duration) return;
        const r = track.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
        if (which === 'start') start = Math.min(t, end - MIN_CLIP); else end = Math.max(t, start + MIN_CLIP);
        start = Math.max(0, start); end = Math.min(duration, end);
        video.currentTime = which === 'start' ? start : end;
        drawTrack();
      });
      const up = () => { handle.dragging = false; };
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    }
    if (trim) {
      dragHandle(hStart, 'start');
      dragHandle(hEnd, 'end');
      track.addEventListener('pointerdown', (e) => {          // tap the bar to move the playhead
        if (e.target !== track && e.target !== range) return;
        const r = track.getBoundingClientRect();
        video.currentTime = Math.max(start, Math.min(end, ((e.clientX - r.left) / r.width) * duration));
      });
    }

    // ---------- Cover ----------
    const showCover = (blob) => {
      cover = blob;
      clear(coverThumb).append(h('img', { src: URL.createObjectURL(blob), alt: 'Cover' }));
    };
    useFrame.onclick = async () => {
      video.pause();
      const cropped = await coverFromVideo(src, { at: video.currentTime, crossOrigin: !isFile });
      if (cropped) showCover(cropped);
    };
    photoIn.addEventListener('change', async () => {
      const f = photoIn.files[0];
      photoIn.value = '';
      if (!f) return;
      const cropped = await cropImage(f);
      if (cropped) showCover(cropped);
    });

    // ---------- Done / cancel ----------
    cancelBtn.onclick = () => finish(null);
    doneBtn.onclick = async () => {
      if (busyTrim) return;
      video.pause();
      if (!duration && trim) return toast('The video is still loading. Try again in a moment.', 'err');
      const trimmed = trim && (start > EDGE || end < duration - EDGE);
      const tooBig = isFile && source.size > MAX_MB * 1048576;
      let out = isFile ? source : null;
      if (isFile && (trimmed || tooBig)) {
        busyTrim = true;
        const label = progress.querySelector('p');
        label.textContent = 'Preparing your clip... 0%';
        progress.hidden = false;
        try {
          out = await recordClip(source, start, end, (p) => { label.textContent = `Preparing your clip... ${Math.round(p * 100)}%`; });
        } catch (e) {
          console.error(e);
          progress.hidden = true; busyTrim = false;
          return toast('This browser couldn\'t cut the video. Trim it in your phone\'s gallery and choose it again.', 'err');
        }
        progress.hidden = true; busyTrim = false;
        if (out.size > MAX_MB * 1048576) {
          return toast(`The clip is still ${sizeMB(out.size)}MB. Keep a shorter part (the limit is ${MAX_MB}MB).`, 'err');
        }
      }
      let c = cover;
      if (!c) {   // no cover chosen: a random frame from the clip, cropped from the middle
        const t = start + (end - start || duration) * (0.15 + Math.random() * 0.7);
        video.currentTime = t;
        await Promise.race([once(video, 'seeked'), new Promise((r) => setTimeout(r, 2000))]);
        const frame = await frameBlob(video);
        c = frame ? await centerCrop(frame) : null;
      }
      finish({ file: out, cover: c, auto: !cover, start, end });
    };
  });
}

// ---------- Cover on the upload page ----------
// "Choose from video" opens the clip with a filmstrip to pick the moment; "Upload photo" takes a picture instead.
// Both end in the framing step (3:4, like the profile tile).
// cover: the current cover Blob (a random frame until the user picks one). onChange(blob) after each pick.
export function coverChooser(file, { cover = null, onChange } = {}) {
  const url = URL.createObjectURL(file);
  const thumb = h('div', { class: 'cover-thumb' });
  const show = (blob) => clear(thumb).append(blob ? h('img', { src: URL.createObjectURL(blob), alt: 'Cover' }) : h('span', null, 'Auto'));
  const picked = (blob) => { if (!blob) return; show(blob); onChange && onChange(blob); };
  const fromVideo = h('button', { type: 'button', class: 'btn secondary small' }, 'Choose from video');
  fromVideo.onclick = async () => picked(await coverFromVideo(url));
  const photoIn = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'cover_photo' });
  photoIn.addEventListener('change', async () => { const f = photoIn.files[0]; photoIn.value = ''; if (f) picked(await cropImage(f)); });
  show(cover);
  return h('div', { class: 'cover-chooser' },
    h('div', { class: 'row', style: { gap: '.75rem', flexWrap: 'nowrap', alignItems: 'flex-start' } }, thumb,
      h('div', { class: 'stack', style: { flex: 1 } },
        h('p', { class: 'hint', style: { margin: 0 } }, 'This shows on your profile and in the feed. Pick a moment from the video, or upload a photo. If you skip this, a random frame is used.'),
        h('div', { class: 'row' }, fromVideo, photoIn,
          h('label', { for: 'cover_photo', class: 'btn secondary small', role: 'button', tabindex: '0' }, 'Upload photo')))));
}

// ---------- Frames and cropping ----------
async function frameBlob(v) {
  if (!v.videoWidth) return null;
  const c = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
  try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return await canvasBlob(c, 0.92); }
  catch { return null; }     // a link without CORS cannot be read
}
function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('BAD_IMAGE'));
    img.src = URL.createObjectURL(blob);
  });
}
async function cropTo(img, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = Math.min(COVER_MAX_W, Math.round(sw)); c.height = Math.round(c.width / COVER_RATIO);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return canvasBlob(c);
}
async function centerCrop(blob) {
  const img = await loadImg(blob);
  const W = img.naturalWidth, H = img.naturalHeight;
  const sw = Math.min(W, H * COVER_RATIO), sh = sw / COVER_RATIO;
  return cropTo(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
}

// A photo: frame it (3:4).
async function cropImage(blob) {
  let img;
  try { img = await loadImg(blob); } catch { toast('This image couldn\'t be read. Try a JPEG or PNG.', 'err'); return null; }
  const pic = h('img', { src: img.src, alt: '', class: 'crop-img', draggable: false });
  return framer({ media: pic, source: img, W: img.naturalWidth, H: img.naturalHeight });
}

// A frame from the video: the filmstrip under the picture runs over the whole clip; drag along it to pick
// the moment, then drag and size the frame. at: where to start (seconds).
export async function coverFromVideo(src, { at = 0, crossOrigin = false } = {}) {
  const make = () => {
    const v = h('video', { src, muted: true, playsInline: true, preload: 'auto', class: 'crop-img' });
    v.setAttribute('playsinline', '');
    if (crossOrigin) v.crossOrigin = 'anonymous';
    return v;
  };
  const video = make();
  await once(video, 'loadedmetadata');
  const duration = await knownDuration(video);
  video.currentTime = Math.min(at, duration);
  await Promise.race([once(video, 'seeked'), new Promise((r) => setTimeout(r, 1500))]);

  const thumbs = h('div', { class: 'strip-thumbs' });
  const headEl = h('div', { class: 'strip-head' });
  const strip = h('div', { class: 'strip', role: 'slider', 'aria-label': 'Moment in the video', tabindex: '0' }, thumbs, headEl);
  const timeEl = h('span', { class: 'ed-hint', style: { color: '#fff' } });
  const showHead = () => {
    const f = duration ? video.currentTime / duration : 0;
    headEl.style.left = `calc(${f * 100}% - ${f * 36}px)`;   // the head (36px wide) stays inside the strip
    timeEl.textContent = `${clock(video.currentTime)} / ${clock(duration)}`;
    strip.setAttribute('aria-valuetext', timeEl.textContent);
  };
  const seek = (e) => {
    const r = strip.getBoundingClientRect();
    if (!duration) return;
    video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
    showHead();
  };
  strip.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(strip, e); seek(e); strip.dragging = true; });
  strip.addEventListener('pointermove', (e) => { if (strip.dragging) seek(e); });
  for (const ev of ['pointerup', 'pointercancel']) strip.addEventListener(ev, () => { strip.dragging = false; });
  strip.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -0.1, ArrowRight: 0.1 }[e.key];
    if (d) { video.currentTime = Math.max(0, Math.min(duration, video.currentTime + d)); showHead(); }
  });
  showHead();
  fillStrip(make(), duration, thumbs);

  return framer({
    media: video, source: video, W: video.videoWidth, H: video.videoHeight,
    hint: 'Drag along the strip to pick the moment, then drag the frame to choose what shows on your profile.',
    extra: h('div', { class: 'stack' }, strip, timeEl),
  });
}

// Small pictures across the whole clip, drawn one after another from a second copy of the video.
async function fillStrip(v, duration, box) {
  const N = 8;
  try {
    await once(v, 'loadedmetadata');
    for (let i = 0; i < N && box.isConnected !== false; i++) {
      v.currentTime = ((i + 0.5) / N) * duration;
      await Promise.race([once(v, 'seeked'), new Promise((r) => setTimeout(r, 1500))]);
      const c = document.createElement('canvas');
      c.height = 64; c.width = Math.round((64 * v.videoWidth) / v.videoHeight) || 48;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      box.append(c);
    }
  } catch {}
  v.removeAttribute('src'); v.load();
}

// Instagram-style framing over a photo or a video: drag the frame (and resize it with the slider) over the picture.
function framer({ media, source, W, H, hint = 'Drag the frame to choose what shows on your profile.', extra = null }) {
  return new Promise((resolve) => {
    const frame = h('div', { class: 'crop-frame', 'aria-label': 'Part shown on your profile' });
    const area = h('div', { class: 'crop-area' }, media, frame);
    const zoom = h('input', { type: 'range', min: 0.35, max: 1, step: 0.01, value: 1, 'aria-label': 'Frame size' });
    const cancel = h('button', { type: 'button', class: 'btn secondary' }, 'Cancel');
    const use = h('button', { type: 'button', class: 'btn' }, 'Use');
    const sheet = h('div', { class: 'crop', role: 'dialog', 'aria-label': 'Frame the cover' },
      h('p', { class: 'ed-hint', style: { color: '#fff', textAlign: 'center' } }, hint),
      area,
      extra,
      h('label', { class: 'ed-hint', style: { color: '#fff' } }, 'Frame size', zoom),
      h('div', { class: 'btn-row' }, cancel, use));
    document.body.append(sheet);

    // Frame position in picture pixels (fx, fy, fw); the box on screen is derived from it.
    const maxW = Math.min(W, H * COVER_RATIO);
    let fw = maxW, fx = (W - fw) / 2, fy = (H - fw / COVER_RATIO) / 2;
    const clamp = () => {
      const fh = fw / COVER_RATIO;
      fx = Math.max(0, Math.min(W - fw, fx)); fy = Math.max(0, Math.min(H - fh, fy));
    };
    const draw = () => {
      const r = area.getBoundingClientRect();
      const b = contentBox(r.width, r.height, W, H);
      const k = b.w / W;
      Object.assign(frame.style, { left: `${b.x + fx * k}px`, top: `${b.y + fy * k}px`, width: `${fw * k}px`, height: `${(fw / COVER_RATIO) * k}px` });
      return k;
    };
    const watch = new ResizeObserver(() => draw());   // place the frame once the area has its size
    watch.observe(area);
    let drag = null;
    frame.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(frame, e); drag = { x: e.clientX, y: e.clientY, fx, fy, k: draw() }; });
    frame.addEventListener('pointermove', (e) => {
      if (!drag) return;
      fx = drag.fx + (e.clientX - drag.x) / drag.k; fy = drag.fy + (e.clientY - drag.y) / drag.k;
      clamp(); draw();
    });
    const stop = () => { drag = null; };
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('pointercancel', stop);
    zoom.addEventListener('input', () => {
      const cx = fx + fw / 2, cy = fy + fw / COVER_RATIO / 2;
      fw = maxW * Number(zoom.value);
      fx = cx - fw / 2; fy = cy - fw / COVER_RATIO / 2;
      clamp(); draw();
    });
    const close = (v) => {
      watch.disconnect(); sheet.remove();
      if (media.tagName === 'VIDEO') { media.removeAttribute('src'); media.load(); }
      resolve(v);
    };
    cancel.onclick = () => close(null);
    use.onclick = async () => {
      let blob = null;
      try { blob = await cropTo(source, fx, fy, fw, fw / COVER_RATIO); } catch {}
      if (!blob) return toast('Couldn\'t read this frame. Try another moment or upload a photo.', 'err');
      close(blob);
    };
  });
}

// ---------- Cutting the clip ----------
// Plays the chosen part once into a canvas + audio stream and records it. Takes as long as the clip.
function recordClip(file, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return reject(new Error('NO_RECORDER'));
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.src = url; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
    // Audio goes into the recording only, not to the speakers.
    let ac = null, dest = null;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest);
      ac.resume();
    } catch { ac = null; dest = null; v.muted = true; }
    const cleanup = () => { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); ac && ac.close().catch(() => {}); };
    // iPhone: a video may only start playing from a tap. Start it now (inside the Done tap) so the
    // later play() after seeking is allowed; the sound goes only into the recording.
    const unlocked = v.play().then(() => v.pause()).catch(() => {});

    v.addEventListener('error', () => { cleanup(); reject(new Error('VIDEO_UNREADABLE')); }, { once: true });
    v.addEventListener('loadedmetadata', async () => {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round((v.videoWidth * scale) / 2) * 2; c.height = Math.round((v.videoHeight * scale) / 2) * 2;
      const ctx = c.getContext('2d');
      const stream = c.captureStream(30);
      dest?.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const mime = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
      let rec;
      try { rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 }); }
      catch (e) { cleanup(); return reject(e); }
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        cleanup();
        const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
        resolve(new File(chunks, 'clip.' + (type.includes('mp4') ? 'mp4' : 'webm'), { type }));
      };
      await unlocked;
      v.currentTime = start;
      await once(v, 'seeked');
      ctx.drawImage(v, 0, 0, c.width, c.height);
      try { await v.play(); } catch (e) { cleanup(); return reject(e); }
      rec.start(500);                     // start once playback runs, so the clip begins at `start`
      const tick = () => {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        onProgress && onProgress(Math.min(1, (v.currentTime - start) / Math.max(0.1, end - start)));
        if (v.currentTime >= end || v.ended) { v.pause(); if (rec.state !== 'inactive') rec.stop(); return; }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
      };
      tick();
    }, { once: true });
    v.load();
  });
}
