// Exercises the server functions with a stubbed Supabase, checking permission paths.
import { onRequestPost as uploadUrl } from '../functions/api/upload-url.js';
import { onRequestPost as mediaUrl } from '../functions/api/media-url.js';
import { onRequestPost as action } from '../functions/api/action.js';

const env = {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon',
  R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'media',
};
const USER = '11111111-1111-1111-1111-111111111111';
const VISIBLE = '22222222-2222-2222-2222-222222222222';
const deleted = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const auth = (init.headers || {}).authorization;
  if (url.endsWith('/auth/v1/user')) return auth === 'Bearer good' ? new Response(JSON.stringify({ id: USER })) : new Response('{}', { status: 401 });
  if (url.includes('/rest/v1/videos?id=eq.' + VISIBLE)) return new Response(JSON.stringify([{ storage_key: `videos/${USER}/a.mp4` }]));
  if (url.includes('/rest/v1/videos?id=eq.')) return new Response('[]');               // RLS hides it
  if (url.includes('/rest/v1/rpc/delete_video')) return new Response(JSON.stringify([`videos/${USER}/a.mp4`, `responses/x/b.webm`]));
  if (init.method === 'DELETE' && url.includes('r2.cloudflarestorage.com')) { deleted.push(new URL(url).pathname); return new Response(''); }
  throw new Error('unexpected fetch ' + url);
};
const req = (body, token = 'good') => ({ request: new Request('https://x/api', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env });
const check = (c, l) => { if (!c) { console.error('FAIL', l); process.exit(1); } console.log('PASS:', l); };

let r = await uploadUrl(req({ purpose: 'video', contentType: 'video/mp4', size: 1000 }));
let b = await r.json();
check(r.status === 200 && b.key.startsWith(`videos/${USER}/`) && b.url.includes('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost'), 'upload URL is in own folder and signs size+type');
r = await uploadUrl(req({ purpose: 'video', contentType: 'video/mp4', size: 300 * 1024 * 1024 }));
check(r.status === 400 && (await r.json()).error === 'TOO_LARGE', 'over-size upload refused');
r = await uploadUrl(req({ purpose: 'video', contentType: 'application/x-msdownload', size: 10 }));
check(r.status === 400, 'non-video type refused');
r = await uploadUrl(req({ purpose: 'video', contentType: 'video/mp4', size: 10 }, 'bad'));
check(r.status === 401, 'no valid session → refused');

r = await mediaUrl(req({ kind: 'video', id: VISIBLE }));
check(r.status === 200 && (await r.json()).url.includes('/media/videos/'), 'permitted viewer gets a time-limited link');
r = await mediaUrl(req({ kind: 'video', id: '33333333-3333-3333-3333-333333333333' }));
check(r.status === 404, 'database hides private video → no link issued');

r = await action(req({ fn: 'admin_set_disabled', args: {} }));
check(r.status === 400, 'only file-releasing actions allowed via /api/action');
r = await action(req({ fn: 'delete_video', args: { p_video: VISIBLE } }));
check(r.status === 200 && deleted.length === 2, 'delete removes exactly the files the database returned');
