# Kitesurf knowledge sources + screenshot plan

Pulled 23.10.2026. Raw material lives outside the repo (articles in Claude's scratchpad, transcripts in `~/CLAUDE/projects/transcripts/kitesurf-samples`). Only our own distilled cards go in the repo.

## What we pulled

| Source | Pulled | Density | Verdict |
|---|---|---|---|
| **IKSURFMAG technique** (C&K) | All 233 beginner + intermediate articles (~380k words, median ~1,600 words/trick). 197 have Top Tips, 196 Keystones, 199 a video; median 7 stage photos each. | **Very high.** Stage-by-stage (Pic A–H), each paragraph tied to a photo, explains the *why*. | **Main source for cards.** Their video transcripts mostly repeat the articles, so we skip them. |
| **Duotone Academy** | List of all 232 trick videos (Hooked 82, Unhooked 41, Wave 37, Strapless 36, Foil 19, Beginner 17). 3 sample transcripts. | High per word, but short (200–370 words). Checklists with no "why" and no mistakes. The `[Music]` gaps are slow-mo/graphics the transcript misses. | **Trick list + key-point checklists.** The visual parts need screenshots (below). |
| **Advakite** (upwind) | 1 transcript, ~1,400 words | High, conceptual (leaning on the lines, edge, speed range) | Use for the fundamentals card. |
| **Steven Akkersdijk — SA Masterclass** (King of the Air podium rider, full-time coach) | 42 of 46 tutorials (~55k words): jumps, pop, back roll, front roll, transitions, kite loops, slides, foil, plus 3 videos reviewing students' and viewers' clips | **Very high.** Mechanics plus *why*, and several "real student mistakes" reviews | **Main source** for jumps, rotations and loops. The mistake reviews are the model for the AI's feedback voice. |
| **Get High with Mike** (Mike Mac Donald, big-air coach) | 17 of 39 tutorials (~38k words); **22 blocked** by a temporary YouTube limit, to retry later | **Very high** on posture, takeoff, landing and big air. Gives cues you can see in a frame ("locked-in position": shoulders over hips, arms forward, hips upwind) | **Main source** for jump posture and takeoff mistakes, and for big-air cards later. |
| **Flukes Kitesurfing** | 1 transcript | Medium, conversational. The channel is now mostly waves, foil and DIY board building. | Low priority; wave cards later. |
| **Kite Surf College** | 390 videos listed; sample failed (**members-only**) | Not checked | Retry with a free video; many lessons may be paywalled. |
| **The Kitesurf Centre** | 1 transcript | Low; garbled auto-captions; few tutorials (23/119) | Drop. |

## Pilot trick list (16) and where each card comes from

| Card | IKSURFMAG | Duotone |
|---|---|---|
| Fundamentals (stance, edge, kite position, bar) | Fix Your Toeside, Body Dragging Upwind | + Advakite upwind |
| Body drag | Body Dragging Upwind | BEGINNER Bodydrag |
| Waterstart | (twin-tip coverage thin, check) | BEGINNER Waterstart |
| Riding upwind | Twin Tip Upwind 360 | BEGINNER Riding Upwind |
| Beach start | Twin Tip Beach Start | HOOKED Beach Start |
| Jibe / carve | Heel to Toe Carve, Air Gybe | BEGINNER Jibe heel to toe / toe to heel |
| Toeside riding | Fix Your Toeside | — |
| Hooked jump | Jumping | HOOKED Jump |
| Jump transition | Jump Transition | HOOKED Jump transition |
| Jump grab | Pop to Toeside with a Tweaked Grab | HOOKED Jump grab |
| Downloop transition | Learning to Loop parts 2–3 | BEGINNER Downloop jibe |
| **Back roll** (sample card done) | Back Roll | HOOKED Backroll |
| Front roll | Front Roll, Hooked Popped Front Roll | HOOKED Frontroll variants |
| Back roll transition | Back Roll Transition One Foot | HOOKED Backroll Transition |
| Pop to toeside | Pop to Toeside | HOOKED Pop to toeside |
| First kite loop | Learning to Loop parts 1–7, Kite Loop | HOOKED Kiteloop |

Inbar should confirm this list matches what pilot riders actually do. The full combined catalog (233 + 232 names, only 18 matching exactly) needs a quick human pass to merge names.

## Screenshots: for learning only

**Decision: the AI coach gives feedback from text knowledge (the trick cards). No screenshots or third-party images go into the product.**

Screenshots are a **study tool for writing the cards**. The articles say "kite at 11 o'clock", but in a trainee's side-on video the kite is usually out of frame. Looking at the reference photos lets us translate each instruction into what's visible in a frame: "lines leaning ~30° forward", "bar horizontal, arms long". That translation goes into the card as text. The AI then only needs the card.

| Step | What | How |
|---|---|---|
| A | IKSURFMAG stage photos for the 16 pilot tricks (~110 images) | Already linked per stage (Pic A–H). View them next to the article text and write the "what it looks like in a frame" column. Images stay in scratch, never in the repo. |
| B | Duotone slow-mo / graphics moments, only where A leaves gaps | Pause and screenshot in the browser for study. No video downloads. |

**Our own pilot frames are still needed, for testing, not for the product:** 20–30 real trainee videos with a coach's written analysis become the test set we rerun after every card change. Pro photos are sharp and close, while trainee phone videos are far away and blurry, so we must test on the real thing.

**Optional later experiment:** if testing shows the AI misreads body positions from text alone, try adding 1–2 real reference frames from our own pilot library at runtime.
