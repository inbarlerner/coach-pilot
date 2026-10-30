# CoachIt (לשעבר GetPro) — פיילוט קואצ׳ינג בווידאו (coach-pilot)

קובץ הקשר ל־Claude Code. עודכן: 22.10.2026 (commit אחרון: `ae08431` — פינוי אוטומטי של אחסון).

## מה זה
פלטפורמת ווב לאימון ספורט: מתאמן מעלה סרטון, בוחר מאמן מאושר ומקבל ממנו ניתוח בטקסט, קול או וידאו, ואחר כך הודעות המשך לפי מדיניות המאמן. בשלב הבא — ניתוח בעזרת AI. הפרויקט נבנה עם שותף.

- **אתר חי:** https://coach-pilot-5jk.pages.dev/
- **ריפו:** https://github.com/inbarlerner/coach-pilot (ענף ראשי, ציבורי)
- **מנהלת הפלטפורמה:** ענבר (נרשמה בהתחלה כמאמנת, הוגדרה כ־admin דרך `004_first_admin.sql`)

## עקרונות שלא משנים בלי לשאול
- **בלי כרטיס אשראי** — כל השירותים במסלול חינמי. לכן האחסון עבר מ־Cloudflare R2 ל־Supabase Storage.
- **בלי מפתח service role** — הדפדפן מדבר ישירות עם Supabase בשם המשתמש המחובר, וכל ההרשאות נאכפות במסד (RLS) ובאחסון (storage policies).
- **בלי שלב build ובלי תלויות** — HTML/CSS/JS טהור. ה־client של Supabase כתוב בבית (`public/js/sbclient.js`) מעל ה־HTTP APIs, בלי CDN. גופנים מאוחסנים אצלנו ב־`public/fonts/` (Rubik, Assistant, רישיון OFL) ואינם נחשבים תלות.
- `public/privacy.html` חייב לשקף את מה שהאפליקציה עושה בפועל: כל שינוי באיסוף מידע, בהרשאות צפייה או בשירות חיצוני חדש → לעדכן את העמוד ואת התאריך בו.
- ממשק באנגלית, LTR (עבר מעברית ב־25.10.2026 לבקשת ענבר; אין מתג שפה). הודעות בין מאמן למתאמן יכולות להיות בכל שפה, ולכן טקסט שמשתמשים כתבו חייב להיות תקין בכל כתב.
- **מותג:** הכללים המלאים ב־`docs/brand-implementation.md`. הרקע (מי אנחנו, טון הכתיבה, השם, כיוון הלוגו ומה עוד לא הוחלט) ב־`docs/brand-book.md`, עותק טקסט של ספר המותג של ענבר. לקרוא את שניהם לפני עבודה על ממשק או טקסטים. בקצרה: רק ששת הצבעים (`--deep` #00432F, `--bottle` #006A4E, `--mint` #E3EFEA, לבן, `--red` #B3261E רק כטקסט על `--pale-red` #FBE9E7), שחור רק על משטחי וידאו. Rubik לכותרות, Assistant לכל השאר. רדיוס 16px או pill בלבד. מסך, סרגל עליון וניווט לבנים, כרטיסים במנטה, ומה שנבחר בירוק כהה עם טקסט לבן. סטטוס תמיד כולל מילה, לא רק צבע. **מצב כהה:** הצעה ב־`feature/dark-mode` (ממתינה לאישור ענבר; פירוט ב־brand-implementation.md). סגנונות חדשים משתמשים בטוקני התפקיד (`--bg`, `--surface`, `--text`, `--strong`...) ולא בצבעים ישירות.
- כל שינוי מצב בבקשות/ניתוחים/הודעות עובר דרך פונקציות `SECURITY DEFINER` במסד, שבודקות הרשאות בצד השרת.
- כלל עסקי לתשלום עתידי: חיוב **רק** ב־`send_analysis` (לא בבקשה, טיוטה, סירוב או פקיעה). תנאי המאמן נשמרים כ־snapshot בכל בקשה (`terms`).

## ארכיטקטורה
| שכבה | שירות | הערות |
|---|---|---|
| אירוח | Cloudflare Pages | `public/` + שתי פונקציות ב־`functions/api/` |
| Auth | Supabase Auth | מייל+סיסמה, שחזור סיסמה, Google (OAuth, מופעלים ב־Supabase → Providers; הוראות ב־README) |
| DB | Supabase Postgres | RLS, פונקציות RPC, pg_cron כל דקה לפקיעת בקשות |
| קבצים | Supabase Storage | דלי פרטי `media` (וידאו/קול/קאברים, עד 50MB, קישור חתום לשעה) + דלי ציבורי `avatars` (תמונות פרופיל, עד 2MB) |

משתני סביבה ב־Cloudflare Pages: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (מקבל גם `SUPABASE_ANON_KEY` ישן), ו־`ANTHROPIC_API_KEY` כסוד (Secret) למעבדת ה־AI. `/api/health` מראה אם חסר משהו.

## מבנה הקוד
```
docs/brand-implementation.md  כללי המותג: צבעים, גופנים, צורות, ריווח, כפתורים, תגיות
docs/brand-book.md            עותק טקסט של ספר המותג (artifact של ענבר): קהל, טון, שם, לוגו, החלטות פתוחות. כשהוא סותר את brand-implementation, brand-implementation קובע
public/
  index.html, privacy.html (מדיניות פרטיות, עמוד סטטי ציבורי ב־/privacy), app.css, _headers
  fonts/             Rubik + Assistant (woff2, לטינית ועברית) + רישיונות OFL
  js/app.js          ראוטר hash (#/home, #/r/<id> ...) + ניווט תחתון
  js/sbclient.js     client מינימלי ל־Supabase (auth/rest/rpc/storage)
  js/api.js          קריאות לפונקציות המסד
  js/ui.js, components.js   עזרי DOM ורכיבים (כולל בוחר שפות; analysisItem = תיבות הניתוח, זהות בעמוד הבקשה, בעמוד הסרטון ובשכבה מעל הפיד: ציטוט + שורות עם כפתור ניגון)
  js/theme.js        מראה (הגדרות): בהיר (ברירת מחדל) / כהה, נשמר ב־localStorage; סקריפט קטן ב־index.html מחיל לפני הציור הראשון
  js/images.js       תמונת פרופיל (avatar), קאבר לסרטון: בחירת פריים / העלאת תמונה / פריים אקראי
  js/feed-player.js  מסך מלא מהפיד: הקשה עוצרת/ממשיכה, החלקה למטה לסרטון הבא, ימינה לניתוח (תיבות שקופות-כהות מעל הסרטון העצור), שמאלה חזרה לסרטון
  js/viewer.js       צפייה מלאה של המאמן (מגע: הקפצה, האטה, עיפרון לפריים) + הצגת שרטוטים בניתוח (צפייה: מסילה קטנה מימין — ניגון, מהירות 1×/½×/¼×, צעד ‎0.1s). timeline() = ציר הזמן המשותף לשני הנגנים במסך מלא
  js/video-editor.js מסך עריכה אחרי בחירת סרטון: חיתוך התחלה/סוף (הקלטה מחדש בדפדפן), קאבר עם מסגרת 3:4 כמו בפרופיל, ✕/✓
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
  010_analysis_drawings.sql שרטוטי המאמן על הסרטון נשמרים עם הניתוח (סוג פריט 'drawing')
  011_social_login.sql כניסה עם Google: needs_setup + complete_signup; אישור 18+ ומדיניות פרטיות (profile_private.consented_at)
  012_delete_account.sql מחיקת חשבון עצמית (הגדרות): start_account_deletion → מחיקת קבצים בדפדפן → finish_account_deletion
tests/               בדיקות SQL (stubs ל־Supabase), פונקציות, ו־e2e בדפדפן
functions/_lib/ai-coach.js  הליבה של מאמן ה־AI (פרומפט, סכמה, קריאה ל־Claude, מחיר)
functions/api/ai-lab.js     מריץ ניתוח AI במעבדה (מנהלות בלבד, מפתח ה־API סוד ב־Cloudflare)
public/ai-coach/     כרטיסי התרגילים + coaching-decisions.md + index.json (node scripts/ai-cards-index.mjs אחרי שינוי)
public/js/pages/ailab.js    מסכי המעבדה (#/admin/lab, /new, /<id>) ופידבק ל־Claude (#/admin/feedback)
public/js/ai-player.js, ai-text.js  נגן המשוב על הסרטון (ציורים, עצירות, האטה, זום) ותצוגת הטקסט
lab/                 גרסה מקומית ישנה של המעבדה (node lab/server.mjs). ראו lab/README.md
```

## מודל הנתונים (עיקרי)
- `profiles` — role: `trainee` / `coach` / `admin`; למאמן `coach_status`: `pending` → `approved`/`rejected` (מאשרת המנהלת). משתמש יכול רק לבקש להיות מאמן (בהרשמה, או מההגדרות דרך `request_coach`), לעולם לא admin. שימו לב: הרשמה שנייה עם מייל שעוד לא אומת נבלעת ב־Supabase Auth בלי שגיאה, ולכן ההרשמה מזהה את זה ומפנה לבקשה מההגדרות. פרטים פרטיים (מייל/טלפון) ב־`profile_private`. כניסה ראשונה עם Google יוצרת פרופיל עם `needs_setup = true` (שם מהספק, שם משתמש זמני `user_...`); האפליקציה חוסמת הכול חוץ מ־`#/welcome` עד ש־`complete_signup` רץ פעם אחת (בוחרים שם משתמש, טלפון, שפות, ענפים; מאמן עובר דרך `request_coach`). הכפתורים מוצגים רק לספקים שמופעלים ב־Supabase (`/auth/v1/settings`).
- `sports`, `user_sports` (תחומי עניין), `coach_sports` (מה המאמן מאמן).
- `coach_settings` — `quota` (בקשות פתוחות במקביל, ברירת מחדל 3), `response_hours` (48), `followup_policy`: `none` / `one` / `chat24` / `unlimited`.
- `videos` — `visibility` private/public, `storage_key`, `cover_key` (קאבר, `set_video_cover`), `removed` (הוסר ע״י מנהלת).
- `profiles.avatar_key` (תמונת פרופיל בדלי הציבורי `avatars`, רק דרך `set_avatar`), `profiles.languages` (קודי ISO 639-1, נשאלים בהרשמה, עריכה בהגדרות).
- `analysis_requests` — סטטוסים: `pending` → `draft` → `completed`, או `declined` (סיבות: unclear / not_my_field / video_problem), או `expired` כשעובר `deadline_at`. רק pending/draft נספרים במכסה. נעילת `FOR UPDATE` על הגדרות המאמן מונעת חריגה מהמכסה במקביל.
- `analysis_items` — טקסט אחד + קבצי קול/וידאו של המאמן.
- `messages` (הודעות המשך, פרטיות לשני הצדדים), `notifications`, `comments`, `reports`, `app_settings`.
- מחיקת חשבון (`012`): מתאמן — נמחקים הסרטונים, הבקשות (כולל ניתוחי המאמנים עליהן), תגובות ודיווחים. מאמן — בקשות פתוחות נדחות (`decline_reason = 'coach_left'`), ניתוחים שהושלמו נשארים אצל המתאמן (טקסט, שרטוטים, הודעות) עם `coach_id`/`sender_id` = null ומוצגים כ־"Former coach" (`FORMER_COACH` ב־`images.js`), והקלטות הקול/וידאו נמחקות; הודעות המשך נסגרות (`COACH_LEFT`). מנהלת לא יכולה למחוק את עצמה. אם המחיקה נקטעה (`profiles.deleting_at`), האפליקציה משלימה אותה בכניסה הבאה. שימו לב: `coach_id` של בקשה יכול להיות null.

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
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f supabase/007_photos_languages_english.sql -f supabase/008_search.sql -f supabase/009_ai_lab.sql -f supabase/010_analysis_drawings.sql -f tests/drawings.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f supabase/007_photos_languages_english.sql -f supabase/008_search.sql -f supabase/009_ai_lab.sql -f supabase/010_analysis_drawings.sql -f supabase/011_social_login.sql -f tests/social_login.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f supabase/006_request_coach.sql -f supabase/007_photos_languages_english.sql -f supabase/008_search.sql -f supabase/009_ai_lab.sql -f supabase/010_analysis_drawings.sql -f supabase/011_social_login.sql -f supabase/012_delete_account.sql -f tests/delete_account.sql
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

### כשנעבור למסלולים בתשלום (כשתהיה תנועה)
- **מסך הכניסה של Google מציג את כתובת Supabase** ("continue to rrtdfvzoqlrsgxyuqeke.supabase.co") במקום CoachIt. הפתרון: Custom Domain ב־Supabase (מסלול Pro + תוסף, בערך $35 לחודש), ואז Branding verification ב־Google Cloud כדי שיופיעו השם והלוגו. חלופה חינמית, אם נרצה לפני כן: להעביר את הכניסה עם Google דרך האתר שלנו (`id_token` → `signInWithIdToken`) כדי שיוצג `coach-pilot-5jk.pages.dev`.
