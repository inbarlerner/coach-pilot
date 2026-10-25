# AI coach lab

> **The lab now lives inside the app:** ניהול → מעבדת מאמן AI (admins only). Reviews are saved in Supabase and shared between Inbar and Jenni automatically. See `docs/ai-coach-plan.md` §13. This local version still works for offline experiments with your own API key.

A local tool for Inbar and Jenni: send a video to the AI coach, watch its feedback played on the video, and review it. Not part of the product. Nothing here touches Supabase.

## One-time setup

1. Install Node (any version from 2024 on): https://nodejs.org
2. Get the repo: `git clone https://github.com/inbarlerner/coach-pilot` (or `git pull` if you already have it).
3. Save the Anthropic API key in a file outside the repo:
   ```bash
   mkdir -p ~/.config/coach-pilot && pbpaste > ~/.config/coach-pilot/anthropic-key
   ```
   (Copy the key first. `ANTHROPIC_API_KEY` in the environment also works.)

## Run it

```bash
node lab/server.mjs
```
Open http://localhost:8790. Write your name at the top right; reviews are saved under it.

Want to try the screens without spending anything? Use `LAB_MOCK=1 node lab/server.mjs`, which returns a canned analysis.

## Flow

1. **ניתוח חדש:** pick a video from `lab/videos/`, or drag one onto the page.
2. Pause on the takeoff and click **סמן המראה כאן**. Then click **סמן אזור פעולה (זום)** and drag a box around the rider and kite. Frames around the takeoff are taken from this box at 5 per second.
3. Choose the trick (or "not sure"), the model and the effort, then click **נתח**. Opus takes about a minute and costs about $0.30–0.40.
4. **▶ הפעל משוב AI** runs the AI's script: slow motion, pauses, zoom, drawings.
5. Review it:
   - Mark each step and each fix ✓ / ✎ / ✗, with a comment.
   - **ערוך ציור:** drag points, or add arrows, lines, circles or labels.
   - **+ נקודה שה־AI פספס** at the current moment.
   - Give an overall score and say whether it could be sent as is.
   - Everything saves automatically.
6. After changing a card or the prompt: **הרץ שוב את כל המקוריים** sends the same frames again with the current cards and adds a new run next to each original.

## Where things are

| | |
|---|---|
| `lab/videos/` | Videos. Stay on your computer, never committed. |
| `lab/runs/<run>/` | `analysis.json` (input, model, tokens, cost, the AI's output), `frames/` (exactly what the AI saw), `review-<name>.json` (one file per reviewer). Not committed yet: the repo is public. |
| `functions/_lib/ai-coach.js` | Prompt, output format, API call. Shared with the future production function. |
| `public/ai-coach/cards/` | Trick cards. Every card for the sport is sent in each request (cached). |

If the video isn't on your computer, the run page shows the saved frames instead, with the same drawings.
