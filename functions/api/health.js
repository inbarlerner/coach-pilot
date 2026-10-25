// GET /api/health — shows whether the site settings are in place (never returns their values).
import { json, publicKey } from '../_lib/common.js';
export const onRequestGet = ({ env }) => {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!publicKey(env)) missing.push('SUPABASE_PUBLISHABLE_KEY');
  return json({ ok: missing.length === 0, missing, ai: !!env.ANTHROPIC_API_KEY });   // ai: the admin AI lab can run
};
