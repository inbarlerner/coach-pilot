// Profile editing for everyone (photo, details, languages) + coach settings (quota, response time, follow-up policy, sports, bio).
import { h, clear, loading, errorState, friendlyError, busy, toast, POLICY, icon } from '../ui.js';
import { sb, state, q, rpc, activeSports, loadProfile, isCoach, uploadFile, discardUpload, AVATARS } from '../api.js';
import { avatar, imageFileToJpeg } from '../images.js';
import { languagePicker } from '../components.js';

export async function settingsPage({ main, setTitle }) {
  setTitle('Settings');
  clear(main).append(loading());
  const p = state.profile;
  let priv, interests, coachSet, coachSports;
  try {
    [priv, interests] = await Promise.all([
      q(sb.from('profile_private').select('*').eq('id', p.id).single()),
      q(sb.from('user_sports').select('sport_id').eq('user_id', p.id)),
    ]);
    if (isCoach()) {
      [coachSet, coachSports] = await Promise.all([
        q(sb.from('coach_settings').select('*').eq('coach_id', p.id).maybeSingle()),
        q(sb.from('coach_sports').select('sport_id').eq('coach_id', p.id)),
      ]);
    }
  } catch (e) { return clear(main).append(errorState(friendlyError(e), () => settingsPage({ main, setTitle }))); }
  clear(main);

  const chips = (name, sel) => h('div', { class: 'chips' }, activeSports().map((s) =>
    h('label', { class: 'chip' }, h('input', { type: 'checkbox', name, value: String(s.id), checked: sel.includes(s.id) }), s.name)));
  const picked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => Number(i.value));

  main.append(photoCard());

  // ---------- Coach settings ----------
  if (isCoach()) {
    const quota = h('input', { type: 'number', id: 'cs_quota', min: 0, max: 100, value: coachSet?.quota ?? 3, inputmode: 'numeric' });
    const hours = h('input', { type: 'number', id: 'cs_hours', min: 1, max: 720, value: coachSet?.response_hours ?? 48, inputmode: 'numeric' });
    const policies = h('div', { class: 'choices', role: 'radiogroup' }, Object.entries(POLICY).map(([k, l]) =>
      h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'policy', value: k, checked: (coachSet?.followup_policy || 'one') === k }), h('span', { class: 't' }, l))));
    const sportsBox = chips('coach_sports', (coachSports || []).map((r) => r.sport_id));
    const bio = h('textarea', { id: 'cs_bio', maxlength: 1000 });
    bio.value = p.bio || '';
    const save = h('button', { class: 'btn block' }, 'Save coach settings');
    const form = h('div', { class: 'card', style: { marginTop: '1rem' } },
      h('h2', { style: { marginTop: 0 } }, 'Coach settings'),
      p.coach_status !== 'approved' && h('p', { class: 'banner' }, p.coach_status === 'pending' ? 'Your account is waiting for admin approval. You can set this up in advance.' : 'Your coach application was not approved.'),
      h('div', { class: 'field' }, h('label', { for: 'cs_quota' }, 'Active request quota'), quota,
        h('div', { class: 'hint' }, 'How many open requests (waiting or in draft) you can have at once. A new request takes a spot; sending an analysis, declining or running out of time frees it.')),
      h('div', { class: 'field' }, h('label', { for: 'cs_hours' }, 'Committed response time (hours)'), hours,
        h('div', { class: 'hint' }, 'If no analysis is sent within this time, the request closes automatically and frees the spot.')),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Chat with trainees after the analysis'), policies,
        h('div', { class: 'hint' }, 'Each video keeps the rule that was set when it was sent to you. A change applies to videos sent from now on.')),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Sports I coach'), sportsBox),
      h('div', { class: 'field' }, h('label', { for: 'cs_bio' }, 'Professional bio'), bio),
      h('div', { class: 'field soon' }, h('div', { class: 'label' }, 'Payment ', h('span', { class: 'tag' }, 'Later')),
        h('p', { class: 'hint' }, 'Setting a price per video comes later. The pilot has no payments and no card details.')),
      h('p', { class: 'hint' }, 'Changes apply to new requests only. Existing requests keep the terms that were in effect when they were sent.'),
      save);
    save.onclick = () => busy(save, async () => {
      const qv = Number(quota.value), hv = Number(hours.value);
      const pol = form.querySelector('input[name=policy]:checked')?.value;
      const cs = picked(form, 'coach_sports');
      if (!Number.isInteger(qv) || qv < 0 || qv > 100) return toast('The quota must be a whole number from 0 to 100', 'err');
      if (!Number.isInteger(hv) || hv < 1 || hv > 720) return toast('The response time must be between 1 and 720 hours', 'err');
      if (!cs.length) return toast('Choose at least one sport', 'err');
      try {
        await q(sb.from('coach_settings').update({ quota: qv, response_hours: hv, followup_policy: pol, updated_at: new Date().toISOString() }).eq('coach_id', p.id));
        const cur = (coachSports || []).map((r) => r.sport_id);
        const add = cs.filter((x) => !cur.includes(x)), rem = cur.filter((x) => !cs.includes(x));
        if (add.length) await q(sb.from('coach_sports').insert(add.map((sport_id) => ({ coach_id: p.id, sport_id }))));
        if (rem.length) await q(sb.from('coach_sports').delete().eq('coach_id', p.id).in('sport_id', rem));
        coachSports = cs.map((sport_id) => ({ sport_id }));
        await q(sb.from('profiles').update({ bio: bio.value.trim() }).eq('id', p.id));
        await loadProfile();
        toast('Coach settings saved');
      } catch (e) { toast(friendlyError(e), 'err'); }
    });
    main.append(form);
  }

  // ---------- Ask to become a coach (trainees, or after a rejection) ----------
  if (p.role === 'trainee' || (p.role === 'coach' && p.coach_status === 'rejected')) {
    const sportsBox = chips('apply_sports', (coachSports || []).map((r) => r.sport_id));
    const bio = h('textarea', { id: 'ap_bio', maxlength: 1000 });
    bio.value = p.bio || '';
    const send = h('button', { class: 'btn block' }, 'Send coach application');
    const form = h('div', { class: 'card', style: { marginTop: '1rem' } },
      h('h2', { style: { marginTop: 0 } }, p.role === 'coach' ? 'Apply again as a coach' : 'Join as a coach'),
      h('p', { class: 'hint' }, 'An admin reviews the application. Until it is approved you won\'t appear in search or receive requests.'),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Sports I coach'), sportsBox),
      h('div', { class: 'field' }, h('label', { for: 'ap_bio' }, 'Professional bio'), bio),
      send);
    send.onclick = () => busy(send, async () => {
      const cs = picked(form, 'apply_sports');
      if (!cs.length) return toast('Choose at least one sport', 'err');
      if (bio.value.trim().length < 10) return toast('Write a short professional bio (at least 10 characters).', 'err');
      try {
        await rpc('request_coach', { p_bio: bio.value.trim(), p_sports: cs });
        await loadProfile();
        toast('Application sent to the admin');
        settingsPage({ main, setTitle });
      } catch (e) { toast(friendlyError(e), 'err'); }
    });
    main.append(form);
  }

  // ---------- Personal details ----------
  const first = h('input', { type: 'text', id: 'p_first', value: p.first_name });
  const last = h('input', { type: 'text', id: 'p_last', value: p.last_name });
  const phone = h('input', { type: 'tel', id: 'p_phone', value: priv.phone || '' });
  const sportsBox = chips('sports', interests.map((r) => r.sport_id));
  const langs = languagePicker(p.languages || []);
  const save = h('button', { class: 'btn block' }, 'Save details');
  const card = h('div', { class: 'card', style: { marginTop: '1rem' } },
    h('h2', { style: { marginTop: 0 } }, 'Personal details'),
    h('div', { class: 'field' }, h('label', { for: 'p_first' }, 'First name'), first),
    h('div', { class: 'field' }, h('label', { for: 'p_last' }, 'Last name'), last),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Username'), h('p', null, '@' + p.username)),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Email'), h('p', null, priv.email)),
    h('div', { class: 'field' }, h('label', { for: 'p_phone' }, 'Phone'), phone, h('div', { class: 'hint' }, 'Your phone and email are not shown to other users.')),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Languages I speak'),
      h('div', { class: 'hint', style: { marginTop: 0, marginBottom: '.4rem' } }, p.role === 'coach' ? 'Shown on your profile and to trainees choosing a coach.' : 'Shown to coaches who answer you.'), langs),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Sports I\'m interested in (affects the feed order)'), sportsBox),
    save);
  save.onclick = () => busy(save, async () => {
    if (!first.value.trim() || !last.value.trim()) return toast('Enter your first and last name', 'err');
    const sel = picked(card, 'sports');
    if (!sel.length) return toast('Choose at least one sport you\'re interested in', 'err');
    if (!langs.value().length) return toast('Choose at least one language', 'err');
    try {
      await q(sb.from('profiles').update({ first_name: first.value.trim(), last_name: last.value.trim(), languages: langs.value() }).eq('id', p.id));
      await q(sb.from('profile_private').update({ phone: phone.value.trim() }).eq('id', p.id));
      const cur = interests.map((r) => r.sport_id);
      const add = sel.filter((x) => !cur.includes(x)), rem = cur.filter((x) => !sel.includes(x));
      if (add.length) await q(sb.from('user_sports').insert(add.map((sport_id) => ({ user_id: p.id, sport_id }))));
      if (rem.length) await q(sb.from('user_sports').delete().eq('user_id', p.id).in('sport_id', rem));
      interests = sel.map((sport_id) => ({ sport_id }));
      await loadProfile();
      toast('Details saved');
    } catch (e) { toast(friendlyError(e), 'err'); }
  });
  main.append(card,
    h('div', { class: 'btn-row', style: { marginTop: '1rem' } },
      h('a', { class: 'btn secondary', href: '#/me' }, 'Back to profile'),
      h('a', { class: 'btn secondary', href: '#/forgot' }, 'Change password'),
      h('button', { class: 'btn secondary', onclick: () => sb.auth.signOut() }, 'Sign out')));
}

// ---------- Profile photo ----------
function photoCard() {
  const p = state.profile;
  const pic = h('div');
  const draw = () => clear(pic).append(avatar(state.profile, 96));
  draw();
  const input = h('input', { type: 'file', id: 'ph_in', accept: 'image/*', class: 'visually-hidden' });
  const choose = h('label', { for: 'ph_in', class: 'btn secondary small', role: 'button', tabindex: '0',
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, p.avatar_key ? 'Change photo' : 'Add photo');
  const remove = h('button', { class: 'btn ghost small', hidden: !p.avatar_key }, 'Remove photo');
  const labels = () => { choose.textContent = state.profile.avatar_key ? 'Change photo' : 'Add photo'; remove.hidden = !state.profile.avatar_key; };
  const set = async (key) => {
    let old;
    try { old = await rpc('set_avatar', { p_key: key }); } catch (e) { if (key) discardUpload(key, AVATARS); throw e; }
    if (old) discardUpload(old, AVATARS);
    await loadProfile();
    draw();
    const navPic = document.querySelector('nav.bottom a.profile');   // refresh the photo in the bottom bar
    if (navPic) navPic.firstChild.replaceWith(state.profile.avatar_key ? avatar(state.profile, 28) : icon('profile'));
  };
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    busy(choose, async () => {
      try {
        const blob = await imageFileToJpeg(f, { max: 400, square: true });
        const up = await uploadFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }), 'avatar');
        await set(up.key);
        toast('Photo updated');
      } catch (e) { toast(friendlyError(e), 'err'); }
    }).then(labels);
  });
  remove.onclick = () => (busy(remove, async () => {
    try { await set(null); toast('Photo removed'); } catch (e) { toast(friendlyError(e), 'err'); }
  }).then(labels));
  return h('div', { class: 'card' },
    h('h2', { style: { marginTop: 0 } }, 'Profile photo'),
    h('div', { class: 'row', style: { gap: '1rem' } }, pic,
      h('div', { class: 'stack' }, h('p', { class: 'hint', style: { margin: 0 } }, 'Shown next to your name everywhere in the app.'),
        h('div', { class: 'row' }, input, choose, remove))));
}
