// POST /api/action  { fn, args }
// Runs a database action that may release stored files (as the user — permissions
// are checked in the database), then deletes exactly the files the database returned.
import { config, bearer, json, handler, HttpError, rpc, deleteObjects } from '../_lib/common.js';

const ALLOWED = new Set(['delete_video', 'discard_draft', 'decline_request', 'remove_analysis_item']);

export const onRequestPost = handler(async ({ request, env }) => {
  const cfg = config(env);
  const token = bearer(request);
  const { fn, args } = await request.json();
  if (!ALLOWED.has(fn)) throw new HttpError(400, 'BAD_ACTION');
  const result = await rpc(cfg, token, fn, args);
  const keys = Array.isArray(result) ? result : result ? [result] : [];
  await deleteObjects(cfg, keys);
  return json({ ok: true });
});
