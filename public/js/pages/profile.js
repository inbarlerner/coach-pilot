// Profiles: trainee (grid; owner sees public/private tabs) and coach (info + performances + analyses).
import { h, clear, loading, empty, errorState, friendlyError, tabs, section, POLICY, statusTag, icon } from '../ui.js';
import { plural } from '../ui.js';
import { sb, state, q, rpc, sportName, isAdmin, coverUrl } from '../api.js';
import { avatar, coverImg } from '../images.js';
import { languagesLine } from '../components.js';
import { go } from '../app.js';

export function mePage() {
  if (state.profile) go('/u/' + state.profile.username);
  else go('/login');
}

export async function profilePage({ main, params, query }) {
  const username = params[0];
  clear(main).append(loading());
  let p;
  try { p = await q(sb.from('profiles').select('*').eq('username', username).maybeSingle()); }
  catch (e) { return clear(main).append(h('h1', null, 'Profile'), errorState(friendlyError(e), () => profilePage({ main, params, query }))); }
  if (!p) return clear(main).append(h('h1', null, 'Profile'), errorState('User not found.'));
  const mine = p.id === state.user.id;
  const coachApproved = p.role === 'coach' && p.coach_status === 'approved';
  clear(main);

  // Header
  const sportsRow = h('p', { class: 'meta' });
  main.append(
    h('div', { class: 'row between' },
      h('div', { class: 'row', style: { gap: 'var(--space-3)', flexWrap: 'nowrap' } },
        mine ? h('a', { href: '#/settings', 'aria-label': 'Change profile photo' }, avatar(p, 72)) : avatar(p, 72),
        h('div', null,
          h('h1', { style: { marginBottom: 'var(--space-1)' } }, p.first_name + ' ' + p.last_name),
          h('p', { class: 'meta' }, '@' + p.username))),
      h('div', { class: 'row' },
        p.is_sample && h('span', { class: 'tag' }, 'Sample'),
        p.role === 'coach' && h('span', { class: 'tag' + (coachApproved ? ' fill' : '') }, coachApproved ? 'Coach' : p.coach_status === 'pending' ? 'Coach · pending approval' : 'Coach · not approved'),
        p.role === 'admin' && h('span', { class: 'tag fill' }, 'Admin'),
        p.disabled && h('span', { class: 'tag' }, 'Disabled'))),
    sportsRow,
    languagesLine(p.languages));

  if (mine) {
    main.append(h('div', { class: 'btn-row', style: { margin: 'var(--space-2) 0 var(--space-4)' } },
      h('a', { class: 'btn secondary small', href: '#/settings' }, p.role === 'coach' ? 'Coach settings & profile' : 'Edit profile'),
      isAdmin() && h('a', { class: 'btn secondary small', href: '#/admin' }, 'Admin'),
      h('button', { class: 'btn secondary small', onclick: () => sb.auth.signOut() }, 'Sign out')));
    if (!(p.languages || []).length) main.append(h('div', { class: 'banner' }, 'Add the languages you speak so coaches and trainees know how to talk with you. ', h('a', { href: '#/settings' }, 'Add languages')));
    if (p.role === 'coach' && p.coach_status === 'pending') main.append(h('div', { class: 'banner' }, 'Your coach account is waiting for admin approval. Until then you won\'t appear in search or receive requests.'));
    if (p.role === 'coach' && p.coach_status === 'rejected') main.append(h('div', { class: 'banner' }, 'Your coach application was not approved. You can still use the site as a trainee.'));
  }

  // Sports
  try {
    const table = p.role === 'coach' ? 'coach_sports' : 'user_sports';
    const col = p.role === 'coach' ? 'coach_id' : 'user_id';
    const rows = await q(sb.from(table).select('sport_id').eq(col, p.id));
    sportsRow.textContent = (p.role === 'coach' ? 'Coaches: ' : 'Sports: ') + (rows.map((r) => sportName(r.sport_id)).filter(Boolean).join(', ') || '—');
  } catch {}

  if (p.role === 'coach') return coachProfile(main, p, mine, coachApproved, query);
  return traineeProfile(main, p, mine, query);
}

function videoGrid(videos, extra) {
  if (!videos.length) return null;
  return h('div', { class: 'grid' }, videos.map((v) => h('a', { class: 'tile', href: '#/v/' + v.id },
    v.cover_key && coverImg(coverUrl(v.cover_key)),
    h('span', { class: 'play' }, icon('play')),
    h('span', { class: 't' }, v.title),
    h('span', { class: 'meta' }, sportName(v.sport_id)),
    h('span', { class: 'row' },
      v.visibility === 'private' && h('span', { class: 'tag soft' }, 'Private'),
      v.file_deleted_at && h('span', { class: 'tag soft' }, 'File removed'),
      v.is_sample && h('span', { class: 'tag' }, 'Sample'),
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
    if (mine) body.append(tabs([['public', 'Public'], ['private', 'Private']], tab, (k) => { tab = k; render(); }));
    const grid = h('div');
    body.append(grid);
    section(grid, async () => {
      const vis = mine ? tab : 'public';
      const vids = await q(sb.from('videos').select('*').eq('owner_id', p.id).eq('visibility', vis).order('created_at', { ascending: false }));
      const st = mine ? await latestStatusMap(vids.map((v) => v.id)) : {};
      return { vids, st, vis };
    }, ({ vids, st, vis }) => videoGrid(vids, (v) => st[v.id] && statusTag(st[v.id]))
      || empty(vis === 'public' ? 'No public videos' : 'No private videos',
        mine ? (vis === 'public' ? 'Videos you choose to make public show up here.' : 'Private videos are visible only to you (and the coach you sent them to).') : null,
        mine && h('a', { class: 'btn', href: '#/upload' }, 'Upload a video')));
  };
  main.append(h('h2', null, 'Videos'), body);
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
          h('dt', null, 'Response time'), h('dd', null, `Up to ${c.response_hours} hours`),
          h('dt', null, 'Follow-ups'), h('dd', null, POLICY[c.followup_policy]),
          h('dt', null, 'Availability'), h('dd', null, c.available ? 'Taking requests (' + plural(c.quota - c.active_count, '1 spot', 'spots') + ')' : 'No free spot right now')));
        if (!mine) info.append(c.available
          ? h('a', { class: 'btn block', href: '#/upload?coach=' + p.id }, 'Send a video for analysis')
          : h('button', { class: 'btn block', disabled: true }, 'No free spot right now'));
      }
    } catch (e) { info.append(errorState(friendlyError(e))); }
  } else if (!mine) {
    info.append(h('p', { class: 'banner' }, 'This coach is not approved yet and is not taking requests.'));
  }

  let tab = query.get('tab') || 'perf';
  const names = [['perf', 'My performances'], ['analyses', 'My analyses']];
  if (mine) names.push(['private', 'Private videos']);
  const body = h('div');
  const render = () => {
    clear(body).append(tabs(names, tab, (k) => { tab = k; render(); }));
    const box = h('div');
    body.append(box);
    if (tab === 'perf' || tab === 'private') {
      section(box, () => q(sb.from('videos').select('*').eq('owner_id', p.id)
        .eq('visibility', tab === 'perf' ? 'public' : 'private').order('created_at', { ascending: false })),
      (vids) => videoGrid(vids) || empty(tab === 'perf' ? 'No public performance videos yet' : 'No private videos', null,
        mine && h('a', { class: 'btn', href: '#/upload' }, 'Upload a video')));
    } else {
      // Portfolio: completed analyses on videos that are public right now
      section(box, () => q(sb.from('analysis_requests')
        .select('id,completed_at,video:videos!inner(*)')
        .eq('coach_id', p.id).eq('status', 'completed').eq('video.visibility', 'public').eq('video.removed', false)
        .order('completed_at', { ascending: false })),
      (rows) => videoGrid(rows.map((r) => r.video)) || empty('No public analyses yet',
        'Analyses show up here when the trainee makes the video public.'));
    }
  };
  main.append(body);
  render();
}
