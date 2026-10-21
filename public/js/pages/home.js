// Home "For You": public videos & analyses, viewer's sports first, simple sport filter.
import { h, clear, loading, empty, errorState, friendlyError, fmtDate } from '../ui.js';
import { state, rpc, activeSports, sportName, isCoach } from '../api.js';
import { protectedVideo } from '../components.js';

const PAGE = 8;

export function homePage({ main, setTitle }) {
  setTitle('עמוד הבית');
  let sport = null, offset = 0, done = false;
  const list = h('div');
  const more = h('div', { class: 'center' });

  if (isCoach() && state.profile.coach_status === 'pending') {
    main.append(h('div', { class: 'banner' }, h('strong', null, 'החשבון שלך כמאמן ממתין לאישור מנהל. '), 'בינתיים אפשר לצפות בתוכן ציבורי ולעדכן את הפרופיל.'));
  }
  main.append(h('h1', null, 'For You'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'סינון לפי ענף', style: { marginBottom: '1rem' } },
      [[null, 'הכול'], ...activeSports().map((s) => [s.id, s.name])].map(([id, name]) =>
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
        list.append(empty('אין עדיין סרטונים ציבוריים' + (sport ? ' בענף הזה' : ''),
          'סרטונים שמשתמשים בוחרים לפרסם כציבוריים יופיעו כאן.', h('a', { class: 'btn', href: '#/upload' }, 'העלאת סרטון')));
        done = true; return;
      }
      rows.forEach((r) => list.append(feedItem(r)));
      if (rows.length < PAGE) { done = true; if (!first || rows.length) more.append(h('p', { class: 'muted' }, 'זה הכול לעכשיו.')); }
      else more.append(h('button', { class: 'btn secondary', onclick: () => loadMore(false) }, 'טעינת עוד'));
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
        h('a', { href: '#/u/' + r.owner_username }, h('strong', null, r.owner_name)),
        r.is_sample && h('span', { class: 'tag' }, 'דוגמה')),
      h('div', null, sportName(r.sport_id), ' · ', h('strong', null, r.title)),
      h('div', { class: 'meta' }, fmtDate(r.created_at))),
    protectedVideo('video', r.video_id, { lazy: true }),
    h('div', { class: 'foot' },
      r.coach_name
        ? h('p', null, 'ניתוח מאת ', h('a', { href: '#/u/' + r.coach_username }, h('strong', null, r.coach_name)))
        : h('p', { class: 'muted' }, 'ללא ניתוח'),
      h('div', { class: 'btn-row' },
        r.request_id && h('a', { class: 'btn small', href: '#/v/' + r.video_id + '?analysis=1' }, 'צפייה בניתוח'),
        h('a', { class: 'btn secondary small', href: '#/v/' + r.video_id }, `תגובות (${r.comment_count})`))));
}
