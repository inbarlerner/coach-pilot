"""End-to-end UI test of the spec's 12-step acceptance flow, through the real screens,
with separate browser sessions per account. Runs against tests/e2e/server.mjs stack.
python3 tests/e2e/acceptance_ui.py
"""
import subprocess, re, os, sys, time, urllib.request, json
from playwright.sync_api import sync_playwright, expect

SITE = 'http://127.0.0.1:8788'
VIDEO = '/var/tmp/e2e/test.webm'  # open-source Chromium has no H.264; real browsers play MP4/MOV
BIG = '/var/tmp/e2e/big.mp4'   # 52MB dummy file for the size-limit check
SHOTS = os.environ.get('SHOTS', '/var/tmp/e2e/shots')
os.makedirs(SHOTS, exist_ok=True)
PW = 'Passw0rd!x'
results = []

def sql(q):
    return subprocess.run(['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', 'e2e', '-Atc', q],
                          capture_output=True, text=True, check=True).stdout.strip()

def ok(cond, label):
    results.append((bool(cond), label))
    print(('PASS: ' if cond else 'FAIL: ') + label, flush=True)
    if not cond: raise AssertionError(label)

def shot(page, name):
    page.screenshot(path=f'{SHOTS}/{name}.png', full_page=False)

def goto(page, route):
    target = SITE + '/#' + route
    if page.url == target: page.reload()
    else: page.goto(target)
    page.wait_for_load_state('networkidle')

def signup(page, role, first, last, user, email, sports=('קייטסרפינג',), coach_sports=(), bio=''):
    goto(page, f'/signup?as={role}')
    page.get_by_label('שם פרטי').fill(first)
    page.get_by_label('שם משפחה').fill(last)
    page.get_by_label('שם משתמש').fill(user)
    page.get_by_label('מייל').fill(email)
    page.get_by_label('טלפון').fill('050-1234567')
    page.get_by_label('סיסמה').fill(PW)
    groups = page.locator('.field').filter(has_text='ענפי ספורט שמעניינים אותי')
    for s in sports: groups.locator('label.chip', has_text=s).click()
    if role == 'coach':
        cg = page.locator('.field').filter(has_text='ענפים שבהם אני מאמן/ת')
        for s in coach_sports: cg.locator('label.chip', has_text=s).click()
        page.get_by_label('תיאור מקצועי קצר').fill(bio)
    page.locator('button[type=submit]').click()

def login(page, email):
    goto(page, '/login')
    page.get_by_label('מייל').fill(email)
    page.get_by_label('סיסמה').fill(PW)
    page.get_by_role('button', name='כניסה').click()
    page.wait_for_url(re.compile(r'#/(home|upload)'))

def upload_to_coach(page, title, coach_name, visibility='private', question='למה אני נופל ביציאה מהג׳יב?'):
    goto(page, '/upload')
    page.locator('label.choice', has_text='מאמן אנושי').click()
    page.get_by_role('button', name='המשך').click()
    page.set_input_files('#u_file', VIDEO)
    page.select_option('#u_sport', label='קייטסרפינג')
    page.get_by_label('שם התרגיל').fill(title)
    page.get_by_label('תיאור (לא חובה)').fill('רוח 18 קשר, קייט 9')
    page.get_by_label('שאלה ישירה למאמן').fill(question)
    page.locator('label.choice', has_text=coach_name).click()
    if visibility == 'public': page.locator('label.choice', has_text='ציבורי').last.click()
    page.get_by_role('button', name='העלאה ושליחה למאמן').click()
    expect(page.get_by_text('הבקשה נשלחה למאמן')).to_be_visible(timeout=20000)
    page.get_by_role('link', name='צפייה בבקשה').click()
    page.wait_for_url(re.compile(r'#/r/'))
    return page.url.split('#/r/')[1]

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    def ctx():
        c = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='he-IL',
                                permissions=['microphone', 'camera'])
        pg = c.new_page()
        pg.on('pageerror', lambda e: print('  [page error]', e, flush=True))
        return pg
    admin, coach, trainee, third = ctx(), ctx(), ctx(), ctx()

    # ---- setup: first admin (signs up normally, then promoted from the SQL editor) ----
    signup(admin, 'trainee', 'מנהלת', 'פיילוט', 'admin1', 'admin@pilot.test')
    admin.wait_for_url(re.compile(r'#/upload'))
    sql("update profiles set role='admin' where username='admin1'")

    # ===== 1. Coach signs up; admin approves =====
    signup(coach, 'coach', 'דנה', 'כהן', 'dana.coach', 'dana@pilot.test', coach_sports=('קייטסרפינג', 'פאדל'), bio='מאמנת קייטסרפינג 10 שנים, מדריכה מוסמכת.')
    coach.wait_for_url(re.compile(r'#/home'))
    expect(coach.get_by_text('ממתין לאישור מנהל').first).to_be_visible()
    shot(coach, '01-coach-pending')
    ok(sql("select coach_status from profiles where username='dana.coach'") == 'pending', '1a coach registered as pending')
    # self-promotion attempt from the browser is refused server-side
    res = coach.evaluate("""async () => { const t = JSON.parse(localStorage.getItem('pilot.session.v1')).access_token;
      const r = await fetch('http://127.0.0.1:8000/rest/v1/profiles?username=eq.dana.coach', {method:'PATCH', headers:{apikey:'x', authorization:'Bearer '+t, 'content-type':'application/json'}, body: JSON.stringify({coach_status:'approved', role:'admin'})});
      return r.status; }""")
    ok(res in (401, 403) and sql("select role||coach_status from profiles where username='dana.coach'") == 'coachpending', f'1b coach cannot approve/promote self (HTTP {res})')

    admin.reload(); goto(admin, '/admin')
    expect(admin.get_by_text('דנה כהן')).to_be_visible()
    shot(admin, '02-admin-coach-requests')
    admin.locator('.card', has_text='דנה כהן').get_by_role('button', name='אישור').click()
    admin.locator('.modal').get_by_role('button', name='אישור').click()
    expect(admin.get_by_text('אין בקשות הצטרפות ממתינות')).to_be_visible()
    ok(sql("select coach_status from profiles where username='dana.coach'") == 'approved', '1c admin approved coach')

    # ===== 2. Coach sets quota, response time and follow-up policy =====
    goto(coach, '/settings')
    coach.get_by_label('מכסת בקשות פעילות').fill('2')
    coach.get_by_label('זמן תגובה מחייב (שעות)').fill('24')
    coach.locator('label.choice', has_text='הודעת המשך אחת').click()
    shot(coach, '03-coach-settings')
    coach.get_by_role('button', name='שמירת הגדרות מאמן').click()
    expect(coach.get_by_text('הגדרות המאמן נשמרו')).to_be_visible()
    ok(sql("select quota||'/'||response_hours||'/'||followup_policy from coach_settings c join profiles p on p.id=c.coach_id where username='dana.coach'") == '2/24/one', '2 settings saved (quota 2, 24h, one follow-up)')

    # ===== 3. Trainee signs up → first-time upload screen; uploads a PRIVATE video =====
    signup(trainee, 'trainee', 'יואב', 'לוי', 'yoav', 'yoav@pilot.test')
    trainee.wait_for_url(re.compile(r'#/upload\?welcome=1'))
    expect(trainee.get_by_role('link', name='דילוג לעמוד הבית')).to_be_visible()
    shot(trainee, '04-first-upload-welcome')
    ok(True, '3a first login opens upload screen with "skip to home"')
    # 50MB limit: clear message before anything is uploaded
    goto(trainee, '/upload')
    trainee.locator('label.choice', has_text='פרסום / שמירה בפרופיל שלי').click()
    trainee.get_by_role('button', name='המשך').click()
    expect(trainee.get_by_text('עד 50MB לסרטון')).to_be_visible()
    trainee.set_input_files('#u_file', BIG)
    expect(trainee.get_by_text('הקובץ גדול מדי: 52MB. המקסימום הוא 50MB לסרטון')).to_be_visible()
    shot(trainee, '04b-too-large')
    ok(trainee.get_by_text('לא נבחר קובץ').count() == 1, 'L1 file over 50MB rejected with a clear message, before upload')
    big_status = trainee.evaluate("""async () => { const t = JSON.parse(localStorage.getItem('pilot.session.v1')).access_token;
      const uid = JSON.parse(atob(t.split('.')[1])).sub;
      const r = await fetch('http://127.0.0.1:8000/storage/v1/object/media/videos/' + uid + '/' + crypto.randomUUID() + '.mp4',
        {method:'POST', headers:{apikey:'x', authorization:'Bearer '+t, 'content-type':'video/mp4'}, body: new Uint8Array(51*1048576)});
      return r.status; }""")
    ok(big_status == 413, f'L2 storage itself refuses a file over 50MB even if the page is bypassed (HTTP {big_status})')

    # ===== 4. Trainee selects the coach and sends =====
    r1 = upload_to_coach(trainee, 'ג׳יבינג לשמאל', 'דנה כהן')
    shot(trainee, '05-request-sent-trainee')
    ok(sql(f"select v.visibility from analysis_requests r join videos v on v.id=r.video_id where r.id='{r1}'") == 'private', '3b/4 private video uploaded and sent to coach')
    ok(sql(f"select terms->>'followup_policy' from analysis_requests where id='{r1}'") == 'one', '4b terms snapshot saved with request')

    # ===== 5. Request appears in coach inbox =====
    goto(coach, '/inbox')
    card = coach.locator('a.card', has_text='ג׳יבינג לשמאל')
    expect(card).to_be_visible()
    expect(card.get_by_text('לא נקראה')).to_be_visible()
    shot(coach, '06-coach-inbox')
    ok(True, '5 request in coach inbox (unread)')

    # ===== 6. Coach saves a draft, comes back, sends =====
    card.click()
    coach.wait_for_url(re.compile(r'#/r/'))
    expect(coach.locator('video').first).to_be_visible()
    coach.get_by_role('button', name='חצי מהירות').click()
    ok(coach.evaluate("document.querySelector('video').playbackRate") == 0.5, '6a half-speed tool works')
    coach.get_by_role('button', name='רבע מהירות').click()
    ok(coach.evaluate("document.querySelector('video').playbackRate") == 0.25, '6b quarter-speed tool works')
    coach.get_by_label('טקסט').fill('הכתף הקדמית נפתחת מוקדם מדי. החזק את הבר קרוב לגוף.')
    coach.get_by_role('button', name='שמירת טיוטה').click()
    expect(coach.get_by_text('הטיוטה נשמרה')).to_be_visible()
    ok(sql(f"select status from analysis_requests where id='{r1}'") == 'draft', '6c draft saved')
    goto(coach, '/inbox'); coach.locator('a.card', has_text='ג׳יבינג לשמאל').click()
    expect(coach.get_by_label('טקסט')).to_have_value(re.compile('הכתף הקדמית'))
    ok(True, '6d draft text restored after leaving and returning')
    # voice recording with (fake) microphone
    coach.get_by_role('button', name='התחלת הקלטת קול').click()
    expect(coach.get_by_text('מקליט…')).to_be_visible()
    coach.wait_for_timeout(2200)
    coach.get_by_role('button', name='עצירת הקלטה').click()
    coach.get_by_role('button', name='שמירת ההקלטה').click()
    expect(coach.get_by_text('הקלטת הקול נשמרה בטיוטה')).to_be_visible(timeout=15000)
    shot(coach, '07-coach-workspace')
    ok(sql(f"select count(*) from analysis_items where request_id='{r1}' and kind='audio'") == '1', '6e voice recording uploaded and attached')
    coach.get_by_role('button', name='שליחת פענוח').click()
    coach.locator('.modal').get_by_role('button', name='שליחה').click()
    expect(coach.get_by_text('הפענוח נשלח למתאמן')).to_be_visible()
    ok(sql(f"select status from analysis_requests where id='{r1}'") == 'completed', '6f analysis sent → completed')

    # ===== 7. Trainee receives analysis and sends ONE follow-up =====
    goto(trainee, '/notifications')
    expect(trainee.get_by_text('התקבל ניתוח מ־דנה כהן')).to_be_visible()
    shot(trainee, '08-trainee-notifications')
    trainee.get_by_text('התקבל ניתוח מ־דנה כהן').click()
    trainee.wait_for_url(re.compile(r'#/r/'))
    expect(trainee.get_by_text('הכתף הקדמית נפתחת מוקדם מדי')).to_be_visible()
    trainee.get_by_role('button', name='האזנה').click()
    expect(trainee.locator('audio')).to_be_visible()
    trainee.wait_for_function("document.querySelector('audio') && document.querySelector('audio').readyState >= 1", timeout=10000)
    ok(True, '7a trainee sees text and plays the voice note (served from protected storage)')
    trainee.get_by_label('הודעה').fill('תודה! ומה עם הרגל האחורית?')
    trainee.get_by_role('button', name='שליחה').click()
    trainee.locator('.modal').get_by_role('button', name='שליחה').click()
    expect(trainee.get_by_text('שלחת את הודעת ההמשך היחידה')).to_be_visible()
    shot(trainee, '09-trainee-analysis-followup')
    ok(True, '7b one follow-up sent; composer closed')

    # ===== 8. Coach replies; trainee cannot send again =====
    goto(coach, '/r/' + r1)
    expect(coach.get_by_text('ומה עם הרגל האחורית')).to_be_visible()
    coach.get_by_label('הודעה').fill('כופף את הברך האחורית ושים יותר משקל עליה.')
    coach.get_by_role('button', name='שליחה').click()
    expect(coach.get_by_text('השבת להודעת ההמשך')).to_be_visible()
    goto(trainee, '/r/' + r1)
    expect(trainee.get_by_text('כופף את הברך האחורית')).to_be_visible()
    ok(trainee.get_by_label('הודעה').count() == 0, '8a trainee has no message box after reply')
    blocked = trainee.evaluate(f"""async () => {{ const t = JSON.parse(localStorage.getItem('pilot.session.v1')).access_token;
      const r = await fetch('http://127.0.0.1:8000/rest/v1/rpc/send_message', {{method:'POST', headers:{{apikey:'x', authorization:'Bearer '+t, 'content-type':'application/json'}}, body: JSON.stringify({{p_request:'{r1}', p_body:'עוד אחת'}})}});
      return (await r.json()).message; }}""")
    ok('ONE_USED' in (blocked or ''), '8b server also refuses a second follow-up (' + str(blocked) + ')')

    # ===== 9. Declined request → "not completed" box =====
    r2 = upload_to_coach(trainee, 'טאק לימין', 'דנה כהן')
    goto(coach, '/r/' + r2)
    coach.get_by_role('button', name='לא יכול לנתח').click()
    coach.locator('.modal label.choice', has_text='סרטון לא ברור').click()
    coach.locator('.modal').get_by_role('button', name='אישור סירוב').click()
    expect(coach.get_by_text('הבקשה סורבה').first).to_be_visible()
    goto(trainee, '/inbox')
    trainee.get_by_role('tab', name='בקשות שלא הושלמו').click()
    expect(trainee.locator('a.card', has_text='טאק לימין').get_by_text('סיבה: סרטון לא ברור')).to_be_visible()
    shot(trainee, '10-trainee-not-completed')
    ok(True, '9 declined request in "not completed" with reason (trainee side)')
    goto(coach, '/inbox'); coach.get_by_role('tab', name='בקשות שלא הושלמו').click()
    expect(coach.locator('a.card', has_text='טאק לימין')).to_be_visible()
    ok(True, '9b also in coach "not completed"')

    # ===== 10. Expired request → same box, quota freed =====
    r3 = upload_to_coach(trainee, 'קפיצה', 'דנה כהן')
    r4 = upload_to_coach(trainee, 'שיוט', 'דנה כהן')
    goto(trainee, '/search')
    expect(trainee.locator('.card', has_text='דנה כהן').get_by_role('button', name='אין מקום פנוי')).to_be_disabled()
    ok(True, '10a coach shown as full at quota (2/2)')
    sql(f"update analysis_requests set deadline_at = now() - interval '1 minute' where id='{r3}'")
    sql("select expire_requests()")   # what the every-minute scheduled job runs
    goto(trainee, '/inbox'); trainee.get_by_role('tab', name='בקשות שלא הושלמו').click()
    expect(trainee.locator('a.card', has_text='קפיצה').get_by_text('המאמן לא הגיב בזמן')).to_be_visible()
    goto(trainee, '/search')
    expect(trainee.locator('.card', has_text='דנה כהן').get_by_role('link', name='שליחת סרטון לניתוח')).to_be_visible()
    ok(True, '10b expired request moved to "not completed" and freed quota')
    goto(coach, '/r/' + r3)
    ok(coach.get_by_role('button', name='שליחת פענוח').count() == 0, '10c no way to send analysis after expiry')

    # ===== 11. Private video not reachable by a third account, even by direct link =====
    signup(third, 'trainee', 'נועה', 'צד', 'noa', 'noa@pilot.test', sports=('פאדל',))
    third.wait_for_url(re.compile(r'#/upload'))
    vid1 = sql(f"select video_id from analysis_requests where id='{r1}'")
    goto(third, '/v/' + vid1)
    expect(third.get_by_text('הסרטון לא נמצא, או שהוא פרטי')).to_be_visible()
    goto(third, '/r/' + r1)
    expect(third.get_by_text('הבקשה לא נמצאה')).to_be_visible()
    key = sql(f"select storage_key from videos where id='{vid1}'")
    res = third.evaluate(f"""async () => {{ const t = JSON.parse(localStorage.getItem('pilot.session.v1')).access_token;
      const H = {{apikey:'x', authorization:'Bearer '+t, 'content-type':'application/json'}};
      const sign = await fetch('http://127.0.0.1:8000/storage/v1/object/sign/media/{key}', {{method:'POST', headers:H, body: JSON.stringify({{expiresIn:60}})}});
      const auth = await fetch('http://127.0.0.1:8000/storage/v1/object/authenticated/media/{key}', {{headers:H}});
      const pub = await fetch('http://127.0.0.1:8000/storage/v1/object/public/media/{key}');
      const forged = await fetch('http://127.0.0.1:8000/storage/v1/object/sign/media/{key}?token=9999999999.deadbeef');
      return [sign.status, auth.status, pub.status, forged.status]; }}""")
    ok(all(x >= 400 for x in res), f'11a third account gets no link and no file for the private video: sign/auth/public/forged = {res}')
    gone = third.evaluate(f"""async () => {{ const t = JSON.parse(localStorage.getItem('pilot.session.v1')).access_token;
      const r = await fetch('http://127.0.0.1:8000/storage/v1/object/media', {{method:'DELETE', headers:{{apikey:'x', authorization:'Bearer '+t, 'content-type':'application/json'}}, body: JSON.stringify({{prefixes:['{key}']}})}});
      return (await r.json()).length; }}""")
    ok(gone == 0 and sql(f"select count(*) from storage.objects where name='{key}'") == '1', '11b third account cannot delete the private video file')
    shot(third, '11-third-blocked')

    # ===== 12. Public → feed & portfolio; back to private → removed =====
    goto(trainee, '/v/' + vid1)
    trainee.get_by_role('button', name='הפיכה לציבורי').click()
    trainee.locator('.modal').get_by_role('button', name='הפיכה לציבורי').click()
    expect(trainee.get_by_text('הסרטון ציבורי עכשיו')).to_be_visible()
    goto(third, '/home')
    item = third.locator('article.feed-item', has_text='ג׳יבינג לשמאל')
    expect(item).to_be_visible()
    expect(item.get_by_text('דנה כהן')).to_be_visible()
    shot(third, '12-feed-public')
    item.get_by_role('link', name='צפייה בניתוח').click()
    expect(third.get_by_text('הכתף הקדמית נפתחת מוקדם מדי')).to_be_visible()
    ok(third.get_by_text('ומה עם הרגל האחורית').count() == 0, '12a public analysis visible to others; follow-up messages stay private')
    third.get_by_label('תגובה חדשה').fill('ניתוח מעולה!')
    third.get_by_role('button', name='פרסום תגובה').click()
    expect(third.get_by_text('ניתוח מעולה!')).to_be_visible()
    goto(third, '/u/dana.coach')
    third.get_by_role('tab', name='ניתוחים שלי').click()
    expect(third.locator('a.tile', has_text='ג׳יבינג לשמאל')).to_be_visible()
    shot(third, '13-coach-profile-portfolio')
    ok(True, '12b public video + analysis in feed and coach portfolio; comments work')
    goto(trainee, '/v/' + vid1)
    trainee.get_by_role('button', name='הפיכה לפרטי').click()
    trainee.locator('.modal').get_by_role('button', name='הפיכה לפרטי').click()
    expect(trainee.get_by_text('הסרטון פרטי עכשיו')).to_be_visible()
    goto(third, '/home')
    expect(third.locator('article.feed-item', has_text='ג׳יבינג לשמאל')).to_have_count(0)
    goto(third, '/u/dana.coach'); third.get_by_role('tab', name='ניתוחים שלי').click()
    expect(third.locator('a.tile', has_text='ג׳יבינג לשמאל')).to_have_count(0)
    ok(True, '12c switching to private removes it from feed and portfolio')

    # ---- persistence: reload / logout / login ----
    trainee.reload(); goto(trainee, '/me'); trainee.get_by_role('tab', name='פרטי').click()
    expect(trainee.locator('a.tile', has_text='ג׳יבינג לשמאל')).to_be_visible()
    shot(trainee, '14-trainee-profile-private')
    trainee.get_by_role('button', name='יציאה').click()
    trainee.wait_for_url(re.compile(r'#/login'))
    login(trainee, 'yoav@pilot.test')
    ok('#/home' in trainee.url, 'P1 returning trainee lands on home (not upload)')
    goto(trainee, '/inbox')
    trainee.get_by_role('tab', name='הושלמו', exact=True).click()
    expect(trainee.locator('a.card', has_text='ג׳יבינג לשמאל')).to_be_visible()
    ok(True, 'P2 data persists after refresh, logout and login')

    # ---- password recovery through real auth server + email ----
    goto(trainee, '/settings'); trainee.get_by_role('button', name='יציאה').click()
    trainee.wait_for_url(re.compile(r'#/login'))
    goto(trainee, '/forgot'); trainee.get_by_label('מייל').fill('yoav@pilot.test')
    before = set(os.listdir('/var/tmp/e2e/mail'))
    trainee.get_by_role('button', name='שליחת קישור לאיפוס').click()
    expect(trainee.get_by_text('נשלח אליו קישור לאיפוס')).to_be_visible()
    mail = None
    for _ in range(30):
        new = set(os.listdir('/var/tmp/e2e/mail')) - before
        if new: mail = open('/var/tmp/e2e/mail/' + sorted(new)[0]).read(); break
        time.sleep(0.3)
    import quopri
    body = quopri.decodestring(mail.encode()).decode('utf-8', 'replace')
    link = re.search(r'href="([^"]+/verify[^"]+)"', body).group(1).replace('&amp;', '&')
    trainee.goto(link)
    trainee.wait_for_url(re.compile(r'#/reset'))
    trainee.get_by_label('סיסמה חדשה').fill('NewPassw0rd!')
    trainee.get_by_label('אימות סיסמה').fill('NewPassw0rd!')
    trainee.get_by_role('button', name='שמירת סיסמה חדשה').click()
    expect(trainee.get_by_text('הסיסמה עודכנה')).to_be_visible()
    ok(True, 'R1 password recovery email → reset page → new password saved')

    # ---- automatic cleanup when storage is full (005_auto_cleanup.sql) ----
    sql("update app_settings set value = storage_used_bytes() where key = 'storage_cap_bytes'")   # storage is "full"
    oldest = sql(f"select video_id from analysis_requests where id='{r1}'")
    goto(trainee, '/upload')
    trainee.locator('label.choice', has_text='פרסום / שמירה בפרופיל שלי').click()
    trainee.get_by_role('button', name='המשך').click()
    expect(trainee.get_by_text('הסרטונים הישנים ביותר נמחקים אוטומטית')).to_be_visible()
    trainee.set_input_files('#u_file', VIDEO)
    trainee.select_option('#u_sport', label='קייטסרפינג')
    trainee.get_by_label('שם התרגיל').fill('סרטון חדש כשהאחסון מלא')
    trainee.get_by_role('button', name='העלאה ושמירה').click()
    expect(trainee.get_by_text('הסרטון נשמר')).to_be_visible(timeout=20000)
    ok(sql(f"select file_deleted_at is not null from videos where id='{oldest}'") == 't'
       and sql(f"select count(*) from videos where file_deleted_at is not null") == '1', 'U1 storage full → only the oldest video without an open request was cleaned up')
    ok(sql(f"select count(*) from storage.objects o join videos v on v.storage_key = o.name where v.id='{oldest}'") == '0', 'U2 its file is really gone from storage')
    goto(trainee, '/v/' + oldest)
    expect(trainee.get_by_text('הסרטון נמחק אוטומטית כדי לפנות מקום באחסון')).to_be_visible()
    expect(trainee.get_by_text('הכתף הקדמית נפתחת מוקדם מדי')).to_be_visible()
    expect(trainee.get_by_text('ההקלטה נמחקה אוטומטית')).to_be_visible()
    shot(trainee, '17-cleaned-up-video')
    ok(trainee.get_by_role('button', name='שליחה למאמן לניתוח').count() == 0 and trainee.get_by_role('button', name='מחיקת הסרטון').count() == 1,
       'U3 the video page explains the removal, keeps the analysis text, and offers only "delete"')
    goto(trainee, '/notifications')
    expect(trainee.get_by_text('נמחק אוטומטית כדי לפנות מקום')).to_be_visible()
    ok(True, 'U4 owner notified')
    sql("update app_settings set value = 943718400 where key = 'storage_cap_bytes'")

    goto(admin, '/admin')
    expect(admin.get_by_text(re.compile(r'אחסון קבצים: \d+MB מתוך 900MB'))).to_be_visible()
    ok(True, 'A0 admin sees storage usage')
    admin.get_by_role('tab', name='משתמשים').click()
    admin.locator('.card', has_text='נועה צד').get_by_role('button', name='השבתת חשבון').click()
    admin.locator('.modal').get_by_role('button', name='אישור').click()
    expect(admin.locator('.card', has_text='נועה צד').get_by_text('מושבת')).to_be_visible()
    third.reload(); third.wait_for_load_state('networkidle')
    expect(third.get_by_text('החשבון הושבת').first).to_be_visible()
    ok(True, 'A1 admin can disable an account')

    # desktop screenshots
    desk = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='he-IL').new_page()
    login(desk, 'dana@pilot.test')
    goto(desk, '/r/' + r1); desk.wait_for_timeout(800); shot(desk, '15-desktop-request')
    goto(desk, '/home'); desk.wait_for_timeout(500); shot(desk, '16-desktop-home')
    browser.close()

passed = sum(1 for r in results if r[0])
print(f'\n{passed}/{len(results)} UI acceptance checks passed')
