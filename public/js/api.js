// Data layer: Supabase client, current user, file uploads and protected media links.
import { createClient } from './sbclient.js';

// Supabase free plan: 50 MB per file. The same limit is set on the storage bucket (003_storage.sql).
export const MAX_MB = 50;
export const BUCKET = 'media';
export const AVATARS = 'avatars';   // public bucket for profile photos (007)
export const LIMITS = {
  videoMaxMB: MAX_MB,
  responseAudioMaxMB: MAX_MB,
  responseVideoMaxMB: MAX_MB,
  videoFormats: 'MP4, MOV, WebM',
  videoTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'],
  audioTypes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'],
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
};

// Languages a user can say they speak (ISO 639-1). The database accepts any two-letter code.
export const LANGUAGES = {
  en: 'English', he: 'Hebrew', ar: 'Arabic', ru: 'Russian', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', uk: 'Ukrainian', ro: 'Romanian', el: 'Greek',
  tr: 'Turkish', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', cs: 'Czech', hu: 'Hungarian',
  ja: 'Japanese', zh: 'Chinese', ko: 'Korean', hi: 'Hindi', th: 'Thai', id: 'Indonesian',
};
export const languageNames = (codes) => (codes || []).map((c) => LANGUAGES[c] || c.toUpperCase()).join(', ');

export let sb = null;
export const state = { session: null, user: null, profile: null, sports: [], unread: 0, inboxUnread: 0 };

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
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
export const sizeMB = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/**
 * Upload a file into the user's own folder, with progress.
 * purpose: 'video' | 'responseAudio' | 'responseVideo' | 'cover' (private bucket) | 'avatar' (public photos).
 * Returns { key, contentType, size }.
 */
export async function uploadFile(file, purpose, onProgress, signal) {
  const contentType = fileType(file);
  const image = purpose === 'cover' || purpose === 'avatar';
  const allowed = image ? LIMITS.imageTypes : purpose === 'responseAudio' ? LIMITS.audioTypes : LIMITS.videoTypes;
  if (!allowed.includes(contentType)) throw new Error('BAD_TYPE');
  if (file.size > (image ? 2 : MAX_MB) * 1048576) throw new Error('TOO_LARGE');
  const name = `${state.user.id}/${crypto.randomUUID()}.${EXT[contentType] || 'bin'}`;
  const bucket = purpose === 'avatar' ? AVATARS : BUCKET;
  const key = purpose === 'avatar' ? name
    : `${({ video: 'videos', cover: 'covers' })[purpose] || 'responses'}/${name}`;
  if (bucket === BUCKET) await makeRoom(file.size);
  const { error } = await sb.storage.from(bucket).upload(key, file, { contentType, onProgress, signal });
  if (error) throw new Error(error.message || 'UPLOAD_FAILED');
  return { key, contentType, size: file.size };
}
// Free up space if storage is near its cap: the database picks the oldest videos without an
// open request (005_auto_cleanup.sql) and releases their files; we remove them from storage.
// If that setup file has not been run yet, uploads simply continue.
async function makeRoom(bytes) {
  try {
    const keys = await rpc('make_room', { p_bytes: bytes });
    if (Array.isArray(keys) && keys.length) await sb.storage.from(BUCKET).remove(keys);
  } catch (e) { console.warn('make_room skipped', e); }
}

// Best-effort removal of a file that was uploaded but could not be saved in the app.
export const discardUpload = (key, bucket = BUCKET) => sb.storage.from(bucket).remove([key]).catch(() => {});

// Profile photos are public: a plain address, no signing.
export const avatarUrl = (key) => (key ? sb.storage.from(AVATARS).getPublicUrl(key).data.publicUrl : null);

// Covers are private: signed links, requested together for everything on screen at once.
const coverCache = new Map();
let coverQueue = null;
export function coverUrl(key) {
  if (!key) return Promise.resolve(null);
  const c = coverCache.get(key);
  if (c && c.until > Date.now()) return c.promise;
  if (!coverQueue) {
    coverQueue = new Map();
    queueMicrotask(async () => {
      const batch = coverQueue; coverQueue = null;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls([...batch.keys()], LINK_SECONDS);
      const byPath = new Map((data || []).map((d) => [d.path, d.signedUrl]));
      for (const [k, done] of batch) {
        const url = error ? null : byPath.get(k) || null;
        if (!url) coverCache.delete(k);
        done(url);
      }
    });
  }
  let done;
  const promise = new Promise((r) => { done = r; });
  coverQueue.set(key, done);
  coverCache.set(key, { promise, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return promise;
}

// Time-limited link to a protected file. The key is read through the database's permissions,
// and storage issues the link only if its own access rules agree.
const mediaCache = new Map();
const LINK_SECONDS = 3600;
export async function mediaUrl(kind, id) {
  const k = kind + ':' + id;
  const c = mediaCache.get(k);
  if (c && c.until > Date.now()) return c.url;
  const table = kind === 'video' ? 'videos' : 'analysis_items';
  const row = await q(sb.from(table).select('*').eq('id', id).maybeSingle());
  if (!row || !row.storage_key) throw new Error('NOT_FOUND');
  if (row.file_deleted_at) throw new Error('FILE_REMOVED');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(row.storage_key, LINK_SECONDS);
  if (error) throw new Error(/not.?found|404/i.test(error.message + error.code) ? 'NOT_FOUND' : error.message);
  mediaCache.set(k, { url: data.signedUrl, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return data.signedUrl;
}

export async function refreshUnread() {
  if (!state.user) return 0;
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false);
  state.unread = count || 0;
  // Inbox badge: requests with something new for me (a new video to analyze, an analysis, a follow-up message).
  const me = state.user.id;
  const r = await sb.from('analysis_requests').select('id', { count: 'exact', head: true })
    .or(`and(coach_id.eq.${me},coach_read.eq.false),and(trainee_id.eq.${me},trainee_read.eq.false)`);
  state.inboxUnread = r.count || 0;
  return state.unread;
}
