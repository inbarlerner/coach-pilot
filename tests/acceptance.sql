-- Acceptance flow (spec section 16) against the real schema, separate accounts.
-- Run: psql -v ON_ERROR_STOP=1 -f tests/acceptance.sql
\set ON_ERROR_STOP 1
\set admin   '''00000000-0000-0000-0000-00000000000a'''
\set coach   '''00000000-0000-0000-0000-00000000000c'''
\set trainee '''00000000-0000-0000-0000-00000000000b'''
\set third   '''00000000-0000-0000-0000-00000000000d'''
\set coach2  '''00000000-0000-0000-0000-00000000000e'''

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;

-- Expect a function call to fail with an error containing `needle`
create or replace function pg_temp.fails(sql text, needle text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) > 0 then raise notice 'PASS: % (blocked: %)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % — wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL: % — was allowed', label;
end $$;
grant execute on function pg_temp.fails(text, text, text) to authenticated;

-- ---------- Signups (as Supabase Auth would) ----------
insert into auth.users (id, email, raw_user_meta_data) values
 (:admin,   'admin@x.test',  '{"first_name":"מנהלת","last_name":"ראשית","username":"admin1","phone":"050","sports":["1"]}'),
 (:coach,   'coach@x.test',  '{"first_name":"דנה","last_name":"מאמנת","username":"dana","phone":"051","role":"coach","bio":"מאמנת קייט","sports":["1"],"coach_sports":["1","4"]}'),
 (:trainee, 'tr@x.test',     '{"first_name":"יואב","last_name":"מתאמן","username":"yoav","phone":"052","sports":["1"]}'),
 (:third,   'third@x.test',  '{"first_name":"שלישי","last_name":"צד","username":"third","phone":"053","sports":["4"]}'),
 (:coach2,  'c2@x.test',     '{"first_name":"רון","last_name":"מאמן","username":"ron","role":"coach","coach_sports":["4"]}');
-- someone tries to sign up as admin via metadata → still trainee
insert into auth.users (email, raw_user_meta_data) values ('evil@x.test','{"username":"evil","role":"admin"}');
select pg_temp.ok((select role from profiles where username='evil') = 'trainee', 'signup cannot request admin');

-- first admin is made from the SQL editor (003_first_admin.sql)
update profiles set role='admin' where id = :admin;

-- ======== 1. Coach signs up (pending) and admin approves ========
select pg_temp.ok((select coach_status from profiles where id=:coach) = 'pending', '1a coach starts pending');

select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from search_coaches('', null)) = 0, '1b pending coach not listed');
select pg_temp.fails($$update profiles set coach_status='approved' where id=auth.uid()$$, 'permission denied', '1c coach cannot self-approve');
select pg_temp.fails($$update profiles set role='admin' where id=auth.uid()$$, 'permission denied', '1d user cannot self-promote to admin');
select pg_temp.fails($$select admin_set_coach_status(auth.uid(),'approved')$$, 'FORBIDDEN', '1e non-admin cannot call approve');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :admin)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from profile_private) = 6, '1f admin sees join details (emails/phones)');
select admin_set_coach_status(:coach, 'approved');
select admin_set_coach_status(:coach2, 'approved');
reset role;
select pg_temp.ok((select coach_status from profiles where id=:coach) = 'approved', '1g coach approved');

-- ======== 2. Coach sets quota, response time, follow-up policy ========
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
update coach_settings set quota = 2, response_hours = 24, followup_policy = 'one' where coach_id = auth.uid();
select pg_temp.ok((select quota from coach_settings where coach_id=:coach) = 2, '2 coach settings saved');
update coach_settings set quota=50 where coach_id=:coach2;
reset role;
select pg_temp.ok((select quota from coach_settings where coach_id=:coach2) = 3, '2b cannot edit another coach''s settings');

-- ======== 3. Trainee uploads a private video ========
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from profile_private) = 1, '3a trainee sees only own private contact info');
select pg_temp.fails($$select create_video('videos/00000000-0000-0000-0000-00000000000c/x.mp4','video/mp4',10,1,'t','', 'private')$$, 'BAD_KEY', '3b cannot register someone else''s file');
select create_video('videos/00000000-0000-0000-0000-00000000000b/v1.mp4','video/mp4',1000,1,'ג׳יבינג','נפילה ביציאה','private') as v1 \gset
select create_video('videos/00000000-0000-0000-0000-00000000000b/v2.mp4','video/mp4',1000,1,'קפיצה','', 'private') as v2 \gset
select create_video('videos/00000000-0000-0000-0000-00000000000b/v3.mp4','video/mp4',1000,1,'טאק','', 'private') as v3 \gset
select create_video('videos/00000000-0000-0000-0000-00000000000b/v4.mp4','video/mp4',1000,1,'שיוט','', 'private') as v4 \gset
select pg_temp.ok((select visibility from videos where id=:'v1') = 'private', '3c video saved private by default choice');

-- ======== 4. Trainee picks coach (approved, has room) and sends ========
select pg_temp.ok((select available from search_coaches('דנה', 1)) , '4a coach searchable by name+sport and available');
select create_request(:'v1', :coach, 'למה אני נופל ביציאה?') as r1 \gset
select pg_temp.ok((select terms->>'followup_policy' from analysis_requests where id=:'r1') = 'one', '4b terms snapshot stored');
reset role;

-- Coach changes settings later → existing request keeps snapshot
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
update coach_settings set followup_policy='unlimited', response_hours=72 where coach_id=auth.uid();
select pg_temp.ok((select followup_policy from analysis_requests where id=:'r1') = 'one'
               and (select response_hours from analysis_requests where id=:'r1') = 24, '4c later settings change does not alter request');
update coach_settings set followup_policy='one', response_hours=24 where coach_id=auth.uid();

-- ======== 5. Request shows in coach inbox (unread, new-request notification) ========
select pg_temp.ok((select count(*) from analysis_requests where coach_id=auth.uid() and status='pending' and not coach_read) = 1, '5a request in coach inbox, unread');
select pg_temp.ok((select count(*) from notifications where type='new_request') = 1, '5b coach notified');
select pg_temp.ok(can_view_video(:'v1'), '5c coach can view the private video sent to them');

-- ======== 6. Coach saves draft, returns, sends ========
select pg_temp.fails($$select send_analysis('$$ || :'r1' || $$')$$, 'EMPTY_ANALYSIS', '6a cannot send empty analysis');
select set_analysis_text(:'r1', 'שים לב לכתף הקדמית');
select save_draft(:'r1');
select pg_temp.ok((select status from analysis_requests where id=:'r1') = 'draft', '6b draft saved');
select pg_temp.ok(coach_active_count(:coach) = 1, '6c draft still occupies quota');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from analysis_items where request_id=:'r1') = 0, '6d trainee cannot see unsent draft');
reset role;
-- X discard: deletes work, back to unread, deadline unchanged
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select deadline_at as dl_before from analysis_requests where id=:'r1' \gset
select discard_draft(:'r1');
select pg_temp.ok((select status='pending' and not coach_read and deadline_at = :'dl_before'::timestamptz from analysis_requests where id=:'r1')
               and (select count(*) from analysis_items where request_id=:'r1') = 0, '6e X discards work, unread, deadline kept');
-- redo and send, with text + audio
select set_analysis_text(:'r1', 'שים לב לכתף הקדמית');
select add_analysis_media(:'r1','audio','responses/00000000-0000-0000-0000-00000000000c/a1.webm','audio/webm');
select save_draft(:'r1');
select send_analysis(:'r1');
select pg_temp.ok((select status from analysis_requests where id=:'r1') = 'completed', '6f analysis sent → completed');
select pg_temp.ok(coach_active_count(:coach) = 0, '6g sending frees quota');
select pg_temp.fails($$select set_analysis_text('$$ || :'r1' || $$','x')$$, 'NOT_OPEN', '6h completed analysis is locked');
reset role;

-- ======== 7. Trainee receives analysis and sends ONE follow-up ========
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from notifications where type='analysis_received') = 1, '7a trainee notified');
select pg_temp.ok((select count(*) from analysis_items where request_id=:'r1') = 2, '7b trainee sees text + audio');
select send_message(:'r1', 'תודה! ומה עם הרגליים?');
reset role;

-- ======== 8. Coach replies; trainee cannot send another ========
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from notifications where type='followup_message') = 1, '8a coach notified of follow-up');
select send_message(:'r1', 'כופף ברכיים יותר');
select pg_temp.fails($$select send_message('$$ || :'r1' || $$','עוד משהו')$$, 'ONE_REPLIED', '8b coach gets one reply only');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from notifications where type='coach_reply') = 1, '8c trainee notified of reply');
select pg_temp.fails($$select send_message('$$ || :'r1' || $$','ועוד שאלה')$$, 'ONE_USED', '8d trainee cannot send a second follow-up');

-- ======== 9. Declined request → not-completed box with reason ========
select create_request(:'v2', :coach, 'שאלה') as r2 \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select decline_request(:'r2', 'unclear');
select pg_temp.ok((select status='declined' and decline_reason='unclear' from analysis_requests where id=:'r2'), '9a declined with reason');
select pg_temp.ok(coach_active_count(:coach) = 0, '9b decline frees quota');
select pg_temp.fails($$select send_analysis('$$ || :'r2' || $$')$$, 'NOT_OPEN', '9c cannot analyse after decline');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from notifications where type='declined') = 1, '9d trainee notified of decline');
select pg_temp.ok((select count(*) from analysis_requests where id=:'r2') = 1, '9e request content kept');

-- ======== quota: full coach blocks new requests ========
select create_request(:'v3', :coach, '') as r3 \gset
select create_request(:'v4', :coach, '') as r4 \gset
select pg_temp.ok(not (select available from search_coaches('dana', null)), 'Q1 coach shows as full at quota');
select create_video('videos/00000000-0000-0000-0000-00000000000b/v5.mp4','video/mp4',1000,1,'עוד','', 'private') as v5 \gset
select pg_temp.fails($$select create_request('$$ || :'v5' || $$','00000000-0000-0000-0000-00000000000c','')$$, 'COACH_FULL', 'Q2 full coach rejects new request');
select pg_temp.fails($$select create_request('$$ || :'v5' || $$','00000000-0000-0000-0000-00000000000d','')$$, 'COACH_NOT_AVAILABLE', 'Q3 cannot send to a non-coach');
reset role;

-- ======== 10. Expired request → not-completed box, frees quota, no late send ========
-- simulate time passing for r3 (cron would run expire_requests() every minute)
update analysis_requests set deadline_at = now() - interval '1 minute' where id = :'r3';
select expire_requests();
select pg_temp.ok((select status from analysis_requests where id=:'r3') = 'expired', '10a overdue request expired by scheduled job (no user logged in)');
select pg_temp.ok(coach_active_count(:coach) = 1, '10b expiry frees quota');
select pg_temp.ok((select count(*) from notifications where type='expired' and request_id=:'r3') = 2, '10c both sides notified');
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select pg_temp.fails($$select set_analysis_text('$$ || :'r3' || $$','late')$$, 'EXPIRED', '10d no analysis after expiry');
-- lazy expiry path: deadline passes between cron runs
reset role;
update analysis_requests set deadline_at = now() - interval '1 second' where id = :'r4';
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select pg_temp.fails($$select send_analysis('$$ || :'r4' || $$')$$, 'EXPIRED', '10e send blocked the instant the deadline passes');
reset role;
select expire_requests();   -- next cron tick
select pg_temp.ok((select status from analysis_requests where id=:'r4') = 'expired', '10f expiry recorded on next scheduled run');

-- ======== 11. Private video not accessible to a third account ========
select set_config('request.jwt.claims', json_build_object('sub', :third)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from videos where id=:'v1') = 0, '11a third account cannot select private video (direct id)');
select pg_temp.ok(not can_view_video(:'v1'), '11b file-URL permission check denies third account');
select pg_temp.ok((select count(*) from analysis_requests where id=:'r1') = 0, '11c third account cannot see the request');
select pg_temp.ok((select count(*) from analysis_items where request_id=:'r1') = 0, '11d nor the analysis');
select pg_temp.ok((select count(*) from get_feed(null, 50, 0)) = 0, '11e feed shows no private content');
update videos set visibility='public' where id=:'v1';
reset role;
select pg_temp.ok((select visibility from videos where id=:'v1') = 'private', '11f non-owner cannot change visibility');

-- ======== 12. Public video + analysis in feed & portfolio; private again removes ========
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
update videos set visibility='public' where id=:'v1';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :third)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from get_feed(null,50,0) f where f.video_id=:'v1' and f.coach_name is not null) = 1, '12a public video + coach analysis in feed');
select pg_temp.ok((select count(*) from analysis_items where request_id=:'r1') = 2, '12b third account can view public analysis');
select pg_temp.ok((select count(*) from messages where request_id=:'r1') = 0, '12c follow-up messages stay private');
-- coach portfolio query ("ניתוחים שלי") = completed requests by coach on public videos
select pg_temp.ok((select count(*) from analysis_requests r join videos v on v.id=r.video_id
                   where r.coach_id=:coach and r.status='completed' and v.visibility='public') = 1, '12d appears in coach portfolio');
insert into comments (video_id, author_id, body) values (:'v1', auth.uid(), 'יפה!');
select pg_temp.ok((select comment_count from get_feed(null,50,0) where video_id=:'v1') = 1, '12e text comment added');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
update videos set visibility='private' where id=:'v1';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :third)::text, false); set role authenticated;
select pg_temp.ok((select count(*) from get_feed(null,50,0) where video_id=:'v1') = 0, '12f private again → gone from feed');
select pg_temp.ok((select count(*) from analysis_requests r join videos v on v.id=r.video_id
                   where r.coach_id=:coach and r.status='completed' and v.visibility='public') = 0, '12g gone from coach portfolio');
select pg_temp.ok((select count(*) from analysis_items where request_id=:'r1') = 0, '12h analysis no longer visible to others');
reset role;

-- ======== Admin moderation & disabled accounts ========
select set_config('request.jwt.claims', json_build_object('sub', :admin)::text, false); set role authenticated;
select admin_set_disabled(:third, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :third)::text, false); set role authenticated;
select pg_temp.fails($$select create_video('videos/00000000-0000-0000-0000-00000000000d/q.mp4','video/mp4',1,1,'q','','private')$$, 'ACCOUNT_DISABLED', 'A1 disabled account cannot act');
reset role;

-- ======== Owner deletes video ========
select set_config('request.jwt.claims', json_build_object('sub', :third)::text, false); set role authenticated;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :coach)::text, false); set role authenticated;
select pg_temp.fails($$select delete_video('$$ || :'v2' || $$')$$, 'NOT_FOUND', 'D1 non-owner cannot delete');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :trainee)::text, false); set role authenticated;
select pg_temp.ok(array_length(delete_video(:'v1'), 1) = 2, 'D2 owner deletes video; returns files to remove (video + audio)');
reset role;
\echo ALL_ACCEPTANCE_CHECKS_PASSED
