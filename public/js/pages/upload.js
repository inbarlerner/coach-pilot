// Upload a video: choose destination → form → upload with progress → (optional) send to coach.
import { h, clear, busy, friendlyError, successState, errorState, loading, POLICY, toast } from '../ui.js';
import { sb, state, activeSports, sportName, rpc, uploadFile, fileType, LIMITS, isCoach } from '../api.js';

export async function uploadPage({ main, setTitle, query }) {
  setTitle('העלאת סרטון');
  const welcome = query.get('welcome') === '1';
  const presetCoach = query.get('coach');

  if (welcome && state.profile && !state.profile.onboarded) {
    sb.from('profiles').update({ onboarded: true }).eq('id', state.user.id).then(() => { state.profile.onboarded = true; });
  }

  const s = { dest: presetCoach ? 'coach' : null, coachId: presetCoach || null, file: null, videoId: null, abort: null };

  const top = h('div');
  if (welcome) {
    top.append(h('div', { class: 'banner' },
      h('p', null, h('strong', null, 'ברוכים הבאים! '), 'אפשר להתחיל בהעלאת סרטון ראשון.'),
      h('a', { class: 'btn secondary small', href: '#/home' }, 'דילוג לעמוד הבית')));
  }
  const body = h('div');
  main.append(top, body);

  if (isCoach() && state.profile.coach_status === 'pending') {
    // pending coaches may still upload their own videos
  }

  // ---------- Step 1: destination ----------
  function stepDest() {
    clear(body).append(
      h('h1', null, 'לאן הסרטון הולך?'),
      h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'יעד הסרטון' },
        destChoice('profile', 'פרסום / שמירה בפרופיל שלי', 'ללא בקשת ניתוח. אפשר לבחור פרטי או ציבורי.'),
        h('label', { class: 'choice disabled', 'aria-disabled': 'true' },
          h('input', { type: 'radio', name: 'dest', disabled: true }),
          h('span', null, h('span', { class: 't' }, 'מאמן וירטואלי AI ', h('span', { class: 'tag' }, 'בקרוב')),
            h('span', { class: 'd' }, 'עדיין לא זמין. אי אפשר לשלוח אליו סרטונים כרגע.'))),
        destChoice('coach', 'מאמן אנושי', 'מאמן מאושר יקבל את הסרטון וישלח ניתוח.')),
      h('div', { style: { marginTop: '1rem' } },
        h('button', { class: 'btn block', onclick: () => { if (!s.dest) return toast('יש לבחור יעד לסרטון', 'err'); stepForm(); } }, 'המשך')));
  }
  function destChoice(v, t, d) {
    return h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'dest', value: v, checked: s.dest === v, onchange: () => { s.dest = v; } }),
      h('span', null, h('span', { class: 't' }, t), h('span', { class: 'd' }, d)));
  }

  // ---------- Step 2: form ----------
  async function stepForm() {
    const toCoach = s.dest === 'coach';
    const fileIn = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v', id: 'u_file' });
    const fileInfo = h('div', { class: 'hint' });
    const fileErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const sport = h('select', { id: 'u_sport' }, h('option', { value: '' }, 'בחירת ענף…'),
      activeSports().map((sp) => h('option', { value: sp.id }, sp.name)));
    const title = h('input', { type: 'text', id: 'u_title', maxlength: 120, placeholder: 'למשל: ג׳יבינג לשמאל' });
    const desc = h('textarea', { id: 'u_desc', maxlength: 2000, placeholder: 'מה רואים בסרטון, תנאים, מה ניסית לעשות' });
    const question = h('textarea', { id: 'u_q', maxlength: 2000, placeholder: 'מה הכי חשוב לך לדעת מהמאמן?' });
    const vis = { private: h('input', { type: 'radio', name: 'vis', value: 'private', checked: true }), public: h('input', { type: 'radio', name: 'vis', value: 'public' }) };
    const coachBox = h('div');
    const err = h('div', { class: 'banner hidden', role: 'alert' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, toCoach ? 'העלאה ושליחה למאמן' : 'העלאה ושמירה');

    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      fileErr.classList.add('hidden');
      s.file = null; fileInfo.textContent = '';
      if (!f) return;
      const t = fileType(f);
      if (!LIMITS.videoTypes.includes(t)) { fileErr.textContent = `הפורמט אינו נתמך. אפשר להעלות ${LIMITS.videoFormats}.`; fileErr.classList.remove('hidden'); fileIn.value = ''; return; }
      if (f.size > LIMITS.videoMaxMB * 1048576) { fileErr.textContent = `הקובץ גדול מ־${LIMITS.videoMaxMB}MB (${Math.round(f.size / 1048576)}MB). קצרו את הסרטון או צלמו באיכות נמוכה יותר.`; fileErr.classList.remove('hidden'); fileIn.value = ''; return; }
      s.file = f;
      fileInfo.textContent = `${f.name} · ${Math.round(f.size / 1048576 * 10) / 10}MB`;
    });

    let coaches = [];
    async function loadCoaches() {
      if (!toCoach) return;
      clear(coachBox).append(loading('טוען מאמנים…'));
      try {
        coaches = await rpc('search_coaches', { p_query: '', p_sport: sport.value ? Number(sport.value) : null });
        coaches = coaches.filter((c) => c.id !== state.user.id);
        renderCoaches();
      } catch (e) {
        clear(coachBox).append(errorState(friendlyError(e), loadCoaches));
      }
    }
    function renderCoaches() {
      clear(coachBox);
      if (!sport.value) { coachBox.append(h('p', { class: 'muted' }, 'בחרו ענף כדי לראות מאמנים מתאימים.')); return; }
      if (!coaches.length) { coachBox.append(h('div', { class: 'state empty' }, h('p', null, 'אין כרגע מאמנים מאושרים בענף הזה.'), h('p', null, 'אפשר לשמור את הסרטון בפרופיל ולשלוח אותו מאוחר יותר.'))); return; }
      if (s.coachId && !coaches.some((c) => c.id === s.coachId)) s.coachId = null;
      coachBox.append(h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'בחירת מאמן' },
        coaches.map((c) => {
          const full = !c.available;
          return h('label', { class: 'choice' + (full ? ' disabled' : '') },
            h('input', { type: 'radio', name: 'coach', value: c.id, disabled: full, checked: s.coachId === c.id && !full, onchange: () => { s.coachId = c.id; } }),
            h('span', null,
              h('span', { class: 't' }, c.first_name + ' ' + c.last_name, ' ', c.is_sample && h('span', { class: 'tag' }, 'דוגמה'), ' ',
                full ? h('span', { class: 'tag fill' }, 'אין מקום פנוי') : h('span', { class: 'tag soft' }, `פנוי · ${c.quota - c.active_count} מקומות`)),
              h('span', { class: 'd' }, 'ענפים: ' + c.sport_ids.map(sportName).join(', ')),
              h('span', { class: 'd' }, `זמן תגובה: עד ${c.response_hours} שעות`),
              h('span', { class: 'd' }, 'הודעות המשך: ' + POLICY[c.followup_policy]),
              h('a', { class: 'small', href: '#/u/' + c.username, target: '_blank' }, 'לפרופיל המאמן')));
        })));
    }
    sport.addEventListener('change', loadCoaches);

    const form = h('form', { novalidate: true },
      h('h1', null, toCoach ? 'שליחת סרטון לניתוח' : 'העלאה לפרופיל'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: stepDest }, '→ שינוי יעד'),
      err,
      h('div', { class: 'field' }, h('label', { for: 'u_file' }, 'קובץ וידאו'), fileIn, fileInfo, fileErr,
        h('div', { class: 'hint' }, `עד ${LIMITS.videoMaxMB}MB · פורמטים: ${LIMITS.videoFormats}. מומלץ סרטון קצר (עד כדקה וחצי).`)),
      h('div', { class: 'field' }, h('label', { for: 'u_sport' }, 'ענף ספורט'), sport),
      h('div', { class: 'field' }, h('label', { for: 'u_title' }, 'שם התרגיל'), title),
      h('div', { class: 'field' }, h('label', { for: 'u_desc' }, 'תיאור (לא חובה)'), desc),
      toCoach && h('div', { class: 'field' }, h('label', { for: 'u_q' }, 'שאלה ישירה למאמן'), question),
      toCoach && h('div', { class: 'field' }, h('div', { class: 'label' }, 'בחירת מאמן'), coachBox),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'מי יכול לצפות?'),
        h('div', { class: 'choices', role: 'radiogroup' },
          h('label', { class: 'choice' }, vis.private, h('span', null, h('span', { class: 't' }, 'פרטי (ברירת מחדל)'),
            h('span', { class: 'd' }, toCoach ? 'רק את/ה והמאמן שנבחר.' : 'רק את/ה.'))),
          h('label', { class: 'choice' }, vis.public, h('span', null, h('span', { class: 't' }, 'ציבורי'),
            h('span', { class: 'd' }, 'הסרטון והניתוח שיתקבל יהיו גלויים בפיד ובפרופילים שלך ושל המאמן'))))),
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
      if (!s.file) problems.push('יש לבחור קובץ וידאו.');
      if (!sport.value) problems.push('יש לבחור ענף ספורט.');
      if (!title.value.trim()) problems.push('יש למלא את שם התרגיל.');
      if (toCoach && !s.coachId) problems.push('יש לבחור מאמן פנוי.');
      if (problems.length) { err.textContent = problems.join(' '); err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' }); return; }
      const visibility = vis.public.checked ? 'public' : 'private';
      stepUpload({ sport: Number(sport.value), title: title.value.trim(), description: desc.value.trim(), question: question.value.trim(), visibility, toCoach });
    });
  }

  // ---------- Step 3: upload ----------
  async function stepUpload(meta) {
    const bar = h('div');
    const pct = h('strong', null, '0%');
    const cancelBtn = h('button', { class: 'btn secondary', type: 'button' }, 'ביטול העלאה');
    clear(body).append(h('h1', null, 'מעלה את הסרטון…'),
      h('p', null, s.file.name),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'התקדמות העלאה' }, bar),
      h('p', { class: 'center' }, pct),
      h('p', { class: 'muted small center' }, 'אל תסגרו את הדף עד לסיום ההעלאה.'), cancelBtn);
    const ctrl = new AbortController();
    cancelBtn.onclick = () => ctrl.abort();
    try {
      if (!s.videoId) {
        const up = await uploadFile(s.file, 'video', (p) => { bar.style.width = Math.round(p * 100) + '%'; pct.textContent = Math.round(p * 100) + '%'; }, ctrl.signal);
        pct.textContent = 'שומר…';
        s.videoId = await rpc('create_video', {
          p_storage_key: up.key, p_content_type: up.contentType, p_size: up.size,
          p_sport: meta.sport, p_title: meta.title, p_description: meta.description, p_visibility: meta.visibility,
        });
      }
      if (meta.toCoach) {
        const rid = await rpc('create_request', { p_video: s.videoId, p_coach: s.coachId, p_question: meta.question });
        clear(body).append(successState('הבקשה נשלחה למאמן', 'המאמן קיבל התראה. תקבלו התראה כשהניתוח יגיע.',
          h('a', { class: 'btn', href: '#/r/' + rid }, 'צפייה בבקשה'),
          h('a', { class: 'btn secondary', href: '#/home' }, 'לעמוד הבית')));
      } else {
        clear(body).append(successState('הסרטון נשמר', meta.visibility === 'public' ? 'הסרטון ציבורי ויופיע בפיד ובפרופיל שלך.' : 'הסרטון פרטי ונשמר בפרופיל שלך.',
          h('a', { class: 'btn', href: '#/v/' + s.videoId }, 'צפייה בסרטון'),
          h('a', { class: 'btn secondary', href: '#/me' }, 'לפרופיל שלי')));
      }
    } catch (e) {
      const aborted = e.message === 'UPLOAD_ABORTED';
      const videoSaved = !!s.videoId;
      const msg = aborted ? 'ההעלאה בוטלה.' : (videoSaved ? 'הסרטון נשמר, אבל שליחת הבקשה נכשלה: ' : 'ההעלאה נכשלה: ') + friendlyError(e);
      clear(body).append(h('div', { class: 'state error', role: 'alert' },
        h('p', null, msg),
        h('div', { class: 'btn-row', style: { width: '100%' } },
          !aborted && h('button', { class: 'btn', onclick: () => stepUpload(meta) }, 'ניסיון חוזר'),
          videoSaved && meta.toCoach && h('button', { class: 'btn secondary', onclick: () => { s.coachId = null; stepPickCoachAgain(meta); } }, 'בחירת מאמן אחר'),
          !videoSaved && h('button', { class: 'btn secondary', onclick: () => stepForm() }, 'חזרה לטופס'),
          videoSaved && h('a', { class: 'btn secondary', href: '#/v/' + s.videoId }, 'לסרטון השמור'))));
    }
  }

  async function stepPickCoachAgain(meta) {
    const box = h('div');
    clear(body).append(h('h1', null, 'בחירת מאמן אחר'), h('p', { class: 'muted' }, 'הסרטון כבר הועלה. בחרו מאמן פנוי ושלחו שוב.'), box);
    box.append(loading());
    try {
      const list = (await rpc('search_coaches', { p_query: '', p_sport: meta.sport })).filter((c) => c.available && c.id !== state.user.id);
      clear(box);
      if (!list.length) return box.append(h('div', { class: 'state empty' }, 'אין כרגע מאמן פנוי בענף הזה. הסרטון שמור, ואפשר לשלוח אותו מדף הסרטון בהמשך.', h('a', { class: 'btn', href: '#/v/' + s.videoId }, 'לסרטון')));
      list.forEach((c) => box.append(h('button', { class: 'btn secondary block', style: { marginBottom: '.5rem' }, onclick: () => { s.coachId = c.id; stepUpload(meta); } },
        `${c.first_name} ${c.last_name} · עד ${c.response_hours} שעות`)));
    } catch (e) { clear(box).append(errorState(friendlyError(e), () => stepPickCoachAgain(meta))); }
  }

  if (s.dest === 'coach') stepForm(); else stepDest();
  return () => s.abort && s.abort.abort();
}

// Send an existing (already uploaded) video to a coach — used from the video page.
export async function sendExistingVideo(video, onDone) {
  const { modal } = await import('../ui.js');
  return modal((close) => {
    const box = h('div', null, loading());
    const q = h('textarea', { maxlength: 2000, placeholder: 'שאלה ישירה למאמן' });
    let picked = null;
    rpc('search_coaches', { p_query: '', p_sport: video.sport_id }).then((list) => {
      list = list.filter((c) => c.id !== state.user.id);
      clear(box);
      if (!list.length) return box.append(h('p', null, 'אין מאמנים מאושרים בענף הזה כרגע.'));
      box.append(h('div', { class: 'choices' }, list.map((c) => h('label', { class: 'choice' + (c.available ? '' : ' disabled') },
        h('input', { type: 'radio', name: 'c2', disabled: !c.available, onchange: () => { picked = c.id; } }),
        h('span', null, h('span', { class: 't' }, `${c.first_name} ${c.last_name} `, c.available ? '' : h('span', { class: 'tag fill' }, 'אין מקום פנוי')),
          h('span', { class: 'd' }, `זמן תגובה עד ${c.response_hours} שעות · ${POLICY[c.followup_policy]}`))))));
    }).catch((e) => clear(box).append(errorState(friendlyError(e))));
    const send = h('button', { class: 'btn' }, 'שליחה');
    send.onclick = () => busy(send, async () => {
      if (!picked) return toast('יש לבחור מאמן פנוי', 'err');
      try {
        const rid = await rpc('create_request', { p_video: video.id, p_coach: picked, p_question: q.value.trim() });
        close(rid); onDone && onDone(rid);
      } catch (e) { toast(friendlyError(e), 'err'); }
    });
    return [h('h2', null, 'שליחת הסרטון לניתוח'), box, h('div', { class: 'field', style: { marginTop: '1rem' } }, h('label', null, 'שאלה למאמן'), q),
      h('p', { class: 'hint' }, 'הפרטיות של הסרטון לא משתנה בשליחה.'),
      h('div', { class: 'btn-row' }, send, h('button', { class: 'btn secondary', onclick: () => close(null) }, 'ביטול'))];
  });
}
