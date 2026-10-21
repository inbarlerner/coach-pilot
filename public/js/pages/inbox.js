// Inbox: active / completed / not completed. Coaches can switch between received and sent.
import { h, clear, section, empty, tabs, fmtDate, timeLeft, STATUS, DECLINE } from '../ui.js';
import { sb, state, q, isCoach, sportName } from '../api.js';

const BOX = {
  active: { label: 'פעילות', statuses: ['pending', 'draft'] },
  done: { label: 'הושלמו', statuses: ['completed'] },
  failed: { label: 'בקשות שלא הושלמו', statuses: ['declined', 'expired'] },
};

export function inboxPage({ main, setTitle, query }) {
  setTitle('אינבוקס');
  const coach = isCoach();
  let side = query.get('side') || (coach ? 'received' : 'sent');
  let box = query.get('box') || 'active';
  const list = h('div');

  const render = () => {
    clear(main);
    main.append(h('h1', null, 'אינבוקס'));
    if (coach) {
      main.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'סוג בקשות', style: { marginBottom: '.5rem' } },
        [['received', 'בקשות שקיבלתי'], ['sent', 'בקשות ששלחתי']].map(([k, l]) =>
          h('button', { class: 'chip' + (side === k ? ' on' : ''), 'aria-pressed': String(side === k), onclick: () => { side = k; render(); } }, l))));
      if (state.profile.coach_status !== 'approved' && side === 'received') {
        main.append(h('div', { class: 'banner' }, 'החשבון שלך כמאמן ממתין לאישור מנהל. עד האישור לא יגיעו אליך בקשות.'));
      }
    }
    main.append(tabs(Object.entries(BOX).map(([k, v]) => [k, v.label]), box, (k) => { box = k; render(); }), list);
    load();
  };

  const load = () => section(list, async () => {
    const mineCol = side === 'received' ? 'coach_id' : 'trainee_id';
    return q(sb.from('analysis_requests')
      .select('id,status,decline_reason,created_at,deadline_at,completed_at,closed_at,trainee_read,coach_read,followup_policy,' +
        'video:videos(id,title,sport_id,visibility),' +
        'trainee:profiles!analysis_requests_trainee_id_fkey(first_name,last_name),' +
        'coach:profiles!analysis_requests_coach_id_fkey(first_name,last_name)')
      .eq(mineCol, state.user.id)
      .in('status', BOX[box].statuses)
      .order(box === 'active' ? 'deadline_at' : 'created_at', { ascending: box === 'active' })
      .limit(100));
  }, (rows) => {
    if (!rows.length) {
      const msgs = {
        active: side === 'received' ? ['אין בקשות פעילות', 'בקשות ניתוח חדשות יופיעו כאן.'] : ['אין בקשות פעילות', 'שלחו סרטון למאמן כדי לקבל ניתוח.'],
        done: ['אין עדיין בקשות שהושלמו', null],
        failed: ['אין בקשות שלא הושלמו', 'בקשות שסורבו או שזמן התגובה שלהן עבר יופיעו כאן.'],
      }[box];
      return empty(msgs[0], msgs[1], box === 'active' && side === 'sent' ? h('a', { class: 'btn', href: '#/upload' }, 'שליחת סרטון לניתוח') : null);
    }
    return h('div', null, rows.map((r) => {
      const read = side === 'received' ? r.coach_read : r.trainee_read;
      const other = side === 'received' ? r.trainee : r.coach;
      return h('a', { class: 'card link' + (read ? '' : ' unread'), href: '#/r/' + r.id },
        h('div', { class: 'list-item' },
          h('div', null,
            h('div', null, h('strong', null, r.video?.title || 'סרטון'), ' · ', sportName(r.video?.sport_id)),
            h('div', { class: 'meta' }, (side === 'received' ? 'מתאמן: ' : 'מאמן: ') + (other ? other.first_name + ' ' + other.last_name : '')),
            h('div', { class: 'meta' }, 'נשלחה: ' + fmtDate(r.created_at),
              box === 'active' ? ' · מועד אחרון: ' + fmtDate(r.deadline_at) + ' (' + timeLeft(r.deadline_at) + ')' : ''),
            r.status === 'declined' && h('div', { class: 'meta' }, 'סיבה: ' + (DECLINE[r.decline_reason] || '')),
            r.status === 'expired' && h('div', { class: 'meta' }, 'סיבה: המאמן לא הגיב בזמן'),
            h('div', { class: 'row', style: { marginTop: '.3rem' } },
              h('span', { class: 'tag' + (r.status === 'completed' ? ' fill' : '') }, STATUS[r.status]),
              !read && h('span', { class: 'tag soft' }, 'לא נקראה'))),
          !read && h('span', { class: 'dot', 'aria-label': 'לא נקראה' })));
    }));
  });

  render();
}
