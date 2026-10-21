import { presign } from './sigv4.js';

export const LIMITS = {
  video: { maxBytes: 200 * 1024 * 1024, types: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'] },
  responseAudio: { maxBytes: 50 * 1024 * 1024, types: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'] },
  responseVideo: { maxBytes: 200 * 1024 * 1024, types: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'] },
};
const EXT = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};
export const extFor = (t) => EXT[t] || 'bin';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export function config(env) {
  const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new HttpError(500, 'SERVER_NOT_CONFIGURED: ' + missing.join(', '));
  return {
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ''),
    anonKey: env.SUPABASE_ANON_KEY,
    r2: {
      // R2_TEST_ENDPOINT is only for local automated tests (e.g. http://127.0.0.1:8001). Never set it in production.
      protocol: env.R2_TEST_ENDPOINT ? new URL(env.R2_TEST_ENDPOINT).protocol.replace(':', '') : 'https',
      host: env.R2_TEST_ENDPOINT ? new URL(env.R2_TEST_ENDPOINT).host : `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  };
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) throw new HttpError(401, 'NOT_AUTHENTICATED');
  return t;
}

// Validates the user's session with Supabase Auth.
export async function getUser(cfg, token) {
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new HttpError(401, 'NOT_AUTHENTICATED');
  return r.json();
}

// Queries run AS THE USER, so database row-level security decides access.
export async function rest(cfg, token, path, init = {}) {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw new HttpError(r.status === 401 ? 401 : 400, (body && body.message) || 'DB_ERROR');
  return body;
}

export const rpc = (cfg, token, fn, args) =>
  rest(cfg, token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) });

export function objectUrl(cfg, method, key, { expires = 900, headers } = {}) {
  return presign({
    method,
    host: cfg.r2.host,
    protocol: cfg.r2.protocol,
    path: `/${cfg.r2.bucket}/${key}`,
    accessKeyId: cfg.r2.accessKeyId,
    secretAccessKey: cfg.r2.secretAccessKey,
    expires,
    headers,
  });
}

export async function deleteObjects(cfg, keys) {
  const list = (keys || []).filter((k) => typeof k === 'string' && /^(videos|responses)\//.test(k));
  await Promise.all(list.map(async (k) => {
    const url = await objectUrl(cfg, 'DELETE', k, { expires: 60 });
    await fetch(url, { method: 'DELETE' }).catch(() => {});
  }));
}

export function handler(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e.message || 'SERVER_ERROR' }, status);
    }
  };
}
