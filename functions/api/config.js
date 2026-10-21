// GET /api/config — public client settings (the Supabase anon key is designed to be public;
// all access is enforced by row-level security in the database).
import { json } from '../_lib/common.js';
export const onRequestGet = ({ env }) =>
  json({ supabaseUrl: env.SUPABASE_URL || null, supabaseAnonKey: env.SUPABASE_ANON_KEY || null });
