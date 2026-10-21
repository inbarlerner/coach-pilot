// Single video page: player, owner controls (privacy, delete, send to coach), analysis, comments, report.
import { h, clear, loading, errorState, friendlyError, fmtDate, busy, toast, confirmDialog, modal, STATUS } from '../ui.js';
import { sb, state, q, action, sportName, isAdmin } from '../api.js';
import { protectedVideo, analysisItem } from '../components.js';
import { go } from '../app.js';

export async function videoPage({ main, setTitle, params, query }) {
  setTitle('סרטון');
  const id = params[0];

  async function load() {
    clear(main).append(loading());
    let v;
    try {
      v = await q(sb.from('videos').select('*, owner:profiles!videos_owner_id_fkey(id,first_name,last_name,username)').eq('id', id).maybeSingle());
    } catch (e) { return clear(main).append(errorState(friendlyError(e), load)); }
    if (!v) return clear(main).append(errorState('הסרטון לא נמצא, או שהוא פרטי ואין לך הרשאה לצפות בו.'));
    const mine = v.owner_id === state.user.id;
    clear(main);

    main.append(
      h('div', { class: 'row between' }, h('a', { href: '#/u/' + v.owner.username }, h('strong', null, v.owner.first_name + ' ' + v.owner.last_name)),
        h('div', { class: 'row' }, v.is_sample && h('span', { class: 'tag' }, 'דוגמה'),
          h('span', { class: 'tag soft' }, v.visibility === 'public' ? 'ציבורי' : 'פרטי'),
          v.removed && h('span', { class: 'tag fill' }, 'הוסר על ידי מנהל'))),
      h('h1', null, v.title),
      h('p', { class: 'meta' }, sportName(v.sport_id) + ' · ' + fmtDate(v.created_at)),
      protectedVideo('video', v.id, { tools: true }),
      v.description && h('p', { class: 'pre', style: { marginTop: '.75rem' } }, v.description));

    if (mine) main.append(ownerControls(v));

    // Requests & analyses on this video
    const reqBox = h('div');
    main.append(reqBox);
    try {
      const reqs = await q(sb.from('analysis_requests')
        .select('id,status,created_at,completed_at,trainee_id,coach_id,coach:profiles!analysis_requests_coach_id_fkey(first_name,last_name,username)')
        .eq('video_id', v.id).order('created_at', { ascending: false }));
      const visible = reqs.filter((r) => mine || r.coach_id === state.user.id || r.status === 'completed');
      if (visible.length) {
        reqBox.append(h('h2', { id: 'analysis' }, mine ? 'בקשות וניתוחים' : 'ניתוח'));
        for (const r of visible) {
          const card = h('div', { class: 'card' },
            h('div', { class: 'row between' },
              h('span', null, 'מאמן: ', h('a', { href: '#/u/' + r.coach.username }, r.coach.first_name + ' ' + r.coach.last_name)),
              h('span', { class: 'tag' + (r.status === 'completed' ? ' fill' : '') }, STATUS[r.status])),
            (mine || r.coach_id === state.user.id) && h('a', { class: 'btn secondary small', style: { marginTop: '.5rem' }, href: '#/r/' + r.id }, 'לבקשה המלאה'));
          if (r.status === 'completed') {
            const items = await q(sb.from('analysis_items').select('*').eq('request_id', r.id).order('created_at'));
            const order = { text: 0, video: 1, audio: 2 };
            items.sort((a, b) => order[a.kind] - order[b.kind]).forEach((it) => card.append(analysisItem(it)));
          }
          reqBox.append(card);
        }
        if (query.get('analysis') === '1') setTimeout(() => document.getElementById('analysis')?.scrollIntoView({ behavior: 'smooth' }), 300);
      }
    } catch (e) { reqBox.append(errorState(friendlyError(e))); }

    if (v.visibility === 'public' && !v.removed) {
      main.append(comments(v));
      if (!mine) main.append(h('div', { style: { marginTop: '1.5rem' } }, reportButton(v)));
    } else if (v.visibility === 'private') {
      main.append(h('p', { class: 'muted small', style: { marginTop: '1rem' } }, 'תגובות זמינות רק בסרטונים ציבוריים.'));
    }
    if (isAdmin() && !mine) main.append(adminControls(v));
  }

  function ownerControls(v) {
    const box = h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', { style: { marginTop: 0 } }, 'ניהול הסרטון'));
    const pub = v.visibility === 'public';
    const toggle = h('button', { class: 'btn secondary block' }, pub ? 'הפיכה לפרטי' : 'הפיכה לציבורי');
    toggle.onclick = async () => {
      const ok = pub
        ? await confirmDialog('להפוך את הסרטון לפרטי?', 'הסרטון והניתוח שלו יוסרו מהפיד, מהפרופיל הציבורי שלך ומתיק העבודות של המאמן.', 'הפיכה לפרטי')
        : await confirmDialog('להפוך את הסרטון לציבורי?', 'הסרטון והניתוח שיתקבל יהיו גלויים בפיד ובפרופילים שלך ושל המאמן. הודעות ההמשך יישארו פרטיות.', 'הפיכה לציבורי');
      if (!ok) return;
      busy(toggle, async () => {
        try { await q(sb.from('videos').update({ visibility: pub ? 'private' : 'public' }).eq('id', v.id)); toast(pub ? 'הסרטון פרטי עכשיו' : 'הסרטון ציבורי עכשיו'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    const send = h('button', { class: 'btn secondary block' }, 'שליחה למאמן לניתוח');
    send.onclick = async () => {
      const { sendExistingVideo } = await import('./upload.js');
      const rid = await sendExistingVideo(v);
      if (rid) { toast('הבקשה נשלחה למאמן'); go('/r/' + rid); }
    };
    const del = h('button', { class: 'btn secondary block' }, 'מחיקת הסרטון');
    del.onclick = async () => {
      if (!(await confirmDialog('למחוק את הסרטון לצמיתות?', 'הסרטון, הבקשות והניתוחים הקשורים אליו יימחקו ולא ניתן יהיה לשחזר אותם.', 'מחיקה לצמיתות'))) return;
      busy(del, async () => {
        try { await action('delete_video', { p_video: v.id }); toast('הסרטון נמחק'); go('/me'); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    box.append(h('div', { class: 'stack' }, toggle, send, del));
    return box;
  }

  function adminControls(v) {
    const b = h('button', { class: 'btn secondary block' }, v.removed ? 'שחזור תוכן (מנהל)' : 'הסרת תוכן בעייתי (מנהל)');
    b.onclick = async () => {
      if (!(await confirmDialog(v.removed ? 'לשחזר את הסרטון?' : 'להסיר את הסרטון מהתצוגה הציבורית?', 'הבעלים ימשיך לראות אותו.', 'אישור'))) return;
      busy(b, async () => {
        try { await sb.rpc('admin_set_video_removed', { p_video: v.id, p_removed: !v.removed }).then(({ error }) => { if (error) throw error; }); toast('עודכן'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    return h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', { style: { marginTop: 0 } }, 'ניהול'), b);
  }

  function comments(v) {
    const box = h('section', { id: 'comments' }, h('h2', null, 'תגובות'));
    const list = h('div', { class: 'stack' });
    const ta = h('textarea', { id: 'c_in', maxlength: 1000, style: { minHeight: '70px' }, placeholder: 'כתבו תגובה…' });
    const send = h('button', { class: 'btn' }, 'פרסום תגובה');
    const loadC = async () => {
      clear(list).append(loading());
      try {
        const rows = await q(sb.from('comments').select('*, author:profiles(first_name,last_name,username)').eq('video_id', v.id).order('created_at'));
        clear(list);
        if (!rows.length) list.append(h('p', { class: 'muted' }, 'אין תגובות עדיין.'));
        rows.forEach((c) => {
          const canDel = c.author_id === state.user.id || isAdmin();
          const del = canDel && h('button', { class: 'btn ghost small', onclick: async () => {
            if (!(await confirmDialog('למחוק את התגובה?', null, 'מחיקה'))) return;
            try { await q(sb.from('comments').delete().eq('id', c.id)); loadC(); } catch (e) { toast(friendlyError(e), 'err'); }
          } }, 'מחיקה');
          list.append(h('div', { class: 'card' }, h('div', { class: 'row between' },
            h('a', { href: '#/u/' + c.author.username }, h('strong', null, c.author.first_name + ' ' + c.author.last_name)),
            h('span', { class: 'meta' }, fmtDate(c.created_at))), h('p', { class: 'pre' }, c.body), del));
        });
      } catch (e) { clear(list).append(errorState(friendlyError(e), loadC)); }
    };
    send.onclick = () => busy(send, async () => {
      if (!ta.value.trim()) return toast('התגובה ריקה', 'err');
      try { await q(sb.from('comments').insert({ video_id: v.id, author_id: state.user.id, body: ta.value.trim() })); ta.value = ''; loadC(); }
      catch (e) { toast(friendlyError(e), 'err'); }
    });
    box.append(list, h('div', { class: 'field', style: { marginTop: '.75rem' } }, h('label', { for: 'c_in' }, 'תגובה חדשה'), ta), send);
    loadC();
    return box;
  }

  function reportButton(v) {
    const b = h('button', { class: 'btn ghost small' }, 'דיווח על תוכן בעייתי');
    b.onclick = async () => {
      const reason = await modal((close) => {
        const ta = h('textarea', { maxlength: 500, placeholder: 'מה הבעיה בתוכן?' });
        return [h('h2', null, 'דיווח על תוכן'), h('p', null, 'הדיווח יישלח למנהלי הפיילוט.'), ta,
          h('div', { class: 'btn-row', style: { marginTop: '1rem' } },
            h('button', { class: 'btn', onclick: () => close(ta.value.trim() || 'ללא פירוט') }, 'שליחת דיווח'),
            h('button', { class: 'btn secondary', onclick: () => close(null) }, 'ביטול'))];
      });
      if (!reason) return;
      try { await q(sb.from('reports').insert({ video_id: v.id, reporter_id: state.user.id, reason })); toast('תודה, הדיווח נשלח'); }
      catch (e) { toast(friendlyError(e), 'err'); }
    };
    return b;
  }

  await load();
}
