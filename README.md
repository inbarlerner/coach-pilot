# פיילוט קואצ׳ינג — ניתוח סרטונים על ידי מאמנים

גרסת ניסיון עובדת: מתאמן מעלה סרטון, בוחר מאמן מאושר ומקבל ניתוח בטקסט, קול או וידאו, עם הודעות המשך לפי מדיניות המאמן.

## מבנה

| תיקייה | מה יש בה |
|---|---|
| `public/` | האתר עצמו (HTML, CSS, JavaScript ללא שלב בנייה). ממשק בעברית, RTL, שחור־לבן. |
| `functions/api/` | שתי פונקציות קטנות של Cloudflare Pages: מסירת כתובת Supabase והמפתח הציבורי לאתר, ובדיקת תקינות. |
| `supabase/` | קובצי ההקמה, לפי הסדר: סכמה והרשאות (001), משימה מתוזמנת (002), אחסון קבצים (003), מנהל ראשון (004), פינוי אוטומטי של אחסון (005). |
| `tests/` | בדיקות: מסד נתונים ואחסון (מסלול 1–12 + הרשאות קבצים), פונקציות שרת, ובדיקת ממשק מלאה בדפדפן. |

## שירותים — הכול במסלולים חינמיים, בלי כרטיס אשראי

- **Supabase** — התחברות (מייל וסיסמה, שחזור סיסמה), מסד נתונים עם הרשאות בצד השרת, משימה מתוזמנת שסוגרת בקשות שזמנן עבר, ו־**Storage** לסרטונים ולהקלטות.
- **Cloudflare Pages** — אירוח האתר.

### אחסון הקבצים (Supabase Storage)

- דלי פרטי בשם `media`, עד 50MB לקובץ, סוגי וידאו וקול בלבד (`003_storage.sql`).
- כל משתמש מעלה רק לתיקייה שלו. תגובות מאמן רק ממאמן מאושר.
- קריאת קובץ מותרת רק למי שמותר לו לראות את הסרטון או הניתוח שהקובץ שייך אליו. זה אותו כלל כמו בטבלאות. צפייה היא דרך קישור חתום שתקף לשעה.
- אין דריסת קבצים, ואי אפשר למחוק קובץ שעדיין בשימוש. האפליקציה רושמת קובץ רק אחרי שווידאה שהוא קיים באחסון, ולוקחת את הגודל והסוג האמיתיים מהאחסון.

### פינוי אוטומטי כשהאחסון מתמלא (`005_auto_cleanup.sql`)

- לפני כל העלאה נבדק אם השימוש יחד עם הקובץ החדש עובר את הגבול. הגבול הוא 900MB, מתחת ל־1GB של המסלול החינמי, ונשמר ב־`app_settings.storage_cap_bytes`.
- אם כן, נמחקים קודם קבצים שנשארו מהעלאות שלא הסתיימו, ואחר כך קובצי הסרטונים הישנים ביותר, עד שיש מקום.
- **נשמרים:** הבקשה, טקסט הניתוח והודעות ההמשך. נמחקים קובץ הסרטון וההקלטות של המאמן.
- סרטונים בבקשה פתוחה (ממתינה או טיוטה) לא נמחקים לעולם.
- בעל הסרטון מקבל התראה, והסרטון יוצא מהפיד.
- המנהלת רואה במסך הניהול כמה אחסון בשימוש.
- כדי לשנות את הגבול, למשל אחרי שדרוג מסלול: `update app_settings set value = <bytes> where key = 'storage_cap_bytes';`

## משתני סביבה (Cloudflare Pages ← Settings ← Variables and Secrets)

| שם | ערך |
|---|---|
| `SUPABASE_URL` | כתובת הפרויקט ב־Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | המפתח הציבורי (`sb_publishable_...`). מפתח `anon` ישן גם עובד. |

אין צורך במפתח השירות (service role) של Supabase. כל פעולה רצה בשם המשתמש המחובר, והמסד והאחסון מחליטים מה מותר.

## כניסה עם Google (`011_social_login.sql`)

הכפתור "Continue with Google" מופיע במסכי הכניסה וההרשמה **רק אחרי** שמפעילים את Google ב־Supabase, כך שאפשר להעלות את הקוד לפני שההגדרות מוכנות. אין צורך בכרטיס אשראי בשום שלב.

כשמישהו נכנס בפעם הראשונה עם Google, השם נלקח מהחשבון שלו, והוא מגיע למסך "Finish signing up" כדי למלא את מה שחסר: שם משתמש, טלפון, שפות, ענפי ספורט, ואם הוא מאמן גם ביוגרפיה וענפים (ואז הוא ממתין לאישור המנהלת כרגיל). מי שכבר רשום במייל ונכנס עם Google באותו מייל מגיע לאותו חשבון (Supabase מחבר ביניהם).

**1. מסד הנתונים:** Supabase ← SQL Editor ← להריץ את `supabase/011_social_login.sql`.

**2. כתובות:** Supabase ← Authentication ← URL Configuration:
- Site URL: `https://coach-pilot-5jk.pages.dev`
- Redirect URLs: להוסיף `https://coach-pilot-5jk.pages.dev/**`

כתובת החזרה (תצטרכו אותה למטה) מופיעה ב־Supabase בעמוד ההגדרות של Google, בצורה `https://<project-ref>.supabase.co/auth/v1/callback`.

**3. Google:**
1. [Google Cloud Console](https://console.cloud.google.com/) ← פרויקט חדש (או קיים).
2. APIs & Services ← OAuth consent screen (Google Auth Platform): סוג External, שם האפליקציה, מייל תמיכה. הרשאות: `openid`, `email`, `profile` בלבד.
3. Credentials ← Create credentials ← OAuth client ID ← Web application:
   - Authorized JavaScript origins: `https://coach-pilot-5jk.pages.dev`
   - Authorized redirect URIs: כתובת ה־callback של Supabase מלמעלה.
4. להעתיק Client ID ו־Client Secret ← Supabase ← Authentication ← Sign In / Providers ← Google ← Enable, להדביק, Save.
5. כל עוד המסך במצב Testing רק משתמשי בדיקה שהוספתם יכולים להיכנס. כדי לפתוח לכולם: Audience ← Publish app. עם ההרשאות הבסיסיות האלה (ובלי לוגו) לא נדרש תהליך אימות של Google.

## מדיניות פרטיות וגיל 18+

- `public/privacy.html` — עמוד סטטי ציבורי (בלי JavaScript ובלי התחברות, כדי ש־Google יוכל לקרוא אותו). Cloudflare מגיש אותו בכתובת `/privacy`. איש קשר: `coachitapp@gmail.com`.
- **לעדכן את העמוד בכל פעם שמשתנה מה שהאפליקציה אוספת, מי רואה מה, או לאילו שירותים נשלח מידע** (ולשנות את התאריך למעלה).
- בהרשמה (במייל וגם במסך "Finish signing up") חובה לסמן "I am 18 or older and I agree to the Privacy Policy". זמן האישור נשמר ב־`profile_private.consented_at`. משתמשים שנרשמו לפני השינוי לא אישרו.
- **מחיקת חשבון** (`012_delete_account.sql`, להריץ ב־SQL Editor אחרי 011): הגדרות ← Delete account (מקלידים DELETE). בלי מפתח service role: המסד מוחק את נתוני האפליקציה ומחזיר רשימת קבצים, הדפדפן מוחק אותם מהאחסון, ואז המסד מוחק את המשתמש מ־`auth.users`. מאמן שמחק את החשבון מופיע אצל המתאמנים כ־"Former coach". בקשות מחיקה במייל (`coachitapp@gmail.com`) מטפלים ידנית תוך 30 יום. מנהלת לא יכולה למחוק את עצמה מהאפליקציה.
- זו טיוטה סבירה לפיילוט, לא ייעוץ משפטי. לפני השקה ציבורית כדאי שעורך/ת דין יעבור/תעבור עליה.

## מגבלות פיילוט

- 50MB לכל קובץ: סרטון, הקלטת קול או הקלטת וידאו. המגבלה נאכפת בדפדפן ובאחסון עצמו.
- הקלטת וידאו של מאמן נעצרת אוטומטית אחרי 5 דקות, והקלטת קול אחרי 15 דקות.
- במסלול החינמי של Supabase: 1GB אחסון כולל, ופרויקט ללא פעילות שבוע נכנס להשהיה.

## בדיקות

```
node tests/functions.test.mjs
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f tests/acceptance.sql
psql -f tests/supabase_stub.sql -f tests/storage_stub.sql -f supabase/001_schema.sql -f supabase/003_storage.sql -f supabase/005_auto_cleanup.sql -f tests/cleanup.sql
python3 tests/e2e/acceptance_ui.py   # ממשק מלא בדפדפן מול Supabase Auth + PostgREST מקומיים ואמולטור אחסון (tests/e2e/server.mjs)
```

כלל עסקי לתשלום עתידי: חיוב רק בשליחת ניתוח (`send_analysis`). לא בבקשה, בטיוטה, בסירוב או בפקיעת זמן. תנאי המאמן נשמרים בכל בקשה (`terms`).
