-- =====================================================================
-- 009: drawings on the video are saved with the analysis.
-- Run in Supabase → SQL Editor AFTER 008_search.sql. Safe to run again.
--
--   • A new item kind 'drawing' holds the coach's pencil strokes as JSON:
--     [{ "t": 3.2, "pts": [[x, y], ...] }, ...]  (t = seconds, x/y = 0..1 of the video frame)
--   • save_drawings replaces the drawings of an open analysis (draft work).
--   • Drawings alone do not count as an analysis: send_analysis still needs
--     text, a voice recording or a video recording.
--   • Drawings are visible wherever the analysis is visible.
-- =====================================================================

alter table public.analysis_items drop constraint if exists analysis_items_kind_check;
alter table public.analysis_items add constraint analysis_items_kind_check
  check (kind in ('text', 'audio', 'video', 'drawing'));

create or replace function public.save_drawings(p_request uuid, p_drawings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r analysis_requests;
begin
  r := _coach_open_request(p_request);
  if jsonb_typeof(coalesce(p_drawings, 'null'::jsonb)) <> 'array' then raise exception 'BAD_DRAWINGS'; end if;
  if jsonb_array_length(p_drawings) > 500 or length(p_drawings::text) > 200000 then raise exception 'TOO_MANY_DRAWINGS'; end if;
  delete from analysis_items where request_id = p_request and kind = 'drawing';
  if jsonb_array_length(p_drawings) > 0 then
    insert into analysis_items (request_id, kind, body) values (p_request, 'drawing', p_drawings::text);
  end if;
end $$;

-- Same as 001, except that drawings alone are not an analysis.
create or replace function public.send_analysis(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r analysis_requests;
begin
  r := _coach_open_request(p_request);
  if not exists (select 1 from analysis_items where request_id = p_request and kind <> 'drawing') then
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

revoke execute on function public.save_drawings(uuid, jsonb) from public, anon;
grant execute on function public.save_drawings(uuid, jsonb) to authenticated;
