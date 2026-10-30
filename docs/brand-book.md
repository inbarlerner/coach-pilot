# CoachIt Brand Book (text copy)

A readable copy of Inbar's brand book, so it can be used in coding sessions without opening the artifact.

- **Source:** https://claude.ai/artifact/LHEc3UopKoFBJrAmAcf9Pq (14 pages)
- **Copied:** 30 October 2026, from version `1793357043-893a`. If the book changes, refresh this file.
- **Which file wins:** `docs/brand-implementation.md` has the exact rules for the code (tokens, classes, sizes). Where this book and that file differ, that file wins. Use this book for what it doesn't cover: who we are, voice, the name, the logo direction and what is still undecided.
- Visual-only content (mockups, color swatches) is described in words here. Open the artifact to see it.

---

## 01 Cover

Brand book, with the wordmark `CoachIt.`

## 02 Who we are

**Upload your video. Get coaching back.**

A web platform that connects athletes with professional coaches through video analysis. An AI coach is in training and will join the platform later.

- **What sets us apart:** real, approved coaches. Our AI coach is still in training.
- **Audience:** amateur and advanced athletes, and certified coaches.
- **Pilot sports:** kitesurfing, skiing, snowboarding and padel.

## 03 Voice

Feels like a good coach: **direct, supportive and precise.**

This is how CoachIt itself speaks: screens, notifications, emails. Each coach keeps their own voice and style.

Traits: professional, trustworthy, calm, sporty.

| Quality | Say this | Not this |
|---|---|---|
| Direct | Your coach replied. | Great news! Your request has an update! |
| Supportive | That didn't upload. Try again. | Upload error. Request failed. |
| Precise | Your coach has 48 hours to respond. | You'll hear back soon. |

**Status: not approved yet** (see page 10). Use it as guidance for new copy. Don't rewrite existing copy to match it until it's approved.

## 04 The name

- Write it **CoachIt**, with a capital C and a capital I.
- Not `Coachit`, not `COACHIT`.
- **With a period** (`CoachIt.`) only when the name is the full logo, such as at the top of a page.
- **In a sentence, no period:** "Upload your video to CoachIt and pick a coach."
- Wherever users see the name in the product, it's CoachIt.

## 05 Logo and symbol

**Direction chosen, final symbol not yet.**

One continuous line: coach, note, video.
- **Coach:** the letter C. Its top end carries on in one continuous line.
- **Note:** the line becomes the stem of an exclamation mark.
- **Video:** the exclamation mark's dot is a triangular Play button.
- Alternative: the same line, with a round dot instead of a triangle.
- Origin: a hand sketch of a crescent-shaped C, with a tapering exclamation mark beside it.

Planned versions: the symbol alone (app icon and profile picture), the full logo (symbol + CoachIt), a version for dark backgrounds, and a legibility check at 32px.

**There are no logo files yet.** Don't draw the symbol from an approximation. Until it's final, the app shows `CoachIt.` as text.

## 06 Color

| Name | Value | RGB | Use |
|---|---|---|---|
| deep | `#00432F` | 0 67 47 | Logo, headings, active items. Text on white or mint. Dark backgrounds. |
| bottle-green | `#006A4E` | 0 106 78 | Primary action buttons (upload a video, send analysis), with white text |
| mint-tint | `#E3EFEA` | 227 239 234 | Card backgrounds, secondary buttons, selected item, highlight. Close to white, so on white the highlight is subtle. |
| white | `#FFFFFF` | 255 255 255 | Main background, text on green |
| red on pale red | `#B3261E` on `#FBE9E7` | | Declined, errors, delete. Never a solid red fill. |

No accent color: the palette stays small.

## 07 Contrast

| Text on background | Ratio |
|---|---|
| deep on white | ~11.4:1 |
| bottle-green on white | ~6.6:1 |
| deep on mint-tint | ~9.7:1 |
| white on deep | ~11.4:1 |
| white on bottle-green | ~6.6:1 |
| bottle-green on mint-tint | ~5.6:1 |
| **white on mint-tint** | **~1.2:1. Don't use.** On mint-tint, text is deep or bottle-green. |

Text needs at least 4.5:1. 1:1 means identical colors and 21:1 is black on white. These ratios are calculated from the color values, not measured in the interface.

## 08 Typography

- **Rubik:** headings and the brand name, weight 700 to 800.
- **Assistant:** running text.
- Text in languages Assistant doesn't cover uses the font on the user's device.

| Style | Size / line height | Font |
|---|---|---|
| title | 40px / 44px, 800 | Rubik |
| heading | 28px / 34px, 700 | Rubik |
| body | 16px / 26px, 400 | Assistant |

## 09 In use

An example, not defined components. A landing screen with the wordmark, the headline "Upload your video. Get coaching back.", the line "Upload a video, pick an approved coach and get their analysis as text, voice or video.", an "Upload a video" button, and a "Choose a coach" list where the selected coach is highlighted.

## 10 Still open

**Decided:**
- **Language:** the platform is in English. Coaches and trainees can talk to each other in many languages.
- **The name:** CoachIt, everywhere users see it. A period only in the full logo.
- **Fonts:** Rubik for headings, Assistant for text. Uncovered languages use the device font.
- **Product look:** pill buttons, red on pale red for alerts, mint cards, dark active items (pages 11 to 14).
- **Accent color:** none.

**Open:**
- **Logo and symbol:** the direction is right. Until the final one is made, the app shows `CoachIt.` as text.
- **Voice examples:** do the lines on page 3 sound like CoachIt?
- **Dark mode:** later. Only light mode is defined for now.

## 11 Buttons

All buttons are pills.

| Type | Example | Look |
|---|---|---|
| Primary | Send analysis | The main action. bottle-green, white text. |
| Secondary | Save draft | The other actions. mint-tint, deep text. |
| Quiet | Cancel | A low-key action. Underlined deep text. |
| Red action | Decline, Delete | Red on pale red. |

- **Not available:** the same button at 45% strength.
- **Sizes:** 52px regular, 44px small. Text in Assistant, bold.
- **On a mint-tint card:** secondary turns white, so it stays visible.
- **On a dark background:** primary turns white, secondary keeps mint-tint.
- Pressed and loading: see page 14.

## 12 Status colors

**Our greens, plus one red.** Red appears only on Declined and Decline, on errors and on delete. Everything else stays green and white.

| Status | Look |
|---|---|
| Pending, Draft, Expired | deep outline |
| Completed | bottle-green |
| Declined, Decline, errors, delete | red `#B3261E` on pale red `#FBE9E7` (~5.6:1). No solid red. |

Each status also carries its word. Our red and green are equally dark, so color never works alone.

Example lines on the page: a request list with each status, the banner "Expires in 6 hours. Send your analysis soon.", the error "That didn't upload. Try again.", and the buttons "Send analysis" and "Delete video".

## 13 Color on screens

**Dark selection.**
- Screen and bars: white.
- Cards: mint-tint.
- Whatever is active: deep, with white text.
- Main button: bottle-green.
- Pending and Draft: deep outline.

The rule is shown on three screens, each with the `CoachIt.` wordmark on top and the bottom nav (Home, Search, Upload, Inbox, Profile):
- **Inbox:** tabs Active / Completed / Not completed. Request cards show a trainee name, the sport, the time left ("Padel · 6 hours left") and a status.
- **Search:** "Search coaches", sport filter chips, coach cards ("Padel · Replies within 48 hours") and a "Choose a coach" button.
- **Request (coach side):** trainee name, Pending, the video, the banner "Expires in 6 hours. Send your analysis soon.", and the buttons Send analysis, Save draft and Decline.

## 14 Final details

- **Corners:** two shapes only. 16px for cards, inputs and video. Pill for buttons, tags and filters.
- **Spacing:** one scale everywhere: 4, 8, 12, 16, 24, 32, 48.
  - 16 from the screen edge
  - 16 inside a card
  - 12 between cards
  - 24 between sections
- **Pressed and loading:** no new colors. Pressed goes one step stronger. Loading keeps the button's size and blocks a second tap (for example "Sending").
- **Icons:** keep the icons already in the app: thin rounded lines, in the color of the text next to them. Their round ends suit the pill buttons. Active in the navigation: white on dark green.

---

## Note

The book links to an older "CoachIt" design system artifact as its source. `docs/brand-implementation.md` says that design system is out of date, so don't use it.
