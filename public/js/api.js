// Data layer: Supabase client, current user, file uploads and protected media links.
import { createClient } from './sbclient.js';

export const LIMITS = {
  videoMaxMB: 200,
  responseAudioMaxMB: 50,
  responseVideoMaxMB: 200,
  videoFormats: 'MP4, MOV, WebM',
  videoTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'],
  audioTypes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'],
};

export let sb = null;
export const state = { session: null, user: null, profile: null, sports: [], unread: 0 };

export async function init() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('SERVER_NOT_CONFIGURED');
  const cfg = await res.json();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('SERVER_NOT_CONFIGURED');
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  await sb.auth.initialize();
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  return sb;
}

export async function loadSports(force = false) {
  if (state.sports.length && !force) return state.sports;
  const { data, error } = await sb.from('sports').select('*').order('sort').order('name');
  if (error) throw error;
  state.sports = data;
  return data;
}
export const sportName = (id) => state.sports.find((s) => s.id === id)?.name || '';
export const activeSports = () => state.sports.filter((s) => s.active);

export async function loadProfile() {
  if (!state.user) { state.profile = null; return null; }
  const { data, error } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  state.profile = data;
  return data;
}
export const isAdmin = () => state.profile?.role === 'admin' && !state.profile?.disabled;
export const isApprovedCoach = () => state.profile?.role === 'coach' && state.profile?.coach_status === 'approved';
export const isCoach = () => state.profile?.role === 'coach';

// Throws on error; returns data.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
export const rpc = (fn, args) => q(sb.rpc(fn, args));

async function token() {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error('NOT_AUTHENTICATED');
  return data.session.access_token;
}
export async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || 'HTTP_' + r.status);
  return out;
}
// Actions that may release stored files (delete video, discard draft, decline, remove item)
export const action = (fn, args) => api('/api/action', { fn, args });

// ---------- Files ----------
const EXT_TYPES = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg' };
export function fileType(file) {
  let t = (file.type || '').split(';')[0].trim().toLowerCase();
  if (!t || t === 'application/octet-stream') {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    t = EXT_TYPES[ext] || t;
  }
  return t;
}

/**
 * Upload a file straight to private storage with progress.
 * purpose: 'video' | 'responseAudio' | 'responseVideo'
 * Returns { key, contentType, size }. `onProgress(0..1)`. Supports abort via signal.
 */
export async function uploadFile(file, purpose, onProgress, signal) {
  const contentType = fileType(file);
  const { key, url } = await api('/api/upload-url', { purpose, contentType, size: file.size });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('UPLOAD_FAILED_' + xhr.status)));
    xhr.onerror = () => reject(new Error('Failed to fetch'));
    xhr.onabort = () => reject(new Error('UPLOAD_ABORTED'));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
  return { key, contentType, size: file.size };
}

// Signed, time-limited link to a protected file — only issued if the database lets this user see it.
const mediaCache = new Map();
export async function mediaUrl(kind, id) {
  const k = kind + ':' + id;
  const c = mediaCache.get(k);
  if (c && c.until > Date.now()) return c.url;
  const { url, expiresIn } = await api('/api/media-url', { kind, id });
  mediaCache.set(k, { url, until: Date.now() + (expiresIn - 300) * 1000 });
  return url;
}

export async function refreshUnread() {
  if (!state.user) return 0;
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false);
  state.unread = count || 0;
  return state.unread;
}
