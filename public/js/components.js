// Reusable components: protected video player with analysis tools, media items, recorder.
import { h, clear, friendlyError, icon, fmtSize, toast, filePicker } from './ui.js';
import { mediaUrl, uploadFile, LIMITS, fileType } from './api.js';

/**
 * Video player for a protected file.
 * opts.tools: show speed / replay / step controls (coach analysis view).
 * opts.lazy: show a "watch" button first (saves data in the feed).
 */
export function protectedVideo(kind, id, opts = {}) {
  const wrap = h('div', { class: 'player' });
  const start = async () => {
    clear(wrap).append(h('div', { class: 'player-placeholder' }, h('div', { class: 'spinner' }), 'טוען סרטון…'));
    try {
      const url = await mediaUrl(kind, id);
      const v = h('video', { src: url, controls: true, playsInline: true, preload: 'metadata' });
      v.setAttribute('playsinline', '');
      v.addEventListener('error', () => {
        clear(wrap).append(h('div', { class: 'player-placeholder' },
          'לא ניתן לנגן את הסרטון בדפדפן הזה (ייתכן שהפורמט אינו נתמך).',
          h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'פתיחה בחלון חדש')));
      });
      clear(wrap).append(v);
      if (opts.tools) wrap.append(playerTools(v));
      if (opts.autoplay) v.play().catch(() => {});
    } catch (e) {
      clear(wrap).append(h('div', { class: 'player-placeholder' }, friendlyError(e),
        h('button', { class: 'btn small', onclick: start }, 'ניסיון חוזר')));
    }
  };
  if (opts.lazy) {
    wrap.append(h('div', { class: 'player-placeholder' },
      h('button', { class: 'btn', onclick: () => { opts.autoplay = true; start(); } }, icon('play'), 'צפייה בסרטון')));
  } else start();
  return wrap;
}

function playerTools(v) {
  const speeds = [[1, 'מהירות רגילה'], [0.5, 'חצי מהירות'], [0.25, 'רבע מהירות']];
  const speedBtns = speeds.map(([s, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(s === 1), onclick: () => {
      v.playbackRate = s;
      speedBtns.forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
    } }, label);
    return b;
  });
  const step = (d) => { v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  return h('div', { class: 'player-bar', role: 'group', 'aria-label': 'כלי צפייה' },
    h('button', { type: 'button', onclick: () => (v.paused ? v.play() : v.pause()) }, 'ניגון / עצירה'),
    h('button', { type: 'button', onclick: () => { v.currentTime = 0; v.play(); } }, 'צפייה חוזרת'),
    h('button', { type: 'button', onclick: () => step(-0.1), title: 'אחורה 0.1 שניות' }, 'אחורה 0.1 שנ׳'),
    h('button', { type: 'button', onclick: () => step(0.1), title: 'קדימה 0.1 שניות' }, 'קדימה 0.1 שנ׳'),
    ...speedBtns);
}

// One analysis item (text / audio / video)
export function analysisItem(item) {
  if (item.kind === 'text') return h('div', { class: 'card' }, h('div', { class: 'label' }, 'טקסט'), h('div', { class: 'pre' }, item.body));
  const box = h('div', { class: 'card' }, h('div', { class: 'label' }, item.kind === 'audio' ? 'הקלטת קול' : 'הקלטת וידאו'));
  const slot = h('div', null, h('button', { class: 'btn secondary small', onclick: load }, item.kind === 'audio' ? 'האזנה' : 'צפייה'));
  async function load() {
    clear(slot).append(h('span', { class: 'spinner sm' }));
    try {
      const url = await mediaUrl('item', item.id);
      const el = item.kind === 'audio'
        ? h('audio', { src: url, controls: true, style: { width: '100%' } })
        : h('video', { src: url, controls: true, playsInline: true, style: { width: '100%', maxHeight: '60vh', background: '#000', borderRadius: '8px' } });
      clear(slot).append(el);
      el.play().catch(() => {});
    } catch (e) {
      clear(slot).append(h('p', { class: 'error-text' }, friendlyError(e)), h('button', { class: 'btn secondary small', onclick: load }, 'ניסיון חוזר'));
    }
  }
  box.append(slot);
  return box;
}

/**
 * Recorder for coach responses: records audio or video in the browser,
 * or falls back to uploading a ready file. Calls onSaved({key, contentType}) after upload.
 */
export function recorder(kind, onSaved) {
  const purpose = kind === 'audio' ? 'responseAudio' : 'responseVideo';
  const maxMB = kind === 'audio' ? LIMITS.responseAudioMaxMB : LIMITS.responseVideoMaxMB;
  const allowed = kind === 'audio' ? LIMITS.audioTypes : LIMITS.videoTypes;
  const box = h('div', { class: 'rec stack' });
  const supported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  let stream = null, rec = null, chunks = [], timer = null;

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
      h('div', { class: 'label' }, kind === 'audio' ? 'הקלטת קול' : 'הקלטת וידאו'),
      msg && h('p', { class: 'error-text', role: 'alert' }, msg),
      supported
        ? h('button', { class: 'btn', type: 'button', onclick: startRec }, kind === 'audio' ? 'התחלת הקלטת קול' : 'התחלת הקלטת וידאו')
        : h('p', { class: 'muted' }, 'הקלטה בדפדפן אינה זמינה במכשיר הזה. אפשר להעלות קובץ מוכן.'),
      fileFallback());
  }

  function fileFallback() {
    const picker = filePicker({ id: 'rec_file_' + kind, accept: kind === 'audio' ? 'audio/*' : 'video/*', label: kind === 'audio' ? 'בחירת קובץ קול' : 'בחירת קובץ וידאו', onChange: (f) => {
      if (!f) return;
      const t = fileType(f);
      if (!allowed.includes(t)) return idle('סוג הקובץ אינו נתמך.');
      if (f.size > maxMB * 1048576) return idle(`הקובץ גדול מ־${maxMB}MB.`);
      upload(f);
    } });
    return h('div', null, h('div', { class: 'small', style: { fontWeight: 600, marginBottom: '.3rem' } }, 'או העלאת קובץ ' + (kind === 'audio' ? 'קול' : 'וידאו') + ` מוכן (עד ${maxMB}MB)`), picker);
  }

  async function startRec() {
    try {
      stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { audio: true, video: { facingMode: 'user' } });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      return idle(denied
        ? 'הגישה ל' + (kind === 'audio' ? 'מיקרופון' : 'מצלמה ולמיקרופון') + ' נחסמה. אפשר לאשר אותה בהגדרות הדפדפן, או להעלות קובץ מוכן.'
        : 'לא נמצא ' + (kind === 'audio' ? 'מיקרופון' : 'מצלמה') + ' זמין. אפשר להעלות קובץ מוכן.');
    }
    const mime = pickMime();
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { return idle('לא ניתן להקליט במכשיר הזה. אפשר להעלות קובץ מוכן.'); }
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const type = (rec.mimeType || mime || (kind === 'audio' ? 'audio/webm' : 'video/webm')).split(';')[0];
      const blob = new Blob(chunks, { type });
      stopStream(); clearInterval(timer);
      review(blob, type);
    };
    rec.start(1000);
    let sec = 0;
    const clock = h('span', null, '0:00');
    timer = setInterval(() => { sec++; clock.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }, 1000);
    const live = kind === 'video' ? h('video', { muted: true, playsInline: true, autoplay: true }) : null;
    if (live) { live.srcObject = stream; live.muted = true; }
    clear(box).append(
      h('div', { class: 'row' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), h('strong', null, 'מקליט… '), clock),
      live,
      h('button', { class: 'btn', type: 'button', onclick: () => rec.state !== 'inactive' && rec.stop() }, 'עצירת הקלטה'));
  }

  function review(blob, type) {
    const url = URL.createObjectURL(blob);
    const media = kind === 'audio' ? h('audio', { src: url, controls: true, style: { width: '100%' } }) : h('video', { src: url, controls: true, playsInline: true });
    const tooBig = blob.size > maxMB * 1048576;
    clear(box).append(
      h('div', { class: 'label' }, 'בדיקת ההקלטה (' + fmtSize(blob.size) + ')'),
      media,
      tooBig && h('p', { class: 'error-text' }, `ההקלטה גדולה מ־${maxMB}MB. הקליטו הקלטה קצרה יותר.`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', disabled: tooBig, onclick: () => {
          const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
          upload(new File([blob], 'recording.' + ext, { type: allowed.includes(type) ? type : (kind === 'audio' ? 'audio/webm' : 'video/webm') }));
        } }, 'שמירת ההקלטה'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => { URL.revokeObjectURL(url); idle(); } }, 'מחיקה והקלטה מחדש')));
  }

  async function upload(file) {
    const bar = h('div');
    const prog = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
    const label = h('p', null, 'מעלה… 0%');
    clear(box).append(label, prog);
    try {
      const res = await uploadFile(file, purpose, (p) => {
        bar.style.width = Math.round(p * 100) + '%';
        prog.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        label.textContent = 'מעלה… ' + Math.round(p * 100) + '%';
      });
      await onSaved(res);
      idle();
      toast(kind === 'audio' ? 'הקלטת הקול נשמרה בטיוטה' : 'הקלטת הווידאו נשמרה בטיוטה');
    } catch (e) {
      clear(box).append(h('p', { class: 'error-text', role: 'alert' }, 'ההעלאה נכשלה: ' + friendlyError(e)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => upload(file) }, 'ניסיון חוזר'),
          h('button', { class: 'btn secondary', type: 'button', onclick: () => idle() }, 'ביטול')));
    }
  }

  idle();
  box.cleanup = () => { stopStream(); clearInterval(timer); };
  return box;
}
