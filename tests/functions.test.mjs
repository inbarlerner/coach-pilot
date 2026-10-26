// Server functions: site settings are exposed only as the two public values; health reports what is missing.
import { onRequestGet as config } from '../functions/api/config.js';
import { onRequestGet as health } from '../functions/api/health.js';

const check = (c, l) => { if (!c) { console.error('FAIL', l); process.exit(1); } console.log('PASS:', l); };

let r = await config({ env: { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', OTHER_SECRET: 's3cret' } });
let b = await r.json();
check(b.supabaseUrl === 'https://p.supabase.co' && b.supabaseAnonKey === 'sb_publishable_x' && !JSON.stringify(b).includes('s3cret'), 'config returns only the URL and the publishable key');
r = await config({ env: { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'legacy' } });
check((await r.json()).supabaseAnonKey === 'legacy', 'older "anon" key name still accepted');
b = await (await health({ env: {} })).json();
check(!b.ok && b.missing.join() === 'SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY', 'health lists missing settings');
b = await (await health({ env: { SUPABASE_URL: 'x', SUPABASE_PUBLISHABLE_KEY: 'y' } })).json();
check(b.ok, 'health ok when both settings are present');
b = await (await health({ env: { SUPABASE_URL: 'x', SUPABASE_PUBLISHABLE_KEY: 'y', ANTHROPIC_API_KEY: 'sk-ant-secret' } })).json();
check(b.ai === true && !JSON.stringify(b).includes('sk-ant'), 'health says whether the AI lab key is set, never the key');
