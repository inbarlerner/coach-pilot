-- =====================================================================
-- 011: sign in with Google.
-- Run in Supabase → SQL Editor AFTER 010_analysis_drawings.sql. Safe to run again.
--
--   • Supabase Auth does the Google login itself (enable the
--     providers in Authentication → Providers). A first social login creates
--     a user, and handle_new_user creates the profile as before.
--   • Social logins do not send a username, phone, languages or sports.
--     Such profiles get needs_setup = true (name taken from the provider,
--     a temporary username) and the app shows "Finish signing up" until
--     complete_signup runs once.
--   • complete_signup saves the missing details, lets the user pick their
--     username once, and for coaches reuses request_coach (pending + admins
--     notified). It never grants admin.
--   • Sign-up consent: every new account confirms "18 or older + privacy
--     policy". Saved as profile_private.consented_at (email sign-up: from the
--     signup form; Google: required by complete_signup).
-- =====================================================================

alter table public.profiles add column if not exists needs_setup boolean not null default false;
alter table public.profile_private add column if not exists consented_at timestamptz;

-- ---------- New users: names from the provider; flag profiles with no username ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wants_coach boolean := (m->>'role') = 'coach';
  social boolean := nullif(trim(m->>'username'), '') is null;   -- Google: no username in the metadata
  full_nm text := trim(coalesce(m->>'full_name', m->>'name', ''));
  s text;
  langs text[];
begin
  select coalesce(array_agg(distinct x), '{}') into langs
    from jsonb_array_elements_text(case when jsonb_typeof(m->'languages') = 'array' then m->'languages' else '[]'::jsonb end) x
   where x ~ '^[a-z]{2}$';
  if not valid_languages(langs) then langs := '{}'; end if;
  insert into profiles (id, first_name, last_name, username, role, coach_status, bio, languages, needs_setup)
  values (
    new.id,
    left(coalesce(nullif(trim(m->>'first_name'), ''), nullif(trim(m->>'given_name'), ''),
                  nullif(split_part(full_nm, ' ', 1), ''), '—'), 100),
    left(coalesce(nullif(trim(m->>'last_name'), ''), nullif(trim(m->>'family_name'), ''),
                  nullif(trim(substr(full_nm, length(split_part(full_nm, ' ', 1)) + 2)), ''), '—'), 100),
    lower(coalesce(nullif(trim(m->>'username'), ''), 'user_' || right(replace(new.id::text,'-',''), 20))),
    case when wants_coach and not social then 'coach' else 'trainee' end,
    case when wants_coach and not social then 'pending' else null end,
    case when wants_coach and not social then left(coalesce(m->>'bio',''), 1000) else '' end,
    langs,
    social
  );
  insert into profile_private (id, email, phone, consented_at)
  values (new.id, coalesce(new.email,''), left(coalesce(m->>'phone',''), 30),
          case when (m->>'consent') = 'true' then now() end);

  for s in select jsonb_array_elements_text(case when jsonb_typeof(m->'sports') = 'array' then m->'sports' else '[]'::jsonb end) loop
    insert into user_sports (user_id, sport_id)
      select new.id, id from sports where id::text = s on conflict do nothing;
  end loop;
  if wants_coach and not social then
    for s in select jsonb_array_elements_text(case when jsonb_typeof(m->'coach_sports') = 'array' then m->'coach_sports' else '[]'::jsonb end) loop
      insert into coach_sports (coach_id, sport_id)
        select new.id, id from sports where id::text = s on conflict do nothing;
    end loop;
    insert into coach_settings (coach_id) values (new.id);
  end if;
  return new;
end $$;

-- ---------- Profile guard: complete_signup may change the username (once) ----------
create or replace function public.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;  -- admin, or SQL editor / service
  -- complete_signup: username and needs_setup only
  if current_setting('app.complete_signup', true) = old.id::text
     and old.needs_setup and not new.needs_setup
     and new.role is not distinct from old.role
     and new.coach_status is not distinct from old.coach_status
     and new.disabled is not distinct from old.disabled
     and new.is_sample is not distinct from old.is_sample
     and new.id is not distinct from old.id then
    return new;
  end if;
  -- request_coach: trainee/rejected -> coach pending (006)
  if current_setting('app.coach_request', true) = old.id::text
     and new.role = 'coach' and new.coach_status = 'pending'
     and new.disabled is not distinct from old.disabled
     and new.is_sample is not distinct from old.is_sample
     and new.username is not distinct from old.username
     and new.needs_setup is not distinct from old.needs_setup
     and new.id is not distinct from old.id then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.coach_status is distinct from old.coach_status
     or new.disabled is distinct from old.disabled
     or new.is_sample is distinct from old.is_sample
     or new.username is distinct from old.username
     or new.needs_setup is distinct from old.needs_setup
     or new.id is distinct from old.id then
    raise exception 'FORBIDDEN_FIELD';
  end if;
  return new;
end $$;

-- ---------- Finish signing up after a social login ----------
drop function if exists public.complete_signup(text, text, text, text, text[], int[], boolean, text, int[]);   -- older draft, no consent
create or replace function public.complete_signup(
  p_first_name text, p_last_name text, p_username text, p_phone text,
  p_languages text[], p_sports int[],
  p_coach boolean default false, p_bio text default '', p_coach_sports int[] default '{}',
  p_consent boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := require_active();
  p profiles;
  uname text := lower(trim(coalesce(p_username, '')));
  langs text[];
begin
  select * into p from profiles where id = me for update;
  if not p.needs_setup then raise exception 'ALREADY_SET_UP'; end if;
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
  if trim(coalesce(p_first_name, '')) = '' or trim(coalesce(p_last_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;
  if uname !~ '^[a-z0-9_.]{3,30}$' then raise exception 'BAD_USERNAME'; end if;
  if exists (select 1 from profiles where username = uname and id <> me) then raise exception 'USERNAME_TAKEN'; end if;
  if trim(coalesce(p_phone, '')) !~ '^[0-9+() -]{7,20}$' then raise exception 'BAD_PHONE'; end if;
  select coalesce(array_agg(distinct x), '{}') into langs from unnest(coalesce(p_languages, '{}')) x;
  if coalesce(array_length(langs, 1), 0) = 0 then raise exception 'LANGUAGES_REQUIRED'; end if;
  if not valid_languages(langs) then raise exception 'profiles_languages_check'; end if;
  if not exists (select 1 from sports where id = any(coalesce(p_sports, '{}')) and active) then
    raise exception 'INTERESTS_REQUIRED';
  end if;
  if p_coach then   -- checked up front so nothing is saved when the coach part is incomplete
    if p.role <> 'trainee' then raise exception 'ALREADY_COACH'; end if;
    if length(trim(coalesce(p_bio, ''))) < 10 then raise exception 'BIO_REQUIRED'; end if;
    if not exists (select 1 from sports where id = any(coalesce(p_coach_sports, '{}')) and active) then
      raise exception 'SPORTS_REQUIRED';
    end if;
  end if;

  perform set_config('app.complete_signup', me::text, true);   -- lets protect_profile_columns allow the username change
  begin
    update profiles
       set first_name = left(trim(p_first_name), 100), last_name = left(trim(p_last_name), 100),
           username = uname, languages = langs, needs_setup = false
     where id = me;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN';
  end;
  perform set_config('app.complete_signup', '', true);
  update profile_private set phone = left(trim(p_phone), 30), consented_at = now() where id = me;
  delete from user_sports where user_id = me;
  insert into user_sports (user_id, sport_id)
    select me, id from sports where id = any(p_sports) and active;

  if p_coach then perform request_coach(p_bio, p_coach_sports); end if;
end $$;

revoke execute on function public.complete_signup(text, text, text, text, text[], int[], boolean, text, int[], boolean) from public, anon;
grant execute on function public.complete_signup(text, text, text, text, text[], int[], boolean, text, int[], boolean) to authenticated;
