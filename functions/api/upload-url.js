// POST /api/upload-url  { purpose: 'video' | 'responseAudio' | 'responseVideo', contentType, size }
// Returns a short-lived signed PUT URL into the user's own folder.
// The size and type are part of the signature, so the browser cannot upload anything else.
import { config, bearer, getUser, json, handler, HttpError, LIMITS, extFor, objectUrl } from '../_lib/common.js';

export const onRequestPost = handler(async ({ request, env }) => {
  const cfg = config(env);
  const token = bearer(request);
  const user = await getUser(cfg, token);
  const { purpose, contentType, size } = await request.json();

  const lim = LIMITS[purpose];
  if (!lim) throw new HttpError(400, 'BAD_PURPOSE');
  if (!lim.types.includes(contentType)) throw new HttpError(400, 'BAD_TYPE');
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'BAD_SIZE');
  if (size > lim.maxBytes) throw new HttpError(400, 'TOO_LARGE');

  const folder = purpose === 'video' ? 'videos' : 'responses';
  const key = `${folder}/${user.id}/${crypto.randomUUID()}.${extFor(contentType)}`;
  const url = await objectUrl(cfg, 'PUT', key, {
    expires: 30 * 60,
    headers: { 'content-type': contentType, 'content-length': String(size) },
  });
  return json({ key, url });
});
