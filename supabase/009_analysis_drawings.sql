-- =====================================================================
-- 009: drawings on the video are saved with the analysis.
-- Run in Supabase → SQL Editor AFTER 008_search.sql. Safe to run again.
--
--   • A new item kind 'drawing' holds the coach's pencil work as JSON:
--       { "strokes": [{ "t": 3.2, "c": "#ffd60a", "pts": [[x, y], ...] }],
--         "notes":   [{ "t": 3.2, "text": "Hips too far back" }] }
--     t = seconds into the video, x/y = 0..1 of the video picture, c = colour.
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
declare r analysis_requests; strokes jsonb; notes jsonb;
begin
  r := _coach_open_request(p_request);
  if jsonb_typeof(coalesce(p_drawings, 'null'::jsonb)) <> 'object' then raise exception 'BAD_DRAWINGS'; end if;
  strokes := coalesce(p_drawings->'strokes', '[]'::jsonb);
  notes := coalesce(p_drawings->'notes', '[]'::jsonb);
  if jsonb_typeof(strokes) <> 'array' or jsonb_typeof(notes) <> 'array' then raise exception 'BAD_DRAWINGS'; end if;
  if jsonb_array_length(strokes) > 500 or jsonb_array_length(notes) > 200 or length(p_drawings::text) > 200000 then
    raise exception 'TOO_MANY_DRAWINGS';
  end if;
  delete from analysis_items where request_id = p_request and kind = 'drawing';
  if jsonb_array_length(strokes) > 0 or jsonb_array_length(notes) > 0 then
    insert into analysis_items (request_id, kind, body)
      values (p_request, 'drawing', jsonb_build_object('strokes', strokes, 'notes', notes)::text);
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
