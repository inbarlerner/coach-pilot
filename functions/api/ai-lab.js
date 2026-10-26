// POST /api/ai-lab { run_id } — runs one AI coach lab analysis. Admins only.
//
// The Claude API key (ANTHROPIC_API_KEY) is a Cloudflare secret: it never reaches the browser.
// Every database step runs AS THE SIGNED-IN ADMIN (their own token), so the database decides:
//   ai_lab_start   → is admin? run not already done/running? monthly spend under the limit?
//   storage sign   → short-lived links to the run's frames (admin-only bucket)
//   ai_lab_finish  → saves the output, model, tokens and cost
// The response is a stream of JSON lines: progress every few seconds, then done or error.
import { json, publicKey } from '../_lib/common.js';
import {
  PROMPT_VERSION, buildSystem, buildUserContent, buildRequest, callClaude, costUsd, cleanAnalysis,
} from '../_lib/ai-coach.js';

const ERR_STATUS = { NOT_ADMIN: 403, NOT_AUTHENTICATED: 401, ACCOUNT_DISABLED: 403, NOT_FOUND: 404, AI_MONTHLY_LIMIT: 429 };

async function sha12(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env, waitUntil, fetchImpl = fetch }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI_NOT_CONFIGURED' }, 503);
  if (!env.SUPABASE_URL || !publicKey(env)) return json({ error: 'SERVER_NOT_CONFIGURED' }, 503);
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  let runId = null;
  try { runId = (await request.json()).run_id; } catch {}
  if (!/^[0-9a-f-]{36}$/.test(runId || '')) return json({ error: 'BAD_REQUEST' }, 400);

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const sb = async (path, body) => {
    const r = await fetchImpl(base + path, {
      method: 'POST', body: JSON.stringify(body),
      headers: { apikey: publicKey(env), authorization: auth, 'content-type': 'application/json' },
    });
    const t = await r.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    if (!r.ok) throw new Error(d?.message || d?.error || `HTTP_${r.status}`);
    return d;
  };
  const asset = async (path, as = 'text') => {
    const r = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
    if (!r.ok) throw new Error('ASSET_MISSING ' + path);
    return as === 'json' ? r.json() : r.text();
  };

  let run;
  try { run = await sb('/rest/v1/rpc/ai_lab_start', { p_run: runId }); }
  catch (e) {
    const code = Object.keys(ERR_STATUS).find((k) => e.message.includes(k));
    return json({ error: code || e.message }, code ? ERR_STATUS[code] : 409);
  }

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const line = (o) => w.write(enc.encode(JSON.stringify(o) + '\n')).catch(() => {});

  const work = (async () => {
    const t0 = Date.now();
    // Keep the connection alive while Claude works (the request itself is not streamed: lighter on CPU).
    const beat = setInterval(() => line({ type: 'progress', phase: 'thinking', seconds: Math.round((Date.now() - t0) / 1000) }), 5000);
    let cost = 0, result = null;
    try {
      const idx = await asset('/ai-coach/index.json', 'json');
      const sport = idx.sports.find((s) => s.id === run.sport);
      if (!sport) throw new Error('UNKNOWN_SPORT');
      const [decisions, ...texts] = await Promise.all([
        asset('/ai-coach/' + idx.decisions),
        ...sport.cards.map((c) => asset(`/ai-coach/cards/${sport.id}/${c.file}`)),
      ]);
      const cards = sport.cards.map((c, i) => ({ ...c, text: texts[i] }));
      const trick = cards.find((c) => c.file === run.trick);
      const system = buildSystem({ sportName: sport.name.he, decisions, cards });

      const signed = await sb('/storage/v1/object/sign/ai-lab', { expiresIn: 900, paths: run.frames.map((f) => f.file) });
      const urlOf = Object.fromEntries((signed || []).map((x) => {
        const u = x.signedURL || x.signedUrl;
        return [x.path, u ? (u.startsWith('http') ? u : base + '/storage/v1' + u) : null];
      }));
      const frames = run.frames.map((f) => ({ n: f.n, t: f.t, kind: f.kind, url: urlOf[f.file] }));
      if (frames.some((f) => !f.url)) throw new Error('FRAMES_MISSING');

      const content = buildUserContent({
        frames, sportName: sport.name.he, trickName: trick?.title, question: run.question,
        duration: run.video?.duration, lang: run.lang,
      });
      const { body, beta } = buildRequest({ modelKey: run.model, effort: run.effort, system, content, stream: false });
      const out = await callClaude({ apiKey: env.ANTHROPIC_API_KEY, body, beta, fetchImpl });
      cost = costUsd(out.usage, run.model);
      result = {
        model: out.model, seconds: out.seconds, usage: out.usage, stop_reason: out.stop_reason,
        prompt_version: PROMPT_VERSION, cards_hash: await sha12(system), cost_usd_est: cost,
      };
      const analysis = cleanAnalysis(JSON.parse(out.text), frames.length);
      await sb('/rest/v1/rpc/ai_lab_finish', { p_run: runId, p_result: result, p_analysis: analysis, p_cost_cents: Math.round(cost * 10000) / 100, p_error: null });
      await line({ type: 'done', id: runId, cost, seconds: out.seconds });
    } catch (e) {
      try { await sb('/rest/v1/rpc/ai_lab_finish', { p_run: runId, p_result: result, p_analysis: null, p_cost_cents: Math.round(cost * 10000) / 100, p_error: e.message }); } catch {}
      await line({ type: 'error', message: e.message });
    } finally {
      clearInterval(beat);
      await w.close().catch(() => {});
    }
  })();
  if (waitUntil) waitUntil(work);
  return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
