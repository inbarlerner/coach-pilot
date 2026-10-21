-- =====================================================================
-- Coaching pilot — database schema, permissions (RLS) and server rules
-- Run once in Supabase → SQL Editor. Then run 002_cron.sql.
-- All state changes to requests / analyses / messages go through
-- SECURITY DEFINER functions that check permissions server-side.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Sports ----------------------------------------------------
create table public.sports (
  id serial primary key,
  name text not null unique,
  active boolean not null default true,
  sort int not null default 100
);
insert into public.sports (name, sort) values
  ('קייטסרפינג', 1), ('סקי', 2), ('סנובורד', 3), ('פאדל', 4);

-- ---------- Profiles --------------------------------------------------
-- Public part (names, role, bio). Email/phone live in profile_private.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  role text not null default 'trainee' check (role in ('trainee','coach','admin')),
  coach_status text check (coach_status in ('pending','approved','rejected')),
  bio text not null default '',
  disabled boolean not null default false,
  onboarded boolean not null default false,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profile_private (
  id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  phone text not null default ''
);

create table public.user_sports (       -- sports of interest
  user_id uuid references public.profiles(id) on delete cascade,
  sport_id int references public.sports(id) on delete cascade,
  primary key (user_id, sport_id)
);

create table public.coach_sports (      -- sports the coach coaches
  coach_id uuid references public.profiles(id) on delete cascade,
  sport_id int references public.sports(id) on delete cascade,
  primary key (coach_id, sport_id)
);

create table public.coach_settings (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  quota int not null default 3 check (quota between 0 and 100),
  response_hours int not null default 48 check (response_hours between 1 and 720),
  followup_policy text not null default 'one'
    check (followup_policy in ('none','one','chat24','unlimited')),
  updated_at timestamptz not null default now()
);

-- ---------- Videos ----------------------------------------------------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  sport_id int not null references public.sports(id),
  title text not null check (length(title) between 1 and 120),
  description text not null default '',
  storage_key text not null unique,
  content_type text not null,
  size_bytes bigint not null default 0,
  visibility text not null default 'private' check (visibility in ('private','public')),
  removed boolean not null default false,   -- removed by admin
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.videos (visibility, created_at desc);
create index on public.videos (owner_id);

-- ---------- Analysis requests ----------------------------------------
create table public.analysis_requests (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  trainee_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  question text not null default '',
  status text not null default 'pending'
    check (status in ('pending','draft','completed','declined','expired')),
  decline_reason text check (decline_reason in ('unclear','not_my_field','video_problem')),
  -- snapshot of the coach's terms at the moment of sending
  terms jsonb not null,
  response_hours int not null,
  followup_policy text not null,
  created_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  completed_at timestamptz,
  closed_at timestamptz,
  trainee_read boolean not null default true,
  coach_read boolean not null default false
);
create index on public.analysis_requests (coach_id, status);
create index on public.analysis_requests (trainee_id, status);
create index on public.analysis_requests (status, deadline_at);

create table public.analysis_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.analysis_requests(id) on delete cascade,
  kind text not null check (kind in ('text','audio','video')),
  body text,
  storage_key text unique,
  content_type text,
  created_at timestamptz not null default now()
);
create unique index analysis_one_text on public.analysis_items (request_id) where kind = 'text';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.analysis_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  request_id uuid references public.analysis_requests(id) on delete cascade,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Helper functions
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled);
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not disabled);
$$;

create or replace function public.require_active() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and not disabled) then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  return auth.uid();
end $$;

create or replace function public.notify(p_user uuid, p_type text, p_request uuid, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, request_id, body) values (p_user, p_type, p_request, p_body);
$$;
revoke execute on function public.notify(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.full_name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select first_name || ' ' || last_name from profiles where id = p;
$$;

-- Can the current user see this video?
create or replace function public.can_view_video(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from videos vi join profiles o on o.id = vi.owner_id
    where vi.id = v and (
      (vi.visibility = 'public' and not vi.removed and not o.disabled)
      or vi.owner_id = auth.uid()
      or exists (select 1 from analysis_requests r where r.video_id = vi.id and r.coach_id = auth.uid())
      or public.is_admin()
    )
  );
$$;

-- =====================================================================
-- Registration: profile created from signup metadata.
-- A user can only ask to be a coach (status pending). Never admin.
-- =====================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wants_coach boolean := (m->>'role') = 'coach';
  s text;
begin
  insert into profiles (id, first_name, last_name, username, role, coach_status, bio)
  values (
    new.id,
    coalesce(nullif(trim(m->>'first_name'), ''), '—'),
    coalesce(nullif(trim(m->>'last_name'), ''), '—'),
    lower(coalesce(nullif(trim(m->>'username'), ''), 'user_' || substr(replace(new.id::text,'-',''),1,10))),
    case when wants_coach then 'coach' else 'trainee' end,
    case when wants_coach then 'pending' else null end,
    case when wants_coach then left(coalesce(m->>'bio',''), 1000) else '' end
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

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where username = lower(trim(p_username)));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Protect privileged profile columns from self-edits.
create or replace function public.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;  -- admin, or SQL editor / service
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
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- =====================================================================
-- Row level security
-- =====================================================================
alter table public.sports enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.user_sports enable row level security;
alter table public.coach_sports enable row level security;
alter table public.coach_settings enable row level security;
alter table public.videos enable row level security;
alter table public.analysis_requests enable row level security;
alter table public.analysis_items enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;

create policy sports_read on public.sports for select using (true);
create policy sports_admin on public.sports for all using (public.is_admin()) with check (public.is_admin());

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy private_read on public.profile_private for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy private_update on public.profile_private for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_sports_read on public.user_sports for select to authenticated using (true);
create policy user_sports_write on public.user_sports for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy coach_sports_read on public.coach_sports for select to authenticated using (true);
create policy coach_sports_write on public.coach_sports for all to authenticated
  using (coach_id = auth.uid() and exists (select 1 from profiles where id = auth.uid() and role = 'coach'))
  with check (coach_id = auth.uid() and exists (select 1 from profiles where id = auth.uid() and role = 'coach'));

create policy coach_settings_read on public.coach_settings for select to authenticated using (true);
create policy coach_settings_update on public.coach_settings for update to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- Videos: visibility enforced here (feed, profiles, direct links all go through this)
create policy videos_read on public.videos for select to authenticated
  using (public.can_view_video(id));
create policy videos_update_owner on public.videos for update to authenticated
  using (owner_id = auth.uid() and public.is_active_user())
  with check (owner_id = auth.uid());

create or replace function public.protect_video_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.owner_id is distinct from old.owner_id or new.storage_key is distinct from old.storage_key
     or new.removed is distinct from old.removed or new.is_sample is distinct from old.is_sample
     or new.size_bytes is distinct from old.size_bytes or new.content_type is distinct from old.content_type then
    raise exception 'FORBIDDEN_FIELD';
  end if;
  return new;
end $$;
create trigger videos_protect before update on public.videos
  for each row execute function public.protect_video_columns();

-- Requests: participants, admin, or anyone for completed analyses of public videos.
create policy requests_read on public.analysis_requests for select to authenticated using (
  trainee_id = auth.uid() or coach_id = auth.uid() or public.is_admin()
  or (status = 'completed' and exists (
        select 1 from videos v join profiles o on o.id = v.owner_id
        where v.id = video_id and v.visibility = 'public' and not v.removed and not o.disabled))
);

-- Analysis items: coach always; trainee only once completed; public once completed + video public.
create policy items_read on public.analysis_items for select to authenticated using (
  exists (
    select 1 from analysis_requests r
    where r.id = request_id and (
      r.coach_id = auth.uid()
      or public.is_admin()
      or (r.status = 'completed' and r.trainee_id = auth.uid())
      or (r.status = 'completed' and exists (
            select 1 from videos v join profiles o on o.id = v.owner_id
            where v.id = r.video_id and v.visibility = 'public' and not v.removed and not o.disabled))
    )
  )
);

-- Follow-up messages are always private to the two participants.
create policy messages_read on public.messages for select to authenticated using (
  exists (select 1 from analysis_requests r where r.id = request_id
          and (r.trainee_id = auth.uid() or r.coach_id = auth.uid()))
);

create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy comments_read on public.comments for select to authenticated
  using (public.can_view_video(video_id));
create policy comments_insert on public.comments for insert to authenticated with check (
  author_id = auth.uid() and public.is_active_user()
  and exists (select 1 from videos v where v.id = video_id and v.visibility = 'public' and not v.removed)
);
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy reports_insert on public.reports for insert to authenticated with check (
  reporter_id = auth.uid() and exists (select 1 from videos v where v.id = video_id and v.visibility = 'public')
);
create policy reports_admin on public.reports for select to authenticated using (public.is_admin());
create policy reports_admin_update on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- Expiry — runs every minute from pg_cron (002_cron.sql), and also
-- lazily before sensitive actions. Frees quota (only pending/draft count).
-- =====================================================================
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
    perform notify(r.trainee_id, 'expired', r.id, 'זמן התגובה של המאמן עבר. הבקשה הועברה לבקשות שלא הושלמו.');
    perform notify(r.coach_id, 'expired', r.id, 'זמן התגובה לבקשה עבר. הבקשה הועברה לבקשות שלא הושלמו.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_requests() from public, anon;
grant execute on function public.expire_requests() to authenticated;

-- =====================================================================
-- Videos
-- =====================================================================
create or replace function public.create_video(
  p_storage_key text, p_content_type text, p_size bigint,
  p_sport int, p_title text, p_description text, p_visibility text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); vid uuid;
begin
  if p_storage_key not like ('videos/' || uid::text || '/%') then raise exception 'BAD_KEY'; end if;
  if p_visibility not in ('private','public') then raise exception 'BAD_VISIBILITY'; end if;
  if not exists (select 1 from sports where id = p_sport and active) then raise exception 'BAD_SPORT'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'TITLE_REQUIRED'; end if;
  insert into videos (owner_id, sport_id, title, description, storage_key, content_type, size_bytes, visibility)
  values (uid, p_sport, left(trim(p_title),120), left(coalesce(p_description,''),2000),
          p_storage_key, p_content_type, p_size, p_visibility)
  returning id into vid;
  return vid;
end $$;

-- Owner deletes own video. Returns storage keys to remove from file storage.
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
  delete from videos where id = p_video;
  return coalesce(keys, '{}');
end $$;

-- =====================================================================
-- Coaches: search & availability
-- =====================================================================
create or replace function public.coach_active_count(p_coach uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from analysis_requests where coach_id = p_coach and status in ('pending','draft');
$$;

create or replace function public.search_coaches(p_query text default '', p_sport int default null)
returns table (
  id uuid, first_name text, last_name text, username text, bio text,
  sport_ids int[], quota int, response_hours int, followup_policy text,
  active_count int, available boolean, is_sample boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.username, p.bio,
         coalesce((select array_agg(cs.sport_id order by cs.sport_id) from coach_sports cs where cs.coach_id = p.id), '{}'),
         s.quota, s.response_hours, s.followup_policy,
         coach_active_count(p.id),
         coach_active_count(p.id) < s.quota,
         p.is_sample
  from profiles p join coach_settings s on s.coach_id = p.id
  where p.role = 'coach' and p.coach_status = 'approved' and not p.disabled
    and (coalesce(p_query,'') = '' or (p.first_name || ' ' || p.last_name || ' ' || p.username) ilike '%' || p_query || '%')
    and (p_sport is null or exists (select 1 from coach_sports cs where cs.coach_id = p.id and cs.sport_id = p_sport))
  order by p.is_sample, p.first_name;
$$;

-- =====================================================================
-- Analysis requests
-- Quota race-safety: lock the coach's settings row (FOR UPDATE) so
-- concurrent requests to the same coach are serialized.
-- =====================================================================
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

  perform notify(p_coach, 'new_request', rid, 'בקשת ניתוח חדשה מ־' || full_name(uid) || ': ' || v.title);
  return rid;
end $$;

create or replace function public.mark_request_read(p_request uuid, p_read boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active();
begin
  update analysis_requests set trainee_read = p_read where id = p_request and trainee_id = uid;
  update analysis_requests set coach_read = p_read where id = p_request and coach_id = uid;
end $$;

-- internal: lock request for the coach, ensure it is still open
create or replace function public._coach_open_request(p_request uuid) returns analysis_requests
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_active(); r analysis_requests%rowtype;
begin
  perform expire_requests();
  select * into r from analysis_requests where id = p_request and coach_id = uid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status = 'expired' then raise exception 'EXPIRED'; end if;
  if r.status not in ('pending','draft') then raise exception 'NOT_OPEN'; end if;
  if r.deadline_at <= now() then raise exception 'EXPIRED'; end if;
  return r;
end $$;
revoke execute on function public._coach_open_request(uuid) from public, anon, authenticated;

create or replace function public.set_analysis_text(p_request uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare r analysis_requests;
begin
  r := _coach_open_request(p_request);
  delete from analysis_items where request_id = p_request and kind = 'text';
  if coalesce(trim(p_text),'') <> '' then
    insert into analysis_items (request_id, kind, body) values (p_request, 'text', left(p_text, 20000));
  end if;
end $$;

create or replace function public.add_analysis_media(p_request uuid, p_kind text, p_storage_key text, p_content_type text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r analysis_requests; iid uuid;
begin
  r := _coach_open_request(p_request);
  if p_kind not in ('audio','video') then raise exception 'BAD_KIND'; end if;
  if p_storage_key not like ('responses/' || auth.uid()::text || '/%') then raise exception 'BAD_KEY'; end if;
  insert into analysis_items (request_id, kind, storage_key, content_type)
  values (p_request, p_kind, p_storage_key, p_content_type) returning id into iid;
  return iid;
end $$;

-- returns the storage key so the caller can delete the file
create or replace function public.remove_analysis_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare rid uuid; k text; r analysis_requests;
begin
  select request_id, storage_key into rid, k from analysis_items where id = p_item;
  if rid is null then raise exception 'NOT_FOUND'; end if;
  r := _coach_open_request(rid);
  delete from analysis_items where id = p_item;
  return k;
end $$;

create or replace function public.save_draft(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r analysis_requests;
begin
  r := _coach_open_request(p_request);
  update analysis_requests set status = 'draft', coach_read = true where id = p_request;
end $$;

-- X: delete analysis work, back to "unread". Deadline is NOT reset.
create or replace function public.discard_draft(p_request uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare r analysis_requests; keys text[];
begin
  r := _coach_open_request(p_request);
  select coalesce(array_agg(storage_key) filter (where storage_key is not null), '{}')
    into keys from analysis_items where request_id = p_request;
  delete from analysis_items where request_id = p_request;
  update analysis_requests set status = 'pending', coach_read = false where id = p_request;
  return keys;
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
                 'התקבל ניתוח מ־' || full_name(r.coach_id));
end $$;

create or replace function public.decline_request(p_request uuid, p_reason text) returns text[]
language plpgsql security definer set search_path = public as $$
declare r analysis_requests; keys text[];
  reason_he text := case p_reason when 'unclear' then 'הסרטון לא ברור'
                                  when 'not_my_field' then 'לא התחום של המאמן'
                                  when 'video_problem' then 'בעיה בסרטון' end;
begin
  if reason_he is null then raise exception 'BAD_REASON'; end if;
  r := _coach_open_request(p_request);
  select coalesce(array_agg(storage_key) filter (where storage_key is not null), '{}')
    into keys from analysis_items where request_id = p_request;
  delete from analysis_items where request_id = p_request;   -- unsent draft work
  update analysis_requests set status = 'declined', decline_reason = p_reason,
         closed_at = now(), trainee_read = false, coach_read = true
   where id = p_request;
  perform notify(r.trainee_id, 'declined', p_request,
                 full_name(r.coach_id) || ' לא יכול לנתח את הסרטון: ' || reason_he);
  return keys;
end $$;

-- =====================================================================
-- Follow-up messages — by the policy SNAPSHOT stored on the request
-- =====================================================================
create or replace function public.followup_state(p_request uuid)
returns table (can_send boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare r analysis_requests%rowtype; uid uuid := auth.uid();
  trainee_msgs int; coach_msgs int; is_trainee boolean;
begin
  select * into r from analysis_requests where id = p_request and (trainee_id = uid or coach_id = uid);
  if not found then return query select false, 'NOT_FOUND'; return; end if;
  if r.status <> 'completed' then return query select false, 'NOT_COMPLETED'; return; end if;
  if exists (select 1 from profiles where id = uid and disabled) then
    return query select false, 'ACCOUNT_DISABLED'; return; end if;
  is_trainee := (r.trainee_id = uid);
  select count(*) filter (where sender_id = r.trainee_id), count(*) filter (where sender_id = r.coach_id)
    into trainee_msgs, coach_msgs from messages where request_id = p_request;

  if r.followup_policy = 'none' then
    return query select false, 'POLICY_NONE';
  elsif r.followup_policy = 'one' then
    if is_trainee then
      if trainee_msgs = 0 then return query select true, 'ONE_TRAINEE';
      else return query select false, 'ONE_USED'; end if;
    else
      if trainee_msgs = 0 then return query select false, 'WAIT_TRAINEE';
      elsif coach_msgs = 0 then return query select true, 'ONE_COACH_REPLY';
      else return query select false, 'ONE_REPLIED'; end if;
    end if;
  elsif r.followup_policy = 'chat24' then
    if now() < r.completed_at + interval '24 hours' then return query select true, 'CHAT24';
    else return query select false, 'CHAT24_ENDED'; end if;
  else
    return query select true, 'UNLIMITED';
  end if;
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
    perform notify(r.coach_id, 'followup_message', p_request, 'הודעת המשך מ־' || full_name(uid));
  else
    update analysis_requests set trainee_read = false where id = p_request;
    perform notify(r.trainee_id, 'coach_reply', p_request, 'תשובה מהמאמן ' || full_name(uid));
  end if;
  return mid;
end $$;

-- =====================================================================
-- Feed (public only), preferring the viewer's sports
-- =====================================================================
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
    and auth.uid() is not null
    and (p_sport is null or v.sport_id = p_sport)
  order by (v.sport_id in (select sport_id from user_sports where user_id = auth.uid())) desc,
           v.created_at desc
  limit least(p_limit, 50) offset p_offset;
$$;

-- =====================================================================
-- Admin
-- =====================================================================
create or replace function public.admin_set_coach_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('approved','rejected','pending') then raise exception 'BAD_STATUS'; end if;
  update profiles set coach_status = p_status where id = p_user and role = 'coach';
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into coach_settings (coach_id) values (p_user) on conflict do nothing;
  perform notify(p_user, 'coach_status', null,
    case p_status when 'approved' then 'חשבון המאמן שלך אושר. אפשר לקבל בקשות ניתוח.'
                  when 'rejected' then 'בקשת ההצטרפות כמאמן לא אושרה.'
                  else 'סטטוס המאמן שלך עודכן.' end);
end $$;

create or replace function public.admin_set_disabled(p_user uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_DISABLE_SELF'; end if;
  update profiles set disabled = p_disabled where id = p_user;
end $$;

create or replace function public.admin_set_video_removed(p_video uuid, p_removed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  update videos set removed = p_removed where id = p_video;
  update reports set resolved = true where video_id = p_video;
end $$;

-- Sample-data flag (admin only) — sample content is labelled "דוגמה" in the UI
create or replace function public.admin_set_sample(p_user uuid, p_sample boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  update profiles set is_sample = p_sample where id = p_user;
  update videos set is_sample = p_sample where owner_id = p_user;
end $$;

-- =====================================================================
-- Grants: tables are read via RLS; writes go through functions above
-- (except a few owner-only updates guarded by RLS + triggers).
-- =====================================================================
revoke all on all tables in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant select on public.sports to anon;
grant update (first_name, last_name, bio, onboarded) on public.profiles to authenticated;
grant update (phone) on public.profile_private to authenticated;
grant insert, delete on public.user_sports to authenticated;
grant insert, delete on public.coach_sports to authenticated;
grant update (quota, response_hours, followup_policy, updated_at) on public.coach_settings to authenticated;
grant update (title, description, visibility, sport_id) on public.videos to authenticated;
grant update (read) on public.notifications to authenticated;
grant insert, delete on public.comments to authenticated;
grant insert on public.reports to authenticated;
grant insert, update, delete on public.sports to authenticated;  -- RLS limits to admin
grant usage, select on all sequences in schema public to authenticated;

-- No anonymous execution of any app function except username check
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, text, uuid, text) from authenticated;
revoke execute on function public._coach_open_request(uuid) from authenticated;
grant execute on function public.username_available(text) to anon;
