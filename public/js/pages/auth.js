// Login, signup (trainee / coach), forgot and reset password.
import { h, clear, busy, friendlyError, successState } from '../ui.js';
import { sb, state, activeSports, rpc, loadProfile } from '../api.js';

function field(label, input, hint) {
  const id = 'f_' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  const err = h('div', { class: 'error-text hidden', id: id + '_e', role: 'alert' });
  input.setAttribute('aria-describedby', id + '_e');
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('div', { class: 'hint' }, hint), err);
  wrap.setError = (msg) => {
    err.textContent = msg || ''; err.classList.toggle('hidden', !msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  return wrap;
}
const formError = () => h('div', { class: 'banner hidden', role: 'alert' });
const showFormError = (el, msg) => { el.textContent = msg; el.classList.remove('hidden'); el.scrollIntoView({ block: 'center' }); };

function header(title, sub) {
  return [h('h1', null, title), sub && h('p', { class: 'muted' }, sub)];
}

export function loginPage({ main }) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, inputmode: 'email' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'כניסה');
  const form = h('form', { novalidate: true },
    err, field('מייל', email), field('סיסמה', pass), btn,
    h('p', { class: 'center' }, h('a', { href: '#/forgot' }, 'שכחתי סיסמה')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!email.value || !pass.value) return showFormError(err, 'יש למלא מייל וסיסמה.');
    busy(btn, async () => {
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) showFormError(err, friendlyError(error));
    });
  });
  main.append(...header('כניסה', 'פלטפורמת ניתוח סרטונים על ידי מאמנים — גרסת ניסיון'), form,
    h('hr', { style: { margin: '1.5rem 0', border: 0, borderTop: '1px solid var(--line)' } }),
    h('p', { class: 'center' }, 'אין לך חשבון?'),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn secondary', href: '#/signup?as=trainee' }, 'הרשמה כמתאמן'),
      h('a', { class: 'btn secondary', href: '#/signup?as=coach' }, 'הרשמה כמאמן')));
}

function sportChips(name, selected = []) {
  return h('div', { class: 'chips', role: 'group' },
    activeSports().map((s) => h('label', { class: 'chip' },
      h('input', { type: 'checkbox', name, value: String(s.id), checked: selected.includes(s.id) }), s.name)));
}
const checked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

export function signupPage({ main, query }) {
  let role = query.get('as') === 'coach' ? 'coach' : 'trainee';
  const render = () => {
    clear(main);
    const f = {
      first: h('input', { type: 'text', autocomplete: 'given-name' }),
      last: h('input', { type: 'text', autocomplete: 'family-name' }),
      user: h('input', { type: 'text', autocomplete: 'username', dir: 'ltr', autocapitalize: 'none', spellcheck: false }),
      email: h('input', { type: 'email', autocomplete: 'email', dir: 'ltr', inputmode: 'email' }),
      phone: h('input', { type: 'tel', autocomplete: 'tel', dir: 'ltr', inputmode: 'tel' }),
      pass: h('input', { type: 'password', autocomplete: 'new-password' }),
      bio: h('textarea', { maxlength: 1000 }),
    };
    const F = {
      first: field('שם פרטי', f.first), last: field('שם משפחה', f.last),
      user: field('שם משתמש', f.user, 'אותיות באנגלית קטנות, ספרות, נקודה או קו תחתון. 3–30 תווים.'),
      email: field('מייל', f.email), phone: field('טלפון', f.phone),
      pass: field('סיסמה', f.pass, 'לפחות 8 תווים.'),
      bio: field('תיאור מקצועי קצר', f.bio, 'ניסיון, הסמכות, במה את/ה מתמחה. יוצג בפרופיל המאמן.'),
    };
    const interests = sportChips('sports');
    const coachSports = sportChips('coach_sports');
    const interestsErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const coachErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const err = formError();
    const btn = h('button', { class: 'btn block', type: 'submit' }, role === 'coach' ? 'שליחת בקשת הצטרפות כמאמן' : 'הרשמה');

    const roleSwitch = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'סוג חשבון' },
      [['trainee', 'מתאמן', 'מעלה סרטונים ומקבל ניתוח ממאמנים'], ['coach', 'מאמן', 'מנתח סרטונים של מתאמנים. דורש אישור מנהל']].map(([v, t, d]) =>
        h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'role', value: v, checked: role === v, onchange: () => { role = v; render(); } }),
          h('span', null, h('span', { class: 't' }, t), h('span', { class: 'd' }, d)))));

    const form = h('form', { novalidate: true },
      err,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'סוג חשבון'), roleSwitch),
      F.first, F.last, F.user, F.email, F.phone, F.pass,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'ענפי ספורט שמעניינים אותי'), interests, interestsErr),
      role === 'coach' && h('div', { class: 'field' }, h('div', { class: 'label' }, 'ענפים שבהם אני מאמן/ת'), coachSports, coachErr),
      role === 'coach' && F.bio,
      role === 'coach' && h('p', { class: 'banner' }, 'אחרי ההרשמה החשבון יהיה במצב ״ממתין לאישור״. עד לאישור מנהל אפשר לצפות בתוכן ציבורי, אך לא להופיע לבחירה ולא לקבל בקשות.'),
      btn,
      h('p', { class: 'center' }, 'כבר רשום/ה? ', h('a', { href: '#/login' }, 'כניסה')));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        Object.values(F).forEach((x) => x.setError(''));
        [interestsErr, coachErr].forEach((x) => x.classList.add('hidden'));
        err.classList.add('hidden');
        let bad = false;
        const req = (k, msg) => { if (!f[k].value.trim()) { F[k].setError(msg); bad = true; } };
        req('first', 'יש למלא שם פרטי.'); req('last', 'יש למלא שם משפחה.');
        req('email', 'יש למלא מייל.'); req('phone', 'יש למלא טלפון.');
        const username = f.user.value.trim().toLowerCase();
        if (!/^[a-z0-9_.]{3,30}$/.test(username)) { F.user.setError('שם משתמש לא תקין.'); bad = true; }
        if (f.email.value && !/^\S+@\S+\.\S+$/.test(f.email.value.trim())) { F.email.setError('כתובת מייל לא תקינה.'); bad = true; }
        if (f.phone.value && !/^[0-9+\-\s()]{7,20}$/.test(f.phone.value.trim())) { F.phone.setError('מספר טלפון לא תקין.'); bad = true; }
        if (f.pass.value.length < 8) { F.pass.setError('הסיסמה צריכה לכלול לפחות 8 תווים.'); bad = true; }
        const sports = checked(form, 'sports');
        if (!sports.length) { interestsErr.textContent = 'יש לבחור לפחות ענף אחד.'; interestsErr.classList.remove('hidden'); bad = true; }
        const cSports = checked(form, 'coach_sports');
        if (role === 'coach' && !cSports.length) { coachErr.textContent = 'יש לבחור לפחות ענף אחד שבו את/ה מאמן/ת.'; coachErr.classList.remove('hidden'); bad = true; }
        if (role === 'coach' && f.bio.value.trim().length < 10) { F.bio.setError('יש לכתוב תיאור מקצועי קצר (לפחות 10 תווים).'); bad = true; }
        if (bad) return showFormError(err, 'יש לתקן את השדות המסומנים.');

        try {
          if (!(await rpc('username_available', { p_username: username }))) {
            F.user.setError('שם המשתמש תפוס. נסו שם אחר.');
            return showFormError(err, 'שם המשתמש תפוס.');
          }
        } catch {}

        const { data, error } = await sb.auth.signUp({
          email: f.email.value.trim(),
          password: f.pass.value,
          options: {
            emailRedirectTo: location.origin + '/',
            data: {
              first_name: f.first.value.trim(), last_name: f.last.value.trim(), username,
              phone: f.phone.value.trim(), role, sports, coach_sports: role === 'coach' ? cSports : [],
              bio: role === 'coach' ? f.bio.value.trim() : '',
            },
          },
        });
        if (error) return showFormError(err, friendlyError(error));
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return showFormError(err, 'כבר קיים חשבון עם המייל הזה. אפשר להתחבר או לשחזר סיסמה.');
        }
        if (!data.session) {
          clear(main).append(successState('נשלח אליך מייל לאימות',
            'פתחו את הקישור במייל כדי להשלים את ההרשמה, ואז התחברו.',
            h('a', { class: 'btn', href: '#/login' }, 'למסך הכניסה')));
        }
        // with a session, the app redirects automatically (first upload screen for trainees)
      });
    });

    main.append(...header('הרשמה'), form);
  };
  render();
}

export function forgotPage({ main }) {
  const email = h('input', { type: 'email', autocomplete: 'email', dir: 'ltr' });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'שליחת קישור לאיפוס');
  const form = h('form', { novalidate: true }, err, field('מייל', email), btn,
    h('p', { class: 'center' }, h('a', { href: '#/login' }, 'חזרה לכניסה')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return showFormError(err, 'יש להזין כתובת מייל תקינה.');
    busy(btn, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + '/' });
      if (error) return showFormError(err, friendlyError(error));
      clear(main).append(successState('אם קיים חשבון עם המייל הזה, נשלח אליו קישור לאיפוס הסיסמה.',
        'הקישור תקף לזמן מוגבל. בדקו גם בתיקיית הספאם.', h('a', { class: 'btn', href: '#/login' }, 'חזרה לכניסה')));
    });
  });
  main.append(...header('שחזור סיסמה', 'נשלח אליך קישור לבחירת סיסמה חדשה.'), form);
}

export function resetPage({ main }) {
  const pass = h('input', { type: 'password', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = formError();
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'שמירת סיסמה חדשה');
  const form = h('form', { novalidate: true }, err, field('סיסמה חדשה', pass, 'לפחות 8 תווים.'), field('אימות סיסמה', pass2), btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pass.value.length < 8) return showFormError(err, 'הסיסמה צריכה לכלול לפחות 8 תווים.');
    if (pass.value !== pass2.value) return showFormError(err, 'הסיסמאות אינן תואמות.');
    busy(btn, async () => {
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) return showFormError(err, friendlyError(error));
      await loadProfile().catch(() => {});
      clear(main).append(successState('הסיסמה עודכנה', null, h('a', { class: 'btn', href: '#/home' }, 'המשך')));
    });
  });
  main.append(...header('בחירת סיסמה חדשה'), form);
}
