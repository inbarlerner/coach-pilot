// POST /api/media-url  { kind: 'video' | 'item', id }
// Looks the file up AS THE USER (row-level security decides). If the user may not
// see it, nothing is returned and no link is issued. The bucket itself is private.
import { config, bearer, json, handler, HttpError, rest, objectUrl } from '../_lib/common.js';

const UUID = /^[0-9a-f-]{36}$/i;

export const onRequestPost = handler(async ({ request, env }) => {
  const cfg = config(env);
  const token = bearer(request);
  const { kind, id } = await request.json();
  if (!UUID.test(id || '')) throw new HttpError(400, 'BAD_ID');

  let rows;
  if (kind === 'video') rows = await rest(cfg, token, `videos?id=eq.${id}&select=storage_key`);
  else if (kind === 'item') rows = await rest(cfg, token, `analysis_items?id=eq.${id}&select=storage_key`);
  else throw new HttpError(400, 'BAD_KIND');

  const key = rows && rows[0] && rows[0].storage_key;
  if (!key) throw new HttpError(404, 'NOT_FOUND');
  const url = await objectUrl(cfg, 'GET', key, { expires: 60 * 60 });
  return json({ url, expiresIn: 3600 });
});
