-- Drawings saved with the analysis (010_analysis_drawings.sql).
-- Run on a fresh DB after the stubs, 001, 003, 005, 006, 007, 008, 009 and 010.
\set ON_ERROR_STOP 1
\set tr  '''00000000-0000-0000-0000-0000000000f1'''
\set co  '''00000000-0000-0000-0000-0000000000f2'''

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
 (:tr, 'tr@x.test', '{"first_name":"Yoav","last_name":"L","username":"yoav9","sports":["1"]}'),
 (:co, 'co@x.test', '{"first_name":"Dana","last_name":"C","username":"dana9","role":"coach","coach_sports":["1"]}');
update profiles set coach_status = 'approved' where id = :co;

select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.put('videos/' || :tr || '/20000000-0000-0000-0000-000000000001.mp4');
select create_video('videos/' || :tr || '/20000000-0000-0000-0000-000000000001.mp4', 'video/mp4', 1000, 1, 'Jibe', '', 'public') as v1 \gset
select create_request(:'v1', :co, 'q') as r1 \gset
reset role;

select pg_temp.as_user(:co); set role authenticated;
select save_drawings(:'r1', '{"strokes":[{"t":1.2,"c":"#ffd60a","pts":[[0.1,0.1],[0.2,0.3]]}],"notes":[]}');
select pg_temp.ok((select count(*) from analysis_items where request_id = :'r1' and kind = 'drawing') = 1, 'D1 drawings are saved on the open analysis');
select pg_temp.fails($$select send_analysis('$$ || :'r1' || $$')$$, 'EMPTY_ANALYSIS', 'D2 drawings alone cannot be sent as an analysis');
select save_drawings(:'r1', '{"strokes":[{"t":2.0,"c":"#ff3b30","pts":[[0.5,0.5],[0.6,0.6]]},{"t":2.1,"pts":[[0.1,0.1],[0.2,0.2]]}],"notes":[{"t":2.0,"text":"Hips too far back"}]}');
select pg_temp.ok((select count(*) from analysis_items where request_id = :'r1' and kind = 'drawing') = 1, 'D3 saving again replaces the drawings');
select pg_temp.fails($$select save_drawings('$$ || :'r1' || $$', '[{"t":1}]')$$, 'BAD_DRAWINGS', 'D4 drawings must be an object with lists');
select pg_temp.ok((select body::jsonb->'notes'->0->>'text' from analysis_items where request_id = :'r1' and kind = 'drawing') = 'Hips too far back', 'D4b the coach note is saved with the drawings');
-- Deleting one frame in the viewer saves the drawings without it.
select save_drawings(:'r1', '{"strokes":[{"t":2.0,"c":"#ff3b30","pts":[[0.5,0.5],[0.6,0.6]]},{"t":5.0,"pts":[[0.1,0.1],[0.2,0.2]]}],"notes":[{"t":2.0,"text":"Hips"}]}');
select save_drawings(:'r1', '{"strokes":[{"t":5.0,"pts":[[0.1,0.1],[0.2,0.2]]}],"notes":[]}');
select pg_temp.ok((select jsonb_array_length(body::jsonb->'strokes') = 1 and jsonb_array_length(body::jsonb->'notes') = 0
  from analysis_items where request_id = :'r1' and kind = 'drawing'), 'D4c the coach deletes a frame''s drawing and text from the draft');
select save_drawings(:'r1', '{"strokes":[{"t":2.0,"c":"#ff3b30","pts":[[0.5,0.5],[0.6,0.6]]}],"notes":[{"t":2.0,"text":"Hips too far back"}]}');
select set_analysis_text(:'r1', 'Keep your weight back');
select send_analysis(:'r1');
reset role;

select pg_temp.ok((select status from analysis_requests where id = :'r1') = 'completed', 'D5 analysis with text and drawings is sent');
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.ok((select count(*) from analysis_items where request_id = :'r1' and kind = 'drawing') = 1, 'D6 trainee sees the drawings once completed');
select pg_temp.fails($$select save_drawings('$$ || :'r1' || $$', '{"strokes":[],"notes":[]}')$$, 'NOT_FOUND', 'D7 trainee cannot change drawings');
reset role;
select pg_temp.as_user(:co); set role authenticated;
select pg_temp.fails($$select save_drawings('$$ || :'r1' || $$', '{"strokes":[],"notes":[]}')$$, 'NOT_OPEN', 'D7b the coach cannot delete drawings after the analysis was sent');
reset role;
