# CoachIt brand: implementation instructions

For a coding session. Apply the decided brand to the whole app. Every value you need is here.

Visual reference: the CoachIt Brand Book, https://claude.ai/artifact/LHEc3UopKoFBJrAmAcf9Pq (pages 6, 7, 8, 11, 12, 13, 14). Where the book's mockups and this file differ, this file wins. The older CoachIt design system artifact is out of date: don't use it.

## Scope

**Change:** the look of the app (`public/app.css`, plus markup in `public/js` where a rule needs it), the fonts, and the docs listed under "Project docs".

**Don't change:**
- UI copy, except the name (see "The name"). Status labels stay as they are in `STATUS` in `public/js/ui.js`.
- Behavior, routes, database, permissions, RPCs.
- The video viewer and editor (`viewer.js`, `video-editor.js`, `ai-player.js` and their CSS). Video surfaces stay black, and their yellow and drawing colors are functional. Only their buttons outside the video take the new button styles, if that doesn't disturb them.
- Dark mode: not defined, don't add it.
- The logo: no symbol exists yet. Don't draw one.

**Project rules still apply** (see `CLAUDE.md`): no build step, no dependencies, no CDN, plain HTML/CSS/JS. Interface in English, LTR.

## Color

Only these colors. No grey, no other tints.

| Token | Value | Use |
|---|---|---|
| `--deep` | `#00432F` | Body text, headings, active items, input outlines |
| `--bottle` | `#006A4E` | Primary buttons, secondary text |
| `--mint` | `#E3EFEA` | Cards, secondary buttons, highlight banners |
| `--white` | `#FFFFFF` | Screen background, text on dark |
| `--red` | `#B3261E` | Text on pale red only. Never a fill |
| `--pale-red` | `#FBE9E7` | Background behind red text |

Map the existing variables in `:root`:

| Existing | New value |
|---|---|
| `--bg` | white |
| `--surface` | mint |
| `--surface-2` | mint |
| `--line` | mint for dividers. Where a line must be seen on mint or marks an input, use deep |
| `--text` | deep |
| `--muted` | bottle |
| `--inverse` | white |
| `--strong` | deep |
| `--focus` | deep |

Replace the "Grayscale only" comment at the top of `app.css`. Replace hardcoded `#fff`, `#000`, `#111`, `#222`, `#ccc`, `#ddd` outside video surfaces. Black stays on video players and video previews.

Allowed text and background pairs (all clear 4.5:1): deep on white ~11.4, bottle on white ~6.6, white on bottle ~6.6, white on deep ~11.4, deep on mint ~9.7, bottle on mint ~5.6, red on pale red ~5.6, red on white ~6.5. Never white on mint (~1.2:1) and never mint as a text color on white.

## Typography

- **Rubik** for headings and the wordmark. **Assistant** for everything else.
- Self-host: put woff2 files in `public/fonts/` with `@font-face` in `app.css`, `font-display: swap`. Rubik weights 700 and 800, Assistant 400, 600 and 700, Latin and Hebrew subsets with `unicode-range`. Both are SIL OFL: include the license files. Don't load from Google at runtime.
- Stacks: `'Assistant', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif` and `'Rubik', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`.
- Decided: languages the fonts don't cover (including Russian, Arabic, Chinese, Japanese, Korean, Hindi) use the device font. That is what the stacks do. Don't add more font files for them.
- Coaches and trainees write to each other in many languages, so user-written text must keep rendering correctly in any script.

| Style | Size | Font |
|---|---|---|
| Hero (auth and landing only) | 40px | Rubik 800 |
| `h1`, screen heading | 28px | Rubik 700 |
| `h2` | 20px | Rubik 700 |
| `h3` | 18px | Rubik 700 |
| Body | 16px | Assistant 400 |
| Small | 14px minimum | Assistant 400 or 600 |

Inputs stay at 16px or more, so iOS doesn't zoom on focus.

## Shape

Two shapes only:
- **16px** radius: cards, inputs, textareas, selects, banners, video frames, modals.
- **Pill** (`999px`): buttons, tags, chips and filters, active tabs, active nav item, badges.

Circles stay circles (avatars, dots). Remove all other radius values. Keep the existing rule that feed items run edge to edge on phones.

## Spacing

Scale: 4, 8, 12, 16, 24, 32, 48 px. Use nothing else for margin, padding or gap in the parts you touch.

- 16 from the screen edge (today it's 8)
- 16 inside a card
- 12 between cards
- 24 between sections

Convert these to variables (`--space-1` and so on). Keep `--tap: 52px`.

## Buttons

| Type | Class | Look |
|---|---|---|
| Primary | `.btn` | bottle fill, white text |
| Secondary | `.btn.secondary` | mint fill, deep text, no border |
| Quiet | `.btn.ghost` | transparent, deep underlined text |
| Red action | new `.btn.danger` | pale red fill, red text, no border |

- Heights: 52px regular, 44px small (`.btn.small` is 40 today). Assistant 700.
- Use `.btn.danger` on Decline, Delete and Discard actions. Find them in `public/js`. Confirmation dialogs (`confirmDialog` in `ui.js`) use it too on destructive confirms. Never a solid red fill.
- On a mint card, secondary turns white. Add a rule for `.card .btn.secondary`.
- On a deep background, primary turns white with deep text, secondary stays mint.
- Not available: the same button at `opacity: .45`, as today.
- Pressed (`:active`): primary fills deep. Secondary and red action gain a 2px inset outline in their text color. No new colors.
- Loading: keep the button's width, show a 16px ring spinner and the existing busy text, block a second tap. Reuse the `busy` helper in `ui.js`. Respect `prefers-reduced-motion`.
- Focus: keep the visible outline in deep. On deep elements it's white.

## Screens: the "dark selection" rule

- Screen, top bar, bottom nav: white. Never dark bars.
- Cards: mint, no border, 16px radius. `.card.unread` gets a 2px deep border.
- Whatever is active or selected: deep fill with white text. This covers the active tab, `.chip.on`, the active nav item and selected options.
- Tabs (`.tabs`): replace the underlined style with pills. Active is deep with white text, inactive is plain deep text. Keep horizontal scrolling.
- Bottom nav: keep icons with labels. The active item is a deep pill with white icon and label. Remove the `::before` bar. Keep the unread badge readable: deep on white pill when on deep, white on deep otherwise.
- Top bar: show the wordmark `CoachIt.` on the side where the page title sits today (Rubik 800, 22px, deep). The page's own `h1` carries the title. Screens with no `h1` in `main` need one added, so no screen loses its title. Keep the notification bell and any back button.
- Filter chips, inactive: mint fill, deep text.
- `.banner`: mint, deep bold text. `.banner.strong`: deep, white text.

## Status tags

`.tag` becomes a pill. Status labels keep their words.

| Status | Look |
|---|---|
| Pending, draft, expired | transparent, 1px deep outline, deep text |
| Completed | bottle fill, white text |
| Declined | pale red fill, red text |

- Add status classes and apply them wherever a request status is rendered, using a helper rather than repeating it. `.tag.soft` today uses a grey line: make it mint fill with deep text on white, white fill on a card.
- Errors and failed uploads: pale red background, red bold text, 16px radius.
- Color never works alone. Our red and green are equally dark, so color-blind users may not tell them apart. Every status keeps its word.

## Icons

Keep the existing set in `public/js/ui.js`: 24px grid, 1.8 stroke, round caps and joins, `currentColor`. A new icon follows the same style. Trash and other red-action icons take the red.

## The name

Always `CoachIt`, capital C and capital I, wherever a user can see it. `CoachIt.` with a period only as the full wordmark (top bar, auth screens), never in a sentence. Already fixed in `public/` and `functions/` (`Coachit` no longer appears there), but check again.

## Project docs

Update `CLAUDE.md`:
- The principle saying "black and white" becomes the rules here. Add that UI is in English while messages between coach and trainee can be in many languages.
- The title's `Coachit` becomes `CoachIt`.
- Self-hosted fonts in `public/fonts/` are not a dependency. Note that in the "no dependencies" principle.
- Add `docs/brand-implementation.md` to the code structure.

## Order of work

1. Fonts and `:root` variables. This gets most of the way alone.
2. Buttons, tabs, chips, tags, cards, banners, inputs in `app.css`.
3. Top bar and bottom nav, including the markup in `public/js/app.js`.
4. Status helper and `.btn.danger` in `public/js`.
5. Sweep every screen: `auth`, `home`, `search`, `upload`, `inbox`, `request`, `video`, `profile`, `settings`, `notifications`, `admin`, `ailab`. Look for inline `style:` colors and hardcoded values.
6. `CLAUDE.md`.

## Verifying

- **Node:** the machine's global Node is 14 and the Node tests need 18 or newer (they fail on `Response` and `.at`, unrelated to this work). Sort this out first and say what you did. There is no brew, psql or docker: see the local dev stack note in project memory. SQL tests don't apply, since this touches no SQL.
- Run `tests/functions.test.mjs`, `tests/ai_coach.test.mjs`, `tests/ai_lab.test.mjs`.
- **Look at it:** run the app locally and check every screen at phone width (390px) and desktop, for trainee, coach and admin. Check the empty, loading and error states. Check a message containing Hebrew, Russian and Arabic. Report what you did not see.
- `grep` `app.css` for leftovers: every color must be a token or sit on a video surface, every radius 16px, pill or circle.
- `tests/e2e/acceptance_ui.py` has Hebrew selectors that are already out of date. Don't treat its failures as caused by this work.

## Git

Work on a feature branch. Don't push or merge until Inbar says so. Show her the running app first, because she decides by looking.

**Heads-up:** this file and the spelling fixes (`public/index.html`, `public/js/pages/ailab.js`, `functions/_lib/ai-coach.js`) may still be uncommitted on `main`. Include them in the first commit on your branch.

## Not in this job

- Logo and app icon.
- Voice examples on page 3 of the book: not yet approved, so don't rewrite copy to match them.
- Dark mode.
