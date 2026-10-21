// GET /api/health — shows whether server settings are in place (never returns secret values).
import { json, publicKey } from '../_lib/common.js';
export const onRequestGet = ({ env }) => {
  const missing = ['SUPABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((k) => !env[k]);
  if (!publicKey(env)) missing.unshift('SUPABASE_PUBLISHABLE_KEY');
  return json({ ok: missing.length === 0, missing });
};
