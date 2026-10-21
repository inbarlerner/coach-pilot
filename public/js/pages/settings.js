// Profile editing for everyone + coach settings (quota, response time, follow-up policy, sports, bio).
import { h, clear, loading, errorState, friendlyError, busy, toast, POLICY } from '../ui.js';
import { sb, state, q, activeSports, loadProfile, isCoach } from '../api.js';

export async function settingsPage({ main, setTitle }) {
  setTitle('הגדרות');
  clear(main).append(loading());
  const p = state.profile;
  let priv, interests, coachSet, coachSports;
  try {
    [priv, interests] = await Promise.all([
      q(sb.from('profile_private').select('*').eq('id', p.id).single()),
      q(sb.from('user_sports').select('sport_id').eq('user_id', p.id)),
    ]);
    if (isCoach()) {
      [coachSet, coachSports] = await Promise.all([
        q(sb.from('coach_settings').select('*').eq('coach_id', p.id).maybeSingle()),
        q(sb.from('coach_sports').select('sport_id').eq('coach_id', p.id)),
      ]);
    }
  } catch (e) { return clear(main).append(errorState(friendlyError(e), () => settingsPage({ main, setTitle }))); }
  clear(main);

  const chips = (name, sel) => h('div', { class: 'chips' }, activeSports().map((s) =>
    h('label', { class: 'chip' }, h('input', { type: 'checkbox', name, value: String(s.id), checked: sel.includes(s.id) }), s.name)));
  const picked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => Number(i.value));

  // ---------- Coach settings ----------
  if (isCoach()) {
    const quota = h('input', { type: 'number', id: 'cs_quota', min: 0, max: 100, value: coachSet?.quota ?? 3, inputmode: 'numeric' });
    const hours = h('input', { type: 'number', id: 'cs_hours', min: 1, max: 720, value: coachSet?.response_hours ?? 48, inputmode: 'numeric' });
    const policies = h('div', { class: 'choices', role: 'radiogroup' }, Object.entries(POLICY).map(([k, l]) =>
      h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'policy', value: k, checked: (coachSet?.followup_policy || 'one') === k }), h('span', { class: 't' }, l))));
    const sportsBox = chips('coach_sports', (coachSports || []).map((r) => r.sport_id));
    const bio = h('textarea', { id: 'cs_bio', maxlength: 1000 });
    bio.value = p.bio || '';
    const save = h('button', { class: 'btn block' }, 'שמירת הגדרות מאמן');
    const form = h('div', { class: 'card' },
      h('h2', { style: { marginTop: 0 } }, 'הגדרות מאמן'),
      p.coach_status !== 'approved' && h('p', { class: 'banner' }, p.coach_status === 'pending' ? 'החשבון ממתין לאישור מנהל. אפשר להכין את ההגדרות מראש.' : 'בקשת ההצטרפות כמאמן לא אושרה.'),
      h('div', { class: 'field' }, h('label', { for: 'cs_quota' }, 'מכסת בקשות פעילות'), quota,
        h('div', { class: 'hint' }, 'כמה בקשות פתוחות (ממתינות או בטיוטה) יכולות להיות אצלך בו־זמנית. בקשה חדשה תופסת מקום; שליחת ניתוח, סירוב או פקיעת זמן מפנים אותו.')),
      h('div', { class: 'field' }, h('label', { for: 'cs_hours' }, 'זמן תגובה מחייב (שעות)'), hours,
        h('div', { class: 'hint' }, 'אם לא יישלח ניתוח בזמן הזה, הבקשה תיסגר אוטומטית ותפנה את המקום.')),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'מדיניות הודעות המשך'), policies),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'ענפים שבהם אני מאמן/ת'), sportsBox),
      h('div', { class: 'field' }, h('label', { for: 'cs_bio' }, 'תיאור מקצועי'), bio),
      h('div', { class: 'field soon' }, h('div', { class: 'label' }, 'תשלום ', h('span', { class: 'tag' }, 'בהמשך')),
        h('p', { class: 'hint' }, 'קביעת מחיר לסרטון תתווסף בהמשך. בגרסת הניסיון אין תשלומים ואין הזנת פרטי אשראי.')),
      h('p', { class: 'hint' }, 'שינוי ההגדרות חל על בקשות חדשות בלבד. בקשות קיימות שומרות את התנאים שהיו בתוקף כששלחו אותן.'),
      save);
    save.onclick = () => busy(save, async () => {
      const qv = Number(quota.value), hv = Number(hours.value);
      const pol = form.querySelector('input[name=policy]:checked')?.value;
      const cs = picked(form, 'coach_sports');
      if (!Number.isInteger(qv) || qv < 0 || qv > 100) return toast('מכסה צריכה להיות מספר שלם בין 0 ל־100', 'err');
      if (!Number.isInteger(hv) || hv < 1 || hv > 720) return toast('זמן תגובה צריך להיות בין 1 ל־720 שעות', 'err');
      if (!cs.length) return toast('יש לבחור לפחות ענף אחד', 'err');
      try {
        await q(sb.from('coach_settings').update({ quota: qv, response_hours: hv, followup_policy: pol, updated_at: new Date().toISOString() }).eq('coach_id', p.id));
        const cur = (coachSports || []).map((r) => r.sport_id);
        const add = cs.filter((x) => !cur.includes(x)), rem = cur.filter((x) => !cs.includes(x));
        if (add.length) await q(sb.from('coach_sports').insert(add.map((sport_id) => ({ coach_id: p.id, sport_id }))));
        if (rem.length) await q(sb.from('coach_sports').delete().eq('coach_id', p.id).in('sport_id', rem));
        coachSports = cs.map((sport_id) => ({ sport_id }));
        await q(sb.from('profiles').update({ bio: bio.value.trim() }).eq('id', p.id));
        await loadProfile();
        toast('הגדרות המאמן נשמרו');
      } catch (e) { toast(friendlyError(e), 'err'); }
    });
    main.append(form);
  }

  // ---------- Personal details ----------
  const first = h('input', { type: 'text', id: 'p_first', value: p.first_name });
  const last = h('input', { type: 'text', id: 'p_last', value: p.last_name });
  const phone = h('input', { type: 'tel', id: 'p_phone', value: priv.phone || '', dir: 'ltr' });
  const sportsBox = chips('sports', interests.map((r) => r.sport_id));
  const save = h('button', { class: 'btn block' }, 'שמירת פרטים');
  const card = h('div', { class: 'card', style: { marginTop: '1rem' } },
    h('h2', { style: { marginTop: 0 } }, 'פרטים אישיים'),
    h('div', { class: 'field' }, h('label', { for: 'p_first' }, 'שם פרטי'), first),
    h('div', { class: 'field' }, h('label', { for: 'p_last' }, 'שם משפחה'), last),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'שם משתמש'), h('p', { dir: 'ltr', style: { textAlign: 'right' } }, '@' + p.username)),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'מייל'), h('p', { dir: 'ltr', style: { textAlign: 'right' } }, priv.email)),
    h('div', { class: 'field' }, h('label', { for: 'p_phone' }, 'טלפון'), phone, h('div', { class: 'hint' }, 'הטלפון והמייל אינם מוצגים למשתמשים אחרים.')),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'ענפי עניין (משפיעים על סדר הפיד)'), sportsBox),
    save);
  save.onclick = () => busy(save, async () => {
    if (!first.value.trim() || !last.value.trim()) return toast('יש למלא שם פרטי ושם משפחה', 'err');
    const sel = picked(card, 'sports');
    if (!sel.length) return toast('יש לבחור לפחות ענף עניין אחד', 'err');
    try {
      await q(sb.from('profiles').update({ first_name: first.value.trim(), last_name: last.value.trim() }).eq('id', p.id));
      await q(sb.from('profile_private').update({ phone: phone.value.trim() }).eq('id', p.id));
      const cur = interests.map((r) => r.sport_id);
      const add = sel.filter((x) => !cur.includes(x)), rem = cur.filter((x) => !sel.includes(x));
      if (add.length) await q(sb.from('user_sports').insert(add.map((sport_id) => ({ user_id: p.id, sport_id }))));
      if (rem.length) await q(sb.from('user_sports').delete().eq('user_id', p.id).in('sport_id', rem));
      interests = sel.map((sport_id) => ({ sport_id }));
      await loadProfile();
      toast('הפרטים נשמרו');
    } catch (e) { toast(friendlyError(e), 'err'); }
  });
  main.append(card,
    h('div', { class: 'btn-row', style: { marginTop: '1rem' } },
      h('a', { class: 'btn secondary', href: '#/me' }, 'חזרה לפרופיל'),
      h('a', { class: 'btn secondary', href: '#/forgot' }, 'שינוי סיסמה'),
      h('button', { class: 'btn secondary', onclick: () => sb.auth.signOut() }, 'יציאה')));
}
