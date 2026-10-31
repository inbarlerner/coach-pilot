# Bake-off 1 · 25.10.2026 · Haiku 5.5 vs Opus 5.5

Same input for both: 5 frame sheets from the WhatsApp clip, cards (fundamentals, hooked jump, big air kiteloop, kiteloop late back), coaching decisions, effort `high`, structured JSON output. Trick not given.

| | Haiku 5.5 | Opus 5.5 |
|---|---|---|
| Time | 58 s | 119 s (streamed) |
| Tokens in / out | 29,983 / 6,097 | 29,983 / 9,716 |
| Cost | **~$0.006** | **~$0.31** |
| Trick identified | "Back roll style, not sure if the kite looped" (low) | **Big air kiteloop** (medium); says it can't tell if there was a late back rotation |
| Timeline | Vague | Precise: takeoff 2.1 s, loop 3.0–3.6 s while still rising, apex ~4.0 s, touchdown ~5.3 s |
| Main fix | Kite didn't come back over the rider before landing ✓ (but says the kite was "high and forward", which looks wrong) | No exit steer after the loop: kite drifts back and low from 4.3 s; board not under the body ✓ |
| Errors | Safety note says the landing is near the waves and shallow water (that's camera perspective, not real). A "head leads" point with no visible evidence. | None found. Hedges kite depth (2D shot) and says so. |
| Usable for a trainee? | No | Yes, after coach review |

Analyses: [Haiku](2026-10-25-jump-haiku.md) · [Opus](2026-10-25-jump-opus.md) · My manual analysis before the new cards: [2026-10-25-jump.md](2026-10-25-jump.md)

## What this tells us

1. **Quality: Opus, by a wide margin.** Haiku missed the loop even with a dedicated kite sheet and made two confident mistakes, one of them a safety claim. On this clip it isn't good enough to show trainees.
2. **Cost is higher than the plan's estimate** ($0.31 vs ~$0.13). Input is ~30k tokens (5 big sheets + 4 cards) and Opus wrote ~10k output tokens, mostly thinking. Levers to try before deciding:
   - **Prompt caching** for the cards and instructions (the same for every trainee): cache reads are ~5% of the input price.
   - **Effort `medium`** on Opus (the model default) instead of `high`.
   - **Fewer, smaller frames:** 3 sheets instead of 5.
   - **Sonnet 5.5** ($2 / $10 per M tokens) as the middle option. Not tested yet.
3. **3 free analyses per user on Opus ≈ $0.90** at today's settings. With the levers above it could plausibly drop to roughly a third, which needs measuring.
4. **The new cards helped.** With them, Opus named the trick and judged loop timing against the card's "¾ height, still rising" rule.

## For Inbar (blind rating, plan §9)
- Is Opus's reading right: a kiteloop with no late back, loop pulled while still rising, crash from no exit steer and the board not under the body?
- Would you give the same top 3 fixes?
