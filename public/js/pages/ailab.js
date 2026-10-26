// Admin AI coach lab: send a video to the AI coach, play its feedback on the video, review it,
// and leave feedback for Claude Code. Admins only (enforced in the database and the server function).
import { h, clear, section, empty, toast, busy, friendlyError, confirmDialog, errorState, fmtDate, filePicker } from '../ui.js';
import { sb, state, q, rpc, isAdmin } from '../api.js';
import { go } from '../app.js';
import { Stage, planFrames, extractFrames, scriptPlayer, fmtT, FULL } from '../ai-player.js';
import { renderText, frameLabel } from '../ai-text.js';

const BUCKET = 'ai-lab';
const MODELS = [['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5'], ['haiku', 'Haiku 5.5']];
const EFFORTS = ['low', 'medium', 'high'];
const LANGS = [['he', 'עברית'], ['en', 'English']];
const KINDS = { bug: 'Bug', idea: 'Idea', coaching: 'Coaching / knowledge', product: 'Product', other: 'Other' };
const FSTATUS = { new: 'New', planned: 'Planned', done: 'Done', dropped: 'Dropped' };
const VERDICT = { right: '✓ Right', fix: '✎ Needs a fix', wrong: '✗ Wrong' };
const localVideos = new Map();   // run id → local video URL (this tab only; videos are not uploaded)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let cardIndex = null;
const loadIndex = async () => (cardIndex ||= await (await fetch('/ai-coach/index.json')).json());
let adminNames = null;
const loadNames = async () => (adminNames ||= Object.fromEntries((await q(sb.from('profiles').select('id,first_name').eq('role', 'admin'))).map((p) => [p.id, p.first_name])));

const sel = (opts, value) => h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
function chips(opts, value, onChange) {
  const box = h('div', { class: 'chips' });
  const draw = () => box.replaceChildren(...opts.map(([v, l]) => h('button', { type: 'button', class: 'chip' + (v === value ? ' on' : ''), onclick: () => { value = v; draw(); onChange(v); } }, l)));
  draw(); return box;
}
const cents = (c) => '$' + (Number(c || 0) / 100).toFixed(2);
const guard = (main) => { if (isAdmin()) return true; main.append(errorState('You need admin access for this page.')); return false; };

async function ndjson(url, body, onLine) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + data.session?.access_token }, body: JSON.stringify(body) });
  if (!res.ok) { let e = {}; try { e = await res.json(); } catch {} return { type: 'error', message: e.error || 'HTTP_' + res.status }; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) { last = JSON.parse(l); onLine(last); } }
  }
  return last || { type: 'error', message: 'NO_RESPONSE' };
}
const ERRORS = {
  NOT_ADMIN: 'Only admins can run an analysis.', AI_MONTHLY_LIMIT: 'The lab reached its monthly AI spend limit.',
  AI_NOT_CONFIGURED: 'The Claude API key is not set up in Cloudflare yet.', FRAMES_MISSING: 'The frames for this analysis were already removed from storage.',
  NO_FRAMES: 'The frames for this analysis were already removed from storage.',
  ALREADY_RUNNING: 'This analysis is already running. Refresh in a minute.', ALREADY_DONE: 'This analysis already finished.',
};
const errText = (m) => ERRORS[Object.keys(ERRORS).find((k) => String(m).includes(k))] || 'Error: ' + m;
const runAnalysis = (id, onProgress) => ndjson('/api/ai-lab', { run_id: id }, (p) => { if (p.type === 'progress') onProgress(`Claude is working… ${p.seconds || 0}s`); });

// ====================================================================== list
export async function aiLabPage({ main, setTitle }) {
  setTitle('AI lab');
  if (!guard(main)) return;
  main.classList.add('xwide', 'ai-lab');
  const usage = h('p', { class: 'meta' });
  rpc('ai_lab_storage').then((r) => {
    const u = Array.isArray(r) ? r[0] : r; if (!u) return;
    usage.textContent = `Frames in storage: ${Math.round(u.used_bytes / 1048576)}MB of ${Math.round(u.cap_bytes / 1048576)}MB · AI spend this month: ${cents(u.month_cents)} of ${cents(u.month_cap_cents)} (on Jenni's API key)`;
  }).catch(() => {});
  const list = h('div');
  const rerunModel = sel(MODELS, 'opus'), rerunEffort = sel(EFFORTS.map((e) => [e, e]), 'medium');
  const rerunMsg = h('p', { class: 'meta' });
  const rerunAll = h('button', { class: 'btn secondary small' }, 'Rerun all originals');
  const exportBtn = h('button', { class: 'btn secondary small', onclick: () => exportReviews() }, 'Copy reviews for Claude');
  main.append(
    h('div', { class: 'row between' }, h('h1', null, 'AI coach lab'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn small', href: '#/admin/lab/new' }, '+ New analysis'), h('a', { class: 'btn secondary small', href: '#/admin/feedback' }, 'Feedback for Claude'))),
    usage,
    h('div', { class: 'card' }, h('strong', null, 'After changing the cards or the prompt'),
      h('p', { class: 'meta' }, 'Sends the same frames again with the current cards, and saves a new analysis next to each original.'),
      h('div', { class: 'row' }, 'Model:', rerunModel, 'Effort:', rerunEffort, rerunAll, exportBtn), rerunMsg),
    list);

  let runs = [];
  const load = () => section(list, async () => {
    const [rows, names] = await Promise.all([
      q(sb.from('ai_lab_runs').select('id,created_at,created_by,parent_id,status,trick_title,lang,model,effort,video,cost_cents,error,frames_deleted_at,identified:analysis->>trick_identified,reviews:ai_lab_reviews(reviewer,score)').order('created_at', { ascending: false }).limit(200)),
      loadNames()]);
    runs = rows;
    return { rows, names };
  }, ({ rows, names }) => rows.length ? h('div', null, rows.map((r) => h('a', { class: 'card link', href: '#/admin/lab/' + r.id },
    h('div', { class: 'row between' },
      h('strong', null, (r.video?.name || 'Video') + ' · ' + (r.trick_title || 'Trick not given')),
      h('span', { class: 'meta' }, fmtDate(r.created_at) + ' · ' + (names[r.created_by] || ''))),
    h('p', { class: 'meta' }, [
      r.identified ? 'Identified: ' + r.identified : null, `${r.model} · ${r.effort} · ${r.lang === 'en' ? 'English' : 'Hebrew'}`, cents(r.cost_cents),
      r.parent_id ? 'Rerun' : null, r.frames_deleted_at ? 'Frames removed' : null].filter(Boolean).join(' · ')),
    h('div', { class: 'row' },
      r.status !== 'done' && h('span', { class: 'tag' + (r.status === 'error' ? ' fill' : '') }, ({ new: 'Not started', running: 'Running…', error: 'Failed' })[r.status]),
      (r.reviews || []).map((v) => h('span', { class: 'tag soft' }, `${names[v.reviewer] || '?'}: ${v.score ?? '?'}/5`)),
      !(r.reviews || []).length && r.status === 'done' && h('span', { class: 'meta' }, 'Not reviewed yet'))))) : empty('No analyses yet', 'Press "+ New analysis" to start.'));
  load();

  rerunAll.onclick = async () => {
    const originals = runs.filter((r) => !r.parent_id && r.status === 'done' && !r.frames_deleted_at);
    if (!originals.length) return toast('No original analyses to rerun', 'err');
    const est = originals.reduce((s, r) => s + Number(r.cost_cents || 0), 0);
    if (!(await confirmDialog(`Rerun ${originals.length} analyses?`, `Estimated cost: ${cents(est)}, charged to the API key.`, 'Rerun'))) return;
    busy(rerunAll, async () => {
      for (const [i, r] of originals.entries()) {
        rerunMsg.textContent = `${i + 1}/${originals.length} · ${r.video?.name || ''}`;
        try {
          const id = await createRerun(r.id, { model: rerunModel.value, effort: rerunEffort.value });
          const last = await runAnalysis(id, (t) => { rerunMsg.textContent = `${i + 1}/${originals.length} · ${t}`; });
          if (last.type === 'error') toast(errText(last.message), 'err');
          if (/AI_MONTHLY_LIMIT/.test(last.message || '')) break;
        } catch (e) { toast(friendlyError(e), 'err'); }
      }
      rerunMsg.textContent = 'Done';
      load();
    });
  };
}

async function createRerun(parentId, { model, effort, lang } = {}) {
  const p = await q(sb.from('ai_lab_runs').select('*').eq('id', parentId).single());
  const id = crypto.randomUUID();
  await q(sb.from('ai_lab_runs').insert({
    id, parent_id: p.id, sport: p.sport, trick: p.trick, trick_title: p.trick_title, question: p.question,
    lang: lang || p.lang, model: model || p.model, effort: effort || p.effort, video: p.video, takeoff: p.takeoff, crop: p.crop, frames: p.frames,
  }));
  return id;
}

// Markdown of every reviewed run, for pasting into Claude Code (→ card edits, coaching decisions, fixes).
async function exportReviews() {
  try {
    const [rows, names] = await Promise.all([
      q(sb.from('ai_lab_runs').select('id,created_at,video,trick_title,model,effort,lang,analysis,reviews:ai_lab_reviews(*)').eq('status', 'done').order('created_at', { ascending: false }).limit(100)),
      loadNames()]);
    const L = ['# AI coach lab reviews (GetPro)', '', 'Reviews by our coaches of AI analyses. Turn them into card edits, coaching decisions or prompt fixes; list what changed per run.', ''];
    for (const r of rows.filter((x) => (x.reviews || []).length)) {
      const a = r.analysis || {};
      L.push(`## ${fmtDate(r.created_at)} · ${r.video?.name || ''} · trick: ${r.trick_title || 'not given'} · AI said: ${a.trick_identified || '?'} · ${r.model}/${r.effort}/${r.lang}`, `Link: ${location.origin}/#/admin/lab/${r.id}`);
      for (const v of r.reviews) {
        const rv = v.review || {};
        L.push(`### ${names[v.reviewer] || 'reviewer'}: ${v.score ?? '?'}/5 · send as is: ${rv.overall?.send || '?'}`);
        if (rv.overall?.notes) L.push(`Notes: ${rv.overall.notes}`);
        (a.steps || []).forEach((s, i) => { const x = rv.steps?.[i]; if (x && (x.verdict || x.comment || x.draw)) L.push(`- Step ${i + 1} "${s.title}" (${frameLabel(s.from_frame)}): ${x.verdict ? VERDICT[x.verdict] : ''} ${x.comment || ''}${x.draw ? ' [drawing corrected]' : ''}`); });
        (a.fixes || []).forEach((f, i) => { const x = rv.fixes?.[i]; if (x && (x.verdict || x.comment)) L.push(`- Fix ${i + 1} "${f.issue}": ${x.verdict ? VERDICT[x.verdict] : ''} ${x.comment || ''}`); });
        (rv.missed || []).forEach((m) => L.push(`- Missed at ${fmtT(m.t)}: ${m.text || '(no text)'}`));
      }
      L.push('');
    }
    await copyText(L.join('\n'), 'Reviews copied. Paste them into Claude Code.');
  } catch (e) { toast(friendlyError(e), 'err'); }
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { // clipboard blocked: show it to copy by hand
    const { modal } = await import('../ui.js');
    modal((close) => [h('h2', null, 'Copy this text'), h('textarea', { rows: 14, style: { width: '100%' }, dir: 'ltr' }, text), h('button', { class: 'btn', onclick: () => close() }, 'Close')]);
  }
}

// ====================================================================== new analysis
export async function aiLabNewPage({ main, setTitle }) {
  setTitle('New AI analysis');
  if (!guard(main)) return;
  main.classList.add('xwide', 'ai-lab');
  const idx = await loadIndex();
  let src = null, file = null, videoRow = null, stage = null, takeoff = null, crop = null, dragging = null;
  const stageBox = h('div', { class: 'ai-stage-box' }, h('p', { class: 'meta' }, 'Choose a video to start.'));
  const info = h('p', { class: 'meta' });
  const msg = h('p', { class: 'meta', role: 'status' });

  let sport = idx.sports[0];
  const trickSel = h('select');
  const fillTricks = () => trickSel.replaceChildren(h('option', { value: '' }, 'Not sure (the AI will identify it)'), ...sport.cards.filter((c) => c.file !== 'fundamentals.md').map((c) => h('option', { value: c.file }, c.title)));
  fillTricks();
  const sportSel = sel(idx.sports.map((s) => [s.id, s.name.en]), sport.id);
  sportSel.onchange = () => { sport = idx.sports.find((s) => s.id === sportSel.value); fillTricks(); };
  const question = h('textarea', { rows: 2, dir: 'auto' }, 'What can I improve?');
  let lang = 'en';
  const langChips = chips(LANGS, lang, (v) => { lang = v; });
  const modelSel = sel(MODELS, 'opus'), effortSel = sel(EFFORTS.map((e) => [e, e]), 'medium');

  const refresh = () => {
    const d = stage?.video.duration || 0;
    const plan = d ? planFrames(d, takeoff, crop) : [];
    info.textContent = `Takeoff: ${takeoff != null ? fmtT(takeoff) : 'not marked'} · Zoom: ${crop ? 'marked' : 'none'} · ${plan.length} frames`;
    stage?.redraw();
  };
  const pickBtn = h('button', { class: 'btn secondary small', type: 'button' }, 'Mark action area (zoom)');
  const tools = h('div', { class: 'btn-row', hidden: true },
    h('button', { class: 'btn secondary small', type: 'button', onclick: () => { stage.video.pause(); takeoff = +stage.video.currentTime.toFixed(3); refresh(); } }, 'Mark takeoff here'),
    pickBtn,
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => { takeoff = null; crop = null; refresh(); } }, 'Clear marks'));

  async function useSource(url) {
    stage?.destroy();
    takeoff = null; crop = null; src = url;
    stage = new Stage({ videoSrc: url });
    clear(stageBox).append(stage.el);
    const ok = await stage.ready;
    if (!ok) { clear(stageBox).append(errorState('This video cannot be opened.')); tools.hidden = true; return; }
    stage.video.controls = true;
    tools.hidden = false;
    stage.extraDraw = (ctx, W, H) => {
      if (!crop) return;
      ctx.setLineDash([6, 4]); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeRect(crop.x * W, crop.y * H, crop.w * W, crop.h * H);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.strokeRect(crop.x * W, crop.y * H, crop.w * W, crop.h * H); ctx.setLineDash([]);
    };
    const norm = (e) => { const r = stage.canvas.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
    stage.canvas.addEventListener('pointerdown', (e) => { if (!stage.el.classList.contains('picking')) return; dragging = norm(e); stage.canvas.setPointerCapture(e.pointerId); });
    stage.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return; const p = norm(e);
      crop = { x: Math.min(p.x, dragging.x), y: Math.min(p.y, dragging.y), w: Math.abs(p.x - dragging.x), h: Math.abs(p.y - dragging.y) };
      refresh();
    });
    stage.canvas.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = null; stage.el.classList.remove('picking'); stage.video.controls = true; pickBtn.classList.remove('on');
      if (!crop || crop.w < 0.06 || crop.h < 0.06) crop = null;
      else { const pad = 0.04, b = crop, x = clamp(b.x - pad, 0, 1), y = clamp(b.y - pad, 0, 1); crop = { x, y, w: clamp(b.x + b.w + pad, 0, 1) - x, h: clamp(b.y + b.h + pad, 0, 1) - y }; }
      refresh();
    });
    refresh();
  }
  pickBtn.onclick = () => { stage.video.pause(); stage.video.controls = false; stage.el.classList.add('picking'); pickBtn.classList.add('on'); };

  const picker = filePicker({ id: 'ai_vid', accept: 'video/*', label: 'Video from this computer', onChange: (f) => { if (!f) return; file = f; videoRow = null; useSource(URL.createObjectURL(f)); } });
  const appList = h('div');
  const appBtn = h('button', { class: 'btn secondary', type: 'button', onclick: () => section(appList,
    () => q(sb.from('videos').select('id,title,storage_key,file_deleted_at,created_at,owner:profiles(first_name,last_name)').order('created_at', { ascending: false }).limit(30)),
    (rows) => h('div', { class: 'ai-pick-list' }, rows.filter((v) => !v.file_deleted_at).map((v) => h('button', { class: 'chip', type: 'button', onclick: async () => {
      const { data, error } = await sb.storage.from('media').createSignedUrl(v.storage_key, 3600);
      if (error) return toast(friendlyError(error), 'err');
      file = null; videoRow = v; useSource(data.signedUrl);
    } }, `${v.title} · ${v.owner?.first_name || ''} · ${fmtDate(v.created_at)}`)))) }, 'Video from the app');

  const go_ = h('button', { class: 'btn' }, 'Analyze');
  go_.onclick = () => busy(go_, async () => {
    if (!stage || stage.mode !== 'video') return toast('Choose a video first', 'err');
    try {
      const plan = planFrames(stage.video.duration, takeoff, crop);
      const { frames, video } = await extractFrames(src, plan, (i, n) => { msg.textContent = `Preparing frames ${i}/${n}`; });
      const total = frames.reduce((s, f) => s + f.blob.size, 0);
      msg.textContent = 'Making room in storage…';
      const old = await rpc('ai_lab_make_room', { p_bytes: total });
      if (old?.length) await sb.storage.from(BUCKET).remove(old);
      const id = crypto.randomUUID();
      const meta = frames.map((f) => ({ n: f.n, t: f.t, kind: f.kind, crop: f.crop, margin: f.margin, size: f.size, file: `${id}/${frameLabel(f.n)}.jpg` }));
      const trick = sport.cards.find((c) => c.file === trickSel.value);
      await q(sb.from('ai_lab_runs').insert({
        id, sport: sport.id, trick: trick?.file || null, trick_title: trick?.title || null, question: question.value.trim().slice(0, 1000),
        lang, model: modelSel.value, effort: effortSel.value, takeoff, crop, frames: meta,
        video: { name: file?.name || videoRow?.title || 'video', size: file?.size || null, ...video, video_id: videoRow?.id || null },
      }));
      for (const [i, f] of frames.entries()) {
        msg.textContent = `Uploading frames ${i + 1}/${frames.length}`;
        const { error } = await sb.storage.from(BUCKET).upload(meta[i].file, f.blob, { contentType: 'image/jpeg' });
        if (error) throw error;
      }
      if (file) localVideos.set(id, src);
      msg.textContent = 'Sending to Claude…';
      const last = await runAnalysis(id, (t) => { msg.textContent = t; });
      if (last.type !== 'done') toast(errText(last.message), 'err');
      go('/admin/lab/' + id);
    } catch (e) { msg.textContent = ''; toast(friendlyError(e), 'err'); }
  });

  main.append(h('h1', null, 'New AI analysis'),
    h('div', { class: 'ai-grid' },
      h('div', null, h('div', { class: 'btn-row' }, picker, appBtn), appList, stageBox, tools, info),
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Sport'), sportSel),
        h('div', { class: 'field' }, h('label', null, 'Trick'), trickSel),
        h('div', { class: 'field' }, h('label', null, 'Trainee\'s question'), question),
        h('div', { class: 'field' }, h('label', null, 'Feedback language'), langChips),
        h('div', { class: 'row' }, h('label', null, 'Model ', modelSel), h('label', null, 'Effort ', effortSel)),
        h('p', { class: 'meta' }, 'Pause the video at takeoff, press "Mark takeoff here", then drag a box around the rider and the kite. The video itself is not uploaded: only the frames the AI sees are kept. Opus: about a minute and about $0.35 per analysis.'),
        go_, msg)));
  return () => stage?.destroy();
}

// ====================================================================== one run: play + review
export async function aiLabRunPage({ main, setTitle, params }) {
  setTitle('AI analysis');
  if (!guard(main)) return;
  main.classList.add('xwide', 'ai-lab');
  const id = params[0];
  const [run, reviews, names] = await Promise.all([
    q(sb.from('ai_lab_runs').select('*').eq('id', id).maybeSingle()),
    q(sb.from('ai_lab_reviews').select('*').eq('run_id', id)),
    loadNames()]);
  if (!run) return main.append(errorState('Analysis not found.'));
  const me = state.user.id;
  const head = h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h1', null, `${run.video?.name || 'Video'} · ${run.trick_title || 'Trick not given'}`), h('a', { class: 'btn ghost small', href: '#/admin/lab' }, 'All analyses')),
    h('p', { class: 'meta' }, `${fmtDate(run.created_at)} · ${names[run.created_by] || ''} · ${run.model} · effort ${run.effort} · ${run.lang === 'en' ? 'English' : 'Hebrew'} · ${cents(run.cost_cents)}`
      + (run.result ? ` · ${Math.round(run.result.seconds || 0)}s · in ${run.result.usage?.input_tokens ?? 0} (+cache ${run.result.usage?.cache_read_input_tokens ?? 0}/${run.result.usage?.cache_creation_input_tokens ?? 0}) · out ${run.result.usage?.output_tokens ?? 0} · cards ${run.result.cards_hash}` : '')),
    run.parent_id && h('p', null, 'Rerun of ', h('a', { href: '#/admin/lab/' + run.parent_id }, 'the original analysis')));
  main.append(head);

  if (run.status !== 'done') {
    const msg = h('p', { class: 'meta', role: 'status' });
    const start = h('button', { class: 'btn' }, run.status === 'error' ? 'Try again' : 'Start the analysis');
    start.onclick = () => busy(start, async () => {
      const last = await runAnalysis(id, (t) => { msg.textContent = t; });
      if (last.type === 'done') go('/admin/lab/' + id); else msg.textContent = errText(last.message);
    });
    head.append(
      run.status === 'running' ? h('p', null, 'The analysis is running now. Refresh in a minute.') : null,
      run.error ? h('p', { class: 'pre' }, errText(run.error)) : null,
      run.status !== 'running' ? start : h('button', { class: 'btn secondary', onclick: () => go('/admin/lab/' + id) }, 'Refresh'), msg,
      deleteButton(run));
    return;
  }

  const a = run.analysis;
  const mine = reviews.find((r) => r.reviewer === me);
  const review = mine?.review && Object.keys(mine.review).length ? mine.review : { overall: { score: null, send: null, notes: '' }, steps: [], fixes: [], missed: [] };
  review.overall ||= { score: null, send: null, notes: '' };
  review.steps = a.steps.map((_, i) => review.steps?.[i] || { verdict: null, comment: '', draw: null });
  review.fixes = a.fixes.map((_, i) => review.fixes?.[i] || { verdict: null, comment: '' });
  review.missed ||= [];
  const saveMsg = h('span', { class: 'meta' });
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await q(sb.from('ai_lab_reviews').upsert({ run_id: id, reviewer: me, review, score: review.overall.score })); saveMsg.textContent = 'Saved ' + new Date().toLocaleTimeString(); }
      catch (e) { saveMsg.textContent = 'Save failed: ' + friendlyError(e); }
    }, 700);
  };

  // video: this tab's local file → the app video → saved frames
  const signed = run.frames_deleted_at ? {} : Object.fromEntries(((await sb.storage.from(BUCKET).createSignedUrls(run.frames.map((f) => f.file), 3600)).data || []).map((d) => [d.path, d.signedUrl]));
  let videoSrc = localVideos.get(id) || null;
  if (!videoSrc && run.video?.video_id) {
    const v = await q(sb.from('videos').select('storage_key,file_deleted_at').eq('id', run.video.video_id).maybeSingle()).catch(() => null);
    if (v && !v.file_deleted_at) videoSrc = (await sb.storage.from('media').createSignedUrl(v.storage_key, 3600)).data?.signedUrl || null;
  }
  const stage = new Stage({ frames: run.frames, videoSrc, frameSrc: (f) => signed[f.file] });
  await stage.ready;
  const frameOf = (n) => run.frames[n - 1];
  const stepShapes = (i) => review.steps[i].draw || a.steps[i].draw;
  const overlayFor = (i, editable = false) => {
    const s = a.steps[i], f = frameOf(s.from_frame);
    return { t: f.t, frameN: s.from_frame, crop: f.crop || FULL, shapes: stepShapes(i), editable, title: s.title, text: s.text,
      badge: `${frameLabel(s.from_frame)} · ${fmtT(f.t)}${s.kind === 'slowmo' ? ` → ${fmtT(frameOf(s.to_frame).t)} · ×${s.rate}` : ''}` };
  };

  // --- editing drawings ---
  let edit = null, tool = null, dragIdx = null, newShape = null;
  const nearest = (pt) => {
    let best = null;
    edit.shapes.forEach((d, si) => d.points.forEach((p, pi) => {
      const p1 = stage.toPx(p, edit.crop), p2 = stage.toPx(pt, edit.crop), dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (dist < 16 && (!best || dist < best.dist)) best = { si, pi, dist };
    }));
    return best;
  };
  stage.canvas.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    const pt = stage.fromClient(e, edit.crop);
    stage.canvas.setPointerCapture(e.pointerId);
    if (tool === 'delete') { const n = nearest(pt); if (n) { edit.shapes.splice(n.si, 1); edit.onChange(); } return; }
    if (tool === 'label') { const label = prompt('Text:'); if (label) { edit.shapes.push({ shape: 'label', points: [pt], label }); edit.onChange(); } return; }
    if (tool) { newShape = { shape: tool, points: [pt, { ...pt }], label: '' }; edit.shapes.push(newShape); stage.redraw(); return; }
    dragIdx = nearest(pt);
  });
  stage.canvas.addEventListener('pointermove', (e) => {
    if (!edit) return;
    const pt = stage.fromClient(e, edit.crop);
    if (newShape) { newShape.points[1] = pt; stage.redraw(); } else if (dragIdx) { edit.shapes[dragIdx.si].points[dragIdx.pi] = pt; stage.redraw(); }
  });
  stage.canvas.addEventListener('pointerup', () => {
    if (!edit) return;
    if (newShape) { newShape.label = prompt('Label (optional):', '') || ''; newShape = null; edit.onChange(); }
    else if (dragIdx) { dragIdx = null; edit.onChange(); }
  });
  const round = (shapes) => shapes.forEach((d) => d.points.forEach((p) => { p.x = +p.x.toFixed(1); p.y = +p.y.toFixed(1); }));
  const toolBar = (onReset) => {
    const btns = [['arrow', 'Arrow'], ['line', 'Line'], ['circle', 'Circle'], ['label', 'Label'], ['delete', 'Delete shape']].map(([k, l]) => {
      const b = h('button', { type: 'button', class: 'chip', onclick: () => { tool = tool === k ? null : k; btns.forEach((x) => x.classList.toggle('on', x.dataset.k === tool)); } }, l);
      b.dataset.k = k; return b;
    });
    return h('div', { class: 'chips ai-tools' }, h('span', { class: 'meta' }, 'Drag points, or add:'), btns, onReset && h('button', { type: 'button', class: 'chip', onclick: onReset }, 'Back to the AI\'s drawing'));
  };
  const stopEdit = () => { edit = null; tool = null; stage.el.classList.remove('editing'); };

  const stepEls = [];
  const mark = (i) => stepEls.forEach((x, k) => x.classList.toggle('active', k === i));
  const holdBox = h('input', { type: 'checkbox' });
  const player = scriptPlayer({ stage, steps: a.steps, frames: run.frames, overlayFor, mark, holdUntilClick: () => holdBox.checked });
  const selectStep = async (i, editing = false) => {
    player.stop(); stopEdit(); mark(i);
    const o = overlayFor(i, editing);
    if (editing) {
      if (!review.steps[i].draw) review.steps[i].draw = JSON.parse(JSON.stringify(a.steps[i].draw));
      o.shapes = review.steps[i].draw;
      edit = { shapes: o.shapes, crop: o.crop, onChange: () => { round(o.shapes); stage.redraw(); save(); } };
      stage.el.classList.add('editing');
    }
    await stage.show(o);
  };
  const verdictBtns = (obj) => {
    const keys = Object.keys(VERDICT);
    const bs = keys.map((k) => h('button', { type: 'button', class: 'chip' + (obj.verdict === k ? ' on' : ''), onclick: () => { obj.verdict = obj.verdict === k ? null : k; bs.forEach((b, j) => b.classList.toggle('on', keys[j] === obj.verdict)); save(); } }, VERDICT[k]));
    return h('div', { class: 'chips' }, bs);
  };
  const comment = (obj, ph) => { const t = h('textarea', { rows: 2, placeholder: ph, dir: 'auto' }, obj.comment || ''); t.addEventListener('input', () => { obj.comment = t.value; save(); }); return t; };

  const stepList = h('ol', { class: 'ai-steps' }, a.steps.map((s, i) => {
    let box = null;
    const editBtn = h('button', { type: 'button', class: 'btn secondary small' }, 'Edit drawing');
    const el = h('li', { class: 'ai-step' },
      h('div', { class: 'ai-step-head', onclick: () => selectStep(i) },
        h('span', { class: 'tag soft' }, s.kind === 'pause' ? 'Pause' : `Slow motion ×${s.rate}`), h('strong', { dir: 'auto' }, s.title), h('span', { class: 'meta' }, frameLabel(s.from_frame))),
      h('p', { dir: 'auto' }, s.text),
      s.fix_index >= 0 && h('p', { class: 'meta' }, `Shows fix ${s.fix_index + 1}`),
      verdictBtns(review.steps[i]), s.kind === 'pause' && editBtn, comment(review.steps[i], 'Comment: what is wrong, what would you say'));
    editBtn.onclick = async () => {
      if (box) { box.remove(); box = null; editBtn.classList.remove('on'); stopEdit(); return selectStep(i); }
      await selectStep(i, true); editBtn.classList.add('on');
      box = toolBar(() => { review.steps[i].draw = null; save(); selectStep(i, true); });
      editBtn.after(box);
    };
    stepEls.push(el);
    return el;
  }));

  const missedList = h('ol', { class: 'ai-steps' });
  const renderMissed = () => missedList.replaceChildren(...review.missed.map((m, i) => {
    let box = null;
    const show = async (editing) => {
      player.stop(); stopEdit();
      const o = { t: m.t, frameN: m.frame_n, crop: m.crop || FULL, shapes: m.draw, editable: editing, title: 'Missed by the AI', text: m.text, badge: fmtT(m.t) };
      if (editing) { edit = { shapes: m.draw, crop: o.crop, onChange: () => { round(m.draw); stage.redraw(); save(); } }; stage.el.classList.add('editing'); }
      await stage.show(o);
    };
    const drawBtn = h('button', { type: 'button', class: 'btn secondary small' }, 'Draw');
    drawBtn.onclick = async () => {
      if (box) { box.remove(); box = null; stopEdit(); return show(false); }
      await show(true); box = toolBar(null); drawBtn.after(box);
    };
    const t = h('textarea', { rows: 2, placeholder: 'What should the AI have said here?', dir: 'auto' }, m.text || '');
    t.addEventListener('input', () => { m.text = t.value; save(); });
    return h('li', { class: 'ai-step' }, h('div', { class: 'ai-step-head', onclick: () => show(false) }, h('strong', null, `Point ${i + 1}`), h('span', { class: 'meta' }, fmtT(m.t))),
      t, h('div', { class: 'btn-row' }, drawBtn, h('button', { type: 'button', class: 'btn ghost small', onclick: () => { review.missed.splice(i, 1); save(); renderMissed(); } }, 'Delete')));
  }));
  renderMissed();
  const addMissed = h('button', { class: 'btn secondary small', onclick: () => {
    player.stop();
    let t, frame_n = null, crop = FULL;
    if (stage.mode === 'video') t = +stage.video.currentTime.toFixed(3);
    else { frame_n = stage.overlay?.frameN || 1; t = frameOf(frame_n).t; crop = frameOf(frame_n).crop || FULL; }
    review.missed.push({ t, frame_n, crop, text: '', draw: [] }); save(); renderMissed();
  } }, '+ Point the AI missed (at this moment)');

  const fixList = h('ol', { class: 'ai-steps' }, a.fixes.map((f, i) => h('li', { class: 'ai-step' },
    h('strong', { dir: 'auto' }, f.issue), h('p', { class: 'meta', dir: 'auto' }, f.what_we_see), h('p', { dir: 'auto' }, f.drill),
    verdictBtns(review.fixes[i]), comment(review.fixes[i], 'Comment'))));
  const scoreBox = chips([1, 2, 3, 4, 5].map((n) => [n, String(n)]), review.overall.score, (v) => { review.overall.score = v; save(); });
  const sendBox = chips([['yes', 'Yes, as is'], ['edits', 'With edits'], ['no', 'No']], review.overall.send, (v) => { review.overall.send = v; save(); });
  const notes = h('textarea', { rows: 3, placeholder: 'General notes on the analysis', dir: 'auto' }, review.overall.notes || '');
  notes.addEventListener('input', () => { review.overall.notes = notes.value; save(); });

  const pick = filePicker({ id: 'ai_local', accept: 'video/*', label: 'Open the original video from this computer', onChange: (f) => { if (f) { localVideos.set(id, URL.createObjectURL(f)); go('/admin/lab/' + id); } } });
  const rerunModel = sel(MODELS, run.model), rerunEffort = sel(EFFORTS.map((e) => [e, e]), run.effort), rerunLang = sel(LANGS, run.lang);
  const rerunMsg = h('span', { class: 'meta' });
  const rerunBtn = h('button', { class: 'btn secondary small' }, 'Rerun');
  rerunBtn.onclick = () => busy(rerunBtn, async () => {
    try {
      const nid = await createRerun(id, { model: rerunModel.value, effort: rerunEffort.value, lang: rerunLang.value });
      const last = await runAnalysis(nid, (t) => { rerunMsg.textContent = t; });
      if (last.type !== 'done') toast(errText(last.message), 'err');
      go('/admin/lab/' + nid);
    } catch (e) { toast(friendlyError(e), 'err'); }
  });

  const others = reviews.filter((r) => r.reviewer !== me);
  main.append(h('div', { class: 'ai-grid' },
    h('div', null,
      stage.el,
      h('div', { class: 'btn-row ai-controls' },
        h('button', { class: 'btn small', onclick: () => { stopEdit(); player.play(); } }, '▶ Play feedback'),
        h('button', { class: 'btn secondary small', onclick: () => { player.stop(); if (stage.mode === 'video') stage.video.controls = true; } }, '⏹ Stop'),
        h('button', { class: 'btn secondary small', onclick: () => player.next() }, 'Next ⏭'),
        h('label', { class: 'chip' }, holdBox, 'Hold until click'), addMissed),
      stage.mode === 'frames' && h('div', { class: 'card' }, h('p', { class: 'meta' }, 'The video is not stored, so these are the frames the AI saw. Have the file? Open it to see the feedback on the video itself.'), pick),
      h('details', { class: 'card' }, h('summary', null, 'Written analysis'), h('div', { class: 'pre', dir: 'auto' }, renderText(a, run.lang))),
      h('div', { class: 'card' }, h('strong', null, 'Rerun with the current cards'), h('div', { class: 'row' }, rerunModel, rerunEffort, rerunLang, rerunBtn), rerunMsg),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn secondary small', href: '#/admin/feedback?run=' + id }, 'Feedback for Claude on this analysis'), deleteButton(run))),
    h('div', null,
      h('div', { class: 'card' }, h('strong', null, 'Your score'), scoreBox, h('p', { class: 'meta' }, 'Send to the trainee?'), sendBox, notes, saveMsg),
      h('div', { class: 'card' }, h('strong', null, `Script (${a.steps.length} steps)`), stepList),
      h('div', { class: 'card' }, h('strong', null, 'Fixes'), fixList),
      h('div', { class: 'card' }, h('strong', null, 'What the AI missed'), missedList),
      others.length > 0 && h('div', { class: 'card' }, h('strong', null, 'Other reviews'),
        others.map((r) => h('p', { dir: 'auto' }, `${names[r.reviewer] || '?'}: ${r.score ?? '?'}/5 · ${r.review?.overall?.notes || ''}`))))));
  if (stage.mode === 'video') stage.video.controls = true;
  else if (a.steps.length) selectStep(0);
  return () => { player.stop(); stage.destroy(); };
}

function deleteButton(run) {
  const b = h('button', { class: 'btn ghost small' }, 'Delete analysis');
  b.onclick = async () => {
    if (!(await confirmDialog('Delete this analysis?', 'The analysis, its reviews and its frames will be deleted. This cannot be undone.', 'Delete'))) return;
    busy(b, async () => {
      try {
        const unused = await rpc('ai_lab_delete_run', { p_run: run.id });   // keeps frames a rerun still uses
        if (unused?.length) await sb.storage.from(BUCKET).remove(unused);
        toast('Deleted'); go('/admin/lab');
      } catch (e) { toast(friendlyError(e), 'err'); }
    });
  };
  return b;
}

// ====================================================================== feedback for Claude
export async function aiFeedbackPage({ main, setTitle, query }) {
  setTitle('Feedback for Claude');
  if (!guard(main)) return;
  main.classList.add('wide', 'ai-lab');
  const runId = query.get('run');
  let kind = runId ? 'coaching' : 'idea', filter = 'new';
  const body = h('textarea', { rows: 4, dir: 'auto', placeholder: 'What should be improved, fixed or built? Hebrew or English is fine.' });
  const add = h('button', { class: 'btn' }, 'Save');
  const list = h('div');
  const bar = h('div', { class: 'chips' });
  add.onclick = () => busy(add, async () => {
    if (!body.value.trim()) return toast('Write something first', 'err');
    try { await q(sb.from('ai_feedback').insert({ kind, body: body.value.trim().slice(0, 5000), run_id: runId || null })); body.value = ''; toast('Saved'); filter = 'new'; drawBar(); load(); }
    catch (e) { toast(friendlyError(e), 'err'); }
  });
  const drawBar = () => bar.replaceChildren(...[['new', 'New'], ['planned', 'Planned'], ['done', 'Done'], ['dropped', 'Dropped'], ['all', 'All']].map(([k, l]) =>
    h('button', { type: 'button', class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; drawBar(); load(); } }, l)));
  drawBar();
  let rows = [];
  const load = () => section(list, async () => {
    let qq = sb.from('ai_feedback').select('*').order('created_at', { ascending: false }).limit(300);
    if (filter !== 'all') qq = qq.eq('status', filter);
    const [r, names] = await Promise.all([q(qq), loadNames()]);
    rows = r;
    return { r, names };
  }, ({ r, names }) => r.length ? h('div', null, r.map((f) => {
    const st = sel(Object.entries(FSTATUS), f.status);
    const out = h('input', { type: 'text', value: f.outcome || '', placeholder: 'Where it went: a todo, a plan section, a fix…', dir: 'auto' });
    const upd = (vals) => q(sb.from('ai_feedback').update(vals).eq('id', f.id)).then(() => toast('Updated')).catch((e) => toast(friendlyError(e), 'err'));
    st.onchange = () => upd({ status: st.value });
    out.onchange = () => upd({ outcome: out.value.slice(0, 2000) });
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('span', null, h('span', { class: 'tag' }, KINDS[f.kind]), ' #' + f.id), h('span', { class: 'meta' }, `${names[f.author] || ''} · ${fmtDate(f.created_at)}`)),
      h('p', { class: 'pre', dir: 'auto' }, f.body),
      f.run_id && h('p', null, h('a', { href: '#/admin/lab/' + f.run_id }, 'The analysis this is about')),
      h('div', { class: 'row' }, st, out));
  })) : empty('Nothing in this list'));
  load();
  const copy = h('button', { class: 'btn secondary small', onclick: async () => {
    const names = await loadNames();
    const items = rows;
    if (!items.length) return toast('Nothing to copy', 'err');
    const L = ['# Feedback from the GetPro admins', '', 'Turn each item into a todo, a plan change or a fix. Reply with what went where, by #id, so we can update the status in the app.', ''];
    for (const f of items) {
      L.push(`## #${f.id} · ${f.kind} · ${FSTATUS[f.status]} · ${names[f.author] || ''} · ${fmtDate(f.created_at)}`, f.body);
      if (f.run_id) L.push(`Run: ${location.origin}/#/admin/lab/${f.run_id}`);
      if (f.outcome) L.push(`Outcome so far: ${f.outcome}`);
      L.push('');
    }
    copyText(L.join('\n'), `${items.length} items copied. Paste them into Claude Code.`);
  } }, 'Copy the list for Claude');

  main.append(
    h('div', { class: 'row between' }, h('h1', null, 'Feedback for Claude'), h('a', { class: 'btn ghost small', href: '#/admin/lab' }, 'AI lab')),
    h('p', { class: 'meta' }, 'Anything you want to happen: bugs, ideas, coaching knowledge, product changes. Copy the list into Claude Code and it turns it into todos, plans and fixes, and replies with what went where.'),
    h('div', { class: 'card' },
      runId && h('p', { class: 'meta' }, 'This will be linked to ', h('a', { href: '#/admin/lab/' + runId }, 'this analysis')),
      h('div', { class: 'field' }, h('label', null, 'Type'), chips(Object.entries(KINDS), kind, (v) => { kind = v; })),
      h('div', { class: 'field' }, body), add),
    h('div', { class: 'row between', style: { margin: '1rem 0 .5rem' } }, bar, copy),
    list);
}
