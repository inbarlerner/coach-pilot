-- =====================================================================
-- 007: profile photos, video covers, spoken languages, English texts.
-- Run in Supabase → SQL Editor AFTER 006_request_coach.sql. Safe to run again.
--
--   • Profile photo: public bucket "avatars" (2 MB, JPEG/PNG/WebP), one
--     folder per user. profiles.avatar_key points at the current photo.
--   • Video cover: an image in the private "media" bucket under
--     covers/<user id>/…; readable by whoever may watch the video.
--     videos.cover_key points at it.
--   • Spoken languages: profiles.languages (ISO 639-1 codes, e.g. {en,nl}).
--     Asked at signup, editable in settings, shown to coaches/trainees.
--   • The app is now in English: notification texts and default sport
--     names are translated.
-- =====================================================================

do $$ begin
  if to_regprocedure('public.request_coach(text,integer[])') is null then
    raise exception 'Run 006_request_coach.sql first';
  end if;
end $$;

-- ---------- Columns ----------
alter table public.profiles add column if not exists avatar_key text;
alter table public.profiles add column if not exists languages text[] not null default '{}';
alter table public.videos add column if not exists cover_key text;

create or replace function public.valid_languages(l text[]) returns boolean
language sql immutable as $$
  select coalesce(array_length(l, 1), 0) <= 20
     and not exists (select 1 from unnest(l) x where x !~ '^[a-z]{2}$');
$$;
alter table public.profiles drop constraint if exists profiles_languages_check;
alter table public.profiles add constraint profiles_languages_check check (public.valid_languages(languages));

-- Users may edit their own languages (avatar_key changes only through set_avatar).
grant update (languages) on public.profiles to authenticated;

-- ---------- Profile photos: public bucket "avatars" ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Key layout in "avatars": <user id>/<random id>.<ext>
create or replace function public.avatar_key_owner(p_name text) returns uuid
language sql immutable as $$
  select case when p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then split_part(p_name, '/', 1)::uuid end;
$$;

drop policy if exists pilot_avatars_insert on storage.objects;
create policy pilot_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.avatar_key_owner(name) = auth.uid() and public.is_active_user());

-- Public photos; reading the file rows is also needed to delete your own old photo.
drop policy if exists pilot_avatars_select on storage.objects;
create policy pilot_avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists pilot_avatars_delete on storage.objects;
create policy pilot_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.avatar_key_owner(name) = auth.uid()
         and not exists (select 1 from public.profiles where avatar_key = name));

-- Set (or clear, with null) the current user's photo. Returns the old key so the app can remove it.
create or replace function public.set_avatar(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); old text; mt text;
begin
  if p_key is not null then
    if avatar_key_owner(p_key) is distinct from uid then raise exception 'BAD_KEY'; end if;
    select lower(o.metadata->>'mimetype') into mt from storage.objects o where o.bucket_id = 'avatars' and o.name = p_key;
    if not found then raise exception 'FILE_NOT_FOUND'; end if;
    if mt not like 'image/%' then raise exception 'BAD_TYPE'; end if;
  end if;
  select avatar_key into old from profiles where id = uid;
  update profiles set avatar_key = p_key where id = uid;
  return case when old is distinct from p_key then old end;
end $$;

-- ---------- Video covers: images in the private "media" bucket ----------
update storage.buckets
   set allowed_mime_types = (select array_agg(distinct t) from unnest(allowed_mime_types || array['image/jpeg','image/png','image/webp']) t)
 where id = 'media';

create or replace function public.storage_key_folder_owner(p_name text) returns uuid
language sql immutable as $$
  select case when p_name ~ '^(videos|responses|covers)/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'
              then split_part(p_name, '/', 2)::uuid end;
$$;

create or replace function public.storage_key_in_use(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from videos where storage_key = p_name and file_deleted_at is null)
      or exists (select 1 from videos where cover_key = p_name)
      or exists (select 1 from analysis_items where storage_key = p_name and file_deleted_at is null);
$$;

create or replace function public.can_upload_storage_key(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and public.storage_key_folder_owner(p_name) = auth.uid()
     and public.is_active_user()
     and (split_part(p_name, '/', 1) in ('videos', 'covers')
          or exists (select 1 from profiles where id = auth.uid()
                     and role = 'coach' and coach_status = 'approved'));
$$;

create or replace function public.can_read_storage_key(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.storage_key_folder_owner(p_name) = auth.uid()                       -- your own upload
    or exists (select 1 from videos v
               where (v.storage_key = p_name or v.cover_key = p_name)
                 and public.can_view_video(v.id))                             -- same rule as the videos table
    or exists (select 1 from analysis_items i join analysis_requests r on r.id = i.request_id
               where i.storage_key = p_name and (                              -- same rule as analysis items
                 r.coach_id = auth.uid()
                 or public.is_admin()
                 or (r.status = 'completed' and r.trainee_id = auth.uid())
                 or (r.status = 'completed' and exists (
                       select 1 from videos v join profiles o on o.id = v.owner_id
                       where v.id = r.video_id and v.visibility = 'public' and not v.removed and not o.disabled))))
    or exists (select 1 from storage_release s where s.name = p_name and s.user_id = auth.uid())
  );
$$;

-- Owner sets the cover of their video. Returns the old cover key so the app can remove it.
create or replace function public.set_video_cover(p_video uuid, p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); old text; f record;
begin
  if not exists (select 1 from videos where id = p_video and owner_id = uid) then raise exception 'NOT_FOUND'; end if;
  if p_key not like ('covers/' || uid::text || '/%') or storage_key_folder_owner(p_key) is null then raise exception 'BAD_KEY'; end if;
  select * into f from _stored_file(p_key);
  if f.mimetype not like 'image/%' then raise exception 'BAD_TYPE'; end if;
  if f.size > 3145728 then raise exception 'TOO_LARGE'; end if;
  select cover_key into old from videos where id = p_video;
  update videos set cover_key = p_key where id = p_video;
  return case when old is distinct from p_key then old end;
end $$;

-- Delete video: also remove its cover.
create or replace function public.delete_video(p_video uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); keys text[];
begin
  if not exists (select 1 from videos where id = p_video and owner_id = uid) then raise exception 'NOT_FOUND'; end if;
  select array_agg(k) into keys from (
    select storage_key k from videos where id = p_video
    union all
    select cover_key from videos where id = p_video and cover_key is not null
    union all
    select i.storage_key from analysis_items i join analysis_requests r on r.id = i.request_id
     where r.video_id = p_video and i.storage_key is not null
  ) t;
  insert into storage_release (name, user_id)
    select k, uid from unnest(coalesce(keys, '{}')) k
     where storage_key_folder_owner(k) is distinct from uid
  on conflict do nothing;
  delete from videos where id = p_video;
  return coalesce(keys, '{}');
end $$;

-- ---------- Feed: add cover and photos ----------
drop function if exists public.get_feed(int, int, int);
create function public.get_feed(p_sport int default null, p_limit int default 10, p_offset int default 0)
returns table (
  video_id uuid, title text, description text, sport_id int, created_at timestamptz,
  owner_id uuid, owner_name text, owner_username text, is_sample boolean,
  request_id uuid, coach_id uuid, coach_name text, coach_username text, comment_count int,
  cover_key text, owner_avatar text, coach_avatar text
)
language sql stable security definer set search_path = public as $$
  select v.id, v.title, v.description, v.sport_id, v.created_at,
         o.id, o.first_name || ' ' || o.last_name, o.username, v.is_sample,
         r.id, c.id, c.first_name || ' ' || c.last_name, c.username,
         (select count(*)::int from comments cm where cm.video_id = v.id),
         v.cover_key, o.avatar_key, c.avatar_key
  from videos v
  join profiles o on o.id = v.owner_id
  left join lateral (
    select * from analysis_requests ar where ar.video_id = v.id and ar.status = 'completed'
    order by ar.completed_at desc limit 1) r on true
  left join profiles c on c.id = r.coach_id
  where v.visibility = 'public' and not v.removed and not o.disabled
    and v.file_deleted_at is null
    and auth.uid() is not null
    and (p_sport is null or v.sport_id = p_sport)
  order by (v.sport_id in (select sport_id from user_sports where user_id = auth.uid())) desc,
           v.created_at desc
  limit least(p_limit, 50) offset p_offset;
$$;

-- ---------- Signup: also save spoken languages ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wants_coach boolean := (m->>'role') = 'coach';
  s text;
  langs text[];
begin
  select coalesce(array_agg(distinct x), '{}') into langs
    from jsonb_array_elements_text(case when jsonb_typeof(m->'languages') = 'array' then m->'languages' else '[]'::jsonb end) x
   where x ~ '^[a-z]{2}$';
  if not valid_languages(langs) then langs := '{}'; end if;
  insert into profiles (id, first_name, last_name, username, role, coach_status, bio, languages)
  values (
    new.id,
    coalesce(nullif(trim(m->>'first_name'), ''), '—'),
    coalesce(nullif(trim(m->>'last_name'), ''), '—'),
    lower(coalesce(nullif(trim(m->>'username'), ''), 'user_' || substr(replace(new.id::text,'-',''),1,10))),
    case when wants_coach then 'coach' else 'trainee' end,
    case when wants_coach then 'pending' else null end,
    case when wants_coach then left(coalesce(m->>'bio',''), 1000) else '' end,
    langs
  );
  insert into profile_private (id, email, phone)
  values (new.id, coalesce(new.email,''), left(coalesce(m->>'phone',''), 30));

  for s in select jsonb_array_elements_text(coalesce(m->'sports','[]'::jsonb)) loop
    insert into user_sports (user_id, sport_id)
      select new.id, id from sports where id = s::int on conflict do nothing;
  end loop;
  if wants_coach then
    for s in select jsonb_array_elements_text(coalesce(m->'coach_sports','[]'::jsonb)) loop
      insert into coach_sports (coach_id, sport_id)
        select new.id, id from sports where id = s::int on conflict do nothing;
    end loop;
    insert into coach_settings (coach_id) values (new.id);
  end if;
  return new;
end $$;

-- ---------- English: default sport names ----------
update public.sports set name = 'Kitesurfing' where name = 'קייטסרפינג';
update public.sports set name = 'Ski'         where name = 'סקי';
update public.sports set name = 'Snowboard'   where name = 'סנובורד';
update public.sports set name = 'Padel'       where name = 'פאדל';

-- ---------- English: functions that write notification texts (logic unchanged) ----------
create or replace function public.expire_requests() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    update analysis_requests
       set status = 'expired', closed_at = now(), trainee_read = false, coach_read = false
     where status in ('pending','draft') and deadline_at <= now()
    returning id, trainee_id, coach_id
  loop
    perform notify(r.trainee_id, 'expired', r.id, 'The coach did not respond in time. The request moved to Not completed.');
    perform notify(r.coach_id, 'expired', r.id, 'The response time for this request has passed. It moved to Not completed.');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.create_request(p_video uuid, p_coach uuid, p_question text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_active();
  s coach_settings%rowtype;
  v videos%rowtype;
  rid uuid;
begin
  perform expire_requests();
  select * into v from videos where id = p_video and owner_id = uid;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_coach = uid then raise exception 'SELF_REQUEST'; end if;
  if not exists (select 1 from profiles where id = p_coach and role = 'coach'
                 and coach_status = 'approved' and not disabled) then
    raise exception 'COACH_NOT_AVAILABLE';
  end if;
  select * into s from coach_settings where coach_id = p_coach for update;
  if not found then raise exception 'COACH_NOT_AVAILABLE'; end if;
  if coach_active_count(p_coach) >= s.quota then raise exception 'COACH_FULL'; end if;

  insert into analysis_requests (video_id, trainee_id, coach_id, question, terms,
      response_hours, followup_policy, deadline_at, trainee_read, coach_read)
  values (p_video, uid, p_coach, left(coalesce(p_question,''),2000),
      jsonb_build_object('quota', s.quota, 'response_hours', s.response_hours,
                         'followup_policy', s.followup_policy, 'captured_at', now(),
                         'billing_rule', 'charge_only_on_analysis_sent'),
      s.response_hours, s.followup_policy, now() + make_interval(hours => s.response_hours), true, false)
  returning id into rid;

  perform notify(p_coach, 'new_request', rid, 'New analysis request from ' || full_name(uid) || ': ' || v.title);
  return rid;
end $$;

create or replace function public.send_analysis(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r analysis_requests;
begin
  r := _coach_open_request(p_request);
  if not exists (select 1 from analysis_items where request_id = p_request) then
    raise exception 'EMPTY_ANALYSIS';
  end if;
  -- Future billing rule: a charge is created ONLY here (analysis sent). Not implemented in pilot.
  update analysis_requests
     set status = 'completed', completed_at = now(), closed_at = now(),
         trainee_read = false, coach_read = true
   where id = p_request;
  perform notify(r.trainee_id, 'analysis_received', p_request,
                 'New analysis from ' || full_name(r.coach_id));
end $$;

create or replace function public.decline_request(p_request uuid, p_reason text) returns text[]
language plpgsql security definer set search_path = public as $$
declare r analysis_requests; keys text[];
  reason_txt text := case p_reason when 'unclear' then 'the video is unclear'
                                  when 'not_my_field' then 'not the coach''s field'
                                  when 'video_problem' then 'a problem with the video' end;
begin
  if reason_txt is null then raise exception 'BAD_REASON'; end if;
  r := _coach_open_request(p_request);
  select coalesce(array_agg(storage_key) filter (where storage_key is not null), '{}')
    into keys from analysis_items where request_id = p_request;
  delete from analysis_items where request_id = p_request;   -- unsent draft work
  update analysis_requests set status = 'declined', decline_reason = p_reason,
         closed_at = now(), trainee_read = false, coach_read = true
   where id = p_request;
  perform notify(r.trainee_id, 'declined', p_request,
                 full_name(r.coach_id) || ' cannot analyze the video: ' || reason_txt);
  return keys;
end $$;

create or replace function public.send_message(p_request uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); r analysis_requests%rowtype; ok boolean; why text; mid uuid;
begin
  -- serialize per request so "one message" cannot be doubled by parallel sends
  select * into r from analysis_requests where id = p_request and (trainee_id = uid or coach_id = uid) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select can_send, reason into ok, why from followup_state(p_request);
  if not ok then raise exception 'FOLLOWUP_NOT_ALLOWED:%', why; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'EMPTY_MESSAGE'; end if;
  insert into messages (request_id, sender_id, body) values (p_request, uid, left(trim(p_body), 4000))
    returning id into mid;
  if uid = r.trainee_id then
    update analysis_requests set coach_read = false where id = p_request;
    perform notify(r.coach_id, 'followup_message', p_request, 'Follow-up message from ' || full_name(uid));
  else
    update analysis_requests set trainee_read = false where id = p_request;
    perform notify(r.trainee_id, 'coach_reply', p_request, 'Reply from coach ' || full_name(uid));
  end if;
  return mid;
end $$;

create or replace function public.admin_set_coach_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('approved','rejected','pending') then raise exception 'BAD_STATUS'; end if;
  update profiles set coach_status = p_status where id = p_user and role = 'coach';
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into coach_settings (coach_id) values (p_user) on conflict do nothing;
  perform notify(p_user, 'coach_status', null,
    case p_status when 'approved' then 'Your coach account was approved. You can now receive analysis requests.'
                  when 'rejected' then 'Your request to join as a coach was not approved.'
                  else 'Your coach status was updated.' end);
end $$;

create or replace function public.make_room(p_bytes bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_active();
  cap bigint := coalesce((select value from app_settings where key = 'storage_cap_bytes'), 943718400);
  used bigint;
  keys text[] := '{}';
  o record;
  v record;
  freed bigint;
  vkeys text[];
begin
  if p_bytes is null or p_bytes < 0 or p_bytes > 52428800 then raise exception 'BAD_SIZE'; end if;
  perform pg_advisory_xact_lock(hashtext('pilot_make_room'));     -- one cleanup at a time
  used := storage_used_bytes();
  if used + p_bytes <= cap then return keys; end if;

  -- 1) Files that no longer belong to anything (older than 30 min, so uploads in progress are safe)
  for o in
    select name, coalesce((metadata->>'size')::bigint, 0) sz from storage.objects
     where bucket_id = 'media' and not storage_key_in_use(name)
       and created_at < now() - interval '30 minutes'
     order by created_at
  loop
    exit when used + p_bytes <= cap;
    keys := keys || o.name;
    used := used - o.sz;
  end loop;

  -- 2) Oldest videos without an open request
  for v in
    select vi.id, vi.owner_id, vi.title, vi.storage_key from videos vi
     where vi.file_deleted_at is null
       and not exists (select 1 from analysis_requests r where r.video_id = vi.id and r.status in ('pending','draft'))
     order by vi.created_at
  loop
    exit when used + p_bytes <= cap;
    select array_agg(k) into vkeys from (
      select v.storage_key k
      union all
      select i.storage_key from analysis_items i join analysis_requests r on r.id = i.request_id
       where r.video_id = v.id and i.storage_key is not null and i.file_deleted_at is null
    ) t;
    select coalesce(sum((metadata->>'size')::bigint), 0) into freed
      from storage.objects where bucket_id = 'media' and name = any(vkeys);
    update videos set file_deleted_at = now() where id = v.id;
    update analysis_items set file_deleted_at = now()
     where storage_key = any(vkeys) and file_deleted_at is null;
    perform notify(v.owner_id, 'file_cleanup', null,
      'The video "' || v.title || '" was removed automatically to free up storage. The analysis text and messages were kept.');
    keys := keys || vkeys;
    used := used - freed;
  end loop;

  insert into storage_release (name, user_id)
    select k, uid from unnest(keys) k
     where storage_key_folder_owner(k) is distinct from uid
  on conflict do nothing;
  return keys;
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
    perform notify(a, 'coach_request', null, full_name(me) || ' asked to join as a coach.');
  end loop;
end $$;

-- ---------- Function privileges ----------
revoke execute on function public.valid_languages(text[]) from public, anon;
revoke execute on function public.avatar_key_owner(text) from public, anon;
revoke execute on function public.set_avatar(text) from public, anon;
revoke execute on function public.set_video_cover(uuid, text) from public, anon;
revoke execute on function public.get_feed(int, int, int) from public, anon;
grant execute on function public.valid_languages(text[]) to authenticated;
grant execute on function public.avatar_key_owner(text) to authenticated;
grant execute on function public.set_avatar(text) to authenticated;
grant execute on function public.set_video_cover(uuid, text) to authenticated;
grant execute on function public.get_feed(int, int, int) to authenticated;
