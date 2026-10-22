-- Automatic cleanup (005_auto_cleanup.sql). Run on a fresh DB after the stubs, 001, 003 and 005.
\set ON_ERROR_STOP 1
\set tr  '''00000000-0000-0000-0000-0000000000a1'''
\set co  '''00000000-0000-0000-0000-0000000000c1'''
\set up  '''00000000-0000-0000-0000-0000000000b2'''

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
-- upload as the current user with a given size (MB)
create or replace function pg_temp.put(p_name text, p_mime text, p_mb int) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('media', p_name, auth.uid()::text, jsonb_build_object('size', p_mb::bigint * 1048576, 'mimetype', p_mime));
$$;
grant execute on function pg_temp.put(text, text, int) to authenticated;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false); $$;

insert into auth.users (id, email, raw_user_meta_data) values
 (:tr, 'tr@x.test', '{"first_name":"מתאמן","last_name":"א","username":"tra","sports":["1"]}'),
 (:co, 'co@x.test', '{"first_name":"מאמנת","last_name":"ב","username":"cob","role":"coach","coach_sports":["1"]}'),
 (:up, 'up@x.test', '{"first_name":"מעלה","last_name":"ג","username":"upc","sports":["1"]}');
update profiles set coach_status = 'approved' where id = :co;
update coach_settings set quota = 10 where coach_id = :co;

-- Three 285MB videos by the trainee + a 10MB coach recording = 865MB used; cap is 900MB.
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000001.mp4', 'video/mp4', 285);
select create_video('videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000001.mp4','video/mp4',0,1,'הכי ישן','','public') as v1 \gset
select pg_temp.put('videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000002.mp4', 'video/mp4', 285);
select create_video('videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000002.mp4','video/mp4',0,1,'שני','','public') as v2 \gset
select pg_temp.put('videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000003.mp4', 'video/mp4', 285);
select create_video('videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000003.mp4','video/mp4',0,1,'שלישי','','private') as v3 \gset
-- v1 has an OPEN request (must be protected); v2 has a COMPLETED analysis with text + voice
select create_request(:'v1', :co, 'שאלה פתוחה') as r1 \gset
select create_request(:'v2', :co, 'שאלה') as r2 \gset
reset role;
update videos set created_at = now() - interval '3 days' where id = :'v1';
update videos set created_at = now() - interval '2 days' where id = :'v2';
update videos set created_at = now() - interval '1 days' where id = :'v3';

select pg_temp.as_user(:co); set role authenticated;
select pg_temp.put('responses/00000000-0000-0000-0000-0000000000c1/20000000-0000-0000-0000-000000000001.webm', 'audio/webm', 10);
select set_analysis_text(:'r2', 'הניתוח בטקסט — חייב להישמר');
select add_analysis_media(:'r2', 'audio', 'responses/00000000-0000-0000-0000-0000000000c1/20000000-0000-0000-0000-000000000001.webm', 'audio/webm');
select send_analysis(:'r2');
reset role;
select pg_temp.as_user(:tr); set role authenticated;
select send_message(:'r2', 'הודעת המשך — חייבת להישמר');
reset role;

-- ===== Under the cap: nothing happens =====
select pg_temp.as_user(:up); set role authenticated;
select pg_temp.ok(cardinality(make_room(1048576)) = 0, 'C1 under the cap nothing is deleted');
select pg_temp.fails($$select make_room(60 * 1048576)$$, 'BAD_SIZE', 'C2 cannot ask to free more than one file''s worth (50MB)');
-- a forgotten 5MB file from an old, unfinished upload
select pg_temp.put('videos/00000000-0000-0000-0000-0000000000b2/30000000-0000-0000-0000-000000000001.mp4', 'video/mp4', 5);
reset role;
update storage.objects set created_at = now() - interval '2 hours' where name like '%30000000-0000-0000-0000-000000000001%';

-- ===== New 50MB upload would pass 900MB → cleanup =====
select pg_temp.as_user(:up); set role authenticated;
select make_room(50 * 1048576) as keys \gset
select pg_temp.ok(:'keys'::text[] @> array['videos/00000000-0000-0000-0000-0000000000b2/30000000-0000-0000-0000-000000000001.mp4'], 'C3 leftover files are cleared first');
select pg_temp.ok(:'keys'::text[] @> array['videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000002.mp4',
                                          'responses/00000000-0000-0000-0000-0000000000c1/20000000-0000-0000-0000-000000000001.webm'],
                  'C4 the oldest video without an open request loses its file and the coach''s recording');
select pg_temp.ok(not (:'keys'::text[] && array['videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000001.mp4']), 'C5 the even older video in an OPEN request is protected');
select pg_temp.ok(not (:'keys'::text[] && array['videos/00000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-000000000003.mp4']), 'C6 only as much as needed is deleted (newer video kept)');
-- the uploader removes the released files through storage (as the app does)
delete from storage.objects where name = any(:'keys'::text[]);
reset role;
select pg_temp.ok((select count(*) from storage.objects where name = any(:'keys'::text[])) = 0, 'C7 released files can be removed by the uploader');
select pg_temp.ok(storage_used_bytes() + 50 * 1048576 <= 943718400, 'C8 there is now room for the new upload');
select pg_temp.ok((select file_deleted_at is not null from videos where id = :'v2'), 'C9 video kept as a record, marked "file removed"');
select pg_temp.ok((select count(*) from analysis_items where request_id = :'r2' and kind = 'text' and body like 'הניתוח בטקסט%') = 1, 'C10 analysis TEXT kept');
select pg_temp.ok((select count(*) from messages where request_id = :'r2') = 1, 'C11 follow-up messages kept');
select pg_temp.ok((select status from analysis_requests where id = :'r2') = 'completed', 'C12 request history kept');
select pg_temp.ok((select count(*) from notifications where user_id = :tr and type = 'file_cleanup' and body like '%שני%') = 1, 'C13 owner notified');
select pg_temp.as_user(:up); set role authenticated;
select pg_temp.ok((select count(*) from get_feed(null, 50, 0) where video_id = :'v2') = 0, 'C14 cleaned-up video leaves the feed');
select pg_temp.ok((select count(*) from get_feed(null, 50, 0) where video_id = :'v1') = 1, 'C15 other public videos stay in the feed');
select pg_temp.fails($$select admin_storage_usage()$$, 'FORBIDDEN', 'C16 storage usage is admin-only');
-- other users still cannot delete files that are in use
delete from storage.objects where name like '%10000000-0000-0000-0000-000000000003%';
reset role;
select pg_temp.ok((select count(*) from storage.objects where name like '%10000000-0000-0000-0000-000000000003%') = 1, 'C17 files in use are still protected from deletion');
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.fails($$select create_request('$$ || :'v2' || $$', '00000000-0000-0000-0000-0000000000c1', '')$$, 'FILE_REMOVED', 'C18 a cleaned-up video cannot be sent for analysis');
reset role;
\echo ALL_CLEANUP_CHECKS_PASSED
