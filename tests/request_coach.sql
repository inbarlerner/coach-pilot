-- Asking to become a coach from an existing account (006_request_coach.sql).
-- Run on a fresh DB after the stubs, 001, 003 and 006.
\set ON_ERROR_STOP 1
\set ad  '''00000000-0000-0000-0000-0000000000f1'''
\set tr  '''00000000-0000-0000-0000-0000000000f2'''
\set co  '''00000000-0000-0000-0000-0000000000f3'''

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

insert into auth.users (id, email, raw_user_meta_data) values
 (:ad, 'ad@x.test', '{"first_name":"מנהלת","last_name":"א","username":"ada"}'),
 (:tr, 'tr@x.test', '{"first_name":"יואב","last_name":"ב","username":"yoav","sports":["1"]}'),
 (:co, 'co@x.test', '{"first_name":"דנה","last_name":"ג","username":"dana","role":"coach","bio":"מאמנת קייט ותיקה","coach_sports":["1"]}');
update profiles set role = 'admin' where id = :ad;

-- A trainee still cannot change their own role directly
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.fails($$update profiles set role='coach', coach_status='pending' where id=auth.uid()$$, 'permission denied', 'R1 no direct role edit');
-- nor through the trigger loophole by setting the flag from a plain request
select pg_temp.fails($$select request_coach('קצר', '{1}')$$, 'BIO_REQUIRED', 'R2 bio required');
select pg_temp.fails($$select request_coach('מאמן גלישה עשר שנים', '{}')$$, 'SPORTS_REQUIRED', 'R3 sport required');

select request_coach('מאמן גלישה עשר שנים', '{1,4}');
reset role;
select pg_temp.ok((select role = 'coach' and coach_status = 'pending' from profiles where id = :tr), 'R4 trainee is now a pending coach');
select pg_temp.ok((select count(*) = 2 from coach_sports where coach_id = :tr), 'R5 coach sports saved');
select pg_temp.ok(exists (select 1 from coach_settings where coach_id = :tr), 'R6 coach settings created');
select pg_temp.ok(exists (select 1 from notifications where user_id = :ad and type = 'coach_request'), 'R7 admin notified');

-- Shows in the admin's pending list (the same query the admin page runs)
select pg_temp.as_user(:ad); set role authenticated;
select pg_temp.ok((select count(*) = 2 from profiles where role = 'coach' and coach_status = 'pending'), 'R8 admin sees both pending coaches');
reset role;

-- Pending or approved coaches cannot re-apply; admins cannot apply
select pg_temp.as_user(:tr); set role authenticated;
select pg_temp.fails($$select request_coach('מאמן גלישה עשר שנים', '{1}')$$, 'ALREADY_COACH', 'R9 pending coach cannot re-apply');
reset role;
select pg_temp.as_user(:ad); set role authenticated;
select pg_temp.fails($$select request_coach('מנהלת שרוצה לאמן', '{1}')$$, 'ALREADY_COACH', 'R10 admin cannot apply (no self-demotion)');

-- Rejected coach can apply again
select admin_set_coach_status(:co, 'rejected');
reset role;
select pg_temp.as_user(:co); set role authenticated;
select request_coach('מאמנת קייט, ניסיון נוסף', '{1}');
reset role;
select pg_temp.ok((select coach_status = 'pending' from profiles where id = :co), 'R11 rejected coach can re-apply');

-- The flag does not leak: after the call, direct role edits are still blocked
select pg_temp.as_user(:co); set role authenticated;
select pg_temp.fails($$update profiles set bio = bio where id = auth.uid(); select set_config('app.coach_request', auth.uid()::text, false); update profiles set coach_status='approved' where id=auth.uid()$$, 'permission denied', 'R12 cannot self-approve');
reset role;
