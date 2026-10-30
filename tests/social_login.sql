-- Sign in with Google (011_social_login.sql).
-- Run on a fresh DB after the stubs, 001, 003, 005–011.
\set ON_ERROR_STOP 1
\set ad  '''00000000-0000-0000-0000-0000000000a1'''
\set em  '''00000000-0000-0000-0000-0000000000a2'''
\set go  '''00000000-0000-0000-0000-0000000000a3'''
\set fb  '''00000000-0000-0000-0000-0000000000a4'''
\set gc  '''00000000-0000-0000-0000-0000000000a5'''

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

-- Email signup (unchanged), and social logins with the metadata Supabase stores for Google (and other providers)
insert into auth.users (id, email, raw_user_meta_data) values
 (:ad, 'ad@x.test', '{"first_name":"Ada","last_name":"A","username":"ada"}'),
 (:em, 'em@x.test', '{"first_name":"Em","last_name":"B","username":"emma","consent":true,"role":"coach","bio":"Kite coach ten years","coach_sports":["1"],"sports":["1"],"languages":["en"]}'),
 (:go, 'go@gmail.test', '{"full_name":"Noa Ben David","name":"Noa Ben David","avatar_url":"https://x/p.jpg","email":"go@gmail.test","email_verified":true}'),
 (:fb, null, '{"name":"Lior","avatar_url":"https://x/f.jpg"}'),
 (:gc, 'gc@gmail.test', '{"full_name":"Tal Cohen","role":"coach"}');
update profiles set role = 'admin' where id = :ad;

select pg_temp.ok((select not needs_setup and role = 'coach' and coach_status = 'pending' and username = 'emma' from profiles where id = :em), 'S1 email signup unchanged, no setup needed');
select pg_temp.ok((select needs_setup and first_name = 'Noa' and last_name = 'Ben David' and username like 'user\_%' and role = 'trainee' from profiles where id = :go), 'S2 Google: names split, temporary username, needs setup');
select pg_temp.ok((select needs_setup and first_name = 'Lior' and last_name = '—' from profiles where id = :fb), 'S3 provider account with one name and no email');
select pg_temp.ok((select email = '' from profile_private where id = :fb), 'S4 missing email stored as empty');
select pg_temp.ok((select consented_at is not null from profile_private where id = :em), 'C1 email signup consent saved');
select pg_temp.ok((select consented_at is null from profile_private where id = :ad), 'C2 no consent flag, nothing saved');
select pg_temp.ok((select role = 'trainee' and coach_status is null from profiles where id = :gc), 'S5 social metadata cannot make a coach directly');

-- The user cannot clear the flag or pick a username outside complete_signup
select pg_temp.as_user(:go); set role authenticated;
select pg_temp.fails($$update profiles set needs_setup = false where id = auth.uid()$$, 'permission denied', 'S6 no direct flag edit');
select pg_temp.fails($$update profiles set username = 'noa' where id = auth.uid()$$, 'permission denied', 'S7 no direct username edit');
select pg_temp.fails($$update profile_private set consented_at = now() where id = auth.uid()$$, 'permission denied', 'C6 no direct consent edit');

-- Validation
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{en}','{1}')$$, 'CONSENT_REQUIRED', 'C3 consent required');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{en}','{1}', p_consent => false)$$, 'CONSENT_REQUIRED', 'C4 consent false refused');
select pg_temp.fails($$select complete_signup('Noa','Ben David','No','0501234567','{en}','{1}', p_consent => true)$$, 'BAD_USERNAME', 'S8 bad username');
select pg_temp.fails($$select complete_signup('Noa','Ben David','emma','0501234567','{en}','{1}', p_consent => true)$$, 'USERNAME_TAKEN', 'S9 taken username');
select pg_temp.fails($$select complete_signup('','Ben David','noa','0501234567','{en}','{1}', p_consent => true)$$, 'NAME_REQUIRED', 'S10 name required');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','abc','{en}','{1}', p_consent => true)$$, 'BAD_PHONE', 'S11 phone checked');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{}','{1}', p_consent => true)$$, 'LANGUAGES_REQUIRED', 'S12 languages required');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{english}','{1}', p_consent => true)$$, 'profiles_languages_check', 'S13 bad language code');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{en}','{}', p_consent => true)$$, 'INTERESTS_REQUIRED', 'S14 sports required');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{en}','{1}', true, 'short', '{1}', p_consent => true)$$, 'BIO_REQUIRED', 'S15 coach bio required');
select pg_temp.fails($$select complete_signup('Noa','Ben David','noa','0501234567','{en}','{1}', true, 'Kite coach for years', '{}', p_consent => true)$$, 'SPORTS_REQUIRED', 'S16 coach sports required');
reset role;
select pg_temp.ok((select needs_setup and username like 'user\_%' from profiles where id = :go), 'S17 failed attempts saved nothing');
select pg_temp.ok((select consented_at is null from profile_private where id = :go), 'C5 no consent saved by failed attempts');

-- Trainee completes signup
select pg_temp.as_user(:go); set role authenticated;
select complete_signup(' Noa ', 'Ben David', 'Noa.BD', '+972 50-123-4567', '{he,en,en}', '{1,2}', p_consent => true);
reset role;
select pg_temp.ok((select not needs_setup and username = 'noa.bd' and first_name = 'Noa' and languages = '{en,he}' and role = 'trainee' from profiles where id = :go), 'S18 trainee profile completed');
select pg_temp.ok((select phone = '+972 50-123-4567' and consented_at is not null from profile_private where id = :go), 'S19 phone and consent saved');
select pg_temp.ok((select count(*) = 2 from user_sports where user_id = :go), 'S20 sports saved');

-- Only once
select pg_temp.as_user(:go); set role authenticated;
select pg_temp.fails($$select complete_signup('Noa','B','other','0501234567','{en}','{1}', p_consent => true)$$, 'ALREADY_SET_UP', 'S21 cannot run twice');
select pg_temp.fails($$update profiles set username = 'other' where id = auth.uid()$$, 'permission denied', 'S22 username fixed afterwards');
reset role;

-- Coach completes signup: pending coach, admins notified
select pg_temp.as_user(:gc); set role authenticated;
select complete_signup('Tal', 'Cohen', 'talc', '0521112222', '{he}', '{1}', true, 'Snowboard coach, 8 seasons', '{3}', p_consent => true);
reset role;
select pg_temp.ok((select not needs_setup and role = 'coach' and coach_status = 'pending' and username = 'talc' and bio like 'Snowboard%' from profiles where id = :gc), 'S23 coach pending after setup');
select pg_temp.ok((select count(*) = 1 from coach_sports where coach_id = :gc and sport_id = 3), 'S24 coach sports saved');
select pg_temp.ok(exists (select 1 from coach_settings where coach_id = :gc), 'S25 coach settings created');
select pg_temp.ok(exists (select 1 from notifications where user_id = :ad and type = 'coach_request'), 'S26 admin notified');

-- Users who never signed in socially cannot use it
select pg_temp.as_user(:em); set role authenticated;
select pg_temp.fails($$select complete_signup('Em','B','emma2','0501234567','{en}','{1}', p_consent => true)$$, 'ALREADY_SET_UP', 'S27 email users cannot use it');
reset role;
select pg_temp.fails($$set role anon; select complete_signup('a','b','anonx','0501234567','{en}','{1}', p_consent => true)$$, 'permission denied', 'S28 anonymous blocked');
reset role;

-- request_coach still works with the new guard (006)
select pg_temp.as_user(:go); set role authenticated;
select request_coach('Coaching padel for years', '{4}');
reset role;
select pg_temp.ok((select role = 'coach' and coach_status = 'pending' and username = 'noa.bd' from profiles where id = :go), 'S29 request_coach still works');

\echo ALL SOCIAL LOGIN TESTS PASSED
