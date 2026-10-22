// Shared helpers for the two small server functions (site settings + health check).
// Files are stored in Supabase Storage; the browser talks to Supabase directly,
// and Supabase enforces every permission (database rules + storage access rules).

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Supabase "publishable" key (sb_publishable_...) — the older "anon" key name is also accepted.
export const publicKey = (env) => env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
