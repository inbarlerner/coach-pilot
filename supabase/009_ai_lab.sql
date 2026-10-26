-- =====================================================================
-- 009_ai_lab.sql — AI coach lab for admins (Inbar, Jenni)
-- Run in Supabase → SQL Editor AFTER 001–008. Safe to run more than once.
-- (Was 007_ai_lab.sql before main got its own 007/008; already ran it? Nothing to redo.)
--
-- What it sets up (admins only, nobody else can see or touch any of it):
--   • ai_lab_runs     one AI analysis: settings, the frames sent, cost, the AI's output
--   • ai_lab_reviews  one review per admin per run (verdicts, corrected drawings, notes)
--   • ai_feedback     general feedback for Claude Code → turned into todos, plans, fixes
--   • bucket "ai-lab" the frames the AI saw (small JPEGs). Videos are NOT kept.
--   • a separate storage limit for the lab, and a monthly AI spend limit
-- The Claude API key lives only in Cloudflare (ANTHROPIC_API_KEY), never in the browser.
-- =====================================================================

do $$ begin
  if to_regclass('public.app_settings') is null then
    raise exception 'Run 005_auto_cleanup.sql first (יש להריץ קודם את 005)';
  end if;
end $$;

-- ---------- Settings ----------
insert into public.app_settings (key, value) values
  ('ai_lab_cap_bytes', 157286400),        -- 150 MB of frames (~100–150 runs), oldest frames removed first
  ('ai_lab_monthly_cents', 3000)          -- $30 per calendar month for the whole lab
on conflict (key) do nothing;
-- Make room for the lab inside Supabase's free 1 GB: videos 800 MB + lab 150 MB (+ small profile photos).
-- Only if the video cap is still the original default.
update public.app_settings set value = 838860800 where key = 'storage_cap_bytes' and value = 943718400;

-- ---------- Tables ----------
create table if not exists public.ai_lab_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  parent_id uuid references public.ai_lab_runs(id) on delete set null,   -- rerun of
  status text not null default 'new' check (status in ('new','running','done','error')),
  started_at timestamptz,
  sport text not null default 'kitesurf' check (sport ~ '^[a-z0-9-]{1,40}$'),
  trick text check (trick ~ '^[a-z0-9-]{1,60}\.md$'),        -- card file, null = "not sure"
  trick_title text,
  question text not null default '' check (length(question) <= 1000),
  lang text not null default 'he' check (lang in ('he','en')),
  model text not null check (model in ('opus','sonnet','haiku')),
  effort text not null check (effort in ('low','medium','high')),
  video jsonb,            -- { name, size, duration, width, height, video_id? }
  takeoff numeric,
  crop jsonb,
  frames jsonb not null default '[]',   -- [{ n, t, kind, crop, margin, size, file }]
  frames_deleted_at timestamptz,
  result jsonb,           -- model, seconds, usage, stop_reason, prompt_version, cards_hash
  analysis jsonb,         -- the AI's structured output (summary, fixes, steps with drawings…)
  error text,
  cost_cents numeric(10,2) not null default 0
);
create index if not exists ai_lab_runs_created on public.ai_lab_runs (created_at desc);

create table if not exists public.ai_lab_reviews (
  run_id uuid not null references public.ai_lab_runs(id) on delete cascade,
  reviewer uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  review jsonb not null default '{}',
  score int check (score between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (run_id, reviewer)
);

create table if not exists public.ai_feedback (
  id bigint generated always as identity primary key,
  author uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  kind text not null default 'idea' check (kind in ('bug','idea','coaching','product','other')),
  body text not null check (length(trim(body)) between 1 and 5000),
  run_id uuid references public.ai_lab_runs(id) on delete set null,
  status text not null default 'new' check (status in ('new','planned','done','dropped')),
  outcome text not null default '' check (length(outcome) <= 2000),   -- where it went: todo, plan section, fix
  updated_at timestamptz not null default now()
);

-- ---------- Access: admins only ----------
alter table public.ai_lab_runs enable row level security;
alter table public.ai_lab_reviews enable row level security;
alter table public.ai_feedback enable row level security;
revoke all on public.ai_lab_runs, public.ai_lab_reviews, public.ai_feedback from anon, authenticated;
grant select, insert, update, delete on public.ai_lab_runs, public.ai_lab_reviews, public.ai_feedback to authenticated;
grant usage, select on sequence public.ai_feedback_id_seq to authenticated;

drop policy if exists ai_lab_runs_admin on public.ai_lab_runs;
create policy ai_lab_runs_admin on public.ai_lab_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_lab_reviews_read on public.ai_lab_reviews;
create policy ai_lab_reviews_read on public.ai_lab_reviews for select to authenticated using (public.is_admin());
drop policy if exists ai_lab_reviews_own on public.ai_lab_reviews;
create policy ai_lab_reviews_own on public.ai_lab_reviews for all to authenticated   -- write only your own review
  using (public.is_admin() and reviewer = auth.uid()) with check (public.is_admin() and reviewer = auth.uid());

drop policy if exists ai_feedback_admin on public.ai_feedback;
create policy ai_feedback_admin on public.ai_feedback for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Settings the run can't fake: who made it, when, cost, status timing. Only the server
-- function path (ai_lab_start / ai_lab_finish) sets status, result and cost.
create or replace function public.ai_lab_protect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;              -- SQL editor
  if current_setting('ai_lab.trusted', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.status := 'new'; new.started_at := null;
    new.result := null; new.analysis := null; new.error := null; new.cost_cents := 0; new.frames_deleted_at := null;
  else
    new.created_by := old.created_by; new.created_at := old.created_at; new.status := old.status; new.started_at := old.started_at;
    new.result := old.result; new.analysis := old.analysis; new.error := old.error; new.cost_cents := old.cost_cents;
    new.frames_deleted_at := old.frames_deleted_at;
  end if;
  return new;
end $$;
drop trigger if exists ai_lab_protect on public.ai_lab_runs;
create trigger ai_lab_protect before insert or update on public.ai_lab_runs
  for each row execute function public.ai_lab_protect();

create or replace function public.ai_lab_touch() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then   -- feedback is always signed by whoever wrote it
    if auth.uid() is not null then new.author := auth.uid(); new.created_at := now(); new.status := 'new'; new.outcome := ''; end if;
    return new;
  end if;
  new.updated_at := now();
  if tg_table_name = 'ai_feedback' then new.author := old.author; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists ai_lab_reviews_touch on public.ai_lab_reviews;
create trigger ai_lab_reviews_touch before update on public.ai_lab_reviews for each row execute function public.ai_lab_touch();
drop trigger if exists ai_feedback_touch on public.ai_feedback;
create trigger ai_feedback_touch before insert or update on public.ai_feedback for each row execute function public.ai_lab_touch();

-- ---------- Run lifecycle (called by the server function, as the signed-in admin) ----------
-- Claims a run for analysis. Checks: admin, the run is new (or failed / stuck),
-- and this month's lab spend is under the limit. Returns the run.
create or replace function public.ai_lab_start(p_run uuid) returns public.ai_lab_runs
language plpgsql security definer set search_path = public as $$
declare r ai_lab_runs; spent numeric; cap numeric;
begin
  perform require_active();
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into r from ai_lab_runs where id = p_run for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status = 'done' then raise exception 'ALREADY_DONE'; end if;
  if r.status = 'running' and r.started_at > now() - interval '5 minutes' then raise exception 'ALREADY_RUNNING'; end if;
  if r.frames_deleted_at is not null or jsonb_array_length(r.frames) = 0 then raise exception 'NO_FRAMES'; end if;
  select coalesce(sum(cost_cents), 0) into spent from ai_lab_runs where created_at >= date_trunc('month', now());
  cap := coalesce((select value from app_settings where key = 'ai_lab_monthly_cents'), 3000);
  if spent >= cap then raise exception 'AI_MONTHLY_LIMIT'; end if;
  perform set_config('ai_lab.trusted', 'on', true);
  update ai_lab_runs set status = 'running', started_at = now(), error = null where id = p_run returning * into r;
  perform set_config('ai_lab.trusted', 'off', true);
  return r;
end $$;

create or replace function public.ai_lab_finish(p_run uuid, p_result jsonb, p_analysis jsonb, p_cost_cents numeric, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_active();
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  perform set_config('ai_lab.trusted', 'on', true);
  update ai_lab_runs set
    status = case when p_error is null then 'done' else 'error' end,
    result = p_result, analysis = p_analysis, error = left(p_error, 2000),
    cost_cents = greatest(coalesce(p_cost_cents, 0), 0)
   where id = p_run and status = 'running';
  if not found then raise exception 'NOT_RUNNING'; end if;
  perform set_config('ai_lab.trusted', 'off', true);
end $$;

-- ---------- Frames bucket: private, JPEG only, 2 MB per file, admins only ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-lab', 'ai-lab', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Key layout: <run id>/F01.jpg
create or replace function public.ai_lab_key_ok(p_name text) returns boolean
language sql immutable as $$ select p_name ~ '^[0-9a-f-]{36}/F[0-9]{2}\.jpg$' $$;

drop policy if exists ai_lab_insert on storage.objects;
create policy ai_lab_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ai-lab' and public.is_admin() and public.ai_lab_key_ok(name)
              and exists (select 1 from public.ai_lab_runs r where r.id::text = split_part(name, '/', 1) and r.status = 'new'));
drop policy if exists ai_lab_select on storage.objects;
create policy ai_lab_select on storage.objects for select to authenticated
  using (bucket_id = 'ai-lab' and public.is_admin());
drop policy if exists ai_lab_delete on storage.objects;
create policy ai_lab_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ai-lab' and public.is_admin());

-- The video cap counts only the "media" bucket; the lab has its own cap.
create or replace function public.ai_lab_storage(out used_bytes bigint, out cap_bytes bigint, out month_cents numeric, out month_cap_cents numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select coalesce(sum((metadata->>'size')::bigint), 0) into used_bytes from storage.objects where bucket_id = 'ai-lab';
  cap_bytes := coalesce((select value from app_settings where key = 'ai_lab_cap_bytes'), 157286400);
  select coalesce(sum(cost_cents), 0) into month_cents from ai_lab_runs where created_at >= date_trunc('month', now());
  month_cap_cents := coalesce((select value from app_settings where key = 'ai_lab_monthly_cents'), 3000);
end $$;

-- Called before uploading a new run's frames. Returns frame files of the OLDEST runs to
-- remove so the new frames fit; their text, AI output and reviews are kept.
create or replace function public.ai_lab_make_room(p_bytes bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  cap bigint := coalesce((select value from app_settings where key = 'ai_lab_cap_bytes'), 157286400);
  used bigint; keys text[] := '{}'; r record; freed bigint; rkeys text[];
begin
  perform require_active();
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > 52428800 then raise exception 'BAD_SIZE'; end if;
  perform pg_advisory_xact_lock(hashtext('ai_lab_make_room'));
  select coalesce(sum((metadata->>'size')::bigint), 0) into used from storage.objects where bucket_id = 'ai-lab';
  if used + p_bytes <= cap then return keys; end if;
  for r in select id, frames from ai_lab_runs where frames_deleted_at is null and status <> 'running' order by created_at loop
    exit when used + p_bytes <= cap;
    select array_agg(o.name), coalesce(sum((o.metadata->>'size')::bigint), 0) into rkeys, freed
      from storage.objects o
     where o.bucket_id = 'ai-lab' and o.name in (select f->>'file' from jsonb_array_elements(r.frames) f);
    perform set_config('ai_lab.trusted', 'on', true);
    update ai_lab_runs set frames_deleted_at = now()    -- reruns share the same frame files
     where frames_deleted_at is null and (id = r.id or frames->0->>'file' = r.frames->0->>'file');
    perform set_config('ai_lab.trusted', 'off', true);
    keys := keys || coalesce(rkeys, '{}');
    used := used - freed;
  end loop;
  return keys;
end $$;

-- Deletes a run (and its reviews). Returns its frame files that no other run still uses
-- (reruns share the original's frames), for the browser to remove from storage.
create or replace function public.ai_lab_delete_run(p_run uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare files text[];
begin
  perform require_active();
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select coalesce(array_agg(distinct f->>'file'), '{}') into files
    from ai_lab_runs r, jsonb_array_elements(r.frames) f where r.id = p_run;
  delete from ai_lab_runs where id = p_run;
  if not found then raise exception 'NOT_FOUND'; end if;
  return coalesce((select array_agg(x) from unnest(files) x
                    where not exists (select 1 from ai_lab_runs r, jsonb_array_elements(r.frames) f where f->>'file' = x)), '{}');
end $$;

-- ---------- Function privileges ----------
revoke execute on function public.ai_lab_protect() from public, anon, authenticated;
revoke execute on function public.ai_lab_start(uuid) from public, anon;
revoke execute on function public.ai_lab_finish(uuid, jsonb, jsonb, numeric, text) from public, anon;
revoke execute on function public.ai_lab_storage() from public, anon;
revoke execute on function public.ai_lab_make_room(bigint) from public, anon;
revoke execute on function public.ai_lab_key_ok(text) from public, anon;
revoke execute on function public.ai_lab_delete_run(uuid) from public, anon;
grant execute on function public.ai_lab_delete_run(uuid) to authenticated;
grant execute on function public.ai_lab_start(uuid) to authenticated;
grant execute on function public.ai_lab_finish(uuid, jsonb, jsonb, numeric, text) to authenticated;
grant execute on function public.ai_lab_storage() to authenticated;
grant execute on function public.ai_lab_make_room(bigint) to authenticated;
grant execute on function public.ai_lab_key_ok(text) to authenticated;
