-- Profile photos, video covers, spoken languages, English texts (007_photos_languages_english.sql).
-- Run on a fresh DB after the stubs, 001, 003, 005, 006 and 007.
\set ON_ERROR_STOP 1
\set tr  '''00000000-0000-0000-0000-0000000000e1'''
\set co  '''00000000-0000-0000-0000-0000000000e2'''
\set ot  '''00000000-0000-0000-0000-0000000000e3'''

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
-- "Upload" a file as the current user (same row Supabase Storage writes, subject to the storage rules)
create or replace function pg_temp.put(p_bucket text, p_name text, p_mime text, p_size int default 1000) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, p_name, auth.uid()::text, jsonb_build_object('size', p_size, 'mimetype', p_mime));
$$;
grant execute on function pg_temp.put(text, text, text, int) to authenticated;
create or replace function pg_temp.can_read(p_name text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'media' and name = p_name);
$$;
grant execute on function pg_temp.can_read(text) to authenticated;

-- ---------- Signup saves languages; bad values are dropped ----------
insert into auth.users (id, email, raw_user_meta_data) values
 (:tr, 'tr@x.test', '{"first_name":"Yoav","last_name":"B","username":"yoav","sports":["1"],"languages":["en","he","nl"]}'),
 (:co, 'co@x.test', '{"first_name":"Dana","last_name":"C","username":"dana","role":"coach","coach_sports":["1"],"languages":["nl","EN!!"]}'),
 (:ot, 'ot@x.test', '{"first_name":"Other","last_name":"D","username":"other","sports":["1"]}');
update profiles set coach_status = 'approved' where id = :co;
select pg_temp.ok((select languages = '{en,he,nl}' from profiles where id = :tr), 'L1 signup saves languages');
select pg_temp.ok((select languages = '{nl}' from profiles where id = :co), 'L2 invalid language codes are dropped');
select pg_temp.ok((select languages = '{}' from profiles where id = :ot), 'L3 no languages → empty list');
select pg_temp.ok((select name from sports where id = 1) = 'Kitesurfing', 'E1 default sports renamed to English');

-- ---------- Languages: editable by owner only, validated ----------
select pg_temp.as_user(:tr); set role authenticated;
update profiles set languages = '{en,fr}' where id = auth.uid();
select pg_temp.fails($$update profiles set languages = '{english}' where id = auth.uid()$$, 'profiles_languages_check', 'L4 language codes are validated');
update profiles set languages = '{de}' where id = :co;   -- RLS: not my row, no effect
reset role;
select pg_temp.ok((select languages = '{en,fr}' from profiles where id = :tr), 'L5 user edits own languages');
select pg_temp.ok((select languages = '{nl}' from profiles where id = :co), 'L6 cannot edit someone else''s languages');

-- ---------- Profile photo ----------
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('avatars', :tr || '/a0000000-0000-0000-0000-000000000001.jpg', 'image/jpeg');
select pg_temp.fails($$select pg_temp.put('avatars', '$$ || :co || $$/a0000000-0000-0000-0000-000000000002.jpg', 'image/jpeg')$$, 'row-level security', 'P1 cannot upload into someone else''s photo folder');
select pg_temp.fails($$update profiles set avatar_key = 'x' where id = auth.uid()$$, 'permission denied', 'P2 avatar_key only through set_avatar');
select pg_temp.fails($$select set_avatar('$$ || :co || $$/a0000000-0000-0000-0000-000000000002.jpg')$$, 'BAD_KEY', 'P3 cannot use someone else''s photo');
select pg_temp.fails($$select set_avatar('$$ || :tr || $$/a0000000-0000-0000-0000-000000000009.jpg')$$, 'FILE_NOT_FOUND', 'P4 photo must exist in storage');
select pg_temp.ok(set_avatar(:tr || '/a0000000-0000-0000-0000-000000000001.jpg') is null, 'P5 first photo set, nothing to remove');
-- the photo in use cannot be deleted
delete from storage.objects where bucket_id = 'avatars' and name = :tr || '/a0000000-0000-0000-0000-000000000001.jpg';
reset role;
select pg_temp.ok(exists (select 1 from storage.objects where bucket_id = 'avatars' and name = :tr || '/a0000000-0000-0000-0000-000000000001.jpg'), 'P6 current photo cannot be deleted');
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('avatars', :tr || '/a0000000-0000-0000-0000-000000000003.png', 'image/png');
select pg_temp.ok(set_avatar(:tr || '/a0000000-0000-0000-0000-000000000003.png') = :tr || '/a0000000-0000-0000-0000-000000000001.jpg', 'P7 replacing returns the old photo to remove');
delete from storage.objects where bucket_id = 'avatars' and name = :tr || '/a0000000-0000-0000-0000-000000000001.jpg';
reset role;
select pg_temp.ok(not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = :tr || '/a0000000-0000-0000-0000-000000000001.jpg'), 'P8 old photo can be removed');
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.ok(set_avatar(null) = :tr || '/a0000000-0000-0000-0000-000000000003.png', 'P9 photo can be cleared');
reset role;

-- ---------- Video cover ----------
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('media', 'videos/' || :tr || '/10000000-0000-0000-0000-000000000001.mp4', 'video/mp4');
select create_video('videos/' || :tr || '/10000000-0000-0000-0000-000000000001.mp4', 'video/mp4', 1000, 1, 'Jibe', '', 'private') as v1 \gset
select pg_temp.put('media', 'covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg', 'image/jpeg');
select pg_temp.put('media', 'covers/' || :tr || '/c0000000-0000-0000-0000-000000000002.jpg', 'image/jpeg', 5000000);
select pg_temp.fails($$select set_video_cover('$$ || :'v1' || $$', 'covers/$$ || :tr || $$/c0000000-0000-0000-0000-000000000002.jpg')$$, 'TOO_LARGE', 'C1 cover over 3MB rejected');
select pg_temp.fails($$select set_video_cover('$$ || :'v1' || $$', 'videos/$$ || :tr || $$/10000000-0000-0000-0000-000000000001.mp4')$$, 'BAD_KEY', 'C2 cover must be in the covers folder');
select pg_temp.ok(set_video_cover(:'v1', 'covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg') is null, 'C3 owner sets cover');
reset role;
select pg_temp.as_user(:ot); set role authenticated;
select pg_temp.fails($$select set_video_cover('$$ || :'v1' || $$', 'covers/$$ || :ot || $$/c0000000-0000-0000-0000-000000000003.jpg')$$, 'NOT_FOUND', 'C4 only the owner sets the cover');
select pg_temp.ok(not pg_temp.can_read('covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg'), 'C5 cover of a private video is hidden from others');
reset role;
-- coach who receives the video can see the cover
select pg_temp.as_user(:tr); set role authenticated;
select create_request(:'v1', :co, '') as r1 \gset
reset role;
select pg_temp.as_user(:co); set role authenticated;
select pg_temp.ok(pg_temp.can_read('covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg'), 'C6 coach on the request can see the cover');
reset role;
select pg_temp.ok((select body like 'New analysis request from Yoav B: Jibe' from notifications where user_id = :co and type = 'new_request'), 'E2 notification texts are in English');
-- public video cover visible to everyone; feed returns it with photos
select pg_temp.as_user(:tr); set role authenticated;
update videos set visibility = 'public' where id = :'v1';
reset role;
select pg_temp.as_user(:ot); set role authenticated;
select pg_temp.ok(pg_temp.can_read('covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg'), 'C7 cover of a public video is visible');
select pg_temp.ok((select cover_key = 'covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg' from get_feed(null, 10, 0) where video_id = :'v1'), 'C8 feed returns the cover');
reset role;
-- cover in use is never cleaned up as a leftover; deleting the video returns it for removal
update storage.objects set created_at = now() - interval '1 day';
select pg_temp.ok(storage_key_in_use('covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg'), 'C9 cover counts as in use');
select pg_temp.as_user(:co); set role authenticated;
select decline_request(:'r1', 'unclear');
reset role;
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.ok('covers/' || :tr || '/c0000000-0000-0000-0000-000000000001.jpg' = any(delete_video(:'v1')), 'C10 deleting a video also removes its cover');
reset role;
select pg_temp.ok((select body like '% cannot analyze the video: the video is unclear' from notifications where user_id = :tr and type = 'declined'), 'E3 decline reason in English');
