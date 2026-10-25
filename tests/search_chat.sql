-- Search (008_search.sql) and chat rules per request (follow-up policy snapshot, 001).
-- Run on a fresh DB after the stubs, 001, 003, 005, 006, 007 and 008.
\set ON_ERROR_STOP 1
\set tr  '''00000000-0000-0000-0000-0000000000d1'''
\set co  '''00000000-0000-0000-0000-0000000000d2'''
\set ot  '''00000000-0000-0000-0000-0000000000d3'''
\set off '''00000000-0000-0000-0000-0000000000d4'''

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
create or replace function pg_temp.put(p_name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('media', p_name, auth.uid()::text, jsonb_build_object('size', 1000, 'mimetype', 'video/mp4'));
$$;
grant execute on function pg_temp.put(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
 (:tr,  'tr@x.test',  '{"first_name":"Yoav","last_name":"Levi","username":"yoav","sports":["1"]}'),
 (:co,  'co@x.test',  '{"first_name":"Dana","last_name":"Coach","username":"dana.coach","role":"coach","coach_sports":["1"]}'),
 (:ot,  'ot@x.test',  '{"first_name":"Noa","last_name":"Snow","username":"noa","sports":["3"]}'),
 (:off, 'off@x.test', '{"first_name":"Danny","last_name":"Gone","username":"danny","sports":["1"]}');
update profiles set coach_status = 'approved' where id = :co;
update profiles set disabled = true where id = :off;

-- ---------- People ----------
select pg_temp.as_user(:ot); set role authenticated;
select pg_temp.ok((select count(*) from search_people('dan')) = 1, 'S1 people by name (disabled accounts hidden)');
select pg_temp.ok((select username from search_people('dana coach')) = 'dana.coach', 'S2 several words: first + last name');
select pg_temp.ok((select username from search_people('YOAV')) = 'yoav', 'S3 case-insensitive, by username');
select pg_temp.ok((select count(*) from search_people('')) = 0, 'S4 empty search returns nothing');
select pg_temp.ok((select count(*) from search_people('%')) = 0, 'S5 wildcards are treated as text');
reset role;

-- ---------- Videos ----------
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('videos/' || :tr || '/10000000-0000-0000-0000-000000000001.mp4');
select pg_temp.put('videos/' || :tr || '/10000000-0000-0000-0000-000000000002.mp4');
select create_video('videos/' || :tr || '/10000000-0000-0000-0000-000000000001.mp4', 'video/mp4', 1000, 1, 'Jibe to the left', 'windy day', 'public') as v1 \gset
select create_video('videos/' || :tr || '/10000000-0000-0000-0000-000000000002.mp4', 'video/mp4', 1000, 1, 'Secret jump', '', 'private') as v2 \gset
select pg_temp.ok((select count(*) from search_videos('jump')) = 1, 'S6 owner finds own private video');
reset role;
select pg_temp.as_user(:ot); set role authenticated;
select pg_temp.ok((select count(*) from search_videos('jibe')) = 1, 'S7 public video by title');
select pg_temp.ok((select count(*) from search_videos('windy')) = 1, 'S8 by description');
select pg_temp.ok((select count(*) from search_videos('kitesurfing yoav')) = 1, 'S9 by sport + owner name');
select pg_temp.ok((select count(*) from search_videos('secret')) = 0, 'S10 other people''s private videos are not found');
reset role;
select pg_temp.as_user(null);
update videos set removed = true where id = :'v1';
select pg_temp.as_user(:ot); set role authenticated;
select pg_temp.ok((select count(*) from search_videos('jibe')) = 0, 'S11 removed videos are not found');
reset role;
select pg_temp.as_user(null);
update videos set removed = false where id = :'v1';

-- ---------- Chat follows the coach's setting at the moment the video was sent ----------
select pg_temp.as_user(:co); set role authenticated;
update coach_settings set followup_policy = 'unlimited' where coach_id = auth.uid();
reset role;
select pg_temp.as_user(:tr); set role authenticated;
select create_request(:'v1', :co, 'q1') as r_unl \gset
reset role;
-- coach changes the setting after the video was sent
select pg_temp.as_user(:co); set role authenticated;
update coach_settings set followup_policy = 'none' where coach_id = auth.uid();
reset role;
select pg_temp.as_user(:tr); set role authenticated;
select create_request(:'v2', :co, 'q2') as r_none \gset
reset role;
select pg_temp.ok((select followup_policy from analysis_requests where id = :'r_unl') = 'unlimited', 'P1 earlier request keeps the setting it was sent with');
select pg_temp.ok((select followup_policy from analysis_requests where id = :'r_none') = 'none', 'P2 new request takes the new setting');
select pg_temp.as_user(:co); set role authenticated;
select set_analysis_text(:'r_unl', 'analysis'); select send_analysis(:'r_unl');
select set_analysis_text(:'r_none', 'analysis'); select send_analysis(:'r_none');
reset role;
-- unlimited: both sides can keep writing
select pg_temp.as_user(:tr); set role authenticated;
select send_message(:'r_unl', 'm1'); select send_message(:'r_unl', 'm2');
reset role;
select pg_temp.as_user(:co); set role authenticated;
select send_message(:'r_unl', 'm3'); select send_message(:'r_unl', 'm4');
reset role;
select pg_temp.as_user(:tr); set role authenticated;
select send_message(:'r_unl', 'm5');
select pg_temp.ok((select count(*) from messages where request_id = :'r_unl') = 5, 'P3 unlimited chat is not limited');
-- none: no messages at all
select pg_temp.fails($$select send_message('$$ || :'r_none' || $$', 'hi')$$, 'POLICY_NONE', 'P4 no follow-ups when the coach chose none');
reset role;
-- chat24: open for 24 hours after the analysis, then closed
select pg_temp.as_user(null);
update analysis_requests set followup_policy = 'chat24' where id = :'r_none';
select pg_temp.as_user(:tr); set role authenticated;
select send_message(:'r_none', 'within 24h');
reset role;
select pg_temp.as_user(null);
update analysis_requests set completed_at = now() - interval '25 hours' where id = :'r_none';
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.fails($$select send_message('$$ || :'r_none' || $$', 'too late')$$, 'CHAT24_ENDED', 'P5 24-hour chat closes after 24 hours');
reset role;
