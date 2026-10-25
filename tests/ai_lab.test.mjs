// Admin AI lab: the server function (/api/ai-lab), the card list, and the browser copy of the text renderer.
// node tests/ai_lab.test.mjs   (no network: Supabase, the site assets and Claude are all faked)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost } from '../functions/api/ai-lab.js';
import { renderText as coreText, frameLabel as coreLabel } from '../functions/_lib/ai-coach.js';
import { renderText as webText, frameLabel as webLabel } from '../public/js/ai-text.js';
import { buildIndex, DIR } from '../scripts/ai-cards-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = (c, l) => { if (!c) { console.error('FAIL', l); process.exit(1); } console.log('PASS:', l); };

// ---------- card list + browser renderer stay in sync ----------
check(JSON.stringify(buildIndex()) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'))),
  'public/ai-coach/index.json is up to date (else: node scripts/ai-cards-index.mjs)');
const sample = {
  verdict: 'ok', trick_identified: 'קפיצה', trick_confidence: 'medium', summary: 's', strengths: ['a', 'b'],
  fixes: [{ issue: 'i', what_we_see: 'w', why: 'y', drill: 'd', frames: 'F03' }], steps: [], safety_note: 'n', cannot_judge: ['c'], filming_tip: 't',
};
check(['he', 'en'].every((l) => coreText(sample, l) === webText(sample, l)) && coreLabel(7) === webLabel(7), 'browser and server render the written analysis identically (he + en)');
check(webText(sample, 'en') !== webText(sample, 'he'), 'English and Hebrew headings differ');

// ---------- server function, with fakes ----------
const RUN = '11111111-2222-3333-4444-555555555555';
const run = {
  id: RUN, sport: 'kitesurf', trick: 'hooked-jump.md', question: 'q', lang: 'en', model: 'sonnet', effort: 'low',
  video: { duration: 6 }, frames: [1, 2, 3].map((n) => ({ n, t: n / 2, kind: 'overview', file: `${RUN}/F0${n}.jpg` })),
};
const analysis = { ...sample, steps: [{ kind: 'pause', from_frame: 2, to_frame: 2, rate: 1, title: 'x', text: 'y', fix_index: 0, draw: [] }] };
const assets = { fetch: async (req) => {
  const p = path.join(ROOT, 'public', decodeURIComponent(new URL(req.url).pathname));
  return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response('nf', { status: 404 });
} };
function fake({ startError = null, claude = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, headers: opts.headers, body });
    if (url.endsWith('/rpc/ai_lab_start')) return startError ? new Response(JSON.stringify({ message: startError }), { status: 400 }) : Response.json(run);
    if (url.includes('/storage/v1/object/sign/ai-lab')) return Response.json(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/ai-lab/${p}?token=t` })));
    if (url.startsWith('https://api.anthropic.com')) return claude ? claude() : Response.json({
      model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500 },
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(analysis) }],
    });
    if (url.endsWith('/rpc/ai_lab_finish')) return new Response(null, { status: 204 });
    return new Response('unexpected ' + url, { status: 500 });
  };
  return { calls, fetchImpl };
}
const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pub', ANTHROPIC_API_KEY: 'sk-ant-SECRET', ASSETS: assets };
const post = (f, { auth = 'Bearer user-token', id = RUN, e = env } = {}) => onRequestPost({
  request: new Request('https://site.test/api/ai-lab', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify({ run_id: id }) }),
  env: e, fetchImpl: f.fetchImpl,
});
const lines = async (res) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l));

let f = fake();
let r = await post(f, { e: { ...env, ANTHROPIC_API_KEY: '' } });
check(r.status === 503 && (await r.json()).error === 'AI_NOT_CONFIGURED' && f.calls.length === 0, 'no API key → 503, nothing called');
r = await post(f, { auth: null });
check(r.status === 401 && f.calls.length === 0, 'not signed in → 401');
r = await post(f, { id: 'nope' });
check(r.status === 400, 'bad run id → 400');

f = fake({ startError: 'NOT_ADMIN' });
r = await post(f);
check(r.status === 403 && f.calls.length === 1 && !f.calls.some((c) => c.url.includes('anthropic')), 'database says not admin → 403, Claude never called');
f = fake({ startError: 'AI_MONTHLY_LIMIT' });
r = await post(f);
check(r.status === 429, 'monthly spend limit → 429');

f = fake();
r = await post(f);
let out = await lines(r);
const text = JSON.stringify(out);
check(out.at(-1).type === 'done' && out.at(-1).id === RUN, 'happy path streams done');
check(!text.includes('SECRET') && !text.includes('user-token'), 'the API key and the user token never appear in the response');
const sbCalls = f.calls.filter((c) => c.url.startsWith(env.SUPABASE_URL));
check(sbCalls.every((c) => c.headers.authorization === 'Bearer user-token' && c.headers.apikey === 'pub'), 'every database call runs as the signed-in user');
const ai = f.calls.find((c) => c.url.startsWith('https://api.anthropic.com'));
check(ai.headers['x-api-key'] === 'sk-ant-SECRET' && ai.body.model === 'claude-sonnet-5-5' && ai.body.stream === false, 'Claude called with the secret key, chosen model, not streamed');
const imgs = ai.body.messages[0].content.filter((b) => b.type === 'image');
check(imgs.length === 3 && imgs.every((b) => b.source.type === 'url' && b.source.url.startsWith('https://p.supabase.co/storage/v1/object/sign/ai-lab/')), 'frames sent as signed storage links');
check(ai.body.system[0].text.includes('hooked') || ai.body.system[0].text.length > 5000, 'cards are in the instructions');
check(/English/.test(JSON.stringify(ai.body.messages[0].content.at(-1))), 'chosen language (English) is in the request');
const fin = f.calls.find((c) => c.url.endsWith('/rpc/ai_lab_finish')).body;
check(fin.p_error === null && fin.p_analysis.steps.length === 1 && fin.p_cost_cents === 0.7 && fin.p_result.cards_hash.length === 12, 'result, cleaned analysis and cost saved (Sonnet: 1000 in + 500 out = $0.007)');

f = fake({ claude: () => new Response('overloaded', { status: 529 }) });
out = await lines(await post(f));
const fin2 = f.calls.find((c) => c.url.endsWith('/rpc/ai_lab_finish')).body;
check(out.at(-1).type === 'error' && /529/.test(out.at(-1).message) && /529/.test(fin2.p_error) && fin2.p_analysis === null, 'Claude failure → run saved as an error, client told');

f = fake({ claude: () => Response.json({ model: 'm', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'not json' }] }) });
out = await lines(await post(f));
check(out.at(-1).type === 'error', 'unreadable Claude output → error, not a broken saved run');
