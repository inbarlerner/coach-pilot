// Admin: coach join requests, users (disable / sample flag), reports, sports.
import { h, clear, section, empty, tabs, fmtDate, busy, toast, friendlyError, confirmDialog, confirmDanger, errorState } from '../ui.js';
import { sb, state, q, rpc, isAdmin, sportName, loadSports, languageNames } from '../api.js';
import { personLink } from '../images.js';

export function adminPage({ main, query }) {
  if (!isAdmin()) return main.append(h('h1', null, 'Admin'), errorState('You do not have admin access.'));
  let tab = query.get('tab') || 'coaches';
  const body = h('div');
  const render = () => {
    const usage = h('p', { class: 'meta' });
    rpc('admin_storage_usage').then((r) => {
      const u = Array.isArray(r) ? r[0] : r;
      if (!u) return;
      const mb = (b) => Math.round(b / 1048576);
      usage.textContent = `File storage: ${mb(u.used_bytes)}MB of ${mb(u.cap_bytes)}MB (${u.file_count} files). At the limit, the oldest videos are removed automatically, except those in open requests.`;
    }).catch(() => {});
    clear(main).append(h('div', { class: 'row between' }, h('h1', null, 'Admin'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn secondary small', href: '#/admin/lab' }, 'AI coach lab'), h('a', { class: 'btn secondary small', href: '#/admin/feedback' }, 'Feedback for Claude'))), usage,
      tabs([['coaches', 'Coach applications'], ['users', 'Users'], ['reports', 'Reports'], ['sports', 'Sports']], tab, (k) => { tab = k; render(); }), body);
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
  const bar = h('div', { class: 'chips', style: { marginBottom: 'var(--space-4)' } });
  const drawBar = () => clear(bar).append(...[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([k, l]) =>
    h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; drawBar(); load(); } }, l)));
  drawBar();
  box.append(bar, list);
  const load = () => section(list, async () => {
    const rows = await q(sb.from('profiles').select('*').eq('role', 'coach').eq('coach_status', filter).order('created_at', { ascending: false }));
    const [pm, sm] = await details(rows.map((r) => r.id));
    return { rows, pm, sm };
  }, ({ rows, pm, sm }) => rows.length ? h('div', null, rows.map((p) => {
    const approve = h('button', { class: 'btn small' }, 'Approve');
    const reject = h('button', { class: 'btn danger small' }, 'Reject');
    const set = (status, btn) => async () => {
      if (!(await (status === 'approved' ? confirmDialog : confirmDanger)(status === 'approved' ? `Approve ${p.first_name} ${p.last_name} as a coach?` : `Reject ${p.first_name} ${p.last_name}?`,
        status === 'approved' ? 'The coach will appear in search and can receive requests.' : 'The user will not appear as a coach or receive requests.', 'OK'))) return;
      busy(btn, async () => {
        try { await rpc('admin_set_coach_status', { p_user: p.id, p_status: status }); toast('Updated'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    approve.onclick = set('approved', approve);
    reject.onclick = set('rejected', reject);
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, personLink(p), h('span', { class: 'meta' }, 'Joined: ' + fmtDate(p.created_at))),
      h('dl', { class: 'kv' },
        h('dt', null, 'Username'), h('dd', null, '@' + p.username),
        h('dt', null, 'Email'), h('dd', null, pm[p.id]?.email || ''),
        h('dt', null, 'Phone'), h('dd', null, pm[p.id]?.phone || ''),
        h('dt', null, 'Sports'), h('dd', null, (sm[p.id] || []).join(', ') || '—'),
        h('dt', null, 'Languages'), h('dd', null, languageNames(p.languages) || '—')),
      h('p', { class: 'pre' }, p.bio || 'No bio'),
      h('div', { class: 'btn-row' }, filter !== 'approved' && approve, filter !== 'rejected' && reject));
  })) : empty(filter === 'pending' ? 'No pending coach applications' : 'No users in this list'));
  load();
}

function users(box) {
  const qIn = h('input', { type: 'search', placeholder: 'Search by name or username' });
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
    const dis = h('button', { class: p.disabled ? 'btn secondary small' : 'btn danger small' }, p.disabled ? 'Enable account' : 'Disable account');
    dis.onclick = async () => {
      if (!(await (p.disabled ? confirmDialog : confirmDanger)(p.disabled ? 'Enable this account again?' : 'Disable this account?', p.disabled ? null : 'The user will not be able to do anything, and their public content will be hidden.', 'OK'))) return;
      busy(dis, async () => { try { await rpc('admin_set_disabled', { p_user: p.id, p_disabled: !p.disabled }); toast('Updated'); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
    };
    const sample = h('button', { class: 'btn ghost small' }, p.is_sample ? 'Unmark as sample' : 'Mark as sample');
    sample.onclick = () => busy(sample, async () => { try { await rpc('admin_set_sample', { p_user: p.id, p_sample: !p.is_sample }); toast('Updated'); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
    const roleLabel = p.role === 'admin' ? 'Admin' : p.role === 'coach' ? `Coach (${({ pending: 'pending', approved: 'approved', rejected: 'rejected' })[p.coach_status] || ''})` : 'Trainee';
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, personLink(p),
        h('div', { class: 'row' }, h('span', { class: 'tag soft' }, roleLabel), p.disabled && h('span', { class: 'tag fill' }, 'Disabled'), p.is_sample && h('span', { class: 'tag' }, 'Sample'))),
      h('p', { class: 'meta' }, (pm[p.id]?.email || '') + ' · ' + (pm[p.id]?.phone || '')),
      p.id !== state.user.id && h('div', { class: 'btn-row' }, dis, sample));
  })) : empty('No users found'));
  load();
}

function reports(box) {
  let showResolved = false;
  const list = h('div');
  const toggle = h('label', { class: 'chip' }, h('input', { type: 'checkbox', onchange: (e) => { showResolved = e.target.checked; load(); } }), 'Show handled reports');
  box.append(h('div', { style: { marginBottom: 'var(--space-4)' } }, toggle), list);
  const load = () => section(list,
    () => q(sb.from('reports').select('*, video:videos(id,title,removed,visibility), reporter:profiles!reports_reporter_id_fkey(first_name,last_name)')
      .eq('resolved', showResolved).order('created_at', { ascending: false })),
    (rows) => rows.length ? h('div', null, rows.map((r) => {
      const rm = h('button', { class: r.video?.removed ? 'btn small' : 'btn danger small' }, r.video?.removed ? 'Restore content' : 'Remove content');
      rm.onclick = () => busy(rm, async () => { try { await rpc('admin_set_video_removed', { p_video: r.video.id, p_removed: !r.video.removed }); toast('Updated'); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
      const ok = h('button', { class: 'btn secondary small' }, 'Mark handled without removing');
      ok.onclick = () => busy(ok, async () => { try { await q(sb.from('reports').update({ resolved: true }).eq('id', r.id)); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
      return h('div', { class: 'card' },
        h('div', null, h('a', { href: '#/v/' + r.video?.id }, h('strong', null, r.video?.title || 'Video')), r.video?.removed && [' ', h('span', { class: 'tag fill' }, 'Removed')]),
        h('p', { class: 'meta' }, 'Reported by ' + (r.reporter ? r.reporter.first_name + ' ' + r.reporter.last_name : '') + ' · ' + fmtDate(r.created_at)),
        h('p', { class: 'pre' }, r.reason),
        h('div', { class: 'btn-row' }, rm, !r.resolved && ok));
    })) : empty(showResolved ? 'No handled reports' : 'No open reports'));
  load();
}

function sports(box) {
  const name = h('input', { type: 'text', id: 'sp_name', placeholder: 'e.g. Surfing' });
  const add = h('button', { class: 'btn' }, 'Add sport');
  const list = h('div');
  add.onclick = () => busy(add, async () => {
    if (!name.value.trim()) return toast('Enter a sport name', 'err');
    try { await q(sb.from('sports').insert({ name: name.value.trim() })); name.value = ''; await loadSports(true); toast('Sport added'); load(); }
    catch (e) { toast(/duplicate/.test(e.message) ? 'A sport with this name already exists' : friendlyError(e), 'err'); }
  });
  box.append(h('div', { class: 'card' }, h('div', { class: 'field' }, h('label', { for: 'sp_name' }, 'New sport'), name), add), h('h2', null, 'Existing sports'), list);
  const load = () => section(list, () => q(sb.from('sports').select('*').order('sort').order('name')),
    (rows) => h('div', null, rows.map((s) => {
      const t = h('button', { class: 'btn secondary small' }, s.active ? 'Hide' : 'Show');
      t.onclick = () => busy(t, async () => { try { await q(sb.from('sports').update({ active: !s.active }).eq('id', s.id)); await loadSports(true); load(); } catch (e) { toast(friendlyError(e), 'err'); } });
      return h('div', { class: 'card list-item' }, h('span', null, s.name, !s.active && [' ', h('span', { class: 'tag soft' }, 'Hidden')]), t);
    })));
  load();
}
