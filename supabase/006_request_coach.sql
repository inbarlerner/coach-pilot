-- =====================================================================
-- 006: an existing account can ask to become a coach.
-- Until now the only way was the coach signup form. Someone who first
-- signed up as a trainee (or whose second signup with the same email was
-- ignored by Supabase Auth) ended up as a trainee with no way to apply,
-- so the admin's pending list stayed empty.
-- Trainees, and coaches who were rejected, can (re)apply. Status becomes
-- 'pending' and every admin gets a notification. Never grants admin.
-- =====================================================================
-- protect_profile_columns (001) blocks role/status self-edits. Allow exactly
-- trainee/rejected -> coach pending, and only from inside request_coach.
create or replace function public.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;  -- admin, or SQL editor / service
  if current_setting('app.coach_request', true) = old.id::text
     and new.role = 'coach' and new.coach_status = 'pending'
     and new.disabled is not distinct from old.disabled
     and new.is_sample is not distinct from old.is_sample
     and new.username is not distinct from old.username
     and new.id is not distinct from old.id then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.coach_status is distinct from old.coach_status
     or new.disabled is distinct from old.disabled
     or new.is_sample is distinct from old.is_sample
     or new.username is distinct from old.username
     or new.id is distinct from old.id then
    raise exception 'FORBIDDEN_FIELD';
  end if;
  return new;
end $$;

create or replace function public.request_coach(p_bio text, p_sports int[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := require_active();
  p profiles;
  a uuid;
begin
  select * into p from profiles where id = me for update;
  if p.role = 'admin' or (p.role = 'coach' and p.coach_status in ('pending','approved')) then
    raise exception 'ALREADY_COACH';
  end if;
  if length(trim(coalesce(p_bio, ''))) < 10 then raise exception 'BIO_REQUIRED'; end if;
  if not exists (select 1 from sports where id = any(coalesce(p_sports, '{}')) and active) then
    raise exception 'SPORTS_REQUIRED';
  end if;

  perform set_config('app.coach_request', me::text, true);   -- lets protect_profile_columns allow this one change
  update profiles set role = 'coach', coach_status = 'pending', bio = left(trim(p_bio), 1000)
   where id = me;
  perform set_config('app.coach_request', '', true);
  delete from coach_sports where coach_id = me;
  insert into coach_sports (coach_id, sport_id)
    select me, id from sports where id = any(p_sports) and active;
  insert into coach_settings (coach_id) values (me) on conflict do nothing;

  for a in select id from profiles where role = 'admin' and not disabled loop
    perform notify(a, 'coach_request', null, full_name(me) || ' ביקש/ה להצטרף כמאמן/ת.');
  end loop;
end $$;
revoke execute on function public.request_coach(text, int[]) from public, anon;
grant execute on function public.request_coach(text, int[]) to authenticated;
