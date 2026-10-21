// GET /api/config — public client settings. The Supabase publishable key is designed to be public;
// all access is enforced by row-level security in the database.
import { json, publicKey } from '../_lib/common.js';
export const onRequestGet = ({ env }) =>
  json({ supabaseUrl: env.SUPABASE_URL || null, supabaseAnonKey: publicKey(env) || null });
