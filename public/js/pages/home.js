// Home "For You": public videos & analyses, viewer's sports first, simple sport filter.
import { h, clear, loading, empty, errorState, friendlyError, fmtDate } from '../ui.js';
import { state, rpc, activeSports, sportName, isCoach } from '../api.js';
import { protectedVideo } from '../components.js';
import { personLink } from '../images.js';

const PAGE = 8;

export function homePage({ main, setTitle }) {
  setTitle('Home');
  let sport = null, offset = 0, done = false;
  const list = h('div');
  const more = h('div', { class: 'center' });

  if (isCoach() && state.profile.coach_status === 'pending') {
    main.append(h('div', { class: 'banner' }, h('strong', null, 'Your coach account is waiting for admin approval. '), 'Meanwhile you can watch public content and update your profile.'));
  }
  main.append(h('h1', null, 'For You'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by sport', style: { marginBottom: '1rem' } },
      [[null, 'All'], ...activeSports().map((s) => [s.id, s.name])].map(([id, name]) =>
        h('button', { class: 'chip' + (sport === id ? ' on' : ''), 'aria-pressed': String(sport === id), onclick: (e) => {
          sport = id;
          e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
          e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-pressed', 'true');
          reset();
        } }, name))),
    list, more);

  function reset() { offset = 0; done = false; clear(list); loadMore(true); }

  async function loadMore(first) {
    if (done) return;
    clear(more).append(loading());
    try {
      const rows = await rpc('get_feed', { p_sport: sport, p_limit: PAGE, p_offset: offset });
      offset += rows.length;
      clear(more);
      if (first && !rows.length) {
        list.append(empty('No public videos yet' + (sport ? ' in this sport' : ''),
          'Videos that people choose to make public show up here.', h('a', { class: 'btn', href: '#/upload' }, 'Upload a video')));
        done = true; return;
      }
      rows.forEach((r) => list.append(feedItem(r)));
      if (rows.length < PAGE) { done = true; if (!first || rows.length) more.append(h('p', { class: 'muted' }, 'That\'s all for now.')); }
      else more.append(h('button', { class: 'btn secondary', onclick: () => loadMore(false) }, 'Load more'));
    } catch (e) {
      clear(more).append(errorState(friendlyError(e), () => loadMore(first)));
    }
  }
  loadMore(true);
}

export function feedItem(r) {
  return h('article', { class: 'feed-item' },
    h('div', { class: 'head' },
      h('div', { class: 'row between' },
        personLink(feedPerson(r.owner_name, r.owner_username, r.owner_avatar)),
        r.is_sample && h('span', { class: 'tag' }, 'Sample')),
      h('div', null, sportName(r.sport_id), ' · ', h('strong', null, r.title)),
      h('div', { class: 'meta' }, fmtDate(r.created_at))),
    protectedVideo('video', r.video_id, { lazy: true, cover: r.cover_key }),
    h('div', { class: 'foot' },
      r.coach_name
        ? h('div', { class: 'row' }, 'Analysis by ', personLink(feedPerson(r.coach_name, r.coach_username, r.coach_avatar), { size: 26 }))
        : h('p', { class: 'muted' }, 'No analysis'),
      h('div', { class: 'btn-row' },
        r.request_id && h('a', { class: 'btn small', href: '#/v/' + r.video_id + '?analysis=1' }, 'View analysis'),
        h('a', { class: 'btn secondary small', href: '#/v/' + r.video_id }, `Comments (${r.comment_count})`))));
}

// The feed returns full names; split them for the avatar initials.
function feedPerson(name, username, avatar_key) {
  const [first_name, ...rest] = (name || '').split(' ');
  return { first_name, last_name: rest.join(' '), username, avatar_key };
}
