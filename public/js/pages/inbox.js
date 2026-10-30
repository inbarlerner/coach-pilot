// Inbox: active / completed / not completed. Coaches can switch between received and sent.
import { h, clear, section, empty, tabs, fmtDate, timeLeft, statusTag, DECLINE } from '../ui.js';
import { sb, state, q, isCoach, sportName } from '../api.js';
import { avatar, FORMER_COACH } from '../images.js';

const BOX = {
  active: { label: 'Active', statuses: ['pending', 'draft'] },
  done: { label: 'Completed', statuses: ['completed'] },
  failed: { label: 'Not completed', statuses: ['declined', 'expired'] },
};

export function inboxPage({ main, query }) {
  const coach = isCoach();
  let side = query.get('side') || (coach ? 'received' : 'sent');
  let box = query.get('box') || 'active';
  const list = h('div');

  const render = () => {
    clear(main);
    main.append(h('h1', null, 'Inbox'));
    if (coach) {
      main.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'Request type', style: { marginBottom: 'var(--space-2)' } },
        [['received', 'Requests I received'], ['sent', 'Requests I sent']].map(([k, l]) =>
          h('button', { class: 'chip' + (side === k ? ' on' : ''), 'aria-pressed': String(side === k), onclick: () => { side = k; render(); } }, l))));
      if (state.profile.coach_status !== 'approved' && side === 'received') {
        main.append(h('div', { class: 'banner' }, 'Your coach account is waiting for admin approval. You won\'t receive requests until then.'));
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
        'trainee:profiles!analysis_requests_trainee_id_fkey(first_name,last_name,avatar_key),' +
        'coach:profiles!analysis_requests_coach_id_fkey(first_name,last_name,avatar_key)')
      .eq(mineCol, state.user.id)
      .in('status', BOX[box].statuses)
      .order(box === 'active' ? 'deadline_at' : 'created_at', { ascending: box === 'active' })
      .limit(100));
  }, (rows) => {
    if (!rows.length) {
      const msgs = {
        active: side === 'received' ? ['No active requests', 'New analysis requests show up here.'] : ['No active requests', 'Send a video to a coach to get an analysis.'],
        done: ['No completed requests yet', null],
        failed: ['No incomplete requests', 'Requests that were declined or ran out of time show up here.'],
      }[box];
      return empty(msgs[0], msgs[1], box === 'active' && side === 'sent' ? h('a', { class: 'btn', href: '#/upload' }, 'Send a video for analysis') : null);
    }
    return h('div', null, rows.map((r) => {
      const read = side === 'received' ? r.coach_read : r.trainee_read;
      const other = side === 'received' ? r.trainee : (r.coach || FORMER_COACH);
      return h('a', { class: 'card link' + (read ? '' : ' unread'), href: '#/r/' + r.id },
        h('div', { class: 'list-item' },
          h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'nowrap', gap: 'var(--space-3)' } },
            avatar(other, 44),
            h('div', null,
              h('div', null, h('strong', null, r.video?.title || 'Video'), ' · ', sportName(r.video?.sport_id)),
              h('div', { class: 'meta' }, (side === 'received' ? 'Trainee: ' : 'Coach: ') + (other ? other.first_name + ' ' + other.last_name : '')),
              h('div', { class: 'meta' }, 'Sent: ' + fmtDate(r.created_at),
                box === 'active' ? ' · Deadline: ' + fmtDate(r.deadline_at) + ' (' + timeLeft(r.deadline_at) + ')' : ''),
              r.status === 'declined' && h('div', { class: 'meta' }, 'Reason: ' + (DECLINE[r.decline_reason] || '')),
              r.status === 'expired' && h('div', { class: 'meta' }, 'Reason: the coach did not respond in time'),
              h('div', { class: 'row', style: { marginTop: 'var(--space-1)' } },
                statusTag(r.status),
                !read && h('span', { class: 'tag soft' }, 'Unread')))),
          !read && h('span', { class: 'dot', 'aria-label': 'Unread' })));
    }));
  });

  render();
}
