-- =====================================================================
-- 003_storage.sql — private file storage in Supabase (replaces Cloudflare R2)
-- Run in Supabase → SQL Editor AFTER 001_schema.sql and 002_cron.sql.
-- Safe to run more than once. It does not delete any data or users.
--
-- What it sets up:
--   • A PRIVATE bucket "media": 50 MB per file, video/audio types only.
--   • Access rules on stored files that mirror the app's permissions:
--       - upload only into your own folder (responses: approved coaches only)
--       - read a file only if you may see the video / analysis it belongs to
--       - no overwriting; delete only files no longer used by the app
--   • The app registers a file only after checking it really exists in storage,
--     and takes its real size and type from storage (not from the browser).
-- =====================================================================

do $$ begin
  if to_regclass('public.videos') is null then
    raise exception 'Run 001_schema.sql first (יש להריץ קודם את 001_schema.sql)';
  end if;
end $$;

-- ---------- Bucket: private, 50 MB, video/audio only ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array[
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/x-m4a', 'audio/m4a',
  'audio/aac', 'audio/wav', 'audio/x-wav'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- Release grants ----------
-- When a trainee deletes a video, the coach's response files (in the coach's
-- folder) are released to the trainee so the app can remove them from storage.
create table if not exists public.storage_release (
  name text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (name, user_id)
);
alter table public.storage_release enable row level security;
revoke all on public.storage_release from anon, authenticated;

-- ---------- Helpers used by the storage access rules ----------
-- Key layout: videos/<user id>/<random id>.<ext>  |  responses/<coach id>/<random id>.<ext>
create or replace function public.storage_key_folder_owner(p_name text) returns uuid
language sql immutable as $$
  select case when p_name ~ '^(videos|responses)/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'
              then split_part(p_name, '/', 2)::uuid end;
$$;

create or replace function public.storage_key_in_use(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from videos where storage_key = p_name)
      or exists (select 1 from analysis_items where storage_key = p_name);
$$;

create or replace function public.can_upload_storage_key(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and public.storage_key_folder_owner(p_name) = auth.uid()
     and public.is_active_user()
     and (split_part(p_name, '/', 1) = 'videos'
          or exists (select 1 from profiles where id = auth.uid()
                     and role = 'coach' and coach_status = 'approved'));
$$;

create or replace function public.can_read_storage_key(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.storage_key_folder_owner(p_name) = auth.uid()                       -- your own upload
    or exists (select 1 from videos v
               where v.storage_key = p_name and public.can_view_video(v.id))  -- same rule as the videos table
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

create or replace function public.can_delete_storage_key(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and public.is_active_user()
     and not public.storage_key_in_use(p_name)                                -- never break a live video/analysis
     and (public.storage_key_folder_owner(p_name) = auth.uid()
          or exists (select 1 from storage_release s where s.name = p_name and s.user_id = auth.uid()));
$$;

revoke execute on function public.storage_key_folder_owner(text) from public, anon;
revoke execute on function public.storage_key_in_use(text) from public, anon;
revoke execute on function public.can_upload_storage_key(text) from public, anon;
revoke execute on function public.can_read_storage_key(text) from public, anon;
revoke execute on function public.can_delete_storage_key(text) from public, anon;
grant execute on function public.storage_key_folder_owner(text) to authenticated;
grant execute on function public.storage_key_in_use(text) to authenticated;
grant execute on function public.can_upload_storage_key(text) to authenticated;
grant execute on function public.can_read_storage_key(text) to authenticated;
grant execute on function public.can_delete_storage_key(text) to authenticated;

-- ---------- Access rules on stored files (no UPDATE rule = no overwriting) ----------
drop policy if exists pilot_media_insert on storage.objects;
create policy pilot_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.can_upload_storage_key(name));

drop policy if exists pilot_media_select on storage.objects;
create policy pilot_media_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.can_read_storage_key(name));

drop policy if exists pilot_media_delete on storage.objects;
create policy pilot_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.can_delete_storage_key(name));

-- =====================================================================
-- App functions updated for Supabase Storage (same names and arguments)
-- =====================================================================
create or replace function public._stored_file(p_key text, out size bigint, out mimetype text)
language plpgsql stable security definer set search_path = public as $$
begin
  select coalesce((o.metadata->>'size')::bigint, 0), lower(split_part(coalesce(o.metadata->>'mimetype', ''), ';', 1))
    into size, mimetype
    from storage.objects o where o.bucket_id = 'media' and o.name = p_key;
  if not found then raise exception 'FILE_NOT_FOUND'; end if;
end $$;
revoke execute on function public._stored_file(text) from public, anon, authenticated;

create or replace function public.create_video(
  p_storage_key text, p_content_type text, p_size bigint,
  p_sport int, p_title text, p_description text, p_visibility text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); vid uuid; f record;
begin
  if p_storage_key not like ('videos/' || uid::text || '/%') then raise exception 'BAD_KEY'; end if;
  select * into f from _stored_file(p_storage_key);
  if f.mimetype not like 'video/%' then raise exception 'BAD_TYPE'; end if;
  if p_visibility not in ('private','public') then raise exception 'BAD_VISIBILITY'; end if;
  if not exists (select 1 from sports where id = p_sport and active) then raise exception 'BAD_SPORT'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'TITLE_REQUIRED'; end if;
  insert into videos (owner_id, sport_id, title, description, storage_key, content_type, size_bytes, visibility)
  values (uid, p_sport, left(trim(p_title),120), left(coalesce(p_description,''),2000),
          p_storage_key, f.mimetype, f.size, p_visibility)
  returning id into vid;
  return vid;
end $$;

create or replace function public.add_analysis_media(p_request uuid, p_kind text, p_storage_key text, p_content_type text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r analysis_requests; iid uuid; f record;
begin
  r := _coach_open_request(p_request);
  if p_kind not in ('audio','video') then raise exception 'BAD_KIND'; end if;
  if p_storage_key not like ('responses/' || auth.uid()::text || '/%') then raise exception 'BAD_KEY'; end if;
  select * into f from _stored_file(p_storage_key);
  if f.mimetype not like (p_kind || '/%') then raise exception 'BAD_TYPE'; end if;
  insert into analysis_items (request_id, kind, storage_key, content_type)
  values (p_request, p_kind, p_storage_key, f.mimetype) returning id into iid;
  return iid;
end $$;

-- Owner deletes own video. Returns the stored files to remove; the coach's
-- response files are released to the owner so the app can remove them too.
create or replace function public.delete_video(p_video uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); keys text[];
begin
  if not exists (select 1 from videos where id = p_video and owner_id = uid) then raise exception 'NOT_FOUND'; end if;
  select array_agg(k) into keys from (
    select storage_key k from videos where id = p_video
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

-- Function privileges (Supabase grants new functions to everyone by default)
revoke execute on function public.create_video(text, text, bigint, int, text, text, text) from public, anon;
revoke execute on function public.add_analysis_media(uuid, text, text, text) from public, anon;
revoke execute on function public.delete_video(uuid) from public, anon;
grant execute on function public.create_video(text, text, bigint, int, text, text, text) to authenticated;
grant execute on function public.add_analysis_media(uuid, text, text, text) to authenticated;
grant execute on function public.delete_video(uuid) to authenticated;
