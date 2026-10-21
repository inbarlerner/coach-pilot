// Search approved coaches by name and sport.
import { h, clear, section, empty, POLICY } from '../ui.js';
import { rpc, activeSports, sportName, state } from '../api.js';

export function searchPage({ main, setTitle, query }) {
  setTitle('חיפוש מאמנים');
  const qIn = h('input', { type: 'search', id: 's_q', placeholder: 'שם המאמן', value: query.get('q') || '' });
  const sport = h('select', { id: 's_sport' }, h('option', { value: '' }, 'כל הענפים'), activeSports().map((s) => h('option', { value: s.id }, s.name)));
  const results = h('div');
  let t;
  const run = () => section(results,
    () => rpc('search_coaches', { p_query: qIn.value.trim(), p_sport: sport.value ? Number(sport.value) : null }),
    (rows) => rows.length ? h('div', null, rows.map(coachCard)) : empty('לא נמצאו מאמנים', 'נסו שם אחר או ענף אחר.'));
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
  sport.addEventListener('change', run);
  main.append(h('h1', null, 'חיפוש מאמנים'),
    h('form', { role: 'search', onsubmit: (e) => { e.preventDefault(); run(); } },
      h('div', { class: 'field' }, h('label', { for: 's_q' }, 'שם'), qIn),
      h('div', { class: 'field' }, h('label', { for: 's_sport' }, 'ענף ספורט'), sport)),
    results);
  run();
}

export function coachCard(c) {
  const self = c.id === state.user.id;
  return h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('a', { href: '#/u/' + c.username }, h('strong', null, c.first_name + ' ' + c.last_name)),
      h('div', { class: 'row' }, c.is_sample && h('span', { class: 'tag' }, 'דוגמה'),
        c.available ? h('span', { class: 'tag soft' }, 'פנוי לבקשות') : h('span', { class: 'tag fill' }, 'אין מקום פנוי'))),
    h('p', { class: 'meta' }, 'ענפים: ' + c.sport_ids.map(sportName).join(', ')),
    c.bio && h('p', null, c.bio.length > 160 ? c.bio.slice(0, 160) + '…' : c.bio),
    h('p', { class: 'meta' }, `זמן תגובה: עד ${c.response_hours} שעות · ${POLICY[c.followup_policy]}`),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn secondary small', href: '#/u/' + c.username }, 'לפרופיל'),
      !self && (c.available
        ? h('a', { class: 'btn small', href: '#/upload?coach=' + c.id }, 'שליחת סרטון לניתוח')
        : h('button', { class: 'btn small', disabled: true }, 'אין מקום פנוי'))));
}
