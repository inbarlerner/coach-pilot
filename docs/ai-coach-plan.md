# AI Coach — Design Plan (draft for review)

Status: proposal, nothing built yet · 23.10.2026

## 1. What we're building

A **standalone AI coach** that trainees pick like any other coach. The trainee uploads a video, picks "מאמן AI", asks a question, and gets a written analysis within about a minute. The first **3 AI analyses per user are free**; after that, payment (not built yet; see §8).

It reuses the existing request → analysis → completed flow, so the inbox, request screen, notifications and storage cleanup all keep working without a parallel system.

## 2. Decisions needed before building

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **AI provider** | (a) Claude, paid through Jenni's account · (b) Gemini free tier · (c) Cloudflare Workers AI free tier | (a). Details in §3. |
| D2 | **Claude model** (if D1 = a) | Opus 5.5 (~$0.13/analysis) · Haiku 5.5 (~$0.003/analysis) | Run the bake-off in §9 on 5 real videos, then decide. |
| D3 | **After 3 free analyses** (until payments exist) | Block with "coming soon" · allow with a global daily cap · admin grants extra credits manually | Block, and let the admin grant credits manually. |
| D4 | **Follow-up questions to the AI** | None in v1 · one follow-up answered by the AI | None in v1 (policy `none`). Add one in v2. |
| D5 | **Keep the frames the AI looked at?** | Delete after the analysis · keep and show them as "key moments" | Keep them (~1.3 MB per analysis, counted in the storage cap and covered by auto-cleanup). |
| D6 | **SDK or plain `fetch`** | Anthropic SDK (adds `package.json` + a build step) · plain `fetch` to the HTTP API | Plain `fetch`, which keeps the "no build, no dependencies" rule. |

## 3. Provider options

| | Claude (Jenni's account) | Gemini API free tier | Cloudflare Workers AI free |
|---|---|---|---|
| Credit card | Yes, on Jenni's Anthropic account only | No | No |
| Cost per analysis | Opus 5.5 ~$0.13 · Haiku 5.5 ~$0.003 (estimate below) | $0 | $0 up to 10,000 "neurons"/day, shared by all models |
| Input | Images (we send frames) | Video directly, or frames | Images; smaller vision models |
| User data | Not used for training | **Free-tier inputs may be used for training and read by human reviewers** (outside EEA/UK/CH, so this applies to Israel) | Not used for training |
| Hebrew output quality | Strong | Good | Untested, probably weak |
| Rate limits | Plenty for the pilot | ~10 requests/min; daily cap reported between 500 and 1,500 (third-party sources conflict) | Model-dependent |

**Why Claude:** trainees upload videos of themselves, possibly including minors. Sending those to a free tier that trains on inputs and allows human review is a privacy and trust risk, and we'd have to say so in the terms. Workers AI is free and private but the quality is likely too low to charge for later. With Haiku 5.5, 3 free analyses cost about **$0.01 per user**. With Opus 5.5 it's about **$0.40 per user**.

**Cost estimate (per analysis):** 16 frames at 1024×576 ≈ 780 visual tokens each ≈ 12.5k tokens, plus ~1.5k prompt tokens ≈ **14k input tokens**. Output (with thinking) ≈ **3.5k tokens**.
- Opus 5.5 ($4 / $20 per M tokens): ≈ $0.056 + $0.070 ≈ **$0.13**
- Haiku 5.5 ($0.10 / $0.50 per M tokens): ≈ **$0.003**

These are estimates. We'll confirm them from real `usage` numbers during the bake-off.

**Safety net:** set a **monthly spend limit** in the Anthropic Console, and a daily AI cap in our database (§5).

We'll keep the provider call in one small adapter file (`functions/_lib/ai.js`), so switching to Gemini later is a one-file change.

## 4. How it works (flow)

```
Trainee browser                 Cloudflare Function             Supabase                 Claude
───────────────                 ───────────────────             ────────                 ──────
1. create_request(video, AI coach)  ─────────────────────────────►  checks free credits
2. extract 16 frames (<video>+canvas), upload JPEGs ──────────────►  storage: ai-frames/<request>/NN.jpg
3. POST /api/ai-analyze {request} + trainee JWT ─►
                                4. verify trainee via ai_request_ready() ─►
                                5. sign in as AI coach account ─►
                                6. ai_claim(request) → status 'draft' (no double runs)
                                7. signed URLs for the frames
                                8. Messages API: frames + sport + question ──────────────►
                                   ◄── streamed analysis (relayed to the browser as progress)
                                9. set_analysis_text + send_analysis (as the AI coach) ─►  completed + notification
                                   on failure: ai_release(request) → back to 'pending', retry allowed
```

Key points:
- **Still no service role key.** The AI coach is a real Supabase user (`role = coach`, `coach_status = approved`, `is_ai = true`). The function signs in as that user with credentials kept as Cloudflare secrets, then calls the **same RPCs a human coach uses**. Every permission is still enforced by RLS and the definer functions.
- **Frames are extracted in the browser.** Cloudflare Workers can't decode video, and the free plan allows only ~10 ms of CPU per request. The browser already has the video. Frames go to Storage, and Claude reads them by signed URL, so the function only passes small JSON along and stays within CPU limits.
- **Streaming.** Opus can take 30–90 s. The function relays the streamed response to the browser, so the connection doesn't time out and the trainee sees progress. If they close the tab mid-run, the request goes back to `pending` and they can retry. They aren't charged, because credits are only used on `send_analysis`.
- **"Not analyzable" videos** (wrong sport, too dark, not a person): the AI calls `decline_request` with `unclear` or `video_problem`. This **doesn't use a credit**, which matches the existing billing rule.

## 5. Database — `supabase/007_ai_coach.sql` (new file, never edit 001–006)

- `profiles.is_ai boolean not null default false`, protected by `protect_profile_columns` so users can't set it.
- `ai_runs` table: `request_id, model, input_tokens, output_tokens, cost_usd_est, status (ok/declined/error), error, created_at`. Readable by the admin only.
- `app_settings` keys: `ai_enabled` (kill switch), `ai_free_credits` (3), `ai_daily_cap` (e.g. 50).
- `ai_credits_left(uid)` = `ai_free_credits` + admin-granted credits − completed AI requests.
- New table `ai_credit_grants (user_id, amount, granted_by, created_at)` so the admin can give extra credits (D3).
- `create_request` wrapper: if the coach is AI, block with `AI_DISABLED`, `AI_NO_CREDITS`, `AI_DAILY_CAP`, or `AI_ONE_OPEN` (max 1 open AI request per trainee).
- `ai_request_ready(p_request)`: called as the trainee. Confirms the request is theirs, the coach is AI, it's `pending`, and frames exist.
- `ai_claim(p_request)` / `ai_release(p_request)`: called as the AI coach. Atomic `pending → draft` and back.
- `ai_log_run(...)`: called as the AI coach; writes to `ai_runs`.
- Storage policy additions in the same file: the trainee can upload under `ai-frames/<own AI request>/`, and the AI coach can read it. `005` cleanup also treats `ai-frames/` as deletable when the request is closed.
- `search_coaches` returns `is_ai` so the UI can show a badge and sort the AI coach first.

The AI coach's `coach_settings`: `quota 100` (max allowed), `response_hours 1`, `followup_policy 'none'`, and `coach_sports` = all active sports.

## 6. Server function — `functions/api/ai-analyze.js` + `functions/_lib/ai.js`

- New env/secrets in Cloudflare Pages: `ANTHROPIC_API_KEY`, `AI_COACH_EMAIL`, `AI_COACH_PASSWORD`, `AI_MODEL` (so we can switch models without a code change).
- `/api/health` also reports whether the AI variables are set.
- The model call uses plain `fetch` to `https://api.anthropic.com/v1/messages` with streaming, adaptive thinking, an explicit `effort`, and **structured output** (JSON schema):
  `{ verdict: "ok"|"unclear"|"video_problem", summary, strengths[], fixes[{issue, why, drill, frame}], safety_note }`
- On Opus 5.5 we enable the server-side refusal **fallback** (`fallbacks: "default"`), and always check `stop_reason` before using the output.
- The JSON is rendered into the existing single text item (Hebrew, with headings), so the request screen shows it with no new rendering. The raw JSON goes into `ai_runs`.
- System prompt (Hebrew): a supportive, specific coach for the sport; refer to frame numbers; no medical diagnosis; say what can't be judged from stills; add an injury-risk note when relevant. The trainee's question is passed as data, not instructions.

## 7. UI changes (no build, plain JS)

- **Search (`search.js`)**: AI coach card at the top with an "AI" badge and "נותרו לך X ניתוחים חינם".
- **Upload/request (`upload.js`)**: when the AI coach is chosen, extract frames and upload them with a progress bar, then call `/api/ai-analyze` and show streaming status ("מנתח את הסרטון…").
- **Request screen (`request.js`)**: AI badge; "key moments" frame strip (if D5 = keep); "נסה שוב" button if the run failed; a disclaimer that this is AI feedback, not a substitute for a coach.
- **Admin (`admin.js`)**: AI on/off switch, today's runs vs cap, estimated spend this month, grant credits to a user.

## 8. Payments (later)

Out of scope here. When added, the charge hooks into `send_analysis` exactly as the existing billing rule says. `ai_credits_left` becomes "free credits + purchased credits".

## 9. Build order

1. **Spike, ~1 day:** frame extraction in the browser plus a call to the Messages API from a Pages Function on the free plan. Confirm CPU/time limits, streaming, and real token counts.
2. **Bake-off:** 5 real pilot videos (kite, ski, snowboard, padel) through Opus 5.5 and Haiku 5.5. Inbar rates them blind, then we pick the model (D2).
3. Migration `007` + SQL tests (`tests/ai_coach.sql`): credits, cap, kill switch, claim/release race, storage policies, non-AI user can't call AI functions.
4. Function + adapter + tests (`tests/functions.test.mjs`, with the provider mocked).
5. UI changes + e2e (`acceptance_ui.py`, with a mock provider so tests cost nothing).
6. Rollout: run `007` in the SQL Editor → create the AI coach account (sign up in the app, then an SQL snippet sets `is_ai`/approved) → add Cloudflare secrets → set the Anthropic spend limit → push.

## 10. Risks

- **Stills miss motion.** 16 frames can't show timing or rhythm. Mitigations: v2 lets the trainee mark the key 3–5 seconds and we sample those densely. The prompt states what can't be judged.
- **Abuse:** a trainee could upload non-sports images as "frames". They can only spend their own credits, and the daily cap and kill switch limit the total.
- **Cost overrun:** Anthropic monthly limit + `ai_daily_cap` + `ai_enabled` switch.
- **Supabase pausing:** unchanged; the AI adds activity, if anything.

## 11. Teaching the coach (sport knowledge)

The model isn't retrained. It's taught with **trick cards** written with our coaches and loaded per request.

- **One card per trick**, plus one fundamentals card per sport. Each card covers stages, what each stage looks like *in a frame*, common mistakes (what you see → fix), drills, safety, and filming needs. Sample: [cards/kitesurf/back-roll.md](ai-coach/cards/kitesurf/back-roll.md).
- **The trainee picks the trick** at upload, or "not sure". The AI gets the fundamentals card plus that one trick card. For "not sure", the AI first identifies the trick from the frames.
- **Frame timing (changes §4):** the trainee taps the takeoff moment, and we sample densely (6–8 fps) from ~2 s before to ~2 s after. Even spacing over a long clip misses tricks.
- **Sources:** [ai-coach/kitesurf-sources.md](ai-coach/kitesurf-sources.md). Main sources: IKSURFMAG (233 articles), Steven Akkersdijk's SA Masterclass and Get High with Mike (tutorials plus student mistake reviews). Trick list: Duotone Academy (232 videos).
- **Feedback comes from text knowledge only.** Screenshots are a study tool for writing the cards; no third-party images go into the product.
- **DB:** `tricks (id, sport_id, name_he, name_en, level, card)` and `analysis_requests.trick_id`. Requests for tricks we have no card for are logged so the backlog is driven by demand.
- **Quality loop:** test set of 20–30 pilot videos with coach-written reference analyses, rerun on every card or instruction change. Trainee rating on each AI analysis.

## Sources

- Claude vision limits and image token formula: https://platform.claude.com/docs/en/build-with-claude/vision
- Gemini free tier terms and limits (third-party, unverified against Google's own pages): https://pecollective.com/tools/gemini-free-tier-guide/ · https://aipromptshub.co/blog/gemini-api-free-tier-rate-limits · https://tokenmix.ai/blog/gemini-api-free-tier-limits
- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
