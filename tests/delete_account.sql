-- Deleting your own account (012_delete_account.sql).
-- Run on a fresh DB after the stubs, 001, 003, 005–012.
\set ON_ERROR_STOP 1
\set ad  '''00000000-0000-0000-0000-0000000000d1'''
\set tr  '''00000000-0000-0000-0000-0000000000d2'''
\set co  '''00000000-0000-0000-0000-0000000000d3'''
\set c2  '''00000000-0000-0000-0000-0000000000d4'''
\set t2  '''00000000-0000-0000-0000-0000000000d5'''

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;
create or replace function pg_temp.fails(sql text, needle text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) > 0 then raise notice 'PASS: % (blocked: %)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % — wrong error: %', label, sqlerrm; end;
  raise exception 'FAIL: % — was allowed', label;
end $$;
grant execute on function pg_temp.fails(text, text, text) to authenticated;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false); $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;
create or replace function pg_temp.put(p_bucket text, p_name text, p_type text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, p_name, auth.uid()::text, jsonb_build_object('size', 1000, 'mimetype', p_type));
$$;
grant execute on function pg_temp.put(text, text, text) to authenticated;
-- What the browser does with the list: remove each file through storage, as the user (storage rules apply)
create or replace function pg_temp.remove_files(f jsonb) returns void language sql as $$
  delete from storage.objects where bucket_id = 'media' and name in (select jsonb_array_elements_text(f->'media'));
  delete from storage.objects where bucket_id = 'avatars' and name in (select jsonb_array_elements_text(f->'avatars'));
$$;
grant execute on function pg_temp.remove_files(jsonb) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
 (:ad, 'ad@x.test', '{"first_name":"Ada","last_name":"A","username":"ada"}'),
 (:tr, 'tr@x.test', '{"first_name":"Tom","last_name":"T","username":"tom","sports":["1"]}'),
 (:co, 'co@x.test', '{"first_name":"Dana","last_name":"C","username":"dana","role":"coach","coach_sports":["1"]}'),
 (:c2, 'c2@x.test', '{"first_name":"Eli","last_name":"C","username":"eli","role":"coach","coach_sports":["1"]}'),
 (:t2, 't2@x.test', '{"first_name":"Gal","last_name":"T","username":"gal","sports":["1"]}');
update profiles set role = 'admin' where id = :ad;
update profiles set coach_status = 'approved' where id in (:co, :c2);

-- Trainee Tom: public video v1 with a cover and a profile photo; requests r1 → Dana, r3 → Eli
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('media', 'videos/' || :tr || '/30000000-0000-0000-0000-000000000001.mp4', 'video/mp4');
select create_video('videos/' || :tr || '/30000000-0000-0000-0000-000000000001.mp4', 'video/mp4', 1000, 1, 'Jump', '', 'public') as v1 \gset
select pg_temp.put('media', 'covers/' || :tr || '/30000000-0000-0000-0000-0000000000c1.jpg', 'image/jpeg');
select set_video_cover(:'v1', 'covers/' || :tr || '/30000000-0000-0000-0000-0000000000c1.jpg');
select pg_temp.put('avatars', :tr || '/30000000-0000-0000-0000-0000000000a1.jpg', 'image/jpeg');
select set_avatar(:tr || '/30000000-0000-0000-0000-0000000000a1.jpg');
select create_request(:'v1', :co, 'How is my pop?') as r1 \gset
select pg_temp.put('media', 'videos/' || :tr || '/30000000-0000-0000-0000-000000000003.mp4', 'video/mp4');
select create_video('videos/' || :tr || '/30000000-0000-0000-0000-000000000003.mp4', 'video/mp4', 1000, 1, 'Jibe', '', 'private') as v3 \gset
select create_request(:'v3', :c2, 'Jibe?') as r3 \gset
reset role;

-- Gal: public video v2, open request r2 → Dana; Tom comments on it
select pg_temp.as_user(:t2); set role authenticated;
select pg_temp.put('media', 'videos/' || :t2 || '/30000000-0000-0000-0000-000000000002.mp4', 'video/mp4');
select create_video('videos/' || :t2 || '/30000000-0000-0000-0000-000000000002.mp4', 'video/mp4', 1000, 1, 'Loop', '', 'public') as v2 \gset
select create_request(:'v2', :co, 'Loop?') as r2 \gset
reset role;
select pg_temp.as_user(:tr); set role authenticated;
insert into comments (video_id, author_id, body) values (:'v2', auth.uid(), 'Nice!');
reset role;

-- Dana answers r1 (text + voice + drawings), starts a draft on r2; Eli starts a draft on r3
select pg_temp.as_user(:co); set role authenticated;
select pg_temp.put('media', 'responses/' || :co || '/30000000-0000-0000-0000-0000000000b1.webm', 'audio/webm');
select add_analysis_media(:'r1', 'audio', 'responses/' || :co || '/30000000-0000-0000-0000-0000000000b1.webm', 'audio/webm');
select set_analysis_text(:'r1', 'Load the board before you pop.');
select save_drawings(:'r1', '{"strokes":[{"t":1,"pts":[[0.1,0.1],[0.2,0.2]]}],"notes":[]}');
select send_analysis(:'r1');
select pg_temp.put('media', 'responses/' || :co || '/30000000-0000-0000-0000-0000000000b2.webm', 'audio/webm');
select add_analysis_media(:'r2', 'audio', 'responses/' || :co || '/30000000-0000-0000-0000-0000000000b2.webm', 'audio/webm');
reset role;
select pg_temp.as_user(:c2); set role authenticated;
select pg_temp.put('media', 'responses/' || :c2 || '/30000000-0000-0000-0000-0000000000b3.webm', 'audio/webm');
select add_analysis_media(:'r3', 'audio', 'responses/' || :c2 || '/30000000-0000-0000-0000-0000000000b3.webm', 'audio/webm');
reset role;
-- follow-up messages on r1 (policy 'one': trainee asks, coach replies)
select pg_temp.as_user(:tr); set role authenticated; select send_message(:'r1', 'Thanks! Front foot too?'); reset role;
select pg_temp.as_user(:co); set role authenticated; select send_message(:'r1', 'Yes, a bit more.'); reset role;

-- ---------- Who cannot ----------
select pg_temp.as_user(:ad); set role authenticated;
select pg_temp.fails($$select start_account_deletion()$$, 'ADMIN_CANNOT_DELETE', 'X1 admin cannot delete their account');
reset role;
select pg_temp.as_user(:t2); set role authenticated;
select pg_temp.fails($$select finish_account_deletion()$$, 'DELETION_NOT_STARTED', 'X2 finish needs a started deletion');
select pg_temp.fails($$update profiles set deleting_at = now() where id = auth.uid()$$, 'permission denied', 'X3 users cannot set the deletion flag');
select pg_temp.fails($$select account_files(auth.uid())$$, 'permission denied', 'X4 file listing is internal');
reset role;
select pg_temp.fails($$set role anon; select start_account_deletion()$$, 'permission denied', 'X5 anonymous blocked');
reset role;

-- ---------- Coach Dana deletes her account (Option A) ----------
select pg_temp.as_user(:co); set role authenticated;
select start_account_deletion() as dana_files \gset
select pg_temp.ok(jsonb_array_length((:'dana_files'::jsonb)->'media') = 2, 'C1 both of Dana''s recordings are listed for removal');
select pg_temp.fails($$select finish_account_deletion()$$, 'FILES_REMAIN', 'C2 cannot finish while files are left');
reset role;
select pg_temp.ok((select status = 'declined' and decline_reason = 'coach_left' from analysis_requests where id = :'r2'), 'C3 open request cancelled');
select pg_temp.ok(exists (select 1 from notifications where user_id = :t2 and request_id = :'r2' and type = 'declined' and body like '%closed their Coachit account%'), 'C4 trainee of the open request told');
select pg_temp.ok((select count(*) = 0 from analysis_items where request_id = :'r2'), 'C5 draft work on the open request removed');
select pg_temp.ok((select array_agg(kind::text order by kind) = '{drawing,text}' from analysis_items where request_id = :'r1'), 'C6 completed analysis keeps text and drawings, voice removed');
select pg_temp.ok((select deleting_at is not null from profiles where id = :co), 'C7 profile flagged as deleting');

select pg_temp.as_user(:co); set role authenticated;
select pg_temp.remove_files(:'dana_files'::jsonb);
select pg_temp.ok(jsonb_array_length(start_account_deletion()->'media') = 0, 'C8 files removed through the storage rules; running step 1 again is safe');
select finish_account_deletion();
reset role;
select pg_temp.ok(not exists (select 1 from auth.users where id = :co) and not exists (select 1 from profiles where id = :co), 'C9 Dana''s login and profile are gone');
select pg_temp.ok((select coach_id is null and status = 'completed' from analysis_requests where id = :'r1'), 'C10 Tom keeps the completed analysis, from a former coach');
select pg_temp.ok((select count(*) = 2 and count(*) filter (where sender_id is null) = 1 from messages where request_id = :'r1'), 'C11 messages kept, Dana''s reply now from a former coach');
select pg_temp.ok((select coach_id is null from analysis_requests where id = :'r2'), 'C12 cancelled request stays in Gal''s history');

select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.ok((select count(*) = 2 from analysis_items where request_id = :'r1'), 'C13 Tom can still read the analysis');
select pg_temp.ok((select reason = 'COACH_LEFT' and not can_send from followup_state(:'r1')), 'C14 follow-ups closed');
select pg_temp.fails($$select send_message('$$ || :'r1' || $$', 'Hello?')$$, 'COACH_LEFT', 'C15 cannot message a deleted coach');
reset role;

-- ---------- Trainee Tom deletes his account ----------
select pg_temp.as_user(:tr); set role authenticated;
select start_account_deletion() as tom_files \gset
reset role;
select pg_temp.ok(jsonb_array_length((:'tom_files'::jsonb)->'media') = 4, 'T1 Tom''s two videos, the cover and Eli''s recording on his request are listed');
select pg_temp.ok((:'tom_files'::jsonb)->'avatars' = jsonb_build_array(:tr || '/30000000-0000-0000-0000-0000000000a1.jpg'), 'T2 profile photo listed');
select pg_temp.ok(not exists (select 1 from videos where owner_id = :tr) and not exists (select 1 from analysis_requests where trainee_id = :tr), 'T3 videos and requests deleted');
select pg_temp.ok(not exists (select 1 from comments where author_id = :tr), 'T4 his comments on other videos deleted');
select pg_temp.ok(exists (select 1 from notifications where user_id = :c2 and type = 'request_removed'), 'T5 coach of the open request told');
select pg_temp.ok((select coach_active_count(:c2)) = 0, 'T6 coach''s quota freed');
select pg_temp.ok((select avatar_key is null from profiles where id = :tr), 'T7 photo unlinked so it can be removed');

select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.ok(start_account_deletion() = :'tom_files'::jsonb, 'T8 running step 1 again lists the same files');
select pg_temp.remove_files(:'tom_files'::jsonb);
reset role;
select pg_temp.ok(not exists (select 1 from storage.objects where name like '%' || :tr || '%' or name like 'responses/' || :c2 || '/%'), 'T9 all of Tom''s files removed, including Eli''s recording');
select pg_temp.as_user(:tr); set role authenticated;
select finish_account_deletion();
reset role;
select pg_temp.ok(not exists (select 1 from auth.users where id = :tr) and not exists (select 1 from profile_private where id = :tr), 'T10 Tom''s login, profile and private details are gone');
select pg_temp.ok(exists (select 1 from videos where id = :'v2') and exists (select 1 from profiles where id = :t2), 'T11 other users untouched');

\echo ALL DELETE ACCOUNT TESTS PASSED
