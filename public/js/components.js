// Reusable components: protected video player with analysis tools, media items, recorder.
import { h, clear, friendlyError, icon, toast, filePicker, confirmDanger } from './ui.js';
import { mediaUrl, coverUrl, uploadFile, discardUpload, LIMITS, fileType, sizeMB, LANGUAGES, languageNames } from './api.js';
import { coverImg } from './images.js';
import { drawingsReview } from './viewer.js';

/**
 * Video player for a protected file.
 * opts.lazy: load and play when scrolled into view, muted and looping (the feed).
 * opts.autoplay: play as soon as it opens.
 * opts.cover: cover key; shown as the poster until the video plays.
 */
export function protectedVideo(kind, id, opts = {}) {
  const wrap = h('div', { class: 'player' });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;   // these viewers keep the Watch button
  const auto = (opts.lazy || opts.autoplay) && !still;
  let inView = false;
  const start = async () => {
    // A cover already on screen stays until the video is ready, so the feed doesn't flash.
    if (!auto || !opts.cover || !opts.lazy) clear(wrap).append(h('div', { class: 'player-placeholder' }, h('div', { class: 'spinner' }), 'Loading video…'));
    try {
      const url = await mediaUrl(kind, id);
      const v = h('video', { src: url, controls: true, playsInline: true, preload: 'metadata' });
      if (opts.cover) coverUrl(opts.cover).then((u) => { if (u) v.poster = u; });
      v.setAttribute('playsinline', '');
      v.addEventListener('error', () => {
        clear(wrap).append(h('div', { class: 'player-placeholder' },
          'This video cannot play in this browser (the format may not be supported).',
          h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open in a new window')));
      });
      clear(wrap).append(v);
      if (opts.lazy) {
        // Browsers block sound until a tap, so the feed plays muted; the video's own controls turn it on.
        v.muted = true;
        v.loop = true;
        if (auto ? inView : opts.autoplay) playOnly(v);
      } else if (opts.autoplay && !still) {
        // Reached by a tap, so sound is usually allowed; muted if the browser says no.
        v.play().catch(() => { v.muted = true; return v.play(); }).catch(() => {});
      }
    } catch (e) {
      if (e.message === 'FILE_REMOVED') {
        return clear(wrap).append(h('div', { class: 'player-placeholder' }, REMOVED_TEXT));
      }
      clear(wrap).append(h('div', { class: 'player-placeholder' }, friendlyError(e),
        h('button', { class: 'btn small', onclick: start }, 'Try again')));
    }
  };
  if (opts.lazy) {
    wrap.append(h('div', { class: 'player-placeholder' + (opts.cover ? ' has-cover' : '') },
      opts.cover && coverImg(coverUrl(opts.cover)),
      still && h('button', { class: 'btn', onclick: () => { opts.autoplay = true; start(); } }, icon('play'), 'Watch video')));
    if (auto) {
      new IntersectionObserver(([e]) => {
        inView = e.isIntersecting;
        const v = wrap.querySelector('video');
        if (!inView) v?.pause();
        else if (v) playOnly(v);
        else start();
      }, { threshold: 0.6 }).observe(wrap);
    }
  } else start();
  return wrap;
}

// Only one feed video plays at a time.
let playing = null;
function playOnly(v) {
  if (playing && playing !== v) playing.pause();
  playing = v;
  v.play().catch(() => {});
}

export const REMOVED_TEXT = 'This video was removed automatically to free up storage. The analysis text and messages were kept.';

// One analysis item (text / audio / video)
export function analysisItem(item, videoId) {
  if (item.kind === 'drawing') return drawingsReview(item, videoId) || h('div');
  if (item.kind === 'text') return h('div', { class: 'card' }, h('div', { class: 'label' }, 'Text'), h('div', { class: 'pre' }, item.body));
  const box = h('div', { class: 'card' }, h('div', { class: 'label' }, item.kind === 'audio' ? 'Voice recording' : 'Video recording'));
  if (item.file_deleted_at) { box.append(h('p', { class: 'muted' }, 'This recording was removed automatically to free up storage.')); return box; }
  const slot = h('div', null, h('button', { class: 'btn secondary small', onclick: load }, item.kind === 'audio' ? 'Listen' : 'Watch'));
  async function load() {
    clear(slot).append(h('span', { class: 'spinner sm' }));
    try {
      const url = await mediaUrl('item', item.id);
      const el = item.kind === 'audio'
        ? h('audio', { src: url, controls: true, style: { width: '100%' } })
        : h('video', { src: url, controls: true, playsInline: true, style: { width: '100%', maxHeight: '60vh', background: '#000', borderRadius: 'var(--radius)' } });
      clear(slot).append(el);
      el.play().catch(() => {});
    } catch (e) {
      clear(slot).append(h('p', { class: 'error-text' }, friendlyError(e)), h('button', { class: 'btn secondary small', onclick: load }, 'Try again'));
    }
  }
  box.append(slot);
  return box;
}

/**
 * Recorder for coach responses: records audio or video in the browser,
 * or falls back to uploading a ready file. There is no save step: once recorded or chosen, the clip is uploaded
 * and attached to the analysis (onSaved({key, contentType}) returns the new item). It stays attached until the
 * coach presses Delete (onRemove(item)), which brings back the record / upload controls.
 * opts.item: a clip already attached (an open draft).
 */
export function recorder(kind, { onSaved, onRemove, item = null } = {}) {
  const purpose = kind === 'audio' ? 'responseAudio' : 'responseVideo';
  const maxMB = kind === 'audio' ? LIMITS.responseAudioMaxMB : LIMITS.responseVideoMaxMB;
  const allowed = kind === 'audio' ? LIMITS.audioTypes : LIMITS.videoTypes;
  // Keep recordings under the 50MB file limit: modest bitrate + automatic stop.
  const MAX_SEC = kind === 'audio' ? 15 * 60 : 5 * 60;
  const BITRATE = kind === 'audio' ? { audioBitsPerSecond: 64000 } : { videoBitsPerSecond: 1000000, audioBitsPerSecond: 64000 };
  const fmtTime = (t) => Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  const box = h('div', { class: 'rec stack' });
  const supported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  let stream = null, rec = null, chunks = [], timer = null, localUrl = null;
  const dropLocal = () => { if (localUrl) URL.revokeObjectURL(localUrl); localUrl = null; };

  const stopStream = () => { stream && stream.getTracks().forEach((t) => t.stop()); stream = null; };

  function pickMime() {
    const opts = kind === 'audio'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    return opts.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  }

  function idle(msg) {
    stopStream();
    clear(box).append(
      h('div', { class: 'label' }, kind === 'audio' ? 'Voice recording' : 'Video recording'),
      msg && h('p', { class: 'error-text', role: 'alert' }, msg),
      supported
        ? [h('button', { class: 'btn', type: 'button', onclick: startRec }, kind === 'audio' ? 'Start voice recording' : 'Start video recording'),
           h('div', { class: 'hint' }, `Up to ${MAX_SEC / 60} minutes. Recording stops automatically at the limit.`)]
        : h('p', { class: 'muted' }, 'Recording in the browser is not available on this device. You can upload a ready file.'),
      fileFallback());
  }

  function fileFallback() {
    const picker = filePicker({ id: 'rec_file_' + kind, accept: kind === 'audio' ? 'audio/*' : 'video/*', label: kind === 'audio' ? 'Choose audio file' : 'Choose video file', onChange: (f) => {
      if (!f) return;
      const t = fileType(f);
      if (!allowed.includes(t)) return idle('This file type is not supported.');
      if (f.size > maxMB * 1048576) return idle(`The file is too large: ${sizeMB(f.size)}MB. The limit is ${maxMB}MB per file. Trim it or record here instead.`);
      upload(f);
    } });
    return h('div', null, h('div', { class: 'small', style: { fontWeight: 600, marginBottom: 'var(--space-1)' } }, 'Or upload a ready ' + (kind === 'audio' ? 'audio' : 'video') + ` file (up to ${maxMB}MB)`), picker);
  }

  async function startRec() {
    try {
      stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { audio: true, video: { facingMode: 'user' } });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      return idle(denied
        ? 'Access to the ' + (kind === 'audio' ? 'microphone' : 'camera and microphone') + ' was blocked. Allow it in the browser settings, or upload a ready file.'
        : 'No ' + (kind === 'audio' ? 'microphone' : 'camera') + ' found. You can upload a ready file.');
    }
    const mime = pickMime();
    try { rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), ...BITRATE }); }
    catch { return idle('Recording is not possible on this device. You can upload a ready file.'); }
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const type = (rec.mimeType || mime || (kind === 'audio' ? 'audio/webm' : 'video/webm')).split(';')[0];
      const blob = new Blob(chunks, { type });
      stopStream(); clearInterval(timer);
      if (blob.size > maxMB * 1048576) return idle(`The recording is too large: ${sizeMB(blob.size)}MB. The limit is ${maxMB}MB per file. Record a shorter one.`);
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      upload(new File([blob], 'recording.' + ext, { type: allowed.includes(type) ? type : (kind === 'audio' ? 'audio/webm' : 'video/webm') }));
    };
    rec.start(1000);
    let sec = 0;
    const clock = h('span', null, '0:00 / ' + fmtTime(MAX_SEC));
    timer = setInterval(() => {
      sec++;
      clock.textContent = fmtTime(sec) + ' / ' + fmtTime(MAX_SEC);
      if (sec >= MAX_SEC && rec.state !== 'inactive') { rec.stop(); toast(`Recording stopped automatically after ${MAX_SEC / 60} minutes.`); }
    }, 1000);
    const live = kind === 'video' ? h('video', { muted: true, playsInline: true, autoplay: true }) : null;
    if (live) { live.srcObject = stream; live.muted = true; }
    clear(box).append(
      h('div', { class: 'row' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), h('strong', null, 'Recording… '), clock),
      live,
      h('button', { class: 'btn', type: 'button', onclick: () => rec.state !== 'inactive' && rec.stop() }, 'Stop recording'));
  }

  // The clip is part of the analysis now and goes to the trainee with it.
  function attached(it) {
    const player = (url) => (kind === 'audio'
      ? h('audio', { src: url, controls: true, style: { width: '100%' } })
      : h('video', { src: url, controls: true, playsInline: true }));
    const slot = h('div');
    if (localUrl) slot.append(player(localUrl));
    else mediaUrl('item', it.id).then((u) => slot.append(player(u))).catch((e) => slot.append(h('p', { class: 'error-text' }, friendlyError(e))));
    const del = h('button', { class: 'btn danger', type: 'button' }, 'Delete');
    del.onclick = async () => {
      if (!(await confirmDanger(kind === 'audio' ? 'Delete this voice recording?' : 'Delete this video recording?',
        'It will be removed from the analysis. You can record or upload another one.', 'Delete'))) return;
      del.disabled = true;
      try { await onRemove(it); dropLocal(); idle(); toast('Recording deleted'); }
      catch (e) { del.disabled = false; toast(friendlyError(e), 'err'); }
    };
    clear(box).append(
      h('div', { class: 'row between' },
        h('div', { class: 'label' }, kind === 'audio' ? 'Voice recording' : 'Video recording'),
        h('span', { class: 'tag soft' }, 'Attached')),
      slot,
      h('div', { class: 'hint' }, 'It goes to the trainee with the analysis.'),
      h('div', { class: 'btn-row' }, del));
  }

  async function upload(file) {
    const bar = h('div');
    const prog = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
    const label = h('p', null, 'Uploading… 0%');
    clear(box).append(label, prog);
    try {
      const res = await uploadFile(file, purpose, (p) => {
        bar.style.width = Math.round(p * 100) + '%';
        prog.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        label.textContent = 'Uploading… ' + Math.round(p * 100) + '%';
      });
      let it;
      try { it = await onSaved(res); } catch (e) { discardUpload(res.key); throw e; }
      dropLocal();
      localUrl = URL.createObjectURL(file);
      attached(it);
      toast(kind === 'audio' ? 'Voice recording attached to the analysis' : 'Video recording attached to the analysis');
    } catch (e) {
      clear(box).append(h('p', { class: 'error-text', role: 'alert' }, 'Upload failed: ' + friendlyError(e)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => upload(file) }, 'Try again'),
          h('button', { class: 'btn secondary', type: 'button', onclick: () => idle() }, 'Cancel')));
    }
  }

  if (item) attached(item); else idle();
  box.cleanup = () => { stopStream(); clearInterval(timer); dropLocal(); };
  return box;
}

// Spoken languages: a chip per language. el.value() returns the picked codes.
export function languagePicker(selected = [], name = 'langs') {
  const el = h('div', { class: 'chips', role: 'group', 'aria-label': 'Languages I speak' },
    Object.entries(LANGUAGES).map(([code, label]) => h('label', { class: 'chip' },
      h('input', { type: 'checkbox', name, value: code, checked: selected.includes(code) }), label)));
  el.value = () => [...el.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  return el;
}

// One small line: "Speaks: English, Dutch"
export const languagesLine = (codes, label = 'Speaks') =>
  codes && codes.length ? h('p', { class: 'langs' }, `${label}: ${languageNames(codes)}`) : null;
