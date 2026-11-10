-- ============================================================
-- Staff schedule (phase 1): the module switch, the board's settings and each regular teacher's fixed weekly schedule
--
--  - centers.schedule_enabled (off by default) and centers.schedule_slot_minutes (15 by default, or 30: the drag snap)
--    can only be changed by a super admin (guard_schedule_flags), like the other module switches.
--  - The board runs from centers.schedule_day_start to schedule_day_end (07:00-18:00 by default), Monday to Friday
--    unless the center turns on schedule_weekends. The center's owner or admins change these through
--    schedule_settings_save().
--  - staff_fixed_schedules is the weekly pattern of an active regular teacher: blocks per weekday with a room, or no
--    room (a "fixed floater": works those hours, room picked each morning). Several blocks a day are fine (Infant A
--    7-1, Toddler 1-3), overlapping ones are not. Every time is on a 15-minute mark.
--  - Each block is dated (effective_from / effective_to) so a change from next month keeps this month's pattern.
--    schedule_fixed_save() replaces a teacher's whole pattern from a date on; earlier days keep what they had.
--  - A regular teacher with no fixed block on a day is a floater that day (the daily board, phase 2, builds on this).
--  - Nobody writes the table directly. Owners and admins read it (RLS) and change it only through the functions.
--  - Needs the live roster migration (home_work_area_id, is_center_regular_staff, roster_today).
-- Rollback: supabase/rollbacks/20270101000000_staff_schedules.down.sql
-- ============================================================

-- 1. Settings on centers -------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS schedule_slot_minutes integer NOT NULL DEFAULT 15;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS schedule_day_start time NOT NULL DEFAULT '07:00';
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS schedule_day_end time NOT NULL DEFAULT '18:00';
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS schedule_weekends boolean NOT NULL DEFAULT false;

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_schedule_slot_minutes_check;
ALTER TABLE public.centers ADD CONSTRAINT centers_schedule_slot_minutes_check CHECK (schedule_slot_minutes IN (15, 30));
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_schedule_day_check;
ALTER TABLE public.centers ADD CONSTRAINT centers_schedule_day_check CHECK (
  schedule_day_end > schedule_day_start
  AND extract(second FROM schedule_day_start) = 0 AND extract(minute FROM schedule_day_start)::int % 15 = 0
  AND extract(second FROM schedule_day_end) = 0 AND extract(minute FROM schedule_day_end)::int % 15 = 0
);

-- The switch and the snap: super admins (or the service role) only; anyone else keeps the old values
CREATE OR REPLACE FUNCTION public.guard_schedule_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.schedule_enabled IS NOT DISTINCT FROM OLD.schedule_enabled
     AND NEW.schedule_slot_minutes IS NOT DISTINCT FROM OLD.schedule_slot_minutes THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.schedule_enabled := OLD.schedule_enabled;
  NEW.schedule_slot_minutes := OLD.schedule_slot_minutes;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_schedule_flags() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_schedule_flags ON public.centers;
CREATE TRIGGER trg_guard_schedule_flags BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_schedule_flags();

-- 2. The fixed weekly schedule -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_fixed_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  center_staff_id  uuid NOT NULL REFERENCES public.center_staff(id) ON DELETE CASCADE,
  weekday          smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),        -- 0 = Sunday ... 6 = Saturday
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  work_area_id     uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,  -- NULL = floater for those hours
  effective_from   date NOT NULL,
  effective_to     date,                                                     -- NULL = until changed
  notes            text CHECK (notes IS NULL OR length(notes) <= 200),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_fixed_schedules_times CHECK (
    end_time > start_time
    AND extract(second FROM start_time) = 0 AND extract(minute FROM start_time)::int % 15 = 0
    AND extract(second FROM end_time) = 0 AND extract(minute FROM end_time)::int % 15 = 0
  ),
  CONSTRAINT staff_fixed_schedules_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS staff_fixed_schedules_center_idx ON public.staff_fixed_schedules (center_id, weekday);
CREATE INDEX IF NOT EXISTS staff_fixed_schedules_staff_idx ON public.staff_fixed_schedules (center_staff_id, effective_from);

-- Backstop for every write: the teacher and the room belong to the row's center, and one person's blocks never
-- overlap on the same weekday while their dates overlap. schedule_fixed_save() checks the same with kinder messages.
CREATE OR REPLACE FUNCTION public.check_staff_fixed_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM center_staff cs WHERE cs.id = NEW.center_staff_id AND cs.center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'That staff member belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.work_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_areas w WHERE w.id = NEW.work_area_id AND w.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'That room belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM staff_fixed_schedules f
    WHERE f.center_staff_id = NEW.center_staff_id AND f.weekday = NEW.weekday AND f.id <> NEW.id
      AND daterange(f.effective_from, f.effective_to, '[]') && daterange(NEW.effective_from, NEW.effective_to, '[]')
      AND f.start_time < NEW.end_time AND f.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'This block overlaps another block for the same person on that day' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_staff_fixed_schedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_check_staff_fixed_schedule ON public.staff_fixed_schedules;
CREATE TRIGGER trg_check_staff_fixed_schedule BEFORE INSERT OR UPDATE ON public.staff_fixed_schedules
  FOR EACH ROW EXECUTE FUNCTION public.check_staff_fixed_schedule();

ALTER TABLE public.staff_fixed_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_fixed_schedules FROM anon, authenticated;
GRANT SELECT ON public.staff_fixed_schedules TO authenticated;
GRANT ALL ON public.staff_fixed_schedules TO service_role;

DROP POLICY IF EXISTS "Center admins read staff_fixed_schedules" ON public.staff_fixed_schedules;
CREATE POLICY "Center admins read staff_fixed_schedules" ON public.staff_fixed_schedules
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));

-- 3. Helpers ------------------------------------------------------------------------------------------------

-- Owner or admin of the center, with the schedule switched on
CREATE OR REPLACE FUNCTION public.schedule_can_manage(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_confidential(p_center_id)
     AND COALESCE((SELECT c.schedule_enabled FROM centers c WHERE c.id = p_center_id), false);
$$;

-- 'HH24:MI', the form the app sends and reads
CREATE OR REPLACE FUNCTION public.schedule_hhmi(p_time time)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT to_char(p_time, 'HH24:MI') $$;

-- The board settings, for the center's owner, admins and regular teachers (enabled = false when it is off)
CREATE OR REPLACE FUNCTION public.schedule_settings(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c centers%ROWTYPE;
BEGIN
  IF NOT (public.can_view_confidential(p_center_id) OR public.is_center_regular_staff(p_center_id)) THEN
    RAISE EXCEPTION 'You do not have access to this center''s schedule' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_c FROM centers WHERE id = p_center_id;
  RETURN jsonb_build_object(
    'enabled', v_c.schedule_enabled,
    'slot_minutes', v_c.schedule_slot_minutes,
    'day_start', public.schedule_hhmi(v_c.schedule_day_start),
    'day_end', public.schedule_hhmi(v_c.schedule_day_end),
    'weekends', v_c.schedule_weekends,
    'today', public.roster_today(p_center_id),
    'can_manage', public.schedule_can_manage(p_center_id)
  );
END $$;

-- 4. Owner/admin: the board's hours and weekends -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_settings_save(p_center_id uuid, p_day_start time, p_day_end time, p_weekends boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date; v_n integer;
BEGIN
  IF NOT public.schedule_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  IF p_day_start IS NULL OR p_day_end IS NULL OR p_day_end <= p_day_start THEN
    RAISE EXCEPTION 'The day has to end after it starts' USING ERRCODE = '22023';
  END IF;
  IF extract(second FROM p_day_start) <> 0 OR extract(minute FROM p_day_start)::int % 15 <> 0
     OR extract(second FROM p_day_end) <> 0 OR extract(minute FROM p_day_end)::int % 15 <> 0 THEN
    RAISE EXCEPTION 'Pick times on the hour, quarter past, half past or quarter to' USING ERRCODE = '22023';
  END IF;

  -- Narrowing the day can't strand blocks that are in use now or later
  v_today := public.roster_today(p_center_id);
  SELECT count(*) INTO v_n FROM staff_fixed_schedules f
  WHERE f.center_id = p_center_id AND (f.effective_to IS NULL OR f.effective_to >= v_today)
    AND (f.start_time < p_day_start OR f.end_time > p_day_end);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% fixed schedule block(s) fall outside %-%. Change those schedules first',
      v_n, public.schedule_hhmi(p_day_start), public.schedule_hhmi(p_day_end) USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_weekends, false) THEN
    SELECT count(*) INTO v_n FROM staff_fixed_schedules f
    WHERE f.center_id = p_center_id AND (f.effective_to IS NULL OR f.effective_to >= v_today) AND f.weekday IN (0, 6);
    IF v_n > 0 THEN
      RAISE EXCEPTION '% fixed schedule block(s) are on Saturday or Sunday. Remove those first', v_n USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE centers SET schedule_day_start = p_day_start, schedule_day_end = p_day_end, schedule_weekends = COALESCE(p_weekends, false)
  WHERE id = p_center_id;
  RETURN public.schedule_settings(p_center_id);
END $$;

-- 5. Owner/admin: every regular teacher with their fixed schedule on a day ---------------------------------
--  { on, settings, rooms: [{id, name, on_roster}], staff: [{center_staff_id, first_name, last_name, avatar_url,
--    home_room_id, blocks: [{id, weekday, start, end, room_id, notes, from, to}], next_change}] }
--  blocks = the pattern in effect on that day; next_change = the next day it changes (or ends), if any.
CREATE OR REPLACE FUNCTION public.schedule_fixed_list(p_center_id uuid, p_on date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_day date; v_rooms jsonb; v_staff jsonb;
BEGIN
  IF NOT public.schedule_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you do not have access to it' USING ERRCODE = '42501';
  END IF;
  v_day := COALESCE(p_on, public.roster_today(p_center_id));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'on_roster', COALESCE(w.on_roster, true))
                            ORDER BY w.sort_order, lower(w.name)), '[]'::jsonb)
  INTO v_rooms
  FROM work_areas w WHERE w.center_id = p_center_id AND COALESCE(w.is_active, true);

  SELECT COALESCE(jsonb_agg(s.obj ORDER BY s.sort_key), '[]'::jsonb)
  INTO v_staff
  FROM (
    SELECT lower(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')) AS sort_key,
      jsonb_build_object(
        'center_staff_id', cs.id,
        'first_name', sp.first_name,
        'last_name', sp.last_name,
        'avatar_url', sp.avatar_url,
        'home_room_id', cs.home_work_area_id,
        'blocks', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'id', f.id, 'weekday', f.weekday, 'start', public.schedule_hhmi(f.start_time), 'end', public.schedule_hhmi(f.end_time),
                   'room_id', f.work_area_id, 'notes', f.notes, 'from', f.effective_from, 'to', f.effective_to)
                 ORDER BY f.weekday, f.start_time)
          FROM staff_fixed_schedules f
          WHERE f.center_staff_id = cs.id AND f.effective_from <= v_day AND (f.effective_to IS NULL OR f.effective_to >= v_day)
        ), '[]'::jsonb),
        'next_change', (
          SELECT min(d) FROM (
            SELECT f.effective_from AS d FROM staff_fixed_schedules f WHERE f.center_staff_id = cs.id AND f.effective_from > v_day
            UNION ALL
            SELECT f.effective_to + 1 FROM staff_fixed_schedules f WHERE f.center_staff_id = cs.id AND f.effective_to >= v_day
          ) z
        )
      ) AS obj
    FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
    WHERE cs.center_id = p_center_id AND cs.status = 'active' AND cs.employment_class = 'regular'
  ) s;

  RETURN jsonb_build_object('on', v_day, 'settings', public.schedule_settings(p_center_id), 'rooms', v_rooms, 'staff', v_staff);
END $$;

-- 6. Owner/admin: replace one teacher's weekly pattern from a date on --------------------------------------
--  p_blocks: [{weekday 0-6, start 'HH:MI', end 'HH:MI', room_id uuid|null, notes}]; [] removes the pattern from
--  that date (the teacher is a floater from then on). Earlier days keep their pattern; anything already saved for
--  that date or later is replaced. Returns how many blocks were saved.
CREATE OR REPLACE FUNCTION public.schedule_fixed_save(p_center_staff_id uuid, p_effective_from date, p_blocks jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cs center_staff%ROWTYPE;
  v_c centers%ROWTYPE;
  v_today date;
  v_days constant text[] := ARRAY['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  b jsonb;
  v_wd integer; v_s time; v_e time; v_room uuid; v_notes text;
  v_wds integer[] := '{}'; v_ss time[] := '{}'; v_es time[] := '{}'; v_rooms uuid[] := '{}'; v_notes_a text[] := '{}';
  i integer;
BEGIN
  SELECT * INTO v_cs FROM center_staff WHERE id = p_center_staff_id FOR UPDATE;
  IF NOT FOUND OR NOT public.schedule_can_manage(v_cs.center_id) THEN
    RAISE EXCEPTION 'You can''t change this person''s schedule' USING ERRCODE = '42501';
  END IF;
  IF v_cs.status <> 'active' OR v_cs.employment_class <> 'regular' THEN
    RAISE EXCEPTION 'Fixed schedules are for active regular staff. Substitutes come in through their shifts' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_c FROM centers WHERE id = v_cs.center_id;
  v_today := public.roster_today(v_cs.center_id);
  IF p_effective_from IS NULL OR p_effective_from < v_today THEN
    RAISE EXCEPTION 'Pick a start date of today or later' USING ERRCODE = '22023';
  END IF;
  IF p_effective_from > v_today + 366 THEN
    RAISE EXCEPTION 'Pick a start date within the next year' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_blocks, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Blocks must be a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(p_blocks, '[]'::jsonb)) > 42 THEN
    RAISE EXCEPTION 'Too many blocks (6 a day at most)' USING ERRCODE = '22023';
  END IF;

  FOR b IN SELECT value FROM jsonb_array_elements(COALESCE(p_blocks, '[]'::jsonb)) LOOP
    BEGIN
      v_wd := (b ->> 'weekday')::integer;
      v_s := (b ->> 'start')::time;
      v_e := (b ->> 'end')::time;
      v_room := NULLIF(b ->> 'room_id', '')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'A block has a day, time or room that can''t be read' USING ERRCODE = '22023';
    END;
    v_notes := NULLIF(btrim(COALESCE(b ->> 'notes', '')), '');

    IF v_wd IS NULL OR v_wd NOT BETWEEN 0 AND 6 THEN
      RAISE EXCEPTION 'A block has no day' USING ERRCODE = '22023';
    END IF;
    IF v_wd IN (0, 6) AND NOT v_c.schedule_weekends THEN
      RAISE EXCEPTION 'This center''s schedule is Monday to Friday. Turn on weekends in the schedule settings first' USING ERRCODE = '22023';
    END IF;
    IF v_s IS NULL OR v_e IS NULL OR v_e <= v_s THEN
      RAISE EXCEPTION '%: each block has to end after it starts', v_days[v_wd + 1] USING ERRCODE = '22023';
    END IF;
    IF extract(second FROM v_s) <> 0 OR extract(minute FROM v_s)::int % 15 <> 0
       OR extract(second FROM v_e) <> 0 OR extract(minute FROM v_e)::int % 15 <> 0 THEN
      RAISE EXCEPTION '%: times go in 15-minute steps', v_days[v_wd + 1] USING ERRCODE = '22023';
    END IF;
    IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
      RAISE EXCEPTION '%: % to % is outside the center''s day (% to %)', v_days[v_wd + 1],
        public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
        public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
    END IF;
    IF v_room IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM work_areas w WHERE w.id = v_room AND w.center_id = v_cs.center_id AND COALESCE(w.is_active, true)
    ) THEN
      RAISE EXCEPTION '%: that room isn''t one of this center''s active rooms', v_days[v_wd + 1] USING ERRCODE = '22023';
    END IF;
    IF length(v_notes) > 200 THEN
      RAISE EXCEPTION 'Notes are 200 characters at most' USING ERRCODE = '22023';
    END IF;
    FOR i IN 1 .. COALESCE(array_length(v_wds, 1), 0) LOOP
      IF v_wds[i] = v_wd AND v_s < v_es[i] AND v_e > v_ss[i] THEN
        RAISE EXCEPTION '%: two blocks overlap (% to % and % to %)', v_days[v_wd + 1],
          public.schedule_hhmi(v_ss[i]), public.schedule_hhmi(v_es[i]), public.schedule_hhmi(v_s), public.schedule_hhmi(v_e)
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM unnest(v_wds) d WHERE d = v_wd) >= 6 THEN
      RAISE EXCEPTION '%: 6 blocks a day at most', v_days[v_wd + 1] USING ERRCODE = '22023';
    END IF;
    v_wds := v_wds || v_wd; v_ss := v_ss || v_s; v_es := v_es || v_e; v_rooms := v_rooms || v_room; v_notes_a := v_notes_a || v_notes;
  END LOOP;

  -- Replace from the start date on: later versions go, the one running across the date ends the day before
  DELETE FROM staff_fixed_schedules WHERE center_staff_id = p_center_staff_id AND effective_from >= p_effective_from;
  UPDATE staff_fixed_schedules SET effective_to = p_effective_from - 1
  WHERE center_staff_id = p_center_staff_id AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to >= p_effective_from);

  FOR i IN 1 .. COALESCE(array_length(v_wds, 1), 0) LOOP
    INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, work_area_id, effective_from, notes, created_by)
    VALUES (v_cs.center_id, p_center_staff_id, v_wds[i], v_ss[i], v_es[i], v_rooms[i], p_effective_from, v_notes_a[i], auth.uid());
  END LOOP;

  RETURN COALESCE(array_length(v_wds, 1), 0);
END $$;

-- 7. Who may call what ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.schedule_can_manage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_hhmi(time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_settings_save(uuid, time, time, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_fixed_list(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_fixed_save(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_can_manage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_hhmi(time) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_settings(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_settings_save(uuid, time, time, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_fixed_list(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_fixed_save(uuid, date, jsonb) TO authenticated;
