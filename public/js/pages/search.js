// Search approved coaches by name and sport.
import { h, clear, section, empty, POLICY } from '../ui.js';
import { rpc, activeSports, sportName, state } from '../api.js';
import { personLink } from '../images.js';
import { languagesLine } from '../components.js';
import { addPeople } from './upload.js';

export function searchPage({ main, setTitle, query }) {
  setTitle('Find a coach');
  const qIn = h('input', { type: 'search', id: 's_q', placeholder: 'Coach name', value: query.get('q') || '' });
  const sport = h('select', { id: 's_sport' }, h('option', { value: '' }, 'All sports'), activeSports().map((s) => h('option', { value: s.id }, s.name)));
  const results = h('div');
  let t;
  const run = () => section(results,
    async () => addPeople(await rpc('search_coaches', { p_query: qIn.value.trim(), p_sport: sport.value ? Number(sport.value) : null })),
    (rows) => rows.length ? h('div', null, rows.map(coachCard)) : empty('No coaches found', 'Try another name or sport.'));
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
  sport.addEventListener('change', run);
  main.append(h('h1', null, 'Find a coach'),
    h('form', { role: 'search', onsubmit: (e) => { e.preventDefault(); run(); } },
      h('div', { class: 'field' }, h('label', { for: 's_q' }, 'Name'), qIn),
      h('div', { class: 'field' }, h('label', { for: 's_sport' }, 'Sport'), sport)),
    results);
  run();
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
    c.bio && h('p', null, c.bio.length > 160 ? c.bio.slice(0, 160) + '…' : c.bio),
    h('p', { class: 'meta' }, `Response time: up to ${c.response_hours} hours · ${POLICY[c.followup_policy]}`),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn secondary small', href: '#/u/' + c.username }, 'Profile'),
      !self && (c.available
        ? h('a', { class: 'btn small', href: '#/upload?coach=' + c.id }, 'Send a video for analysis')
        : h('button', { class: 'btn small', disabled: true }, 'No free spot'))));
}
