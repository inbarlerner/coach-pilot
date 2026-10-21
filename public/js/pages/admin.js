// Admin: coach join requests, users (disable / sample flag), reports, sports.
import { h, clear, section, empty, tabs, fmtDate, busy, toast, friendlyError, confirmDialog, errorState } from '../ui.js';
import { sb, state, q, rpc, isAdmin, sportName, loadSports } from '../api.js';

export function adminPage({ main, setTitle, query }) {
  setTitle('ניהול');
  if (!isAdmin()) return main.append(errorState('אין לך הרשאת מנהל.'));
  let tab = query.get('tab') || 'coaches';
  const body = h('div');
  const render = () => {
    clear(main).append(h('h1', null, 'ניהול'),
      tabs([['coaches', 'בקשות מאמנים'], ['users', 'משתמשים'], ['reports', 'דיווחים'], ['sports', 'ענפים']], tab, (k) => { tab = k; render(); }), body);
    ({ coaches, users, reports, sports })[tab](clear(body));
  };
  render();
}

async function details(ids) {
  if (!ids.length) return [{}, {}];
  const [priv, cs] = await Promise.all([
    q(sb.from('profile_private').select('*').in('id', ids)),
    q(sb.from('coach_sports').select('*').in('coach_id', ids)),
  ]);
  const pm = Object.fromEntries(priv.map((p) => [p.id, p]));
  const sm = {};
  cs.forEach((r) => (sm[r.coach_id] ||= []).push(sportName(r.sport_id)));
  return [pm, sm];
}

function coaches(box) {
  let filter = 'pending';
  const list = h('div');
  const bar = h('div', { class: 'chips', style: { marginBottom: '1rem' } });
  const drawBar = () => clear(bar).append(...[['pending', 'ממתינים'], ['approved', 'מאושרים'], ['rejected', 'נדחו']].map(([k, l]) =>
    h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; drawBar(); load(); } }, l)));
  drawBar();
  box.append(bar, list);
  const load = () => section(list, async () => {
    const rows = await q(sb.from('profiles').select('*').eq('role', 'coach').eq('coach_status', filter).order('created_at', { ascending: false }));
    const [pm, sm] = await details(rows.map((r) => r.id));
    return { rows, pm, sm };
  }, ({ rows, pm, sm }) => rows.length ? h('div', null, rows.map((p) => {
    const approve = h('button', { class: 'btn small' }, 'אישור');
    const reject = h('button', { class: 'btn secondary small' }, 'דחייה');
    const set = (status, btn) => async () => {
      if (!(await confirmDialog(status === 'approved' ? `לאשר את ${p.first_name} ${p.last_name} כמאמן?` : `לדחות את ${p.first_name} ${p.last_name}?`,
        status === 'approved' ? 'המאמן יופיע בחיפוש ויוכל לקבל בקשות.' : 'המשתמש לא יופיע כמאמן ולא יקבל בקשות.', 'אישור'))) return;
      busy(btn, async () => {
        try { await rpc('admin_set_coach_status', { p_user: p.id, p_status: status }); toast('עודכן'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    approve.onclick = set('approved', approve);
    reject.onclick = set('rejected', reject);
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('a', { href: '#/u/' + p.username }, h('strong', null, p.first_name + ' ' + p.last_name)), h('span', { class: 'meta' }, 'נרשם: ' + fmtDate(p.created_at))),
      h('dl', { class: 'kv' },
        h('dt', null, 'שם משתמש'), h('dd', { dir: 'ltr', style: { textAlign: 'right' } }, '@' + p.username),
        h('dt', null, 'מייל'), h('dd', { dir: 'ltr', style: { textAlign: 'right' } }, pm[p.id]?.email || ''),
        h('dt', null, 'טלפון'), h('dd', { dir: 'ltr', style: { textAlign: 'right' } }, pm[p.id]?.phone || ''),
        h('dt', null, 'ענפים'), h('dd', null, (sm[p.id] || []).join(', ') || '—')),
      h('p', { class: 'pre' }, p.bio || 'ללא תיאור'),
      h('div', { class: 'btn-row' }, filter !== 'approved' && approve, filter !== 'rejected' && reject));
  })) : empty(filter === 'pending' ? 'אין בקשות הצטרפות ממתינות' : 'אין משתמשים ברשימה הזו'));
  load();
}

function users(box) {
  const qIn = h('input', { type: 'search', placeholder: 'חיפוש לפי שם או שם משתמש' });
  const list = h('div');
  let t;
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 350); });
  box.append(h('div', { class: 'field' }, qIn), list);
  const load = () => section(list, async () => {
    let qq = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
    const s = qIn.value.trim();
    if (s) qq = qq.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,username.ilike.%${s}%`);
    const rows = await q(qq);
    const [pm] = await details(rows.map((r) => r.id));
    return { rows, pm };
  }, ({ rows, pm }) => rows.length ? h('div', null, rows.map((p) => {
    const dis = h('button', { class: 'btn secondary small' }, p.disabled ? 'הפעלת חשבון' : 'השבתת חשבון');
    dis.onclick = async () => {
      if (!(await confirmDialog(p.disabled ? 'להפעיל מחדש את החשבון?' : 'להשבית את החשבון?', p.disabled ? null : 'המשתמש לא יוכל לבצע פעולות, והתוכן הציבורי שלו יוסתר.', 'אישור'))) return;
      busy(dis, async () => { try { await rpc('admin_set_disabled', { p_user: p.id, p_disabled: !p.disabled }); toast('עודכן'); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
    };
    const sample = h('button', { class: 'btn ghost small' }, p.is_sample ? 'ביטול סימון ״דוגמה״' : 'סימון כ״דוגמה״');
    sample.onclick = () => busy(sample, async () => { try { await rpc('admin_set_sample', { p_user: p.id, p_sample: !p.is_sample }); toast('עודכן'); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
    const roleLabel = p.role === 'admin' ? 'מנהל' : p.role === 'coach' ? `מאמן (${({ pending: 'ממתין', approved: 'מאושר', rejected: 'נדחה' })[p.coach_status] || ''})` : 'מתאמן';
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('a', { href: '#/u/' + p.username }, h('strong', null, p.first_name + ' ' + p.last_name)),
        h('div', { class: 'row' }, h('span', { class: 'tag soft' }, roleLabel), p.disabled && h('span', { class: 'tag fill' }, 'מושבת'), p.is_sample && h('span', { class: 'tag' }, 'דוגמה'))),
      h('p', { class: 'meta', dir: 'ltr', style: { textAlign: 'right' } }, (pm[p.id]?.email || '') + ' · ' + (pm[p.id]?.phone || '')),
      p.id !== state.user.id && h('div', { class: 'btn-row' }, dis, sample));
  })) : empty('לא נמצאו משתמשים'));
  load();
}

function reports(box) {
  let showResolved = false;
  const list = h('div');
  const toggle = h('label', { class: 'chip' }, h('input', { type: 'checkbox', onchange: (e) => { showResolved = e.target.checked; load(); } }), 'הצגת דיווחים שטופלו');
  box.append(h('div', { style: { marginBottom: '1rem' } }, toggle), list);
  const load = () => section(list,
    () => q(sb.from('reports').select('*, video:videos(id,title,removed,visibility), reporter:profiles!reports_reporter_id_fkey(first_name,last_name)')
      .eq('resolved', showResolved).order('created_at', { ascending: false })),
    (rows) => rows.length ? h('div', null, rows.map((r) => {
      const rm = h('button', { class: 'btn small' }, r.video?.removed ? 'שחזור תוכן' : 'הסרת התוכן');
      rm.onclick = () => busy(rm, async () => { try { await rpc('admin_set_video_removed', { p_video: r.video.id, p_removed: !r.video.removed }); toast('עודכן'); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
      const ok = h('button', { class: 'btn secondary small' }, 'סימון כטופל ללא הסרה');
      ok.onclick = () => busy(ok, async () => { try { await q(sb.from('reports').update({ resolved: true }).eq('id', r.id)); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
      return h('div', { class: 'card' },
        h('div', null, h('a', { href: '#/v/' + r.video?.id }, h('strong', null, r.video?.title || 'סרטון')), r.video?.removed && [' ', h('span', { class: 'tag fill' }, 'הוסר')]),
        h('p', { class: 'meta' }, 'דווח על ידי ' + (r.reporter ? r.reporter.first_name + ' ' + r.reporter.last_name : '') + ' · ' + fmtDate(r.created_at)),
        h('p', { class: 'pre' }, r.reason),
        h('div', { class: 'btn-row' }, rm, !r.resolved && ok));
    })) : empty(showResolved ? 'אין דיווחים שטופלו' : 'אין דיווחים פתוחים'));
  load();
}

function sports(box) {
  const name = h('input', { type: 'text', id: 'sp_name', placeholder: 'למשל: גלישת גלים' });
  const add = h('button', { class: 'btn' }, 'הוספת ענף');
  const list = h('div');
  add.onclick = () => busy(add, async () => {
    if (!name.value.trim()) return toast('יש להזין שם ענף', 'err');
    try { await q(sb.from('sports').insert({ name: name.value.trim() })); name.value = ''; await loadSports(true); toast('הענף נוסף'); load(); }
    catch (e) { toast(/duplicate/.test(e.message) ? 'ענף בשם הזה כבר קיים' : friendlyError(e), 'err'); }
  });
  box.append(h('div', { class: 'card' }, h('div', { class: 'field' }, h('label', { for: 'sp_name' }, 'ענף חדש'), name), add), h('h2', null, 'ענפים קיימים'), list);
  const load = () => section(list, () => q(sb.from('sports').select('*').order('sort').order('name')),
    (rows) => h('div', null, rows.map((s) => {
      const t = h('button', { class: 'btn secondary small' }, s.active ? 'הסתרה' : 'הפעלה');
      t.onclick = () => busy(t, async () => { try { await q(sb.from('sports').update({ active: !s.active }).eq('id', s.id)); await loadSports(true); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
      return h('div', { class: 'card list-item' }, h('span', null, s.name, !s.active && [' ', h('span', { class: 'tag soft' }, 'מוסתר')]), t);
    })));
  load();
}
