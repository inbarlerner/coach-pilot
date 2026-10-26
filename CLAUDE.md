# GetPro — פיילוט קואצ׳ינג בווידאו (coach-pilot)

קובץ הקשר ל־Claude Code. עודכן: 22.10.2026 (commit אחרון: `ae08431` — פינוי אוטומטי של אחסון).

## מה זה
פלטפורמת ווב לאימון ספורט: מתאמן מעלה סרטון, בוחר מאמן מאושר ומקבל ממנו ניתוח בטקסט, קול או וידאו, ואחר כך הודעות המשך לפי מדיניות המאמן. בשלב הבא — ניתוח בעזרת AI. הפרויקט נבנה עם שותף.

- **אתר חי:** https://coach-pilot-5jk.pages.dev/
- **ריפו:** https://github.com/inbarlerner/coach-pilot (ענף ראשי, ציבורי)
- **מנהלת הפלטפורמה:** ענבר (נרשמה בהתחלה כמאמנת, הוגדרה כ־admin דרך `004_first_admin.sql`)

## עקרונות שלא משנים בלי לשאול
- **בלי כרטיס אשראי** — כל השירותים במסלול חינמי. לכן האחסון עבר מ־Cloudflare R2 ל־Supabase Storage.
- **בלי מפתח service role** — הדפדפן מדבר ישירות עם Supabase בשם המשתמש המחובר, וכל ההרשאות נאכפות במסד (RLS) ובאחסון (storage policies).
- **בלי שלב build ובלי תלויות** — HTML/CSS/JS טהור. ה־client של Supabase כתוב בבית (`public/js/sbclient.js`) מעל ה־HTTP APIs, בלי CDN.
- ממשק באנגלית, LTR, שחור־לבן (עבר מעברית ב־25.10.2026 לבקשת ענבר; אין מתג שפה).
- כל שינוי מצב בבקשות/ניתוחים/הודעות עובר דרך פונקציות `SECURITY DEFINER` במסד, שבודקות הרשאות בצד השרת.
- כלל עסקי לתשלום עתידי: חיוב **רק** ב־`send_analysis` (לא בבקשה, טיוטה, סירוב או פקיעה). תנאי המאמן נשמרים כ־snapshot בכל בקשה (`terms`).

## ארכיטקטורה
| שכבה | שירות | הערות |
|---|---|---|
| אירוח | Cloudflare Pages | `public/` + שתי פונקציות ב־`functions/api/` |
| Auth | Supabase Auth | מייל+סיסמה, שחזור סיסמה |
| DB | Supabase Postgres | RLS, פונקציות RPC, pg_cron כל דקה לפקיעת בקשות |
| קבצים | Supabase Storage | דלי פרטי `media` (וידאו/קול/קאברים, עד 50MB, קישור חתום לשעה) + דלי ציבורי `avatars` (תמונות פרופיל, עד 2MB) |

משתני סביבה ב־Cloudflare Pages: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (מקבל גם `SUPABASE_ANON_KEY` ישן), ו־`ANTHROPIC_API_KEY` כסוד (Secret) למעבדת ה־AI. `/api/health` מראה אם חסר משהו.

## מבנה הקוד
```
public/
  index.html, app.css, _headers
  js/app.js          ראוטר hash (#/home, #/r/<id> ...) + ניווט תחתון
  js/sbclient.js     client מינימלי ל־Supabase (auth/rest/rpc/storage)
  js/api.js          קריאות לפונקציות המסד
  js/ui.js, components.js   עזרי DOM ורכיבים (כולל בוחר שפות)
  js/images.js       תמונת פרופיל (avatar), קאבר לסרטון: בחירת פריים / העלאת תמונה / פריים אקראי
  js/pages/          auth, home (פיד), search (מאמנים), upload, inbox,
                     request (מסך בקשה/ניתוח), video, profile, settings,
                     notifications, admin
functions/
  api/config.js      מחזיר כתובת Supabase + מפתח ציבורי
  api/health.js      בדיקת משתני סביבה
  _lib/common.js
supabase/            להריץ לפי הסדר ב־SQL Editor:
  001_schema.sql     טבלאות, RLS, כל פונקציות ה־RPC
  002_cron.sql       pg_cron → expire_requests() כל דקה
  003_storage.sql    דלי media + מדיניות גישה לקבצים
  004_first_admin.sql הגדרת המנהלת הראשונה (ידני)
  005_auto_cleanup.sql פינוי אוטומטי כשהאחסון מתמלא
  006_request_coach.sql בקשת הצטרפות כמאמן מחשבון קיים (מסך הגדרות)
  007_photos_languages_english.sql תמונות פרופיל, קאבר, שפות, טקסטים באנגלית
  008_search.sql     חיפוש כללי: search_people, search_videos
  009_ai_lab.sql     מעבדת מאמן AI למנהלות: ריצות, ביקורות, פידבק ל־Claude, דלי ai-lab
tests/               בדיקות SQL (stubs ל־Supabase), פונקציות, ו־e2e בדפדפן
functions/_lib/ai-coach.js  הליבה של מאמן ה־AI (פרומפט, סכמה, קריאה ל־Claude, מחיר)
functions/api/ai-lab.js     מריץ ניתוח AI במעבדה (מנהלות בלבד, מפתח ה־API סוד ב־Cloudflare)
public/ai-coach/     כרטיסי התרגילים + coaching-decisions.md + index.json (node scripts/ai-cards-index.mjs אחרי שינוי)
public/js/pages/ailab.js    מסכי המעבדה (#/admin/lab, /new, /<id>) ופידבק ל־Claude (#/admin/feedback)
public/js/ai-player.js, ai-text.js  נגן המשוב על הסרטון (ציורים, עצירות, האטה, זום) ותצוגת הטקסט
lab/                 גרסה מקומית ישנה של המעבדה (node lab/server.mjs). ראו lab/README.md
```

## מודל הנתונים (עיקרי)
- `profiles` — role: `trainee` / `coach` / `admin`; למאמן `coach_status`: `pending` → `approved`/`rejected` (מאשרת המנהלת). משתמש יכול רק לבקש להיות מאמן (בהרשמה, או מההגדרות דרך `request_coach`), לעולם לא admin. שימו לב: הרשמה שנייה עם מייל שעוד לא אומת נבלעת ב־Supabase Auth בלי שגיאה, ולכן ההרשמה מזהה את זה ומפנה לבקשה מההגדרות. פרטים פרטיים (מייל/טלפון) ב־`profile_private`.
- `sports`, `user_sports` (תחומי עניין), `coach_sports` (מה המאמן מאמן).
- `coach_settings` — `quota` (בקשות פתוחות במקביל, ברירת מחדל 3), `response_hours` (48), `followup_policy`: `none` / `one` / `chat24` / `unlimited`.
- `videos` — `visibility` private/public, `storage_key`, `cover_key` (קאבר, `set_video_cover`), `removed` (הוסר ע״י מנהלת).
- `profiles.avatar_key` (תמונת פרופיל בדלי הציבורי `avatars`, רק דרך `set_avatar`), `profiles.languages` (קודי ISO 639-1, נשאלים בהרשמה, עריכה בהגדרות).
- `analysis_requests` — סטטוסים: `pending` → `draft` → `completed`, או `declined` (סיבות: unclear / not_my_field / video_problem), או `expired` כשעובר `deadline_at`. רק pending/draft נספרים במכסה. נעילת `FOR UPDATE` על הגדרות המאמן מונעת חריגה מהמכסה במקביל.
- `analysis_items` — טקסט אחד + קבצי קול/וידאו של המאמן.
- `messages` (הודעות המשך, פרטיות לשני הצדדים), `notifications`, `comments`, `reports`, `app_settings`.

פונקציות מרכזיות: `create_video`, `delete_video`, `search_coaches`, `create_request`, `set_analysis_text`, `add_analysis_media`, `remove_analysis_item`, `save_draft`, `discard_draft`, `send_analysis`, `decline_request`, `followup_state`, `send_message`, `get_feed`, `expire_requests`.

## אחסון ופינוי אוטומטי (`005`)
- גבול 900MB (מתחת ל־1GB החינמי), ב־`app_settings.storage_cap_bytes`.
- לפני העלאה: אם חורגים — נמחקות קודם העלאות שלא הושלמו, אחר כך קובצי הסרטונים הישנים ביותר.
- נשמרים: הבקשה, טקסט הניתוח וההודעות. נמחקים: קובץ הסרטון והקלטות המאמן. סרטון בבקשה פתוחה לא נמחק לעולם. בעל הסרטון מקבל התראה.
- המנהלת רואה את השימוש באחסון במסך הניהול.

## מגבלות פיילוט
- 50MB לקובץ (נאכף בדפדפן ובאחסון). הקלטת וידאו של מאמן עד 5 דק׳, קול עד 15 דק׳.
- Supabase חינמי: 1GB אחסון, ופרויקט בלי פעילות שבוע נכנס להשהיה.

## בדיקות
```
node tests/functions.test.mjs
node tests/ai_coach.test.mjs
node tests/ai_lab.test.mjs
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f tests/acceptance.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f tests/cleanup.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f tests/request_coach.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f supabase/007_photos_languages_english.sql -f tests/photos_languages.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f supabase/007_photos_languages_english.sql -f supabase/008_search.sql -f tests/search_chat.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f supabase/007_photos_languages_english.sql -f supabase/008_search.sql -f supabase/009_ai_lab.sql -f tests/ai_lab.sql
python3 tests/e2e/acceptance_ui.py   # Supabase Auth + PostgREST מקומיים + אמולטור אחסון (tests/e2e/server.mjs). שימו לב: הסלקטורים עדיין בעברית ולא עודכנו לממשק האנגלי.
```
בלי psql מקומי אפשר להריץ את בדיקות ה־SQL בקונטיינר `postgres:17-alpine` (docker exec … psql). ל־`tests/e2e/server.mjs` אפשר להגדיר `E2E_PSQL`, ו־Claude מזויף כברירת מחדל (`E2E_AI_REPLY` = קובץ תשובה).
להריץ את כל הבדיקות לפני כל commit.

## איך עובדים כאן
- שינויי מסד: קובץ SQL חדש וממוספר ב־`supabase/` (006_..., 007_...) — לא לערוך קבצים שכבר הורצו בפרודקשן. אחרי push צריך להריץ אותו ידנית ב־Supabase → SQL Editor.
- פריסה: push ל־main ב־GitHub → Cloudflare Pages בונה ומפרסם אוטומטית.
- כל הרשאה חדשה נאכפת במסד/אחסון, לא רק בממשק.

## השלבים הבאים (פתוח)
- ניתוח סרטונים בעזרת AI.
- תשלומים (לפי הכלל העסקי למעלה).
