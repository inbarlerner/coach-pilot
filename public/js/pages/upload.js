// Upload a video: choose destination → form → upload with progress → (optional) send to coach.
import { h, clear, busy, friendlyError, successState, errorState, loading, POLICY, toast, filePicker, plural, fmtSize } from '../ui.js';
import { sb, state, q, activeSports, sportName, rpc, uploadFile, discardUpload, fileType, LIMITS, MAX_MB, sizeMB, isCoach } from '../api.js';
import { avatar } from '../images.js';
import { openVideoEditor } from '../video-editor.js';
import { languagesLine } from '../components.js';

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

export async function uploadPage({ main, setTitle, query }) {
  setTitle('Upload video');
  const welcome = query.get('welcome') === '1';
  const presetCoach = query.get('coach');

  if (welcome && state.profile && !state.profile.onboarded) {
    sb.from('profiles').update({ onboarded: true }).eq('id', state.user.id).then(() => { state.profile.onboarded = true; });
  }

  const s = { dest: presetCoach ? 'coach' : null, coachId: presetCoach || null, file: null, videoId: null, abort: null };

  const top = h('div');
  if (welcome) {
    top.append(h('div', { class: 'banner' },
      h('p', null, h('strong', null, 'Welcome! '), 'Start by uploading your first video.'),
      h('a', { class: 'btn secondary small', href: '#/home' }, 'Skip to home')));
  }
  const body = h('div');
  main.append(top, body);

  if (isCoach() && state.profile.coach_status === 'pending') {
    // pending coaches may still upload their own videos
  }

  // ---------- Step 1: destination ----------
  function stepDest() {
    clear(body).append(
      h('h1', null, 'Where is this video going?'),
      h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Video destination' },
        destChoice('profile', 'Post / save to my profile', 'No analysis request. You can choose private or public.'),
        h('label', { class: 'choice disabled', 'aria-disabled': 'true' },
          h('input', { type: 'radio', name: 'dest', disabled: true }),
          h('span', null, h('span', { class: 't' }, 'AI virtual coach ', h('span', { class: 'tag' }, 'Soon')),
            h('span', { class: 'd' }, 'Not available yet. You cannot send videos to it right now.'))),
        destChoice('coach', 'Human coach', 'An approved coach receives the video and sends an analysis.')),
      h('div', { style: { marginTop: '1rem' } },
        h('button', { class: 'btn block', onclick: () => { if (!s.dest) return toast('Choose where the video goes', 'err'); stepForm(); } }, 'Continue')));
  }
  function destChoice(v, t, d) {
    return h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'dest', value: v, checked: s.dest === v, onchange: () => { s.dest = v; } }),
      h('span', null, h('span', { class: 't' }, t), h('span', { class: 'd' }, d)));
  }

  // ---------- Step 2: form ----------
  async function stepForm() {
    const toCoach = s.dest === 'coach';
    const picker = filePicker({ id: 'u_file', accept: 'video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v', label: 'Choose video' });
    const fileIn = picker.input;
    const fileInfo = h('div', { class: 'hint' });
    const fileErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const sport = h('select', { id: 'u_sport' }, h('option', { value: '' }, 'Choose a sport…'),
      activeSports().map((sp) => h('option', { value: sp.id }, sp.name)));
    const title = h('input', { type: 'text', id: 'u_title', maxlength: 120, placeholder: 'e.g. Jibe to the left' });
    const desc = h('textarea', { id: 'u_desc', maxlength: 2000, placeholder: 'What\'s in the video, conditions, what you were trying to do' });
    const question = h('textarea', { id: 'u_q', maxlength: 2000, placeholder: 'What do you most want to know from the coach?' });
    const vis = { private: h('input', { type: 'radio', name: 'vis', value: 'private' }), public: h('input', { type: 'radio', name: 'vis', value: 'public', checked: true }) };
    const coachBox = h('div');
    let cover = null;            // cover Blob from the editor
    let edit = null;             // { original, start, end } so the clip can be edited again
    const err = h('div', { class: 'banner hidden', role: 'alert' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, toCoach ? 'Upload and send to coach' : 'Upload and save');

    // After choosing a video: the editor (trim + cover) opens; ✓ brings the clip back here.
    async function editClip(original, prev = {}) {
      const res = await openVideoEditor(original, prev);
      if (!res) return !!s.file;            // cancelled: keep what was there before
      s.file = res.file; cover = res.cover; edit = { original, start: res.start, end: res.end };
      const thumb = res.cover ? h('img', { src: URL.createObjectURL(res.cover), alt: 'Cover', class: 'clip-thumb' }) : null;
      clear(fileInfo).append(h('div', { class: 'row', style: { flexWrap: 'nowrap', marginTop: '.5rem' } }, thumb,
        h('div', null,
          h('div', null, h('strong', null, `Clip ${clock(res.end - res.start)}`), ` · ${fmtSize(res.file.size)}`),
          h('button', { type: 'button', class: 'btn secondary small', style: { marginTop: '.35rem' },
            onclick: () => editClip(edit.original, { start: edit.start, end: edit.end }) }, 'Edit clip and cover'))));
      return true;
    }
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileErr.classList.add('hidden');
      if (!f) return;
      const t = fileType(f);
      if (!LIMITS.videoTypes.includes(t)) { fileErr.textContent = `This format is not supported. You can upload ${LIMITS.videoFormats}.`; fileErr.classList.remove('hidden'); picker.reset(); return; }
      s.file = null; cover = null; edit = null; clear(fileInfo);
      if (!(await editClip(f))) picker.reset();
    });

    let coaches = [];
    async function loadCoaches() {
      if (!toCoach) return;
      clear(coachBox).append(loading('Loading coaches…'));
      try {
        coaches = await rpc('search_coaches', { p_query: '', p_sport: sport.value ? Number(sport.value) : null });
        coaches = coaches.filter((c) => c.id !== state.user.id);
        await addPeople(coaches);
        renderCoaches();
      } catch (e) {
        clear(coachBox).append(errorState(friendlyError(e), loadCoaches));
      }
    }
    function renderCoaches() {
      clear(coachBox);
      if (!sport.value) { coachBox.append(h('p', { class: 'muted' }, 'Choose a sport to see matching coaches.')); return; }
      if (!coaches.length) { coachBox.append(h('div', { class: 'state empty' }, h('p', null, 'There are no approved coaches in this sport yet.'), h('p', null, 'You can save the video to your profile and send it later.'))); return; }
      if (s.coachId && !coaches.some((c) => c.id === s.coachId)) s.coachId = null;
      coachBox.append(h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Choose a coach' },
        coaches.map((c) => {
          const full = !c.available;
          return h('label', { class: 'choice' + (full ? ' disabled' : '') },
            h('input', { type: 'radio', name: 'coach', value: c.id, disabled: full, checked: s.coachId === c.id && !full, onchange: () => { s.coachId = c.id; } }),
            avatar(c, 40),
            h('span', null,
              h('span', { class: 't' }, c.first_name + ' ' + c.last_name, ' ', c.is_sample && h('span', { class: 'tag' }, 'Sample'), ' ',
                full ? h('span', { class: 'tag fill' }, 'No free spot') : h('span', { class: 'tag soft' }, 'Available · ' + plural(c.quota - c.active_count, '1 spot', 'spots'))),
              h('span', { class: 'd' }, 'Sports: ' + c.sport_ids.map(sportName).join(', ')),
              languagesLine(c.languages),
              h('span', { class: 'd' }, `Response time: up to ${c.response_hours} hours`),
              h('span', { class: 'd' }, 'Follow-ups: ' + POLICY[c.followup_policy]),
              h('a', { class: 'small', href: '#/u/' + c.username, target: '_blank' }, 'Coach profile')));
        })));
    }
    sport.addEventListener('change', loadCoaches);

    const form = h('form', { novalidate: true },
      h('h1', null, toCoach ? 'Send a video for analysis' : 'Upload to profile'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: stepDest }, '← Change destination'),
      err,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Video file'), picker, fileInfo, fileErr,
        h('div', { class: 'banner', style: { marginTop: '.5rem', marginBottom: 0 } },
          h('strong', null, `Up to ${MAX_MB}MB per video`), ` · ${LIMITS.videoFormats}. `,
          'With normal phone recording that is usually under a minute. You can trim a longer video in your gallery before uploading.',
          h('br'), h('span', { class: 'small' }, 'When the pilot storage fills up, the oldest videos are removed automatically. Analysis text and messages are kept.'))),
      h('div', { class: 'field' }, h('label', { for: 'u_sport' }, 'Sport'), sport),
      h('div', { class: 'field' }, h('label', { for: 'u_title' }, 'Drill name'), title),
      h('div', { class: 'field' }, h('label', { for: 'u_desc' }, 'Description (optional)'), desc),
      toCoach && h('div', { class: 'field' }, h('label', { for: 'u_q' }, 'Question for the coach'), question),
      toCoach && h('div', { class: 'field' }, h('div', { class: 'label' }, 'Choose a coach'), coachBox),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Who can watch?'),
        h('div', { class: 'choices', role: 'radiogroup' },
          h('label', { class: 'choice' }, vis.public, h('span', null, h('span', { class: 't' }, 'Public (default)'),
            h('span', { class: 'd' }, 'The video and its analysis will be visible in the feed and on your and the coach\'s profiles'))),
          h('label', { class: 'choice' }, vis.private, h('span', null, h('span', { class: 't' }, 'Private'),
            h('span', { class: 'd' }, toCoach ? 'Only you and the coach you choose.' : 'Only you.'))))),
      btn);
    clear(body).append(form);
    if (toCoach) {
      renderCoaches();
      // If coming from a coach profile, preselect that coach's first sport
      if (presetCoach) {
        try {
          const cs = await sb.from('coach_sports').select('sport_id').eq('coach_id', presetCoach);
          const mine = (state.profile && cs.data) ? cs.data.map((x) => x.sport_id) : [];
          if (mine.length === 1) { sport.value = String(mine[0]); loadCoaches(); }
        } catch {}
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      const problems = [];
      if (!s.file) problems.push('Choose a video file.');
      if (!sport.value) problems.push('Choose a sport.');
      if (!title.value.trim()) problems.push('Enter the drill name.');
      if (toCoach && !s.coachId) problems.push('Choose an available coach.');
      if (problems.length) { err.textContent = problems.join(' '); err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' }); return; }
      const visibility = vis.public.checked ? 'public' : 'private';
      stepUpload({ sport: Number(sport.value), title: title.value.trim(), description: desc.value.trim(), question: question.value.trim(), visibility, toCoach, cover });
    });
  }

  // ---------- Step 3: upload ----------
  async function stepUpload(meta) {
    const bar = h('div');
    const pct = h('strong', null, '0%');
    const cancelBtn = h('button', { class: 'btn secondary', type: 'button' }, 'Cancel upload');
    clear(body).append(h('h1', null, 'Uploading video…'),
      h('p', null, s.file.name),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Upload progress' }, bar),
      h('p', { class: 'center' }, pct),
      h('p', { class: 'muted small center' }, 'Keep this page open until the upload finishes.'), cancelBtn);
    const ctrl = new AbortController();
    cancelBtn.onclick = () => ctrl.abort();
    try {
      if (!s.videoId) {
        const up = await uploadFile(s.file, 'video', (p) => { bar.style.width = Math.round(p * 100) + '%'; pct.textContent = Math.round(p * 100) + '%'; }, ctrl.signal);
        pct.textContent = 'Saving…';
        try {
          s.videoId = await rpc('create_video', {
            p_storage_key: up.key, p_content_type: up.contentType, p_size: up.size,
            p_sport: meta.sport, p_title: meta.title, p_description: meta.description, p_visibility: meta.visibility,
          });
        } catch (e) { discardUpload(up.key); throw e; }
        await saveCover(s.videoId, meta.cover);
      }
      if (meta.toCoach) {
        const rid = await rpc('create_request', { p_video: s.videoId, p_coach: s.coachId, p_question: meta.question });
        clear(body).append(successState('Request sent to the coach', 'The coach was notified. You\'ll get a notification when the analysis arrives.',
          h('a', { class: 'btn', href: '#/r/' + rid }, 'View request'),
          h('a', { class: 'btn secondary', href: '#/home' }, 'Go home')));
      } else {
        clear(body).append(successState('Video saved', meta.visibility === 'public' ? 'The video is public and will show in the feed and on your profile.' : 'The video is private and saved to your profile.',
          h('a', { class: 'btn', href: '#/v/' + s.videoId }, 'Watch video'),
          h('a', { class: 'btn secondary', href: '#/me' }, 'My profile')));
      }
    } catch (e) {
      const aborted = e.message === 'UPLOAD_ABORTED';
      const videoSaved = !!s.videoId;
      const msg = aborted ? 'Upload cancelled.' : (videoSaved ? 'The video was saved, but sending the request failed: ' : 'Upload failed: ') + friendlyError(e);
      clear(body).append(h('div', { class: 'state error', role: 'alert' },
        h('p', null, msg),
        h('div', { class: 'btn-row', style: { width: '100%' } },
          !aborted && h('button', { class: 'btn', onclick: () => stepUpload(meta) }, 'Try again'),
          videoSaved && meta.toCoach && h('button', { class: 'btn secondary', onclick: () => { s.coachId = null; stepPickCoachAgain(meta); } }, 'Choose another coach'),
          !videoSaved && h('button', { class: 'btn secondary', onclick: () => stepForm() }, 'Back to the form'),
          videoSaved && h('a', { class: 'btn secondary', href: '#/v/' + s.videoId }, 'Go to the saved video'))));
    }
  }

  async function stepPickCoachAgain(meta) {
    const box = h('div');
    clear(body).append(h('h1', null, 'Choose another coach'), h('p', { class: 'muted' }, 'The video is already uploaded. Pick an available coach and send again.'), box);
    box.append(loading());
    try {
      const list = (await rpc('search_coaches', { p_query: '', p_sport: meta.sport })).filter((c) => c.available && c.id !== state.user.id);
      clear(box);
      if (!list.length) return box.append(h('div', { class: 'state empty' }, 'No coach is available in this sport right now. The video is saved, and you can send it later from the video page.', h('a', { class: 'btn', href: '#/v/' + s.videoId }, 'Go to video')));
      list.forEach((c) => box.append(h('button', { class: 'btn secondary block', style: { marginBottom: '.5rem' }, onclick: () => { s.coachId = c.id; stepUpload(meta); } },
        `${c.first_name} ${c.last_name} · up to ${c.response_hours} hours`)));
    } catch (e) { clear(box).append(errorState(friendlyError(e), () => stepPickCoachAgain(meta))); }
  }

  // Upload the cover (picked and framed in the editor, or a random frame). A missing cover never blocks the video.
  async function saveCover(videoId, blob) {
    if (!blob) return;
    try {
      const up = await uploadFile(new File([blob], 'cover.jpg', { type: 'image/jpeg' }), 'cover');
      try { await rpc('set_video_cover', { p_video: videoId, p_key: up.key }); } catch (e) { discardUpload(up.key); throw e; }
    } catch (e) { console.warn('cover skipped', e); }
  }

  if (s.dest === 'coach') stepForm(); else stepDest();
  return () => s.abort && s.abort.abort();
}

// Send an existing (already uploaded) video to a coach — used from the video page.
export async function sendExistingVideo(video, onDone) {
  const { modal } = await import('../ui.js');
  return modal((close) => {
    const box = h('div', null, loading());
    const qa = h('textarea', { maxlength: 2000, placeholder: 'Question for the coach' });
    let picked = null;
    rpc('search_coaches', { p_query: '', p_sport: video.sport_id }).then(async (list) => {
      list = list.filter((c) => c.id !== state.user.id);
      await addPeople(list);
      clear(box);
      if (!list.length) return box.append(h('p', null, 'There are no approved coaches in this sport right now.'));
      box.append(h('div', { class: 'choices' }, list.map((c) => h('label', { class: 'choice' + (c.available ? '' : ' disabled') },
        h('input', { type: 'radio', name: 'c2', disabled: !c.available, onchange: () => { picked = c.id; } }),
        avatar(c, 36),
        h('span', null, h('span', { class: 't' }, `${c.first_name} ${c.last_name} `, c.available ? '' : h('span', { class: 'tag fill' }, 'No free spot')),
          languagesLine(c.languages),
          h('span', { class: 'd' }, `Response time up to ${c.response_hours} hours · ${POLICY[c.followup_policy]}`))))));
    }).catch((e) => clear(box).append(errorState(friendlyError(e))));
    const send = h('button', { class: 'btn' }, 'Send');
    send.onclick = () => busy(send, async () => {
      if (!picked) return toast('Choose an available coach', 'err');
      try {
        const rid = await rpc('create_request', { p_video: video.id, p_coach: picked, p_question: qa.value.trim() });
        close(rid); onDone && onDone(rid);
      } catch (e) { toast(friendlyError(e), 'err'); }
    });
    return [h('h2', null, 'Send video for analysis'), box, h('div', { class: 'field', style: { marginTop: '1rem' } }, h('label', null, 'Question for the coach'), qa),
      h('p', { class: 'hint' }, 'Sending does not change the video\'s privacy.'),
      h('div', { class: 'btn-row' }, send, h('button', { class: 'btn secondary', onclick: () => close(null) }, 'Cancel'))];
  });
}

// search_coaches has no photo or languages; add them from profiles in one query.
export async function addPeople(coaches) {
  if (!coaches.length) return coaches;
  try {
    const rows = await q(sb.from('profiles').select('id,avatar_key,languages').in('id', coaches.map((c) => c.id)));
    const m = Object.fromEntries(rows.map((r) => [r.id, r]));
    coaches.forEach((c) => Object.assign(c, { avatar_key: m[c.id]?.avatar_key || null, languages: m[c.id]?.languages || [] }));
  } catch {}
  return coaches;
}
