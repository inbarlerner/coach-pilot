-- =====================================================================
-- 012: users can delete their own account (Settings → Delete account).
-- Run in Supabase → SQL Editor AFTER 011_social_login.sql. Safe to run again.
--
-- No service-role key: the browser does it in three steps, as the user.
--   1. start_account_deletion()  deletes/changes the app data (below), flags the
--      profile (deleting_at) and returns every stored file of the user.
--   2. The browser removes those files through the Storage API (the storage
--      rules allow it, because nothing refers to them any more).
--   3. finish_account_deletion() checks no files are left and deletes the
--      login (auth.users); everything else that is still linked goes with it.
--   If step 2 or 3 is interrupted, the app finishes it on the next sign-in.
--
-- What happens (privacy policy, "Deleting your account and data"):
--   • Trainee side: their videos, requests (with the coaches' analyses of them),
--     comments and reports are deleted. Coaches of open requests are told.
--   • Coach side ("Option A"): open requests are declined ('coach_left') and the
--     trainees are told. Completed analyses stay with the trainee: the text,
--     drawings and messages are kept and shown as "Former coach"
--     (coach_id / sender_id become null). The coach's voice and video
--     recordings are deleted.
--   • Admins cannot delete their own account (the platform needs an admin).
-- =====================================================================

do $$ begin
  if to_regprocedure('public.complete_signup(text,text,text,text,text[],integer[],boolean,text,integer[],boolean)') is null then
    raise exception 'Run 011_social_login.sql first';
  end if;
end $$;

alter table public.profiles add column if not exists deleting_at timestamptz;   -- set by start_account_deletion only

-- ---------- Completed work outlives a deleted coach ----------
alter table public.analysis_requests alter column coach_id drop not null;
alter table public.analysis_requests drop constraint if exists analysis_requests_coach_id_fkey;
alter table public.analysis_requests add constraint analysis_requests_coach_id_fkey
  foreign key (coach_id) references public.profiles(id) on delete set null;   -- same name: the app's joins use it

alter table public.messages alter column sender_id drop not null;
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete set null;

alter table public.analysis_requests drop constraint if exists analysis_requests_decline_reason_check;
alter table public.analysis_requests add constraint analysis_requests_decline_reason_check
  check (decline_reason in ('unclear','not_my_field','video_problem','coach_left'));

-- ---------- Follow-ups: closed once the coach has left ----------
create or replace function public.followup_state(p_request uuid)
returns table (can_send boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare r analysis_requests%rowtype; uid uuid := auth.uid();
  trainee_msgs int; coach_msgs int; is_trainee boolean;
begin
  select * into r from analysis_requests where id = p_request and (trainee_id = uid or coach_id = uid);
  if not found then return query select false, 'NOT_FOUND'; return; end if;
  if r.status <> 'completed' then return query select false, 'NOT_COMPLETED'; return; end if;
  if r.coach_id is null then return query select false, 'COACH_LEFT'; return; end if;
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

-- ---------- The user's stored files (media folder + files released to them + photos) ----------
create or replace function public.account_files(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'media', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                        where o.bucket_id = 'media'
                          and (storage_key_folder_owner(o.name) = p_user
                               or exists (select 1 from storage_release s where s.name = o.name and s.user_id = p_user))), '[]'::jsonb),
    'avatars', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                          where o.bucket_id = 'avatars' and avatar_key_owner(o.name) = p_user), '[]'::jsonb));
$$;
revoke execute on function public.account_files(uuid) from public, anon, authenticated;

-- ---------- Step 1 ----------
create or replace function public.start_account_deletion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := require_active();
  p profiles;
  r record;
begin
  select * into p from profiles where id = me for update;
  if p.role = 'admin' then raise exception 'ADMIN_CANNOT_DELETE'; end if;

  if p.deleting_at is null then
    -- As a coach: cancel open requests (unsent draft work goes too) and tell the trainees
    for r in select id, trainee_id from analysis_requests
              where coach_id = me and status in ('pending','draft') for update loop
      delete from analysis_items where request_id = r.id;
      update analysis_requests set status = 'declined', decline_reason = 'coach_left',
             closed_at = now(), trainee_read = false, coach_read = true
       where id = r.id;
      perform notify(r.trainee_id, 'declined', r.id,
        full_name(me) || ' closed their Coachit account and cannot analyze this video. You can send it to another coach.');
    end loop;
    -- As a coach: my voice/video recordings go; text and drawings stay with the trainee
    delete from analysis_items i using analysis_requests q
     where i.request_id = q.id and q.coach_id = me and i.kind in ('audio','video');

    -- As a trainee: tell coaches whose open request disappears
    for r in select coach_id from analysis_requests
              where trainee_id = me and status in ('pending','draft') and coach_id is not null loop
      perform notify(r.coach_id, 'request_removed', null,
        full_name(me) || ' closed their Coachit account, so their request was removed.');
    end loop;
    -- coaches' recordings on my requests live in the coaches' folders: let me remove them
    insert into storage_release (name, user_id)
      select i.storage_key, me from analysis_items i join analysis_requests q on q.id = i.request_id
       where q.trainee_id = me and i.storage_key is not null
         and storage_key_folder_owner(i.storage_key) is distinct from me
    on conflict do nothing;
    delete from analysis_requests where trainee_id = me;
    delete from videos where owner_id = me;            -- their comments and reports go with them
    delete from comments where author_id = me;
    delete from reports where reporter_id = me;

    update profiles set avatar_key = null, deleting_at = now() where id = me;
  end if;

  return account_files(me);
end $$;

-- ---------- Step 3 ----------
create or replace function public.finish_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_active(); f jsonb;
begin
  if not exists (select 1 from profiles where id = me and deleting_at is not null) then
    raise exception 'DELETION_NOT_STARTED';
  end if;
  if exists (select 1 from profiles where id = me and role = 'admin') then raise exception 'ADMIN_CANNOT_DELETE'; end if;
  f := account_files(me);
  if jsonb_array_length(f->'media') > 0 or jsonb_array_length(f->'avatars') > 0 then
    raise exception 'FILES_REMAIN';
  end if;
  delete from auth.users where id = me;   -- profile, private details, sports, settings, notifications… cascade
end $$;

revoke execute on function public.start_account_deletion() from public, anon;
revoke execute on function public.finish_account_deletion() from public, anon;
grant execute on function public.start_account_deletion() to authenticated;
grant execute on function public.finish_account_deletion() to authenticated;
