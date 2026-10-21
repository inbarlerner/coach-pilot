// Minimal Supabase client (Auth + REST + RPC) — no third-party CDN needed.
// Talks to Supabase's documented HTTP APIs: /auth/v1 (GoTrue) and /rest/v1 (PostgREST).

const STORAGE_KEY = 'pilot.session.v1';

export function createClient(url, anonKey) {
  url = url.replace(/\/$/, '');
  const listeners = new Set();
  let session = load();
  let refreshing = null;

  function load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; } }
  function save(s) {
    session = s;
    try { s ? localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) : localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  const emit = (event) => listeners.forEach((cb) => { try { cb(event, session); } catch (e) { console.error(e); } });
  const toSession = (d) => ({
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user,
  });

  async function authFetch(path, { method = 'POST', body, token, query } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    let r;
    try {
      r = await fetch(`${url}/auth/v1/${path}${qs}`, {
        method,
        headers: { apikey: anonKey, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { return { error: { message: 'Failed to fetch' } }; }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!r.ok) return { error: { status: r.status, message: data?.msg || data?.error_description || data?.message || data?.error || 'AUTH_ERROR', code: data?.error_code || data?.code } };
    return { data };
  }

  async function refresh() {
    if (!session?.refresh_token) return null;
    if (!refreshing) {
      refreshing = (async () => {
        const { data, error } = await authFetch('token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: session.refresh_token } });
        if (error) {
          if (error.status && error.status < 500) { save(null); emit('SIGNED_OUT'); }
          return null;
        }
        save(toSession(data)); emit('TOKEN_REFRESHED');
        return session;
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function currentToken() {
    if (!session) return null;
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    return session?.access_token || null;
  }

  // Handle links from emails (confirm signup / password recovery): #access_token=...&type=...
  async function detectFromUrl() {
    const hash = location.hash.replace(/^#/, '');
    if (!/(^|&)(access_token|error_description)=/.test(hash)) return;
    const p = new URLSearchParams(hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('error_description')) { detected.error = p.get('error_description').replace(/\+/g, ' '); return; }
    const token = p.get('access_token');
    const { data: user } = await authFetch('user', { method: 'GET', token });
    if (!user) return;
    save(toSession({ access_token: token, refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in') || 3600), expires_at: Number(p.get('expires_at')) || undefined, user }));
    detected.type = p.get('type');
  }
  const detected = { type: null, error: null };

  const auth = {
    detected,
    async initialize() { await detectFromUrl(); if (session) await currentToken(); },
    async getSession() { await currentToken(); return { data: { session } }; },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async signUp({ email, password, options = {} }) {
      const { data, error } = await authFetch('signup', {
        query: options.emailRedirectTo ? { redirect_to: options.emailRedirectTo } : undefined,
        body: { email, password, data: options.data || {} },
      });
      if (error) return { data: { user: null, session: null }, error };
      if (data.access_token) { save(toSession(data)); emit('SIGNED_IN'); return { data: { user: data.user, session }, error: null }; }
      return { data: { user: data, session: null }, error: null };   // email confirmation required
    },
    async signInWithPassword({ email, password }) {
      const { data, error } = await authFetch('token', { query: { grant_type: 'password' }, body: { email, password } });
      if (error) return { data: {}, error };
      save(toSession(data)); emit('SIGNED_IN');
      return { data: { user: data.user, session }, error: null };
    },
    async signOut() {
      const t = session?.access_token;
      save(null);
      emit('SIGNED_OUT');                       // update the screen immediately
      if (t) authFetch('logout', { token: t }); // revoke the session server-side in the background
      return { error: null };
    },
    async resetPasswordForEmail(email, { redirectTo } = {}) {
      const { error } = await authFetch('recover', { query: redirectTo ? { redirect_to: redirectTo } : undefined, body: { email } });
      return { data: {}, error: error || null };
    },
    async updateUser(attrs) {
      const token = await currentToken();
      if (!token) return { error: { message: 'NOT_AUTHENTICATED' } };
      const { data, error } = await authFetch('user', { method: 'PUT', token, body: attrs });
      if (error) return { error };
      save({ ...session, user: data }); emit('USER_UPDATED');
      return { data: { user: data }, error: null };
    },
  };

  async function restFetch(path, init = {}, retry = true) {
    const token = await currentToken();
    let r;
    try {
      r = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: anonKey, ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json', ...(init.headers || {}) },
      });
    } catch { return { error: { message: 'Failed to fetch' } }; }
    if (r.status === 401 && retry && session) {
      if (await refresh()) return restFetch(path, init, false);
    }
    const text = init.method === 'HEAD' ? '' : await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const range = r.headers.get('content-range');
    const count = range && range.includes('/') ? Number(range.split('/')[1]) : null;
    if (!r.ok) return { data: null, count, error: { status: r.status, message: data?.message || 'DB_ERROR', code: data?.code, details: data?.details } };
    return { data, count, error: null };
  }

  const fmt = (v) => (v === null ? 'null' : typeof v === 'string' && /[,()".:\s]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : String(v));

  class Query {
    constructor(table) { this.table = table; this.params = new URLSearchParams(); this.method = 'GET'; this.body = undefined; this.headers = {}; this.mode = 'many'; this.orders = []; }
    select(cols = '*', opts = {}) {
      this.params.set('select', cols.replace(/\s+/g, ''));
      if (opts.count) this.headers.Prefer = `count=${opts.count}`;
      if (opts.head) this.method = 'HEAD';
      return this;
    }
    insert(rows) { this.method = 'POST'; this.body = rows; this.headers.Prefer = 'return=minimal'; return this; }
    update(values) { this.method = 'PATCH'; this.body = values; this.headers.Prefer = 'return=minimal'; return this; }
    delete() { this.method = 'DELETE'; this.headers.Prefer = 'return=minimal'; return this; }
    // Plain operators take the raw value; quoting is only for in-lists (PostgREST rules).
    eq(c, v) { this.params.append(c, 'eq.' + (v === null ? 'null' : String(v))); return this; }
    neq(c, v) { this.params.append(c, 'neq.' + (v === null ? 'null' : String(v))); return this; }
    in(c, vals) { this.params.append(c, `in.(${vals.map(fmt).join(',')})`); return this; }
    ilike(c, v) { this.params.append(c, 'ilike.' + String(v)); return this; }
    or(expr) { this.params.append('or', `(${expr})`); return this; }
    order(c, { ascending = true } = {}) { this.orders.push(`${c}.${ascending ? 'asc' : 'desc'}`); return this; }
    limit(n) { this.params.set('limit', String(n)); return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    single() { this.mode = 'single'; return this; }
    async run() {
      if (this.orders.length) this.params.set('order', this.orders.join(','));
      const res = await restFetch(`${this.table}?${this.params.toString()}`, {
        method: this.method, headers: this.headers, body: this.body !== undefined ? JSON.stringify(this.body) : undefined,
      });
      if (res.error || this.method !== 'GET') return res;
      if (this.mode === 'many') return res;
      const rows = Array.isArray(res.data) ? res.data : [];
      if (rows.length > 1) return { data: null, error: { message: 'MULTIPLE_ROWS' } };
      if (!rows.length && this.mode === 'single') return { data: null, error: { message: 'NOT_FOUND' } };
      return { data: rows[0] || null, error: null };
    }
    then(resolve, reject) { return this.run().then(resolve, reject); }
  }

  return {
    auth,
    from: (table) => new Query(table),
    rpc: (fn, args = {}) => ({
      then(resolve, reject) {
        return restFetch(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }).then(resolve, reject);
      },
    }),
  };
}
