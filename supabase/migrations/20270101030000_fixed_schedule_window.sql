-- ============================================================
-- Staff schedule: a fixed weekly schedule with an end date (from ... until)
--
--  schedule_fixed_save(cs, from, blocks) replaces a teacher's pattern from a date on, with no end.
--  schedule_fixed_save_window(cs, from, until, blocks) replaces it only from `from` through `until`: whatever they
--  had before and after the window stays (a summer schedule ends and the usual week comes back by itself; with
--  nothing after, they are a floater after `until`). Same checks and messages as schedule_fixed_save, which it uses.
-- Needs 20270101000000_staff_schedules.sql. Rollback: supabase/rollbacks/20270101030000_fixed_schedule_window.down.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.schedule_fixed_save_window(p_center_staff_id uuid, p_effective_from date, p_effective_to date, p_blocks jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer;
  v_after staff_fixed_schedules[];   -- the parts of the current pattern that run past the window
  r staff_fixed_schedules;
BEGIN
  IF p_effective_to IS NULL THEN
    RETURN public.schedule_fixed_save(p_center_staff_id, p_effective_from, p_blocks);
  END IF;
  IF p_effective_from IS NOT NULL AND p_effective_to < p_effective_from THEN
    RAISE EXCEPTION 'The end date has to be on or after the start date' USING ERRCODE = '22023';
  END IF;
  IF p_effective_from IS NOT NULL AND p_effective_to > p_effective_from + 731 THEN
    RAISE EXCEPTION 'Pick an end date within two years of the start' USING ERRCODE = '22023';
  END IF;

  -- Keep what runs after the window (access is checked by schedule_fixed_save below; nothing is written before it)
  SELECT COALESCE(array_agg(f ORDER BY f.effective_from, f.weekday, f.start_time), '{}') INTO v_after
  FROM staff_fixed_schedules f
  WHERE f.center_staff_id = p_center_staff_id AND (f.effective_to IS NULL OR f.effective_to > p_effective_to);

  -- Checks everything, ends the earlier pattern the day before, and saves the new one open-ended from the start date
  v_n := public.schedule_fixed_save(p_center_staff_id, p_effective_from, p_blocks);

  -- ... which now ends on the last day of the window
  UPDATE staff_fixed_schedules SET effective_to = p_effective_to
  WHERE center_staff_id = p_center_staff_id AND effective_from = p_effective_from AND effective_to IS NULL;

  -- ... and the earlier pattern picks up again the day after
  FOREACH r IN ARRAY v_after LOOP
    INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, work_area_id, effective_from, effective_to, notes, created_by, created_at)
    VALUES (r.center_id, r.center_staff_id, r.weekday, r.start_time, r.end_time, r.work_area_id,
            GREATEST(r.effective_from, p_effective_to + 1), r.effective_to, r.notes, r.created_by, r.created_at);
  END LOOP;

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.schedule_fixed_save_window(uuid, date, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_fixed_save_window(uuid, date, date, jsonb) TO authenticated;
