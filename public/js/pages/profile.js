// Profiles: trainee (grid; owner sees public/private tabs) and coach (info + performances + analyses).
import { h, clear, loading, empty, errorState, friendlyError, tabs, section, POLICY, STATUS, icon } from '../ui.js';
import { sb, state, q, rpc, sportName, isAdmin } from '../api.js';
import { go } from '../app.js';

export function mePage() {
  if (state.profile) go('/u/' + state.profile.username);
  else go('/login');
}

export async function profilePage({ main, setTitle, params, query }) {
  const username = params[0];
  setTitle('פרופיל');
  clear(main).append(loading());
  let p;
  try { p = await q(sb.from('profiles').select('*').eq('username', username).maybeSingle()); }
  catch (e) { return clear(main).append(errorState(friendlyError(e), () => profilePage({ main, setTitle, params, query }))); }
  if (!p) return clear(main).append(errorState('המשתמש לא נמצא.'));
  const mine = p.id === state.user.id;
  const coachApproved = p.role === 'coach' && p.coach_status === 'approved';
  clear(main);

  // Header
  const sportsRow = h('p', { class: 'meta' });
  main.append(
    h('div', { class: 'row between' },
      h('div', null,
        h('h1', { style: { marginBottom: '.1rem' } }, p.first_name + ' ' + p.last_name),
        h('p', { class: 'meta', dir: 'ltr', style: { textAlign: 'right' } }, '@' + p.username)),
      h('div', { class: 'row' },
        p.is_sample && h('span', { class: 'tag' }, 'דוגמה'),
        p.role === 'coach' && h('span', { class: 'tag' + (coachApproved ? ' fill' : '') }, coachApproved ? 'מאמן' : p.coach_status === 'pending' ? 'מאמן · ממתין לאישור' : 'מאמן · לא אושר'),
        p.role === 'admin' && h('span', { class: 'tag fill' }, 'מנהל'),
        p.disabled && h('span', { class: 'tag' }, 'מושבת'))),
    sportsRow);

  if (mine) {
    main.append(h('div', { class: 'btn-row', style: { margin: '.5rem 0 1rem' } },
      h('a', { class: 'btn secondary small', href: '#/settings' }, p.role === 'coach' ? 'הגדרות מאמן ופרופיל' : 'עריכת פרופיל'),
      isAdmin() && h('a', { class: 'btn secondary small', href: '#/admin' }, 'ניהול'),
      h('button', { class: 'btn secondary small', onclick: () => sb.auth.signOut() }, 'יציאה')));
    if (p.role === 'coach' && p.coach_status === 'pending') main.append(h('div', { class: 'banner' }, 'החשבון שלך כמאמן ממתין לאישור מנהל. עד האישור לא תופיע/י בחיפוש ולא יגיעו אליך בקשות.'));
    if (p.role === 'coach' && p.coach_status === 'rejected') main.append(h('div', { class: 'banner' }, 'בקשת ההצטרפות כמאמן לא אושרה. אפשר עדיין להשתמש באתר כמתאמן.'));
  }

  // Sports
  try {
    const table = p.role === 'coach' ? 'coach_sports' : 'user_sports';
    const col = p.role === 'coach' ? 'coach_id' : 'user_id';
    const rows = await q(sb.from(table).select('sport_id').eq(col, p.id));
    sportsRow.textContent = (p.role === 'coach' ? 'מאמן/ת ב: ' : 'ענפים: ') + (rows.map((r) => sportName(r.sport_id)).filter(Boolean).join(', ') || '—');
  } catch {}

  if (p.role === 'coach') return coachProfile(main, p, mine, coachApproved, query);
  return traineeProfile(main, p, mine, query);
}

function videoGrid(videos, extra) {
  if (!videos.length) return null;
  return h('div', { class: 'grid' }, videos.map((v) => h('a', { class: 'tile', href: '#/v/' + v.id },
    h('span', { class: 'play' }, icon('play')),
    h('span', { class: 't' }, v.title),
    h('span', { class: 'meta' }, sportName(v.sport_id)),
    h('span', { class: 'row' },
      v.visibility === 'private' && h('span', { class: 'tag soft' }, 'פרטי'),
      v.is_sample && h('span', { class: 'tag' }, 'דוגמה'),
      extra && extra(v)))));
}

async function latestStatusMap(videoIds) {
  if (!videoIds.length) return {};
  const rows = await q(sb.from('analysis_requests').select('video_id,status,created_at').in('video_id', videoIds).order('created_at', { ascending: false }));
  const m = {};
  rows.forEach((r) => { if (!m[r.video_id]) m[r.video_id] = r.status; });
  return m;
}

function traineeProfile(main, p, mine, query) {
  let tab = query.get('tab') || 'public';
  const body = h('div');
  const render = () => {
    clear(body);
    if (mine) body.append(tabs([['public', 'ציבורי'], ['private', 'פרטי']], tab, (k) => { tab = k; render(); }));
    const grid = h('div');
    body.append(grid);
    section(grid, async () => {
      const vis = mine ? tab : 'public';
      const vids = await q(sb.from('videos').select('id,title,sport_id,visibility,is_sample,created_at').eq('owner_id', p.id).eq('visibility', vis).order('created_at', { ascending: false }));
      const st = mine ? await latestStatusMap(vids.map((v) => v.id)) : {};
      return { vids, st, vis };
    }, ({ vids, st, vis }) => videoGrid(vids, (v) => st[v.id] && h('span', { class: 'tag soft' }, STATUS[st[v.id]]))
      || empty(vis === 'public' ? 'אין סרטונים ציבוריים' : 'אין סרטונים פרטיים',
        mine ? (vis === 'public' ? 'סרטונים שתבחרו לפרסם כציבוריים יופיעו כאן.' : 'סרטונים פרטיים נראים רק לך (ולמאמן שאליו נשלחו).') : null,
        mine && h('a', { class: 'btn', href: '#/upload' }, 'העלאת סרטון')));
  };
  main.append(h('h2', null, 'סרטונים'), body);
  render();
}

async function coachProfile(main, p, mine, approved, query) {
  const info = h('div');
  main.append(info);
  if (p.bio) info.append(h('p', { class: 'pre' }, p.bio));
  if (approved) {
    try {
      const c = (await rpc('search_coaches', { p_query: p.username, p_sport: null })).find((x) => x.id === p.id);
      if (c) {
        info.append(h('dl', { class: 'kv' },
          h('dt', null, 'זמן תגובה'), h('dd', null, `עד ${c.response_hours} שעות`),
          h('dt', null, 'הודעות המשך'), h('dd', null, POLICY[c.followup_policy]),
          h('dt', null, 'זמינות'), h('dd', null, c.available ? `פנוי לבקשות (${c.quota - c.active_count} מקומות)` : 'אין כרגע מקום פנוי')));
        if (!mine) info.append(c.available
          ? h('a', { class: 'btn block', href: '#/upload?coach=' + p.id }, 'שליחת סרטון לניתוח')
          : h('button', { class: 'btn block', disabled: true }, 'אין כרגע מקום פנוי'));
      }
    } catch (e) { info.append(errorState(friendlyError(e))); }
  } else if (!mine) {
    info.append(h('p', { class: 'banner' }, 'המאמן עדיין לא מאושר ואינו מקבל בקשות.'));
  }

  let tab = query.get('tab') || 'perf';
  const names = [['perf', 'ביצועים שלי'], ['analyses', 'ניתוחים שלי']];
  if (mine) names.push(['private', 'סרטונים פרטיים']);
  const body = h('div');
  const render = () => {
    clear(body).append(tabs(names, tab, (k) => { tab = k; render(); }));
    const box = h('div');
    body.append(box);
    if (tab === 'perf' || tab === 'private') {
      section(box, () => q(sb.from('videos').select('id,title,sport_id,visibility,is_sample').eq('owner_id', p.id)
        .eq('visibility', tab === 'perf' ? 'public' : 'private').order('created_at', { ascending: false })),
      (vids) => videoGrid(vids) || empty(tab === 'perf' ? 'אין עדיין סרטוני ביצועים ציבוריים' : 'אין סרטונים פרטיים', null,
        mine && h('a', { class: 'btn', href: '#/upload' }, 'העלאת סרטון')));
    } else {
      // Portfolio: completed analyses on videos that are public right now
      section(box, () => q(sb.from('analysis_requests')
        .select('id,completed_at,video:videos!inner(id,title,sport_id,visibility,is_sample,removed)')
        .eq('coach_id', p.id).eq('status', 'completed').eq('video.visibility', 'public').eq('video.removed', false)
        .order('completed_at', { ascending: false })),
      (rows) => videoGrid(rows.map((r) => r.video)) || empty('אין עדיין ניתוחים ציבוריים',
        'ניתוחים מופיעים כאן כשהמתאמן בחר לפרסם את הסרטון כציבורי.'));
    }
  };
  main.append(body);
  render();
}
