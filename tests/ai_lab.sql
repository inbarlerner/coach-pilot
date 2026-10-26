-- Admin AI lab (009_ai_lab.sql): admin-only access, protected run fields, run lifecycle,
-- monthly spend limit, frame storage rules, freeing space, deleting runs, feedback.
-- Run on a fresh DB after the stubs, 001, 003, 005, 006, 007, 008 and 009.
\set ON_ERROR_STOP 1
\set a1 '''00000000-0000-0000-0000-0000000000a1'''
\set a2 '''00000000-0000-0000-0000-0000000000a2'''
\set tr '''00000000-0000-0000-0000-0000000000a3'''
\set r1 '''10000000-0000-0000-0000-000000000001'''
\set r2 '''10000000-0000-0000-0000-000000000002'''
\set r3 '''10000000-0000-0000-0000-000000000003'''

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
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

insert into auth.users (id, email, raw_user_meta_data) values
 (:a1, 'a1@x.test', '{"first_name":"ג׳ני","last_name":"א","username":"jen"}'),
 (:a2, 'a2@x.test', '{"first_name":"ענבר","last_name":"ב","username":"inbar"}'),
 (:tr, 'tr@x.test', '{"first_name":"יואב","last_name":"ג","username":"yoav","sports":["1"]}');
update profiles set role = 'admin' where id in (:a1, :a2);

select pg_temp.ok((select value = 838860800 from app_settings where key = 'storage_cap_bytes'), 'L1 video storage cap lowered to 800MB to leave room for the lab');
select pg_temp.ok((select value = 3000 from app_settings where key = 'ai_lab_monthly_cents'), 'L2 monthly AI spend limit is $30');

-- ---------- Non-admins see and do nothing ----------
insert into ai_lab_runs (id, model, effort, frames) values (:r1, 'opus', 'medium',
  jsonb_build_array(jsonb_build_object('n', 1, 'file', :r1 || '/F01.jpg'), jsonb_build_object('n', 2, 'file', :r1 || '/F02.jpg')));
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.ok((select count(*) = 0 from ai_lab_runs), 'L3 trainee cannot see lab runs');
select pg_temp.fails($$insert into ai_lab_runs (model, effort) values ('opus','low')$$, 'row-level security', 'L4 trainee cannot create a run');
select pg_temp.fails($$select ai_lab_start('10000000-0000-0000-0000-000000000001')$$, 'NOT_ADMIN', 'L5 trainee cannot start a run (would spend the API key)');
select pg_temp.fails($$select ai_lab_storage()$$, 'NOT_ADMIN', 'L6 trainee cannot see lab usage');
select pg_temp.fails($$insert into ai_feedback (body) values ('hi')$$, 'row-level security', 'L7 trainee cannot write lab feedback');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('ai-lab', '10000000-0000-0000-0000-000000000001/F01.jpg')$$, 'row-level security', 'L8 trainee cannot upload lab frames');
reset role;
delete from ai_lab_runs;

-- ---------- Admin creates a run: protected fields cannot be faked ----------
select pg_temp.as_user(:a1); set role authenticated;
insert into ai_lab_runs (id, model, effort, status, cost_cents, analysis, created_by, frames) values (:r1, 'opus', 'medium', 'done', 99, '{"x":1}', :a2,
  jsonb_build_array(jsonb_build_object('n', 1, 'file', :r1 || '/F01.jpg'), jsonb_build_object('n', 2, 'file', :r1 || '/F02.jpg')));
select pg_temp.ok((select status = 'new' and cost_cents = 0 and analysis is null and created_by = :a1 from ai_lab_runs where id = :r1), 'L9 status, cost, output and author are set by the server, not the browser');
update ai_lab_runs set status = 'done', cost_cents = 0.01, question = 'מה לשפר?' where id = :r1;
select pg_temp.ok((select status = 'new' and cost_cents = 0 and question = 'מה לשפר?' from ai_lab_runs where id = :r1), 'L10 admin can edit the question but not the status or cost');
select pg_temp.fails($$insert into ai_lab_runs (model, effort, lang) values ('opus','low','fr')$$, 'check constraint', 'L11 only Hebrew or English feedback');

-- frames: only JPEG keys of a run that is still new
insert into storage.objects (bucket_id, name, metadata) values
  ('ai-lab', :r1 || '/F01.jpg', '{"size": 40000000}'), ('ai-lab', :r1 || '/F02.jpg', '{"size": 40000000}');
select pg_temp.ok((select count(*) = 2 from storage.objects where bucket_id = 'ai-lab'), 'L12 admin uploads frames for a new run');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('ai-lab', '10000000-0000-0000-0000-000000000001/x.png')$$, 'row-level security', 'L13 bad frame name refused');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('ai-lab', '10000000-0000-0000-0000-000000000009/F01.jpg')$$, 'row-level security', 'L14 frames for a run that does not exist refused');

-- ---------- Lifecycle ----------
select pg_temp.ok((select status = 'running' from ai_lab_start(:r1)), 'L15 start claims the run');
select pg_temp.fails($$select ai_lab_start('10000000-0000-0000-0000-000000000001')$$, 'ALREADY_RUNNING', 'L16 cannot start twice (no double charge)');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('ai-lab', '10000000-0000-0000-0000-000000000001/F03.jpg')$$, 'row-level security', 'L17 no new frames once the run started');
select ai_lab_finish(:r1, '{"model":"claude-opus-5-5"}', '{"steps":[]}', 1000, null);
select pg_temp.ok((select status = 'done' and cost_cents = 1000 and analysis = '{"steps":[]}' from ai_lab_runs where id = :r1), 'L18 finish saves output and cost');
select pg_temp.fails($$select ai_lab_start('10000000-0000-0000-0000-000000000001')$$, 'ALREADY_DONE', 'L19 a finished run cannot be re-run in place');
select pg_temp.fails($$select ai_lab_finish('10000000-0000-0000-0000-000000000001', null, null, 0, null)$$, 'NOT_RUNNING', 'L20 cannot overwrite a finished run');

-- rerun reuses the original's frames; a failed run can be retried
insert into ai_lab_runs (id, parent_id, model, effort, lang, frames) select :r2, :r1, 'sonnet', 'low', 'en', frames from ai_lab_runs where id = :r1;
select ai_lab_start(:r2);
select ai_lab_finish(:r2, null, null, 0, 'HTTP 529');
select pg_temp.ok((select status = 'error' and error = 'HTTP 529' from ai_lab_runs where id = :r2), 'L21 failure saved as an error');
select pg_temp.ok((select status = 'running' from ai_lab_start(:r2)), 'L22 failed run can be retried');
select ai_lab_finish(:r2, '{}', '{"steps":[]}', 1500, null);

-- monthly limit: $10 + $15 = $25 spent; push it over $30
select pg_temp.ok((select month_cents = 2500 and month_cap_cents = 3000 and used_bytes = 80000000 from ai_lab_storage()), 'L23 usage shows frames and this month''s spend');
insert into ai_lab_runs (id, parent_id, model, effort, frames) select :r3, :r1, 'opus', 'high', frames from ai_lab_runs where id = :r1;
select ai_lab_start(:r3); select ai_lab_finish(:r3, '{}', '{"steps":[]}', 600, null);
insert into ai_lab_runs (model, effort, frames) select 'opus', 'low', frames from ai_lab_runs where id = :r1;
select pg_temp.fails($$select ai_lab_start(id) from ai_lab_runs where status = 'new'$$, 'AI_MONTHLY_LIMIT', 'L24 monthly spend limit stops new runs');
reset role;
delete from ai_lab_runs where status = 'new';

-- ---------- Reviews: everyone reads, each writes only their own ----------
select pg_temp.as_user(:a1); set role authenticated;
insert into ai_lab_reviews (run_id, review, score) values (:r1, '{"overall":{"notes":"טוב"}}', 4);
insert into ai_lab_reviews (run_id, review, score) values (:r1, '{"overall":{"notes":"מצוין"}}', 5)
  on conflict (run_id, reviewer) do update set review = excluded.review, score = excluded.score;
select pg_temp.ok((select score = 5 from ai_lab_reviews where run_id = :r1 and reviewer = :a1), 'L25 saving a review again updates it (upsert)');
reset role;
select pg_temp.as_user(:a2); set role authenticated;
select pg_temp.ok((select count(*) = 1 from ai_lab_reviews where run_id = :r1), 'L26 other admin reads the review');
update ai_lab_reviews set score = 1 where reviewer = :a1;
select pg_temp.ok((select score = 5 from ai_lab_reviews where reviewer = :a1), 'L27 other admin cannot change it');
select pg_temp.fails($$insert into ai_lab_reviews (run_id, reviewer, score) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 1)$$, 'row-level security', 'L28 cannot write a review in someone else''s name');

-- ---------- Feedback for Claude ----------
insert into ai_feedback (kind, body, run_id, author, status) values ('coaching', 'הקייט נמוך מדי בהמראה', :r1, :a1, 'done');
select pg_temp.ok((select author = :a2 and status = 'new' from ai_feedback), 'L29 feedback is signed by its writer and starts as new');
update ai_feedback set status = 'planned', outcome = 'משימה: כרטיס hooked-jump', author = :a1;
select pg_temp.ok((select status = 'planned' and outcome <> '' and author = :a2 from ai_feedback), 'L30 status and outcome editable, author is not');
select pg_temp.fails($$insert into ai_feedback (body) values ('   ')$$, 'check constraint', 'L31 empty feedback refused');
reset role;

-- ---------- Freeing space: oldest frames go first, reruns sharing them are marked too ----------
update app_settings set value = 100000000 where key = 'ai_lab_cap_bytes';   -- 100 MB, 80 MB used
select pg_temp.as_user(:a1); set role authenticated;
select pg_temp.ok((select ai_lab_make_room(10000000) = '{}'), 'L32 nothing removed while there is room');
select pg_temp.ok((select array_length(ai_lab_make_room(30000000), 1) = 2), 'L33 oldest run''s frames returned for removal');
select pg_temp.ok((select count(*) = 3 from ai_lab_runs where frames_deleted_at is not null), 'L34 the original and both reruns know their frames are gone');
select pg_temp.fails($$select ai_lab_make_room(99999999999)$$, 'BAD_SIZE', 'L35 absurd sizes refused');
reset role;
select set_config('ai_lab.trusted', 'on', false); update ai_lab_runs set frames_deleted_at = null; select set_config('ai_lab.trusted', 'off', false);

-- ---------- Deleting runs keeps frames that a rerun still uses ----------
select pg_temp.as_user(:a1); set role authenticated;
select pg_temp.ok((select ai_lab_delete_run(:r1) = '{}'), 'L36 deleting the original keeps frames the reruns use');
select pg_temp.ok((select count(*) = 0 from ai_lab_reviews where run_id = :r1) and (select parent_id is null from ai_lab_runs where id = :r2), 'L37 its reviews go with it; reruns stay');
select pg_temp.ok((select ai_lab_delete_run(:r2) = '{}'), 'L38 deleting one rerun keeps frames another rerun uses');
select pg_temp.ok((select array_length(ai_lab_make_room(30000000), 1) = 2), 'L38b with the original gone, freeing space still finds its frames through the rerun');
reset role;
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.fails($$select ai_lab_delete_run('10000000-0000-0000-0000-000000000003')$$, 'NOT_ADMIN', 'L39 trainee cannot delete runs');
select pg_temp.fails($$select ai_lab_finish('10000000-0000-0000-0000-000000000003', null, null, 0, null)$$, 'NOT_ADMIN', 'L40 trainee cannot write results');
select pg_temp.as_user(:a1); set role authenticated;
select pg_temp.ok((select array_length(ai_lab_delete_run(:r3), 1) = 2), 'L41 deleting the last run that uses the frames returns them (no orphan files)');
reset role;
-- a fresh run with its own frames, nobody sharing: its files come back for removal
select pg_temp.as_user(:a1); set role authenticated;
insert into ai_lab_runs (id, model, effort, frames) values ('20000000-0000-0000-0000-000000000001', 'haiku', 'low',
  '[{"n":1,"file":"20000000-0000-0000-0000-000000000001/F01.jpg"}]');
select pg_temp.ok((select ai_lab_delete_run('20000000-0000-0000-0000-000000000001') = '{20000000-0000-0000-0000-000000000001/F01.jpg}'), 'L42 a run''s own unshared frames are returned for removal');
reset role;
\echo 'ai_lab.sql: all passed'
