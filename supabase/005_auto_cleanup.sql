-- =====================================================================
-- 005_auto_cleanup.sql — free up storage automatically
-- Run in Supabase → SQL Editor AFTER 003_storage.sql. Safe to run again.
-- Does not delete anything when you run it; it only sets up the rule:
--
--   Before every upload, if (files in storage + the new file) would pass the
--   cap (default 900 MB, under the free plan's 1 GB), the OLDEST videos lose
--   their files until there is room:
--     • the video file and the coach's voice/video recordings are deleted
--     • the request, the analysis TEXT and follow-up messages are kept
--     • videos in an OPEN request (waiting / draft) are never touched
--     • the video's owner gets a notification
--   Leftover files that no longer belong to anything are cleared first.
-- =====================================================================

do $$ begin
  if to_regclass('public.storage_release') is null then
    raise exception 'Run 003_storage.sql first (יש להריץ קודם את 003_storage.sql)';
  end if;
end $$;

-- ---------- Settings (cap can be changed later, e.g. after a plan upgrade) ----------
create table if not exists public.app_settings (
  key text primary key,
  value bigint not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings (key, value) values ('storage_cap_bytes', 943718400)   -- 900 MB
on conflict (key) do nothing;

-- ---------- Mark files removed by cleanup (rows and analysis text are kept) ----------
alter table public.videos add column if not exists file_deleted_at timestamptz;
alter table public.analysis_items add column if not exists file_deleted_at timestamptz;

-- A file whose row is marked as removed no longer counts as "in use" (so it can be deleted).
create or replace function public.storage_key_in_use(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from videos where storage_key = p_name and file_deleted_at is null)
      or exists (select 1 from analysis_items where storage_key = p_name and file_deleted_at is null);
$$;

create or replace function public.storage_used_bytes() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'media';
$$;
revoke execute on function public.storage_used_bytes() from public, anon, authenticated;

-- ---------- make_room: called by the app right before an upload ----------
-- Returns the files the caller should remove from storage (they are released to the caller).
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
      'הסרטון ״' || v.title || '״ נמחק אוטומטית כדי לפנות מקום באחסון. טקסט הניתוח וההודעות נשמרו.');
    keys := keys || vkeys;
    used := used - freed;
  end loop;

  insert into storage_release (name, user_id)
    select k, uid from unnest(keys) k
     where storage_key_folder_owner(k) is distinct from uid
  on conflict do nothing;
  return keys;
end $$;
revoke execute on function public.make_room(bigint) from public, anon;
grant execute on function public.make_room(bigint) to authenticated;

-- A video whose file was cleaned up cannot be sent for analysis.
create or replace function public.block_request_on_removed_file() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from videos where id = new.video_id and file_deleted_at is not null) then
    raise exception 'FILE_REMOVED';
  end if;
  return new;
end $$;
drop trigger if exists requests_block_removed_file on public.analysis_requests;
create trigger requests_block_removed_file before insert on public.analysis_requests
  for each row execute function public.block_request_on_removed_file();

-- ---------- Admin: storage usage ----------
create or replace function public.admin_storage_usage(out used_bytes bigint, out cap_bytes bigint, out file_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  used_bytes := storage_used_bytes();
  cap_bytes := coalesce((select value from app_settings where key = 'storage_cap_bytes'), 943718400);
  select count(*)::int into file_count from storage.objects where bucket_id = 'media';
end $$;
revoke execute on function public.admin_storage_usage() from public, anon;
grant execute on function public.admin_storage_usage() to authenticated;

-- ---------- Feed: skip videos whose file was cleaned up ----------
create or replace function public.get_feed(p_sport int default null, p_limit int default 10, p_offset int default 0)
returns table (
  video_id uuid, title text, description text, sport_id int, created_at timestamptz,
  owner_id uuid, owner_name text, owner_username text, is_sample boolean,
  request_id uuid, coach_id uuid, coach_name text, coach_username text, comment_count int
)
language sql stable security definer set search_path = public as $$
  select v.id, v.title, v.description, v.sport_id, v.created_at,
         o.id, o.first_name || ' ' || o.last_name, o.username, v.is_sample,
         r.id, c.id, c.first_name || ' ' || c.last_name, c.username,
         (select count(*)::int from comments cm where cm.video_id = v.id)
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
