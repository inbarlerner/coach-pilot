// A single analysis request: trainee view, coach analysis workspace, analysis result, follow-up messages.
import { h, clear, loading, errorState, friendlyError, fmtDate, timeLeft, STATUS, DECLINE, POLICY, busy, toast, confirmDialog, modal } from '../ui.js';
import { sb, state, q, rpc, action, sportName } from '../api.js';
import { protectedVideo, analysisItem, recorder } from '../components.js';
import { go, refreshBadge } from '../app.js';

export async function requestPage({ main, setTitle, params }) {
  setTitle('בקשת ניתוח');
  const id = params[0];
  let timers = [];
  let recorders = [];
  const cleanup = () => { timers.forEach(clearInterval); recorders.forEach((r) => r.cleanup && r.cleanup()); timers = []; recorders = []; };

  async function load() {
    cleanup();
    clear(main).append(loading());
    let r;
    try {
      r = await q(sb.from('analysis_requests')
        .select('*, video:videos(id,title,description,sport_id,visibility,owner_id),' +
          'trainee:profiles!analysis_requests_trainee_id_fkey(id,first_name,last_name,username),' +
          'coach:profiles!analysis_requests_coach_id_fkey(id,first_name,last_name,username)')
        .eq('id', id).maybeSingle());
    } catch (e) { return clear(main).append(errorState(friendlyError(e), load)); }
    if (!r) return clear(main).append(errorState('הבקשה לא נמצאה או שאין לך הרשאה לצפות בה.'));

    const me = state.user.id;
    const isCoachHere = r.coach_id === me;
    const isTrainee = r.trainee_id === me;
    if ((isCoachHere && !r.coach_read) || (isTrainee && !r.trainee_read)) {
      rpc('mark_request_read', { p_request: id, p_read: true }).then(refreshBadge).catch(() => {});
    }
    const open = ['pending', 'draft'].includes(r.status) && new Date(r.deadline_at) > Date.now();

    clear(main);
    const deadlineEl = h('span', null, timeLeft(r.deadline_at));
    if (open) timers.push(setInterval(() => { deadlineEl.textContent = timeLeft(r.deadline_at); if (new Date(r.deadline_at) <= Date.now()) load(); }, 30000));

    main.append(
      h('a', { class: 'btn ghost small', href: '#/inbox' + (isCoachHere ? '?side=received' : '?side=sent') }, '→ חזרה לאינבוקס'),
      h('h1', null, r.video.title),
      h('div', { class: 'row' }, h('span', { class: 'tag' + (r.status === 'completed' ? ' fill' : '') }, STATUS[r.status]),
        h('span', { class: 'tag soft' }, r.video.visibility === 'public' ? 'ציבורי' : 'פרטי')),
      h('dl', { class: 'kv' },
        h('dt', null, 'ענף'), h('dd', null, sportName(r.video.sport_id)),
        h('dt', null, 'מתאמן'), h('dd', null, h('a', { href: '#/u/' + r.trainee.username }, r.trainee.first_name + ' ' + r.trainee.last_name)),
        h('dt', null, 'מאמן'), h('dd', null, h('a', { href: '#/u/' + r.coach.username }, r.coach.first_name + ' ' + r.coach.last_name)),
        h('dt', null, 'נשלחה'), h('dd', null, fmtDate(r.created_at)),
        h('dt', null, 'מועד אחרון למענה'), h('dd', null, fmtDate(r.deadline_at), open ? [' · ', deadlineEl] : ''),
        r.completed_at && [h('dt', null, 'הניתוח נשלח'), h('dd', null, fmtDate(r.completed_at))],
        h('dt', null, 'הודעות המשך'), h('dd', null, POLICY[r.followup_policy])),
      r.status === 'declined' && h('div', { class: 'banner', role: 'status' }, h('strong', null, 'הבקשה סורבה. '), 'סיבה: ' + (DECLINE[r.decline_reason] || '') + '. הסרטון והבקשה נשמרו.'),
      r.status === 'expired' && h('div', { class: 'banner', role: 'status' }, h('strong', null, 'זמן התגובה עבר. '), 'המאמן לא שלח ניתוח עד המועד האחרון, ולכן אי אפשר לשלוח ניתוח בבקשה זו. הסרטון והבקשה נשמרו.'),
      ['pending', 'draft'].includes(r.status) && !open && h('div', { class: 'banner' }, 'זמן התגובה עבר. הבקשה תועבר לבקשות שלא הושלמו בתוך דקה.'),
    );

    const left = h('div');
    const right = h('div');
    main.classList.add('wide');
    main.append(h('div', { class: 'two-col' }, left, right));

    left.append(protectedVideo('video', r.video.id, { tools: true }),
      r.video.description && h('div', null, h('h3', null, 'תיאור'), h('p', { class: 'pre' }, r.video.description)),
      r.question && h('div', null, h('h3', null, 'השאלה למאמן'), h('p', { class: 'pre' }, r.question)));

    if (isCoachHere && open) return workspace(r, right);
    if (r.status === 'completed') return result(r, right, isCoachHere, isTrainee);
    if (isTrainee && ['pending', 'draft'].includes(r.status)) {
      right.append(h('div', { class: 'state' }, h('p', null, h('strong', null, 'ממתין לניתוח מהמאמן')),
        h('p', null, 'תקבלו התראה כשהניתוח יגיע. המועד האחרון: ' + fmtDate(r.deadline_at) + '.')));
    }
  }

  // ---------- Coach workspace ----------
  async function workspace(r, root) {
    let items = [];
    try { items = await q(sb.from('analysis_items').select('*').eq('request_id', r.id).order('created_at')); }
    catch (e) { return root.append(errorState(friendlyError(e), load)); }
    const textItem = items.find((i) => i.kind === 'text');
    const text = h('textarea', { id: 'a_text', style: { minHeight: '180px' }, placeholder: 'מה ראית, מה לתקן ואיך לתרגל' }, textItem?.body || '');
    text.value = textItem?.body || '';
    const mediaList = h('div');
    const renderMedia = () => {
      clear(mediaList);
      const media = items.filter((i) => i.kind !== 'text');
      if (!media.length) return;
      mediaList.append(h('h3', null, 'הקלטות שנשמרו בטיוטה'));
      media.forEach((it) => {
        const del = h('button', { class: 'btn secondary small' }, 'הסרה');
        del.onclick = async () => {
          if (!(await confirmDialog('להסיר את ההקלטה?', 'ההקלטה תימחק מהטיוטה.', 'הסרה'))) return;
          busy(del, async () => {
            try { await action('remove_analysis_item', { p_item: it.id }); items = items.filter((x) => x.id !== it.id); renderMedia(); toast('ההקלטה הוסרה'); }
            catch (e) { toast(friendlyError(e), 'err'); }
          });
        };
        mediaList.append(h('div', null, analysisItem(it), h('div', { style: { margin: '.3rem 0 .8rem' } }, del)));
      });
    };
    renderMedia();

    const onSaved = (kind) => async ({ key, contentType }) => {
      const iid = await rpc('add_analysis_media', { p_request: r.id, p_kind: kind, p_storage_key: key, p_content_type: contentType });
      await rpc('save_draft', { p_request: r.id });
      items.push({ id: iid, kind, storage_key: key, content_type: contentType });
      renderMedia();
    };
    const audioRec = recorder('audio', onSaved('audio'));
    const videoRec = recorder('video', onSaved('video'));
    recorders.push(audioRec, videoRec);

    const saveBtn = h('button', { class: 'btn secondary' }, 'שמירת טיוטה');
    const sendBtn = h('button', { class: 'btn' }, 'שליחת פענוח');
    const cancelBtn = h('button', { class: 'btn secondary', 'aria-label': 'ביטול עבודת הניתוח' }, '✕ ביטול');
    const declineBtn = h('button', { class: 'btn secondary' }, 'לא יכול לנתח');

    saveBtn.onclick = () => busy(saveBtn, async () => {
      try {
        await rpc('set_analysis_text', { p_request: r.id, p_text: text.value });
        await rpc('save_draft', { p_request: r.id });
        toast('הטיוטה נשמרה. הבקשה ממשיכה לתפוס מקום במכסה.');
      } catch (e) { toast(friendlyError(e), 'err'); if (/EXPIRED|NOT_OPEN/.test(e.message)) load(); }
    });
    sendBtn.onclick = async () => {
      const hasMedia = items.some((i) => i.kind !== 'text');
      if (!text.value.trim() && !hasMedia) return toast('יש להוסיף לפחות רכיב תגובה אחד: טקסט, הקלטת קול או הקלטת וידאו.', 'err');
      if (!(await confirmDialog('לשלוח את הפענוח למתאמן?', 'אחרי השליחה אי אפשר לערוך את הניתוח.', 'שליחה'))) return;
      busy(sendBtn, async () => {
        try {
          await rpc('set_analysis_text', { p_request: r.id, p_text: text.value });
          await rpc('send_analysis', { p_request: r.id });
          toast('הפענוח נשלח למתאמן');
          load();
        } catch (e) { toast(friendlyError(e), 'err'); if (/EXPIRED|NOT_OPEN/.test(e.message)) load(); }
      });
    };
    cancelBtn.onclick = async () => {
      if (!(await confirmDialog('למחוק את עבודת הניתוח?', 'הטקסט וההקלטות יימחקו והבקשה תסומן כ״לא נקראה״. הבקשה של המתאמן לא תבוטל וזמן התגובה לא יתאפס.', 'מחיקה'))) return;
      busy(cancelBtn, async () => {
        try { await action('discard_draft', { p_request: r.id }); toast('עבודת הניתוח נמחקה'); go('/inbox?side=received'); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    declineBtn.onclick = async () => {
      const reason = await modal((close) => {
        let pick = null;
        return [h('h2', null, 'לא יכול לנתח'), h('p', null, 'בחרו סיבה. הסיבה תוצג למתאמן.'),
          h('div', { class: 'choices' }, Object.entries(DECLINE).map(([k, l]) =>
            h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'dr', onchange: () => { pick = k; } }), h('span', { class: 't' }, l)))),
          h('div', { class: 'btn-row', style: { marginTop: '1rem' } },
            h('button', { class: 'btn', onclick: () => (pick ? close(pick) : toast('יש לבחור סיבה', 'err')) }, 'אישור סירוב'),
            h('button', { class: 'btn secondary', onclick: () => close(null) }, 'חזרה'))];
      });
      if (!reason) return;
      busy(declineBtn, async () => {
        try { await action('decline_request', { p_request: r.id, p_reason: reason }); toast('הבקשה סורבה והועברה לבקשות שלא הושלמו'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };

    root.append(
      h('h2', { style: { marginTop: 0 } }, 'הניתוח שלך'),
      r.status === 'draft' && h('p', { class: 'tag soft' }, 'טיוטה שמורה'),
      h('p', { class: 'muted small' }, 'אפשר לשלב טקסט, הקלטת קול והקלטת וידאו. נדרש לפחות רכיב אחד.'),
      h('div', { class: 'field' }, h('label', { for: 'a_text' }, 'טקסט'), text),
      audioRec, h('div', { style: { height: '.75rem' } }), videoRec,
      mediaList,
      h('div', { class: 'card soon', style: { marginTop: '1rem' } },
        h('div', { class: 'row' }, h('strong', null, 'כלי ניתוח מתקדמים'), h('span', { class: 'tag' }, 'בקרוב')),
        h('p', { class: 'small muted' }, 'שרטוט על גבי הסרטון, הקלטת הסבר משולבת (סרטון המתאמן + קול + מצלמה קטנה של המאמן) ושמירת תזמון השרטוטים יתווספו בשלב הבא. כרגע אינם פעילים.')),
      h('div', { class: 'btn-row', style: { marginTop: '1.25rem' } }, sendBtn, saveBtn),
      h('div', { class: 'btn-row', style: { marginTop: '.6rem' } }, declineBtn, cancelBtn));
  }

  // ---------- Completed: analysis + follow-ups ----------
  async function result(r, root, isCoachHere, isTrainee) {
    root.append(h('h2', { style: { marginTop: 0 } }, 'הניתוח מ' + r.coach.first_name + ' ' + r.coach.last_name));
    const itemsBox = h('div', null, loading());
    root.append(itemsBox);
    try {
      const order = { text: 0, video: 1, audio: 2 };
      const items = (await q(sb.from('analysis_items').select('*').eq('request_id', r.id).order('created_at')))
        .sort((a, b) => order[a.kind] - order[b.kind]);
      clear(itemsBox).append(...(items.length ? items.map(analysisItem) : [h('p', { class: 'muted' }, 'אין רכיבי ניתוח.')]));
    } catch (e) { clear(itemsBox).append(errorState(friendlyError(e))); }

    if (!isCoachHere && !isTrainee) return;
    const thread = h('div', { class: 'thread' });
    const composer = h('div');
    root.append(h('h2', null, 'הודעות המשך'), h('p', { class: 'muted small' }, POLICY[r.followup_policy] + ' · ההודעות פרטיות ביניכם גם אם הסרטון ציבורי.'), thread, composer);

    const loadThread = async () => {
      clear(thread).append(loading());
      try {
        const [msgs, st] = await Promise.all([
          q(sb.from('messages').select('*').eq('request_id', r.id).order('created_at')),
          rpc('followup_state', { p_request: r.id }),
        ]);
        clear(thread);
        if (!msgs.length) thread.append(h('p', { class: 'muted' }, 'אין הודעות עדיין.'));
        msgs.forEach((m) => thread.append(h('div', { class: 'msg ' + (m.sender_id === state.user.id ? 'mine' : 'theirs') },
          h('div', null, m.body), h('div', { class: 'meta' }, (m.sender_id === r.coach_id ? 'מאמן' : 'מתאמן') + ' · ' + fmtDate(m.created_at)))));
        renderComposer(st[0] || { can_send: false, reason: 'NOT_FOUND' });
      } catch (e) { clear(thread).append(errorState(friendlyError(e), loadThread)); }
    };
    const REASONS = {
      POLICY_NONE: 'בבקשה זו אין הודעות המשך. הניתוח זמין לצפייה.',
      ONE_USED: 'שלחת את הודעת ההמשך היחידה. המאמן יכול להשיב לה.',
      ONE_REPLIED: 'השבת להודעת ההמשך. ההתכתבות בבקשה זו הסתיימה.',
      WAIT_TRAINEE: 'אפשר להשיב רק אם המתאמן שולח הודעת המשך.',
      CHAT24_ENDED: '24 השעות להתכתבות הסתיימו.',
      ACCOUNT_DISABLED: 'החשבון הושבת.',
    };
    const HINTS = {
      ONE_TRAINEE: 'אפשר לשלוח הודעת המשך אחת בלבד. כתבו את כל מה שחשוב לכם.',
      ONE_COACH_REPLY: 'אפשר להשיב פעם אחת להודעת ההמשך.',
      CHAT24: 'ההתכתבות פתוחה עד ' + fmtDate(new Date(new Date(r.completed_at).getTime() + 864e5)) + '.',
      UNLIMITED: '',
    };
    function renderComposer(st) {
      clear(composer);
      if (!st.can_send) return composer.append(h('p', { class: 'banner' }, REASONS[st.reason] || 'אי אפשר לשלוח הודעה כרגע.'));
      const ta = h('textarea', { id: 'msg_in', maxlength: 4000, placeholder: 'כתבו הודעה…', style: { minHeight: '90px' } });
      const send = h('button', { class: 'btn' }, 'שליחה');
      send.onclick = () => busy(send, async () => {
        if (!ta.value.trim()) return toast('ההודעה ריקה', 'err');
        if (st.reason === 'ONE_TRAINEE' && !(await confirmDialog('לשלוח את הודעת ההמשך?', 'זו ההודעה היחידה שאפשר לשלוח בבקשה זו.', 'שליחה'))) return;
        try { await rpc('send_message', { p_request: r.id, p_body: ta.value }); toast('ההודעה נשלחה'); loadThread(); }
        catch (e) { toast(friendlyError(e), 'err'); loadThread(); }
      });
      composer.append(h('div', { class: 'field', style: { marginTop: '.75rem' } }, h('label', { for: 'msg_in' }, 'הודעה'), ta,
        HINTS[st.reason] && h('div', { class: 'hint' }, HINTS[st.reason])), send);
    }
    loadThread();
  }

  await load();
  return cleanup;
}
