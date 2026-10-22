// Data layer: Supabase client, current user, file uploads and protected media links.
import { createClient } from './sbclient.js';

// Supabase free plan: 50 MB per file. The same limit is set on the storage bucket (003_storage.sql).
export const MAX_MB = 50;
export const BUCKET = 'media';
export const LIMITS = {
  videoMaxMB: MAX_MB,
  responseAudioMaxMB: MAX_MB,
  responseVideoMaxMB: MAX_MB,
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

// Database actions that release stored files (delete video, discard draft, decline, remove item):
// the database decides and returns the files to remove; then they are removed from storage.
export async function action(fn, args) {
  const result = await rpc(fn, args);
  const keys = (Array.isArray(result) ? result : result ? [result] : []).filter(Boolean);
  if (keys.length) {
    const { error } = await sb.storage.from(BUCKET).remove(keys);
    if (error) console.warn('storage cleanup failed', error);   // the app data is already updated
  }
  return { ok: true };
}

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

const EXT = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};
export const sizeMB = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/**
 * Upload a file to the private bucket, into the user's own folder, with progress.
 * purpose: 'video' | 'responseAudio' | 'responseVideo'. Returns { key, contentType, size }.
 */
export async function uploadFile(file, purpose, onProgress, signal) {
  const contentType = fileType(file);
  const allowed = purpose === 'responseAudio' ? LIMITS.audioTypes : LIMITS.videoTypes;
  if (!allowed.includes(contentType)) throw new Error('BAD_TYPE');
  if (file.size > MAX_MB * 1048576) throw new Error('TOO_LARGE');
  const folder = purpose === 'video' ? 'videos' : 'responses';
  const key = `${folder}/${state.user.id}/${crypto.randomUUID()}.${EXT[contentType] || 'bin'}`;
  const { error } = await sb.storage.from(BUCKET).upload(key, file, { contentType, onProgress, signal });
  if (error) throw new Error(error.message || 'UPLOAD_FAILED');
  return { key, contentType, size: file.size };
}
// Best-effort removal of a file that was uploaded but could not be saved in the app.
export const discardUpload = (key) => sb.storage.from(BUCKET).remove([key]).catch(() => {});

// Time-limited link to a protected file. The key is read through the database's permissions,
// and storage issues the link only if its own access rules agree.
const mediaCache = new Map();
const LINK_SECONDS = 3600;
export async function mediaUrl(kind, id) {
  const k = kind + ':' + id;
  const c = mediaCache.get(k);
  if (c && c.until > Date.now()) return c.url;
  const table = kind === 'video' ? 'videos' : 'analysis_items';
  const row = await q(sb.from(table).select('storage_key').eq('id', id).maybeSingle());
  if (!row || !row.storage_key) throw new Error('NOT_FOUND');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(row.storage_key, LINK_SECONDS);
  if (error) throw new Error(/not.?found|404/i.test(error.message + error.code) ? 'NOT_FOUND' : error.message);
  mediaCache.set(k, { url: data.signedUrl, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return data.signedUrl;
}

export async function refreshUnread() {
  if (!state.user) return 0;
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false);
  state.unread = count || 0;
  return state.unread;
}
