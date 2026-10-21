// GET /api/health — tells the setup guide whether server settings are in place (no secrets returned).
import { json } from '../_lib/common.js';
export const onRequestGet = ({ env }) => {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = keys.filter((k) => !env[k]);
  return json({ ok: missing.length === 0, missing });
};
