// Login, signup (trainee / coach), forgot and reset password.
import { h, clear, busy, friendlyError, successState, icon } from '../ui.js';
import { sb, state, activeSports, rpc, loadProfile } from '../api.js';
import { go, defaultRoute } from '../app.js';
import { languagePicker } from '../components.js';

function field(label, input, hint) {
  const id = 'f_' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  const err = h('div', { class: 'error-text hidden', id: id + '_e', role: 'alert' });
  input.setAttribute('aria-describedby', id + '_e');
  const box = input.type === 'password' ? withShowButton(input) : input;
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), box, hint && h('div', { class: 'hint' }, hint), err);
  wrap.setError = (msg) => {
    err.textContent = msg || ''; err.classList.toggle('hidden', !msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  return wrap;
}
// Password box with an eye button inside it, so people can check what they typed.
// Open eye while hidden (tap to show), crossed-out eye while shown (tap to hide).
function withShowButton(input) {
  const btn = h('button', { type: 'button', class: 'pw-toggle', 'aria-controls': input.id });
  const sync = () => {
    const shown = input.type === 'text';
    btn.replaceChildren(icon(shown ? 'eyeOff' : 'eye'));
    btn.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    btn.title = shown ? 'Hide password' : 'Show password';
  };
  btn.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; sync(); };
  sync();
  return h('div', { class: 'pw' }, input, btn);
}
const formError = () => h('div', { class: 'banner error hidden', role: 'alert' });
const showFormError = (el, msg) => { el.textContent = msg; el.classList.remove('hidden'); el.scrollIntoView({ block: 'center' }); };

function header(title, sub) {
  return [h('div', { class: 'wordmark auth-mark' }, 'CoachIt.'), h('h1', { class: 'hero' }, title), sub && h('p', { class: 'muted' }, sub)];
}

// ---------- Google sign-in ----------
const LOGOS = {
  google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
};
const PROVIDERS = [['google', 'Google']];
const SIGNUP_AS = 'pilot.signup_as';   // account type chosen before leaving for Google
let providersCache = null;

// Shows a button for each provider switched on in Supabase; nothing at all if none is.
function socialButtons(getRole) {
  const box = h('div', { class: 'social hidden' });
  (providersCache ||= sb.auth.getProviders().catch(() => ({}))).then((on) => {
    const list = PROVIDERS.filter(([id]) => on[id]);
    if (!list.length) return;
    box.append(...list.map(([id, label]) => h('button', {
      type: 'button', class: 'btn secondary block',
      onclick: () => {
        try { sessionStorage.setItem(SIGNUP_AS, getRole ? getRole() : ''); } catch {}
        sb.auth.signInWithOAuth({ provider: id, options: { redirectTo: location.origin + '/' } });
      },
    }, h('span', { class: 'logo', html: LOGOS[id] }), `Continue with ${label}`)),
    h('div', { class: 'or' }, 'or'));
    box.classList.remove('hidden');
  });
  return box;
}

export function loginPage({ main }) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, inputmode: 'email' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Sign in');
  const form = h('form', { novalidate: true },
    err, field('Email', email), field('Password', pass), btn,
    h('p', { class: 'center' }, h('a', { href: '#/forgot' }, 'Forgot password')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!email.value || !pass.value) return showFormError(err, 'Enter your email and password.');
    busy(btn, async () => {
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) showFormError(err, friendlyError(error));
    });
  });
  main.append(...header('Sign in', 'Video analysis by real coaches, pilot version'), socialButtons(), form,
    h('hr', { style: { margin: 'var(--space-5) 0', border: 0, borderTop: '1px solid var(--line)' } }),
    h('p', { class: 'center' }, 'No account yet?'),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn secondary', href: '#/signup?as=trainee' }, 'Sign up as a trainee'),
      h('a', { class: 'btn secondary', href: '#/signup?as=coach' }, 'Sign up as a coach')),
    h('p', { class: 'legal-links' }, h('a', { href: '/privacy' }, 'Privacy Policy')));
}

function sportChips(name, selected = []) {
  return h('div', { class: 'chips', role: 'group' },
    activeSports().map((s) => h('label', { class: 'chip' },
      h('input', { type: 'checkbox', name, value: String(s.id), checked: selected.includes(s.id) }), s.name)));
}
const checked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

export function signupPage({ main, query }) {
  signupForm(main, { role: query.get('as') === 'coach' ? 'coach' : 'trainee' });
}

// After a first Google sign-in: the details the provider does not give us.
export function finishSignupPage({ main }) {
  const p = state.profile;
  if (!p?.needs_setup) return go(defaultRoute());
  let role = 'trainee';
  try { role = sessionStorage.getItem(SIGNUP_AS) === 'coach' ? 'coach' : 'trainee'; } catch {}
  const email = state.user?.email || '';
  const suggested = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30);
  signupForm(main, {
    role, social: true,
    first: p.first_name === '—' ? '' : p.first_name, last: p.last_name === '—' ? '' : p.last_name,
    username: suggested.length >= 3 ? suggested : '',
  });
}

// Shared sign-up form. social = finishing a Google signup (no email/password; saved by complete_signup).
function signupForm(main, init) {
  let role = init.role;
  const social = !!init.social;
  const render = () => {
    clear(main);
    const f = {
      first: h('input', { type: 'text', autocomplete: 'given-name', value: init.first || '' }),
      last: h('input', { type: 'text', autocomplete: 'family-name', value: init.last || '' }),
      user: h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, value: init.username || '' }),
      email: h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', value: init.email || '' }),
      phone: h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', value: init.phone || '' }),
      pass: h('input', { type: 'password', autocomplete: 'new-password' }),
      bio: h('textarea', { maxlength: 1000 }),
    };
    const F = {
      first: field('First name', f.first), last: field('Last name', f.last),
      user: field('Username', f.user, 'Lowercase letters, digits, dot or underscore. 3 to 30 characters.'),
      email: field('Email', f.email), phone: field('Phone', f.phone),
      pass: field('Password', f.pass, 'At least 8 characters.'),
      bio: field('Short professional bio', f.bio, 'Experience, certifications, what you specialize in. Shown on your coach profile.'),
    };
    if (social) { delete F.email; delete F.pass; }
    const interests = sportChips('sports');
    const coachSports = sportChips('coach_sports');
    const interestsErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const coachErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const langs = languagePicker([]);
    const langsErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const consent = h('input', { type: 'checkbox', checked: !!init.consent });
    const consentErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const err = formError();
    const btn = h('button', { class: 'btn block', type: 'submit' },
      role === 'coach' ? 'Send coach application' : social ? 'Finish signing up' : 'Sign up');

    const roleSwitch = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Account type' },
      [['trainee', 'Trainee', 'Upload videos and get analysis from coaches'], ['coach', 'Coach', 'Analyze trainees\' videos. Requires admin approval']].map(([v, t, d]) =>
        h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'role', value: v, checked: role === v, onchange: () => { keep(); role = v; render(); } }),
          h('span', null, h('span', { class: 't' }, t), h('span', { class: 'd' }, d)))));
    // keep what was typed when switching account type
    const keep = () => { for (const k of ['first', 'last', 'email', 'phone']) init[k] = f[k].value; init.username = f.user.value; init.consent = consent.checked; };

    const form = h('form', { novalidate: true },
      err,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Account type'), roleSwitch),
      F.first, F.last, F.user, F.email, F.phone, F.pass,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Which languages do you speak?'),
        h('div', { class: 'hint', style: { marginTop: 0, marginBottom: 'var(--space-1)' } },
          role === 'coach' ? 'Trainees see these on your profile and when they send you a video.' : 'Coaches see these when they answer you.'),
        langs, langsErr),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Sports I\'m interested in'), interests, interestsErr),
      role === 'coach' && h('div', { class: 'field' }, h('div', { class: 'label' }, 'Sports I coach'), coachSports, coachErr),
      role === 'coach' && F.bio,
      role === 'coach' && h('p', { class: 'banner' }, 'After signing up, your account will be "pending approval". Until an admin approves it you can watch public content, but you won\'t appear in search or receive requests.'),
      h('div', { class: 'field' },
        h('label', { class: 'consent' }, consent,
          h('span', null, 'I\'m 18 or older and I agree to the ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy'), '.')),
        consentErr),
      btn,
      social
        ? h('p', { class: 'center' }, 'Signed in as ', h('strong', null, state.user?.email || 'your account'), '. ',
            h('button', { type: 'button', class: 'btn ghost', onclick: () => sb.auth.signOut() }, 'Sign out'))
        : h('p', { class: 'center' }, 'Already have an account? ', h('a', { href: '#/login' }, 'Sign in')));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        Object.values(F).forEach((x) => x.setError(''));
        [interestsErr, coachErr, langsErr, consentErr].forEach((x) => x.classList.add('hidden'));
        err.classList.add('hidden');
        let bad = false;
        const req = (k, msg) => { if (!f[k].value.trim()) { F[k].setError(msg); bad = true; } };
        req('first', 'Enter your first name.'); req('last', 'Enter your last name.');
        if (!social) req('email', 'Enter your email.');
        req('phone', 'Enter your phone number.');
        const username = f.user.value.trim().toLowerCase();
        if (!/^[a-z0-9_.]{3,30}$/.test(username)) { F.user.setError('Invalid username.'); bad = true; }
        if (!social && f.email.value && !/^\S+@\S+\.\S+$/.test(f.email.value.trim())) { F.email.setError('Invalid email address.'); bad = true; }
        if (f.phone.value && !/^[0-9+\-\s()]{7,20}$/.test(f.phone.value.trim())) { F.phone.setError('Invalid phone number.'); bad = true; }
        if (!social && f.pass.value.length < 8) { F.pass.setError('The password needs at least 8 characters.'); bad = true; }
        const languages = langs.value();
        if (!languages.length) { langsErr.textContent = 'Choose at least one language.'; langsErr.classList.remove('hidden'); bad = true; }
        const sports = checked(form, 'sports');
        if (!sports.length) { interestsErr.textContent = 'Choose at least one sport.'; interestsErr.classList.remove('hidden'); bad = true; }
        const cSports = checked(form, 'coach_sports');
        if (role === 'coach' && !cSports.length) { coachErr.textContent = 'Choose at least one sport you coach.'; coachErr.classList.remove('hidden'); bad = true; }
        if (role === 'coach' && f.bio.value.trim().length < 10) { F.bio.setError('Write a short professional bio (at least 10 characters).'); bad = true; }
        if (!consent.checked) { consentErr.textContent = 'CoachIt is for people 18 or older. Confirm your age and the Privacy Policy to continue.'; consentErr.classList.remove('hidden'); bad = true; }
        if (bad) return showFormError(err, 'Please fix the highlighted fields.');

        try {
          if (!(await rpc('username_available', { p_username: username }))) {
            F.user.setError('This username is taken. Try another one.');
            return showFormError(err, 'This username is taken.');
          }
        } catch {}

        if (social) {
          try {
            await rpc('complete_signup', {
              p_first_name: f.first.value.trim(), p_last_name: f.last.value.trim(), p_username: username,
              p_phone: f.phone.value.trim(), p_languages: languages, p_sports: sports.map(Number),
              p_coach: role === 'coach', p_bio: role === 'coach' ? f.bio.value.trim() : '',
              p_coach_sports: role === 'coach' ? cSports.map(Number) : [], p_consent: true,
            });
          } catch (e2) { return showFormError(err, friendlyError(e2)); }
          try { sessionStorage.removeItem(SIGNUP_AS); } catch {}
          await loadProfile().catch(() => {});
          return go(defaultRoute());
        }

        const { data, error } = await sb.auth.signUp({
          email: f.email.value.trim(),
          password: f.pass.value,
          options: {
            emailRedirectTo: location.origin + '/',
            data: {
              first_name: f.first.value.trim(), last_name: f.last.value.trim(), username,
              phone: f.phone.value.trim(), role, sports, coach_sports: role === 'coach' ? cSports : [], languages,
              bio: role === 'coach' ? f.bio.value.trim() : '', consent: true,
            },
          },
        });
        if (error) return showFormError(err, friendlyError(error));
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return showFormError(err, 'An account with this email already exists. Sign in or reset your password.');
        }
        // Supabase ignores a second signup for an email that is not confirmed yet: it resends the
        // first confirmation and keeps the first details (role, name), without any error.
        const meta = data.user?.user_metadata;
        if (!data.session && meta && (meta.username !== username || (meta.role || 'trainee') !== role)) {
          return showFormError(err, role === 'coach'
            ? 'You already signed up with this email as a trainee. We sent the confirmation email again: confirm it, sign in, and ask to join as a coach from Settings.'
            : 'You already signed up with this email. We sent the confirmation email again: confirm it and sign in.');
        }
        if (!data.session) {
          clear(main).append(successState('Check your email',
            'Open the link in the email to finish signing up, then sign in.',
            h('a', { class: 'btn', href: '#/login' }, 'Go to sign in')));
        }
        // with a session, the app redirects automatically (first upload screen for trainees)
      });
    });

    if (social) main.append(...header('Finish signing up', 'A few details so coaches know who they\'re working with.'), form);
    else main.append(...header('Sign up'), socialButtons(() => role), form);
  };
  render();
}

export function forgotPage({ main }) {
  const email = h('input', { type: 'email', autocomplete: 'email' });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Send reset link');
  const form = h('form', { novalidate: true }, err, field('Email', email), btn,
    h('p', { class: 'center' }, h('a', { href: '#/login' }, 'Back to sign in')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return showFormError(err, 'Enter a valid email address.');
    busy(btn, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + '/' });
      if (error) return showFormError(err, friendlyError(error));
      clear(main).append(successState('If an account exists for this email, we sent it a password reset link.',
        'The link works for a limited time. Check your spam folder too.', h('a', { class: 'btn', href: '#/login' }, 'Back to sign in')));
    });
  });
  main.append(...header('Reset password', 'We\'ll email you a link to choose a new password.'), form);
}

export function resetPage({ main }) {
  const pass = h('input', { type: 'password', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Save new password');
  const form = h('form', { novalidate: true }, err, field('New password', pass, 'At least 8 characters.'), field('Confirm password', pass2), btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pass.value.length < 8) return showFormError(err, 'The password needs at least 8 characters.');
    if (pass.value !== pass2.value) return showFormError(err, 'The passwords don\'t match.');
    busy(btn, async () => {
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) return showFormError(err, friendlyError(error));
      await loadProfile().catch(() => {});
      clear(main).append(successState('Password updated', null, h('a', { class: 'btn', href: '#/home' }, 'Continue')));
    });
  });
  main.append(...header('Choose a new password'), form);
}
