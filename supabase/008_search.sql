-- =====================================================================
-- 008: search across the app (people and videos).
-- Run in Supabase → SQL Editor AFTER 007_photos_languages_english.sql. Safe to run again.
--
--   search_people(q): trainees, coaches and admins by first/last name or username.
--   search_videos(q): videos by title, description, sport or the owner's name.
--   Every word in q must match somewhere (so "dana kite" finds Dana's kite videos).
--   Results follow the same visibility rules as the rest of the app: disabled
--   accounts are hidden, and only videos the user may watch are returned.
-- =====================================================================

create or replace function public.search_words(q text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(w), '{}') from (
    select '%' || replace(replace(replace(lower(w), '\', '\\'), '%', '\%'), '_', '\_') || '%' as w
    from regexp_split_to_table(trim(coalesce(q, '')), '\s+') w where w <> '' limit 6) t;
$$;

create or replace function public.search_people(p_query text, p_limit int default 20)
returns table (id uuid, first_name text, last_name text, username text, avatar_key text,
               role text, coach_status text, languages text[], is_sample boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.username, p.avatar_key, p.role, p.coach_status, p.languages, p.is_sample
  from profiles p
  where auth.uid() is not null and not p.disabled
    and cardinality(search_words(p_query)) > 0
    and not exists (
      select 1 from unnest(search_words(p_query)) w
       where not (lower(p.first_name || ' ' || p.last_name || ' ' || p.username) like w))
  order by (lower(p.first_name || ' ' || p.last_name) like lower(trim(p_query)) || '%') desc,
           (p.role = 'coach' and p.coach_status = 'approved') desc, p.first_name, p.last_name
  limit least(coalesce(p_limit, 20), 50);
$$;

create or replace function public.search_videos(p_query text, p_limit int default 20)
returns table (id uuid, title text, description text, sport_id int, visibility text, cover_key text,
               created_at timestamptz, file_deleted_at timestamptz, is_sample boolean,
               owner_id uuid, owner_first_name text, owner_last_name text, owner_username text, owner_avatar text)
language sql stable security definer set search_path = public as $$
  select v.id, v.title, v.description, v.sport_id, v.visibility, v.cover_key, v.created_at, v.file_deleted_at, v.is_sample,
         o.id, o.first_name, o.last_name, o.username, o.avatar_key
  from videos v
  join profiles o on o.id = v.owner_id
  left join sports s on s.id = v.sport_id
  where auth.uid() is not null
    and cardinality(search_words(p_query)) > 0
    and can_view_video(v.id)
    and (v.owner_id = auth.uid() or (not v.removed and not o.disabled))
    and not exists (
      select 1 from unnest(search_words(p_query)) w
       where not (lower(v.title || ' ' || v.description || ' ' || coalesce(s.name, '') || ' ' ||
                        o.first_name || ' ' || o.last_name || ' ' || o.username) like w))
  order by (lower(v.title) like '%' || lower(trim(p_query)) || '%') desc, v.created_at desc
  limit least(coalesce(p_limit, 20), 50);
$$;

revoke execute on function public.search_words(text) from public, anon;
revoke execute on function public.search_people(text, int) from public, anon;
revoke execute on function public.search_videos(text, int) from public, anon;
grant execute on function public.search_words(text) to authenticated;
grant execute on function public.search_people(text, int) to authenticated;
grant execute on function public.search_videos(text, int) to authenticated;
