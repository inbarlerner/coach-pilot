// AI coach core (functions/_lib/ai-coach.js): request shape, streamed parsing, cost, output cleanup. No network.
import {
  MODELS, SCHEMA, buildSystem, buildUserContent, buildRequest, callClaude, costUsd, cleanAnalysis, renderText, frameLabel,
} from '../functions/_lib/ai-coach.js';

const check = (c, l) => { if (!c) { console.error('FAIL', l); process.exit(1); } console.log('PASS:', l); };

const system = buildSystem({ sportName: 'קייט', decisions: 'הראש מוביל', cards: [{ text: 'CARD-A' }, { text: 'CARD-B' }] });
check(system.includes('הראש מוביל') && system.indexOf('CARD-A') < system.indexOf('CARD-B'), 'system prompt carries decisions and cards in order');

const content = buildUserContent({ frames: [{ n: 3, t: 1.5, kind: 'zoom', data: 'AAA' }], sportName: 'קייט', trickName: null, question: 'שאלה' });
check(content[1].text.startsWith('F03 · 1.50s · זום') && content[2].type === 'image' && content[2].source.data === 'AAA', 'each frame is a label then an image');
check(content.at(-1).text.includes('לא נאמר'), 'missing trick asks the model to identify it');
check(frameLabel(7) === 'F07', 'frame labels are zero-padded');

let req = buildRequest({ modelKey: 'opus', effort: 'medium', system, content });
check(req.body.model === 'claude-opus-5-5' && req.body.stream && req.body.thinking.type === 'adaptive', 'opus request: streamed, adaptive thinking');
check(req.body.output_config.format.schema === SCHEMA && req.body.output_config.effort === 'medium', 'structured output and explicit effort');
check(req.body.system[0].cache_control?.type === 'ephemeral', 'instructions and cards are cached');
check(req.body.fallbacks === 'default' && req.beta.includes('server-side-fallback-2026-07-01'), 'refusal fallback on for opus');
req = buildRequest({ modelKey: 'haiku', effort: 'low', system, content });
check(!('fallbacks' in req.body) && !req.beta.length, 'no fallback parameter for haiku');

// Streamed response, mocked.
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const mockFetch = (events, captured) => async (url, opts) => {
  captured.push({ url, opts });
  const enc = new TextEncoder().encode(sse(events));
  return { ok: true, body: (async function* () { yield enc.slice(0, 40); yield enc.slice(40); })() };
};
const captured = [];
const progress = [];
const out = await callClaude({
  apiKey: 'k', body: req.body, beta: ['b1'], onProgress: (p) => progress.push(p.phase),
  fetchImpl: mockFetch([
    { type: 'message_start', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 100, cache_read_input_tokens: 1000 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"a":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '1}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } },
  ], captured),
});
check(JSON.parse(out.text).a === 1 && out.usage.output_tokens === 50 && out.usage.input_tokens === 100, 'stream is reassembled across chunk boundaries');
check(captured[0].opts.headers['x-api-key'] === 'k' && captured[0].opts.headers['anthropic-beta'] === 'b1', 'key and beta headers sent');
check(progress.includes('thinking') && progress.includes('writing'), 'progress reported while thinking and writing');

let threw = '';
try {
  await callClaude({ apiKey: 'k', body: req.body, fetchImpl: mockFetch([{ type: 'message_start', message: { model: 'm', usage: {} } }, { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { category: 'x' } }, usage: {} }], []) });
} catch (e) { threw = e.message; }
check(threw.startsWith('refusal'), 'refusal is an error, not an empty analysis');

check(costUsd({ input_tokens: 1e6, output_tokens: 1e6 }, 'opus') === 24 && costUsd({ cache_read_input_tokens: 1e6 }, 'opus') === MODELS.opus.cacheRead, 'cost counts input, output and cache reads');

const clean = cleanAnalysis({
  fixes: [{ issue: 'x' }],
  steps: [
    { kind: 'pause', from_frame: 9, to_frame: 9, rate: 1, title: 'late', text: '', fix_index: 0, draw: [{ shape: 'circle', points: [{ x: 120, y: -5 }, { x: 50, y: 50 }], label: 'a' }, { shape: 'angle', points: [{ x: 1, y: 1 }], label: '' }] },
    { kind: 'slowmo', from_frame: 2, to_frame: 6, rate: 0.3, title: 'early', text: '', fix_index: 4, draw: [{ shape: 'label', points: [{ x: 1, y: 1 }], label: 'no' }] },
    { kind: 'pause', from_frame: 99, to_frame: 99, rate: 1, title: 'bad frame', text: '', fix_index: -1, draw: [] },
  ],
}, 10);
check(clean.steps.length === 2 && clean.steps[0].title === 'early' && clean.steps[1].title === 'late', 'bad frame numbers dropped, steps in time order');
check(clean.steps[0].rate === 0.25 && clean.steps[0].draw.length === 0 && clean.steps[0].fix_index === -1, 'slow motion: rate snapped, no drawings, bad fix index cleared');
check(clean.steps[1].draw.length === 1 && clean.steps[1].draw[0].points[0].x === 100 && clean.steps[1].draw[0].points[0].y === 0, 'points kept inside the grid, shapes with too few points dropped');

const txt = renderText({ trick_identified: 'קפיצה', trick_confidence: 'high', summary: 's', strengths: ['a'], fixes: [{ issue: 'i', what_we_see: 'w', why: 'y', drill: 'd', frames: 'F01' }], safety_note: 'n', cannot_judge: [], filming_tip: 't' });
check(txt.includes('**i**') && txt.includes('לא תחליף למאמן'), 'written analysis renders with the AI disclaimer');
