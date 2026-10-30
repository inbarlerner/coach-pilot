// Search everything: people (trainees, coaches), videos (title, description, sport, owner), and coaches taking requests.
import { h, clear, section, empty, icon, POLICY } from '../ui.js';
import { rpc, activeSports, sportName, state, coverUrl } from '../api.js';
import { avatar, personLink, coverImg } from '../images.js';
import { languagesLine } from '../components.js';
import { addPeople } from './upload.js';

const TABS = [['all', 'All'], ['people', 'People'], ['videos', 'Videos'], ['coaches', 'Coaches']];

export function searchPage({ main, query }) {
  let tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'all';
  const qIn = h('input', { type: 'search', id: 's_q', placeholder: 'Search drills, videos, trainees, coaches...', value: query.get('q') || '', autocomplete: 'off' });
  const sport = h('select', { id: 's_sport', 'aria-label': 'Sport' }, h('option', { value: '' }, 'All sports'), activeSports().map((s) => h('option', { value: s.id }, s.name)));
  const sportBox = h('div', { class: 'field' }, sport);
  const bar = h('div', { class: 'chips', role: 'group', 'aria-label': 'What to search', style: { marginBottom: 'var(--space-4)' } });
  const results = h('div');
  let t;

  const drawBar = () => clear(bar).append(TABS.map(([k, l]) =>
    h('button', { class: 'chip' + (tab === k ? ' on' : ''), 'aria-pressed': String(tab === k), onclick: () => { tab = k; drawBar(); run(); } }, l)));

  const run = () => {
    const text = qIn.value.trim();
    sportBox.hidden = tab !== 'coaches';
    history.replaceState(null, '', '#/search?' + new URLSearchParams({ ...(text ? { q: text } : {}), ...(tab !== 'all' ? { tab } : {}) }));
    if (tab === 'coaches') return section(results,
      async () => addPeople(await rpc('search_coaches', { p_query: text, p_sport: sport.value ? Number(sport.value) : null })),
      (rows) => rows.length ? h('div', null, rows.map(coachCard)) : empty('No coaches found', 'Try another name or sport.'));
    if (!text) { clear(results).append(empty('Search the app', 'Type a drill or video title, a sport, or the name of a trainee or coach.')); return; }
    section(results, async () => {
      const [people, videos] = await Promise.all([
        tab === 'videos' ? [] : rpc('search_people', { p_query: text, p_limit: tab === 'all' ? 6 : 30 }),
        tab === 'people' ? [] : rpc('search_videos', { p_query: text, p_limit: tab === 'all' ? 12 : 30 }),
      ]);
      return { people, videos };
    }, ({ people, videos }) => {
      if (!people.length && !videos.length) return empty('No results', `Nothing matches "${text}". Try fewer or different words.`);
      return h('div', null,
        people.length > 0 && h('section', null,
          h('div', { class: 'row between' }, h('h2', null, 'People'),
            tab === 'all' && people.length >= 6 && h('button', { class: 'btn ghost small', onclick: () => { tab = 'people'; drawBar(); run(); } }, 'See all')),
          h('div', null, people.map(personRow))),
        videos.length > 0 && h('section', null,
          h('div', { class: 'row between' }, h('h2', null, 'Videos'),
            tab === 'all' && videos.length >= 12 && h('button', { class: 'btn ghost small', onclick: () => { tab = 'videos'; drawBar(); run(); } }, 'See all')),
          h('div', { class: 'grid' }, videos.map(videoTile))));
    });
  };
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 300); });
  sport.addEventListener('change', run);
  main.append(h('h1', null, 'Search'),
    h('form', { role: 'search', onsubmit: (e) => { e.preventDefault(); run(); } },
      h('div', { class: 'field' }, h('label', { for: 's_q', class: 'visually-hidden' }, 'Search'), qIn)),
    bar, sportBox, results);
  drawBar();
  run();
  qIn.focus();
}

const ROLE = (p) => p.role === 'admin' ? 'Admin'
  : p.role === 'coach' ? (p.coach_status === 'approved' ? 'Coach' : 'Coach · not approved yet') : 'Trainee';

function personRow(p) {
  return h('a', { class: 'card link list-item', href: '#/u/' + p.username },
    h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: 'var(--space-3)' } }, avatar(p, 44),
      h('div', null, h('strong', null, p.first_name + ' ' + p.last_name),
        h('div', { class: 'meta' }, '@' + p.username + ' · ' + ROLE(p)),
        languagesLine(p.languages))),
    p.is_sample && h('span', { class: 'tag' }, 'Sample'));
}

function videoTile(v) {
  return h('a', { class: 'tile', href: '#/v/' + v.id },
    v.cover_key && coverImg(coverUrl(v.cover_key)),
    h('span', { class: 'play' }, icon('play')),
    h('span', { class: 't' }, v.title),
    h('span', { class: 'meta' }, sportName(v.sport_id) + ' · ' + v.owner_first_name + ' ' + v.owner_last_name),
    h('span', { class: 'row' },
      v.visibility === 'private' && h('span', { class: 'tag soft' }, 'Private'),
      v.file_deleted_at && h('span', { class: 'tag soft' }, 'File removed')));
}

export function coachCard(c) {
  const self = c.id === state.user.id;
  return h('div', { class: 'card' },
    h('div', { class: 'row between' },
      personLink(c, { size: 44 }),
      h('div', { class: 'row' }, c.is_sample && h('span', { class: 'tag' }, 'Sample'),
        c.available ? h('span', { class: 'tag soft' }, 'Taking requests') : h('span', { class: 'tag fill' }, 'No free spot'))),
    h('p', { class: 'meta' }, 'Sports: ' + c.sport_ids.map(sportName).join(', ')),
    languagesLine(c.languages),
    c.bio && h('p', null, c.bio.length > 160 ? c.bio.slice(0, 160) + '...' : c.bio),
    h('p', { class: 'meta' }, `Response time: up to ${c.response_hours} hours · ${POLICY[c.followup_policy]}`),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn secondary small', href: '#/u/' + c.username }, 'Profile'),
      !self && (c.available
        ? h('a', { class: 'btn small', href: '#/upload?coach=' + c.id }, 'Send a video for analysis')
        : h('button', { class: 'btn small', disabled: true }, 'No free spot'))));
}
