// In-app notifications.
import { h, section, empty, fmtDate, busy, toast, friendlyError } from '../ui.js';
import { sb, state, q } from '../api.js';
import { refreshBadge } from '../app.js';

export function notificationsPage({ main, setTitle }) {
  setTitle('התראות');
  const list = h('div');
  const markAll = h('button', { class: 'btn secondary small' }, 'סימון הכול כנקרא');
  markAll.onclick = () => busy(markAll, async () => {
    try { await q(sb.from('notifications').update({ read: true }).eq('user_id', state.user.id).eq('read', false)); await refreshBadge(); load(); }
    catch (e) { toast(friendlyError(e), 'err'); }
  });
  main.append(h('div', { class: 'row between' }, h('h1', null, 'התראות'), markAll), list);
  const load = () => section(list,
    () => q(sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)),
    (rows) => rows.length ? h('div', null, rows.map((n) => {
      const href = n.request_id ? '#/r/' + n.request_id : (n.type === 'coach_status' ? '#/me' : null);
      const open = async (e) => {
        if (!n.read) { e.preventDefault(); await sb.from('notifications').update({ read: true }).eq('id', n.id); await refreshBadge(); location.hash = href || '#/notifications'; }
      };
      return h(href ? 'a' : 'div', { class: 'card' + (href ? ' link' : '') + (n.read ? '' : ' unread'), href, onclick: href ? open : null },
        h('div', { class: 'list-item' }, h('div', null, h('div', null, n.body), h('div', { class: 'meta' }, fmtDate(n.created_at))),
          !n.read && h('span', { class: 'dot', 'aria-label': 'חדש' })));
    })) : empty('אין התראות', 'התראות על בקשות, ניתוחים והודעות יופיעו כאן.'));
  load();
}
