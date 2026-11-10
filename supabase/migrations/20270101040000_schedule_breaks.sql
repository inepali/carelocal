-- ============================================================
-- Staff schedule: breaks and break covers
--
--  - A teacher's usual break is part of their fixed schedule (kind 'break': inside a working block that day, no
--    room of its own). Building a day cuts each break out of the working box it falls in, so the day shows
--    "Infant A 7-11 · Break 11-12 · Infant A 12-3". On the daily board a break can be added (default 60 minutes),
--    moved, resized or removed (removing gives the time back).
--  - A break cover (kind 'cover', red on the board) is a box in a room for the time someone is on break. It can be
--    empty ("needs someone") or have a person on it: a regular teacher of the center, or a substitute whose shift
--    covers it. Putting a floater on a cover takes that time from their Floaters box (and gives it back if they come
--    off it). Adding a break offers an empty cover in that room at the same time.
--  - Breaks don't count toward a room's ratio; covers with someone on them do.
--  - Call-outs, undo and reset keep covers (someone called out comes off their covers, which go back to "needs
--    someone"). Substitute shifts that are cancelled leave their covers as placeholders.
--  - Teachers see their breaks and covers on My day / My Schedule, and in notices.
-- Needs 20270101000000 ... 20270101030000. Rollback: supabase/rollbacks/20270101040000_schedule_breaks.down.sql
-- ============================================================

-- 1. Fixed schedules: breaks ----------------------------------------------------------------------------------
ALTER TABLE public.staff_fixed_schedules ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'work';
ALTER TABLE public.staff_fixed_schedules DROP CONSTRAINT IF EXISTS staff_fixed_schedules_kind_check;
ALTER TABLE public.staff_fixed_schedules ADD CONSTRAINT staff_fixed_schedules_kind_check CHECK (kind IN ('work', 'break'));

-- 2. Day boxes: breaks and covers (a cover may have nobody on it yet) -------------------------------------------
ALTER TABLE public.schedule_blocks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'work';
ALTER TABLE public.schedule_blocks ADD COLUMN IF NOT EXISTS carved boolean NOT NULL DEFAULT false;   -- cover took Floaters time
ALTER TABLE public.schedule_blocks DROP CONSTRAINT IF EXISTS schedule_blocks_kind_check;
ALTER TABLE public.schedule_blocks ADD CONSTRAINT schedule_blocks_kind_check CHECK (kind IN ('work', 'break', 'cover'));
ALTER TABLE public.schedule_blocks ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE public.schedule_blocks DROP CONSTRAINT IF EXISTS schedule_blocks_one_owner;
ALTER TABLE public.schedule_blocks ADD CONSTRAINT schedule_blocks_one_owner CHECK (
  (CASE WHEN kind = 'cover' THEN num_nonnulls(center_staff_id, shift_claim_id) <= 1 ELSE num_nonnulls(center_staff_id, shift_claim_id) = 1 END)
  AND ((staff_id IS NULL) = (num_nonnulls(center_staff_id, shift_claim_id) = 0))
);

-- Replaced from earlier migrations with small changes (generated: kind and break handling)
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
    WHERE f.center_staff_id = NEW.center_staff_id AND f.weekday = NEW.weekday AND f.kind = NEW.kind AND f.id <> NEW.id
      AND daterange(f.effective_from, f.effective_to, '[]') && daterange(NEW.effective_from, NEW.effective_to, '[]')
      AND f.start_time < NEW.end_time AND f.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'This block overlaps another block for the same person on that day' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;

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
  v_kind text; v_kinds text[] := '{}'; j integer; v_inside boolean;
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
    v_kind := COALESCE(NULLIF(b ->> 'kind', ''), 'work');
    IF v_kind NOT IN ('work', 'break') THEN RAISE EXCEPTION 'A block is either working hours or a break' USING ERRCODE = '22023'; END IF;
    IF v_kind = 'break' THEN v_room := NULL; END IF;     -- a break happens in the room it falls in

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
      IF v_wds[i] = v_wd AND v_kinds[i] = v_kind AND v_s < v_es[i] AND v_e > v_ss[i] THEN
        RAISE EXCEPTION '%: two blocks overlap (% to % and % to %)', v_days[v_wd + 1],
          public.schedule_hhmi(v_ss[i]), public.schedule_hhmi(v_es[i]), public.schedule_hhmi(v_s), public.schedule_hhmi(v_e)
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM unnest(v_wds, v_kinds) AS t(d, k) WHERE d = v_wd AND k = v_kind) >= 6 THEN
      RAISE EXCEPTION '%: 6 blocks a day at most', v_days[v_wd + 1] USING ERRCODE = '22023';
    END IF;
    v_wds := v_wds || v_wd; v_ss := v_ss || v_s; v_es := v_es || v_e; v_rooms := v_rooms || v_room; v_notes_a := v_notes_a || v_notes; v_kinds := v_kinds || v_kind;
  END LOOP;

  -- A break sits inside one of that day's working blocks (and isn't the whole block)
  FOR i IN 1 .. COALESCE(array_length(v_wds, 1), 0) LOOP
    CONTINUE WHEN v_kinds[i] <> 'break';
    v_inside := false;
    FOR j IN 1 .. array_length(v_wds, 1) LOOP
      IF v_kinds[j] = 'work' AND v_wds[j] = v_wds[i] AND v_ss[j] <= v_ss[i] AND v_es[j] >= v_es[i]
         AND (v_ss[j] < v_ss[i] OR v_es[j] > v_es[i]) THEN v_inside := true; END IF;
    END LOOP;
    IF NOT v_inside THEN
      RAISE EXCEPTION '%: a break has to be inside their working hours', v_days[v_wds[i] + 1] USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Replace from the start date on: later versions go, the one running across the date ends the day before
  DELETE FROM staff_fixed_schedules WHERE center_staff_id = p_center_staff_id AND effective_from >= p_effective_from;
  UPDATE staff_fixed_schedules SET effective_to = p_effective_from - 1
  WHERE center_staff_id = p_center_staff_id AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to >= p_effective_from);

  FOR i IN 1 .. COALESCE(array_length(v_wds, 1), 0) LOOP
    INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, work_area_id, effective_from, notes, created_by, kind)
    VALUES (v_cs.center_id, p_center_staff_id, v_wds[i], v_ss[i], v_es[i], v_rooms[i], p_effective_from, v_notes_a[i], auth.uid(), v_kinds[i]);
  END LOOP;

  RETURN COALESCE(array_length(v_wds, 1), 0);
END $$;

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
                   'room_id', f.work_area_id, 'kind', f.kind, 'notes', f.notes, 'from', f.effective_from, 'to', f.effective_to)
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
    INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, work_area_id, effective_from, effective_to, notes, created_by, created_at, kind)
    VALUES (r.center_id, r.center_staff_id, r.weekday, r.start_time, r.end_time, r.work_area_id,
            GREATEST(r.effective_from, p_effective_to + 1), r.effective_to, r.notes, r.created_by, r.created_at, r.kind);
  END LOOP;

  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_day_payload_base(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE;
BEGIN
  SELECT * INTO d FROM schedule_days WHERE id = p_day_id;
  RETURN jsonb_build_object(
    'settings', public.schedule_settings(d.center_id),
    'day', jsonb_build_object('id', d.id, 'date', d.service_date, 'weekday', extract(dow FROM d.service_date)::int,
                              'status', d.status, 'version', d.version, 'published_at', d.published_at),
    'rooms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'on_roster', COALESCE(w.on_roster, true),
                                          'ratio', w.ratio_children,
                                          'enrolled', (SELECT count(*) FROM children ch WHERE ch.center_id = d.center_id AND ch.classroom_id = w.id AND ch.status = 'enrolled'))
                       ORDER BY w.sort_order, lower(w.name))
      FROM work_areas w WHERE w.center_id = d.center_id AND COALESCE(w.is_active, true)), '[]'::jsonb),
    'people', COALESCE((
      SELECT jsonb_agg(p.obj ORDER BY p.kind_order, p.sort_key)
      FROM (
        SELECT 0 AS kind_order, lower(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')) AS sort_key,
               jsonb_build_object('staff_id', sp.id, 'center_staff_id', cs.id, 'kind', 'regular',
                                  'first_name', sp.first_name, 'last_name', sp.last_name, 'avatar_url', sp.avatar_url,
                                  'home_room_id', cs.home_work_area_id,
                                  'absence', (SELECT jsonb_build_object('kind', a.kind, 'start', public.schedule_hhmi(a.start_time),
                                                                        'end', public.schedule_hhmi(a.end_time), 'note', a.note)
                                              FROM schedule_absences a WHERE a.day_id = d.id AND a.center_staff_id = cs.id)) AS obj
        FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
        WHERE cs.center_id = d.center_id AND cs.status = 'active' AND cs.employment_class = 'regular'
        UNION ALL
        SELECT 1, lower(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')),
               jsonb_build_object('staff_id', sp.id, 'center_staff_id', NULL, 'kind', 'sub',
                                  'first_name', sp.first_name, 'last_name', sp.last_name, 'avatar_url', sp.avatar_url,
                                  'home_room_id', NULL, 'absence', NULL)
        FROM staff_profiles sp
        WHERE sp.id IN (SELECT b.staff_id FROM schedule_blocks b WHERE b.day_id = d.id AND b.shift_claim_id IS NOT NULL)
          AND sp.id NOT IN (SELECT cs.staff_id FROM center_staff cs WHERE cs.center_id = d.center_id AND cs.status = 'active' AND cs.employment_class = 'regular')
      ) p), '[]'::jsonb),
    'blocks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'staff_id', b.staff_id, 'center_staff_id', b.center_staff_id,
                                          'shift_claim_id', b.shift_claim_id, 'room_id', b.work_area_id,
                                          'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time),
                                          'source', b.source, 'kind', b.kind, 'note', b.note)
                       ORDER BY b.start_time)
      FROM schedule_blocks b WHERE b.day_id = d.id), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.my_schedule(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff uuid := public.schedule_my_staff_id();
BEGIN
  IF v_staff IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'Pick up to a month of days' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'center_id', d.center_id, 'center_name', c.name, 'date', d.service_date, 'weekday', extract(dow FROM d.service_date)::int,
             'published_at', d.published_at,
             'seen', n.seen_hash IS NOT DISTINCT FROM public.schedule_person_hash(d.id, v_staff),
             'off', (SELECT jsonb_build_object('start', public.schedule_hhmi(a.start_time), 'end', public.schedule_hhmi(a.end_time))
                     FROM schedule_absences a JOIN center_staff cs ON cs.id = a.center_staff_id
                     WHERE a.day_id = d.id AND cs.staff_id = v_staff),
             'blocks', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('room_id', b.work_area_id, 'room_name', w.name, 'start', public.schedule_hhmi(b.start_time),
                                                   'end', public.schedule_hhmi(b.end_time), 'note', b.note, 'kind', b.kind, 'sub', b.shift_claim_id IS NOT NULL)
                                ORDER BY b.start_time)
               FROM schedule_blocks b LEFT JOIN work_areas w ON w.id = b.work_area_id
               WHERE b.day_id = d.id AND b.staff_id = v_staff), '[]'::jsonb))
           ORDER BY d.service_date, c.name)
    FROM schedule_days d
    JOIN centers c ON c.id = d.center_id AND c.schedule_enabled
    LEFT JOIN schedule_person_notices n ON n.day_id = d.id AND n.staff_id = v_staff
    WHERE d.status = 'published' AND d.service_date BETWEEN p_from AND p_to
      AND (EXISTS (SELECT 1 FROM schedule_blocks b WHERE b.day_id = d.id AND b.staff_id = v_staff)
           OR EXISTS (SELECT 1 FROM center_staff cs WHERE cs.center_id = d.center_id AND cs.staff_id = v_staff
                        AND cs.status = 'active' AND cs.employment_class = 'regular'))
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_board(p_center_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE;
BEGIN
  IF NOT (public.can_view_confidential(p_center_id) OR public.is_center_regular_staff(p_center_id))
     OR NOT COALESCE((SELECT schedule_enabled FROM centers WHERE id = p_center_id), false) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you do not have access to it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date AND status = 'published';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('published', false, 'settings', public.schedule_settings(p_center_id), 'date', p_date);
  END IF;
  RETURN jsonb_build_object(
    'published', true,
    'settings', public.schedule_settings(p_center_id),
    'day', jsonb_build_object('id', d.id, 'date', d.service_date, 'weekday', extract(dow FROM d.service_date)::int,
                              'status', d.status, 'version', d.version, 'published_at', d.published_at),
    'me', public.schedule_my_staff_id(),
    'rooms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'on_roster', COALESCE(w.on_roster, true), 'ratio', NULL, 'enrolled', 0)
                                        ORDER BY w.sort_order, lower(w.name))
                       FROM work_areas w WHERE w.center_id = p_center_id AND COALESCE(w.is_active, true)), '[]'::jsonb),
    'people', COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', sp.id, 'center_staff_id', NULL,
                                           'kind', CASE WHEN EXISTS (SELECT 1 FROM center_staff cs WHERE cs.center_id = p_center_id AND cs.staff_id = sp.id
                                                                       AND cs.status = 'active' AND cs.employment_class = 'regular') THEN 'regular' ELSE 'sub' END,
                                           'first_name', sp.first_name, 'last_name', sp.last_name, 'avatar_url', sp.avatar_url,
                                           'home_room_id', NULL, 'absence', NULL)
                                         ORDER BY lower(COALESCE(sp.first_name, '')))
                        FROM staff_profiles sp WHERE sp.id IN (SELECT b.staff_id FROM schedule_blocks b WHERE b.day_id = d.id AND b.staff_id IS NOT NULL)), '[]'::jsonb),
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'staff_id', b.staff_id, 'center_staff_id', NULL,
                                           'shift_claim_id', CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' END,
                                           'room_id', b.work_area_id, 'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time),
                                           'source', b.source, 'kind', b.kind, 'note', b.note)
                                         ORDER BY b.start_time)
                        FROM schedule_blocks b WHERE b.day_id = d.id), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.schedule_unnotified(p_day_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(x.staff_id ORDER BY x.staff_id), '{}')
  FROM (
    SELECT DISTINCT b.staff_id FROM schedule_blocks b WHERE b.day_id = p_day_id AND b.staff_id IS NOT NULL
    UNION
    SELECT n.staff_id FROM schedule_person_notices n WHERE n.day_id = p_day_id AND n.notified_hash IS NOT NULL
  ) x
  JOIN schedule_days d ON d.id = p_day_id AND d.status = 'published'
  LEFT JOIN schedule_person_notices n ON n.day_id = p_day_id AND n.staff_id = x.staff_id
  WHERE public.schedule_person_hash(p_day_id, x.staff_id) IS DISTINCT FROM n.notified_hash
    -- someone never notified and still not on the board has nothing to hear about
    AND NOT (n.notified_hash IS NULL AND public.schedule_person_hash(p_day_id, x.staff_id) = md5(''))
$$;

-- 3. Block helpers (internal) ---------------------------------------------------------------------------------

-- Add a box for someone in the free parts of [start, end): never on top of their other boxes, never inside their
-- call-out, kept inside the board's day. Returns how many pieces it added.
CREATE OR REPLACE FUNCTION public.schedule_insert_free(
  p_day schedule_days, p_staff uuid, p_cs uuid, p_claim uuid, p_room uuid, p_start time, p_end time,
  p_kind text, p_source text, p_fixed uuid, p_note text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c centers%ROWTYPE; v_s time; v_e time; cur time; x record; v_n integer := 0;
BEGIN
  SELECT * INTO v_c FROM centers WHERE id = p_day.center_id;
  v_s := GREATEST(p_start, v_c.schedule_day_start);
  v_e := LEAST(p_end, v_c.schedule_day_end);
  IF v_e <= v_s THEN RETURN 0; END IF;
  cur := v_s;
  FOR x IN
    SELECT s, e FROM (
      SELECT b.start_time AS s, b.end_time AS e FROM schedule_blocks b WHERE b.day_id = p_day.id AND b.staff_id = p_staff
      UNION ALL
      SELECT COALESCE(a.start_time, time '00:00'), COALESCE(a.end_time, time '23:59')
      FROM schedule_absences a WHERE a.day_id = p_day.id AND p_cs IS NOT NULL AND a.center_staff_id = p_cs
    ) busy
    WHERE e > v_s AND s < v_e ORDER BY s
  LOOP
    IF x.s > cur THEN
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, fixed_schedule_id, note, updated_by)
      VALUES (p_day.id, p_day.center_id, p_day.service_date, p_staff, p_cs, p_claim, p_room, cur, LEAST(x.s, v_e), p_kind, p_source, p_fixed, p_note, auth.uid());
      v_n := v_n + 1;
    END IF;
    cur := GREATEST(cur, x.e);
    EXIT WHEN cur >= v_e;
  END LOOP;
  IF cur < v_e THEN
    INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, fixed_schedule_id, note, updated_by)
    VALUES (p_day.id, p_day.center_id, p_day.service_date, p_staff, p_cs, p_claim, p_room, cur, v_e, p_kind, p_source, p_fixed, p_note, auth.uid());
    v_n := v_n + 1;
  END IF;
  RETURN v_n;
END $$;

-- Cut [start, end) out of someone's boxes of the given kinds (inside: removed; across the middle: split; across an
-- end: trimmed). With p_only_floater, only their Floaters-row boxes. Returns how many boxes it touched.
CREATE OR REPLACE FUNCTION public.schedule_carve(p_day_id uuid, p_staff uuid, p_start time, p_end time, p_kinds text[], p_only_floater boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b schedule_blocks%ROWTYPE; v_n integer := 0;
BEGIN
  FOR b IN SELECT * FROM schedule_blocks
           WHERE day_id = p_day_id AND staff_id = p_staff AND kind = ANY (p_kinds) AND start_time < p_end AND end_time > p_start
             AND (NOT p_only_floater OR work_area_id IS NULL)
  LOOP
    v_n := v_n + 1;
    IF b.start_time >= p_start AND b.end_time <= p_end THEN
      DELETE FROM schedule_blocks WHERE id = b.id;
    ELSIF b.start_time < p_start AND b.end_time > p_end THEN
      UPDATE schedule_blocks SET end_time = p_start, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, fixed_schedule_id, note, updated_by)
      VALUES (b.day_id, b.center_id, b.service_date, b.staff_id, b.center_staff_id, b.shift_claim_id, b.work_area_id, p_end, b.end_time, b.kind, b.source, b.fixed_schedule_id, b.note, auth.uid());
    ELSIF b.start_time < p_start THEN
      UPDATE schedule_blocks SET end_time = p_start, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
    ELSE
      UPDATE schedule_blocks SET start_time = p_end, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- Join someone's back-to-back working boxes in the same room (after a break or a cover is taken away)
CREATE OR REPLACE FUNCTION public.schedule_merge(p_day_id uuid, p_staff uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  LOOP
    SELECT a.id AS aid, b.id AS bid, b.end_time AS b_end INTO r
    FROM schedule_blocks a JOIN schedule_blocks b
      ON b.day_id = a.day_id AND b.staff_id = a.staff_id AND b.start_time = a.end_time AND a.kind = 'work' AND b.kind = 'work'
     AND b.work_area_id IS NOT DISTINCT FROM a.work_area_id AND b.center_staff_id IS NOT DISTINCT FROM a.center_staff_id
     AND b.shift_claim_id IS NOT DISTINCT FROM a.shift_claim_id
    WHERE a.day_id = p_day_id AND a.staff_id = p_staff
    LIMIT 1;
    EXIT WHEN NOT FOUND;
    DELETE FROM schedule_blocks WHERE id = r.bid;
    UPDATE schedule_blocks SET end_time = r.b_end, updated_at = now(), updated_by = auth.uid() WHERE id = r.aid;
  END LOOP;
END $$;

-- Take the person off a break cover (it stays as a placeholder). With p_return, the time it took from their
-- Floaters box goes back to them.
CREATE OR REPLACE FUNCTION public.schedule_cover_release(p_day schedule_days, p_block_id uuid, p_return boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b schedule_blocks%ROWTYPE;
BEGIN
  SELECT * INTO b FROM schedule_blocks WHERE id = p_block_id AND kind = 'cover';
  IF NOT FOUND OR b.staff_id IS NULL THEN RETURN; END IF;
  UPDATE schedule_blocks SET staff_id = NULL, center_staff_id = NULL, shift_claim_id = NULL, source = 'added', carved = false,
         updated_at = now(), updated_by = auth.uid()
  WHERE id = b.id;
  IF p_return AND b.carved THEN
    PERFORM public.schedule_insert_free(p_day, b.staff_id, b.center_staff_id, b.shift_claim_id, NULL, b.start_time, b.end_time, 'work',
      CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, NULL, NULL);
    PERFORM public.schedule_merge(p_day.id, b.staff_id);
  END IF;
END $$;

-- Put someone on a break cover: a regular teacher of the center, or a substitute whose shift that day covers it.
-- Time in their Floaters box is taken for it; a box in a room (or a break) at that time is refused.
CREATE OR REPLACE FUNCTION public.schedule_cover_assign(p_day schedule_days, p_block_id uuid, p_staff uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b schedule_blocks%ROWTYPE; v_cs uuid; v_claim uuid; a schedule_absences%ROWTYPE; x record; v_label text; v_carved boolean := false;
BEGIN
  SELECT * INTO b FROM schedule_blocks WHERE id = p_block_id AND kind = 'cover' AND day_id = p_day.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That break cover is no longer on this day' USING ERRCODE = 'P0002'; END IF;
  v_label := public.schedule_person_label(p_staff);

  SELECT cs.id INTO v_cs FROM center_staff cs
  WHERE cs.center_id = p_day.center_id AND cs.staff_id = p_staff AND cs.status = 'active' AND cs.employment_class = 'regular';
  IF v_cs IS NULL THEN
    SELECT sc.id INTO v_claim FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
    WHERE sc.staff_id = p_staff AND s.center_id = p_day.center_id AND s.shift_date = p_day.service_date
      AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled'
      AND public.schedule_time((public.schedule_mins(s.start_time) / 15) * 15) <= b.start_time
      AND public.schedule_time(((public.schedule_mins(s.end_time) + 14) / 15) * 15) >= b.end_time
    ORDER BY s.start_time LIMIT 1;
    IF v_claim IS NULL THEN
      IF EXISTS (SELECT 1 FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
                 WHERE sc.staff_id = p_staff AND s.center_id = p_day.center_id AND s.shift_date = p_day.service_date AND sc.status::text = 'confirmed') THEN
        RAISE EXCEPTION '%''s shift today doesn''t cover % to %', v_label, public.schedule_hhmi(b.start_time), public.schedule_hhmi(b.end_time) USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Pick someone on the team today: a regular teacher, or a substitute with a shift today' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO a FROM schedule_absences WHERE day_id = p_day.id AND center_staff_id = v_cs;
    IF FOUND AND (a.start_time IS NULL OR (a.start_time < b.end_time AND a.end_time > b.start_time)) THEN
      RAISE EXCEPTION '% is off then today' , v_label USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR x IN SELECT o.kind, o.work_area_id, w.name AS room_name, o.start_time, o.end_time FROM schedule_blocks o LEFT JOIN work_areas w ON w.id = o.work_area_id
           WHERE o.day_id = p_day.id AND o.staff_id = p_staff AND o.id <> b.id AND o.start_time < b.end_time AND o.end_time > b.start_time
  LOOP
    IF x.kind = 'break' THEN
      RAISE EXCEPTION '% is on a break then', v_label USING ERRCODE = '22023';
    ELSIF x.kind = 'cover' THEN
      RAISE EXCEPTION '% is already covering a break then', v_label USING ERRCODE = '22023';
    ELSIF x.work_area_id IS NOT NULL THEN
      RAISE EXCEPTION '% is in % from % to %. Move them first, or pick someone else', v_label, x.room_name,
        public.schedule_hhmi(x.start_time), public.schedule_hhmi(x.end_time) USING ERRCODE = '22023';
    END IF;
    v_carved := true;                                  -- only Floaters-row time is in the way: take it
  END LOOP;
  IF v_carved THEN PERFORM public.schedule_carve(p_day.id, p_staff, b.start_time, b.end_time, ARRAY['work'], true); END IF;

  UPDATE schedule_blocks SET staff_id = p_staff, center_staff_id = v_cs, shift_claim_id = v_claim,
         source = CASE WHEN v_claim IS NOT NULL THEN 'sub' ELSE 'added' END, carved = v_carved, updated_at = now(), updated_by = auth.uid()
  WHERE id = b.id;
END $$;

-- 4. Building a day: work blocks, then the breaks cut out of them -------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_add_trimmed(
  p_day schedule_days, p_cs center_staff, p_room uuid, p_start time, p_end time, p_source text, p_fixed uuid, p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.schedule_insert_free(p_day, p_cs.staff_id, p_cs.id, NULL, p_room, p_start, p_end, 'work', p_source, p_fixed, p_note);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_fill_fixed(p_day schedule_days, p_cs center_staff)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f staff_fixed_schedules%ROWTYPE; w schedule_blocks%ROWTYPE; v_n integer := 0;
BEGIN
  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int AND kind = 'work'
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    PERFORM public.schedule_add_trimmed(p_day, p_cs,
      CASE WHEN EXISTS (SELECT 1 FROM work_areas wa WHERE wa.id = f.work_area_id AND COALESCE(wa.is_active, true)) THEN f.work_area_id END,
      f.start_time, f.end_time, 'fixed', f.id, f.notes);
    v_n := v_n + 1;
  END LOOP;
  -- Usual breaks: cut out of the box they fall in (skipped if that time isn't a working box today)
  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int AND kind = 'break'
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    SELECT * INTO w FROM schedule_blocks
    WHERE day_id = p_day.id AND center_staff_id = p_cs.id AND kind = 'work' AND start_time <= f.start_time AND end_time >= f.end_time LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    PERFORM public.schedule_carve(p_day.id, p_cs.staff_id, f.start_time, f.end_time, ARRAY['work'], false);
    INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, kind, source, fixed_schedule_id, updated_by)
    VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.staff_id, p_cs.id, w.work_area_id, f.start_time, f.end_time, 'break', 'fixed', f.id, auth.uid());
  END LOOP;
  RETURN v_n;
END $$;

-- Substitutes: a working box per confirmed claim (in the free parts of the shift); boxes of claims that are no
-- longer confirmed go, and break covers they had are kept as placeholders
CREATE OR REPLACE FUNCTION public.schedule_sync_subs(p_day schedule_days)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_s time; v_e time; v_changed boolean := false; v_n integer; x uuid;
BEGIN
  FOR x IN
    SELECT b.id FROM schedule_blocks b
    WHERE b.day_id = p_day.id AND b.shift_claim_id IS NOT NULL AND b.kind = 'cover'
      AND NOT EXISTS (SELECT 1 FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
                      WHERE sc.id = b.shift_claim_id AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled'
                        AND s.center_id = p_day.center_id AND s.shift_date = p_day.service_date)
  LOOP
    PERFORM public.schedule_cover_release(p_day, x, false);
    v_changed := true;
  END LOOP;

  DELETE FROM schedule_blocks b
  WHERE b.day_id = p_day.id AND b.shift_claim_id IS NOT NULL AND b.kind <> 'cover'
    AND NOT EXISTS (SELECT 1 FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
                    WHERE sc.id = b.shift_claim_id AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled'
                      AND s.center_id = p_day.center_id AND s.shift_date = p_day.service_date);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_changed := v_changed OR v_n > 0;

  FOR r IN
    SELECT sc.id AS claim_id, sc.staff_id, s.start_time, s.end_time, s.work_area_id
    FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
    WHERE s.center_id = p_day.center_id AND s.shift_date = p_day.service_date
      AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled' AND NOT COALESCE(s.is_archived, false)
      AND NOT EXISTS (SELECT 1 FROM schedule_blocks b WHERE b.day_id = p_day.id AND b.shift_claim_id = sc.id AND b.kind IN ('work', 'break'))
    ORDER BY s.start_time
  LOOP
    IF r.end_time <= r.start_time THEN CONTINUE; END IF;          -- overnight shifts don't fit a day board
    v_s := public.schedule_time((public.schedule_mins(r.start_time) / 15) * 15);
    v_e := public.schedule_time(((public.schedule_mins(r.end_time) + 14) / 15) * 15);
    IF public.schedule_insert_free(p_day, r.staff_id, NULL, r.claim_id,
         CASE WHEN EXISTS (SELECT 1 FROM work_areas w WHERE w.id = r.work_area_id AND w.center_id = p_day.center_id) THEN r.work_area_id END,
         v_s, v_e, 'work', 'sub', NULL, NULL) > 0 THEN
      v_changed := true;
    END IF;
  END LOOP;
  RETURN v_changed;
END $$;

-- 5. Owner/admin: change boxes ------------------------------------------------------------------------------------
--  p_ops, in order, all or nothing:
--   {op:'add', center_staff_id, room_id, start, end, note}      a regular teacher's new working box
--   {op:'update', id, room_id?, start?, end?, note?}             only the keys sent change. A working box of a sub
--                                                               keeps the shift's hours; a break only moves in time;
--                                                               a cover keeps its person if it can
--   {op:'remove', id}                                            a break gives its time back; a cover gives taken
--                                                               Floaters time back; not a sub's working box
--   {op:'split', id, at, room_id}                                working boxes only
--   {op:'break', id, start, end, cover?}                         cut a break out of a working box; cover (default
--                                                               true) also adds an empty break cover in that room
--   {op:'cover', room_id, start, end, staff_id?}                 a break cover (empty, or with someone on it)
--   {op:'assign', id, staff_id | null}                           put someone on a cover, or take them off
CREATE OR REPLACE FUNCTION public.schedule_apply(p_center_id uuid, p_date date, p_version integer, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d schedule_days%ROWTYPE; v_c centers%ROWTYPE; o jsonb; b schedule_blocks%ROWTYPE; w schedule_blocks%ROWTYPE; cs center_staff%ROWTYPE;
  v_op text; v_room uuid; v_s time; v_e time; v_at time; v_note text; v_staff uuid; v_cs uuid; v_label text; v_prev uuid; v_new uuid;
  a schedule_absences%ROWTYPE;
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  SELECT * INTO v_c FROM centers WHERE id = p_center_id;
  IF jsonb_typeof(COALESCE(p_ops, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_ops) > 50 THEN
    RAISE EXCEPTION 'Too many changes at once' USING ERRCODE = '22023';
  END IF;

  FOR o IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_op := o ->> 'op';
    BEGIN
      v_room := CASE WHEN o ? 'room_id' THEN NULLIF(o ->> 'room_id', '')::uuid END;
      v_s := CASE WHEN o ? 'start' THEN (o ->> 'start')::time END;
      v_e := CASE WHEN o ? 'end' THEN (o ->> 'end')::time END;
      v_at := CASE WHEN o ? 'at' THEN (o ->> 'at')::time END;
      v_new := CASE WHEN o ? 'staff_id' THEN NULLIF(o ->> 'staff_id', '')::uuid END;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'A change has a time, room or person that can''t be read' USING ERRCODE = '22023';
    END;
    v_note := NULLIF(btrim(COALESCE(o ->> 'note', '')), '');
    IF length(v_note) > 200 THEN RAISE EXCEPTION 'Notes are 200 characters at most' USING ERRCODE = '22023'; END IF;
    IF o ? 'room_id' AND v_room IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM work_areas wa WHERE wa.id = v_room AND wa.center_id = p_center_id AND COALESCE(wa.is_active, true)
    ) THEN
      RAISE EXCEPTION 'That room isn''t one of this center''s active rooms' USING ERRCODE = '22023';
    END IF;

    -- A new break cover
    IF v_op = 'cover' THEN
      IF v_room IS NULL THEN RAISE EXCEPTION 'A break cover needs a room' USING ERRCODE = '22023'; END IF;
      PERFORM public.schedule_check_time(v_s, 'Start'); PERFORM public.schedule_check_time(v_e, 'End');
      IF v_e <= v_s THEN RAISE EXCEPTION 'A box has to end after it starts' USING ERRCODE = '22023'; END IF;
      IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
        RAISE EXCEPTION '% to % is outside the center''s day (% to %)', public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
          public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
      END IF;
      INSERT INTO schedule_blocks (day_id, center_id, service_date, work_area_id, start_time, end_time, kind, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, v_room, v_s, v_e, 'cover', 'added', v_note, auth.uid()) RETURNING id INTO v_prev;
      IF v_new IS NOT NULL THEN PERFORM public.schedule_cover_assign(d, v_prev, v_new); END IF;
      PERFORM public.schedule_log(d, 'cover', jsonb_build_object('room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e), 'staff_id', v_new));
      CONTINUE;
    END IF;

    IF v_op = 'add' THEN
      SELECT * INTO cs FROM center_staff WHERE id = NULLIF(o ->> 'center_staff_id', '')::uuid AND center_id = p_center_id;
      IF NOT FOUND OR cs.status <> 'active' OR cs.employment_class <> 'regular' THEN
        RAISE EXCEPTION 'Only this center''s active regular staff can be added. Substitutes come in through their shifts' USING ERRCODE = '22023';
      END IF;
      v_staff := cs.staff_id; v_cs := cs.id;
      PERFORM public.schedule_check_time(v_s, 'Start'); PERFORM public.schedule_check_time(v_e, 'End');
      b := NULL;
    ELSIF v_op IN ('update', 'remove', 'split', 'break', 'assign') THEN
      SELECT * INTO b FROM schedule_blocks WHERE id = NULLIF(o ->> 'id', '')::uuid AND day_id = d.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That box is no longer on this day. It has been reloaded' USING ERRCODE = 'P0002';
      END IF;
      v_staff := b.staff_id; v_cs := b.center_staff_id;
    ELSE
      RAISE EXCEPTION 'Unknown change "%"', COALESCE(v_op, '') USING ERRCODE = '22023';
    END IF;
    v_label := public.schedule_person_label(v_staff);

    -- Break covers: assign / remove / update
    IF b.kind = 'cover' THEN
      IF v_op = 'assign' THEN
        v_prev := b.staff_id;
        PERFORM public.schedule_cover_release(d, b.id, true);
        IF v_new IS NOT NULL THEN PERFORM public.schedule_cover_assign(d, b.id, v_new); END IF;
        PERFORM public.schedule_log(d, 'assign', jsonb_build_object('block', b.id, 'from', v_prev, 'to', v_new));
      ELSIF v_op = 'remove' THEN
        PERFORM public.schedule_cover_release(d, b.id, true);
        DELETE FROM schedule_blocks WHERE id = b.id;
        PERFORM public.schedule_log(d, 'remove', jsonb_build_object('block', b.id, 'kind', 'cover', 'room_id', b.work_area_id,
          'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)));
      ELSIF v_op = 'update' THEN
        IF o ? 'start' THEN PERFORM public.schedule_check_time(v_s, 'Start'); ELSE v_s := b.start_time; END IF;
        IF o ? 'end' THEN PERFORM public.schedule_check_time(v_e, 'End'); ELSE v_e := b.end_time; END IF;
        IF NOT o ? 'room_id' THEN v_room := b.work_area_id; END IF;
        IF NOT o ? 'note' THEN v_note := b.note; END IF;
        IF v_room IS NULL THEN RAISE EXCEPTION 'A break cover needs a room' USING ERRCODE = '22023'; END IF;
        IF v_e <= v_s THEN RAISE EXCEPTION 'A box has to end after it starts' USING ERRCODE = '22023'; END IF;
        IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
          RAISE EXCEPTION '% to % is outside the center''s day (% to %)', public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
            public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
        END IF;
        v_prev := b.staff_id;
        PERFORM public.schedule_cover_release(d, b.id, true);
        UPDATE schedule_blocks SET work_area_id = v_room, start_time = v_s, end_time = v_e, note = v_note, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
        IF v_prev IS NOT NULL THEN PERFORM public.schedule_cover_assign(d, b.id, v_prev); END IF;
        PERFORM public.schedule_log(d, 'update', jsonb_build_object('block', b.id, 'kind', 'cover',
          'from', jsonb_build_object('room_id', b.work_area_id, 'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)),
          'to', jsonb_build_object('room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e))));
      ELSE
        RAISE EXCEPTION 'A break cover can be moved, resized, assigned or removed' USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF v_op = 'assign' THEN RAISE EXCEPTION 'Only a break cover can be assigned' USING ERRCODE = '22023'; END IF;

    -- Breaks: remove gives the time back; update moves the break (the time goes back, then a new one is cut out)
    IF b.kind = 'break' THEN
      IF v_op NOT IN ('remove', 'update') THEN RAISE EXCEPTION 'A break can be moved, resized or removed' USING ERRCODE = '22023'; END IF;
      IF v_op = 'update' THEN
        IF o ? 'start' THEN PERFORM public.schedule_check_time(v_s, 'Start'); ELSE v_s := b.start_time; END IF;
        IF o ? 'end' THEN PERFORM public.schedule_check_time(v_e, 'End'); ELSE v_e := b.end_time; END IF;
        IF v_e <= v_s THEN RAISE EXCEPTION 'A break has to end after it starts' USING ERRCODE = '22023'; END IF;
      END IF;
      DELETE FROM schedule_blocks WHERE id = b.id;
      PERFORM public.schedule_insert_free(d, b.staff_id, b.center_staff_id, b.shift_claim_id, b.work_area_id, b.start_time, b.end_time, 'work',
        CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, NULL, NULL);
      PERFORM public.schedule_merge(d.id, b.staff_id);
      IF v_op = 'update' THEN
        SELECT * INTO w FROM schedule_blocks WHERE day_id = d.id AND staff_id = b.staff_id AND kind = 'work' AND start_time <= v_s AND end_time >= v_e LIMIT 1;
        IF NOT FOUND THEN RAISE EXCEPTION 'A break has to be inside one of %''s working boxes', v_label USING ERRCODE = '22023'; END IF;
        PERFORM public.schedule_carve(d.id, b.staff_id, v_s, v_e, ARRAY['work'], false);
        INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, updated_by)
        VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, w.work_area_id, v_s, v_e, 'break',
                CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, auth.uid());
      END IF;
      PERFORM public.schedule_log(d, v_op, jsonb_build_object('block', b.id, 'kind', 'break', 'staff_id', b.staff_id,
        'from', jsonb_build_object('start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)),
        'to', CASE WHEN v_op = 'update' THEN jsonb_build_object('start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e)) END));
      CONTINUE;
    END IF;

    -- A break cut out of a working box (and, unless told not to, an empty break cover in that room)
    IF v_op = 'break' THEN
      PERFORM public.schedule_check_time(v_s, 'Break start'); PERFORM public.schedule_check_time(v_e, 'Break end');
      IF v_e <= v_s THEN RAISE EXCEPTION 'A break has to end after it starts' USING ERRCODE = '22023'; END IF;
      IF v_s < b.start_time OR v_e > b.end_time THEN
        RAISE EXCEPTION 'Pick a break between % and %', public.schedule_hhmi(b.start_time), public.schedule_hhmi(b.end_time) USING ERRCODE = '22023';
      END IF;
      IF v_s = b.start_time AND v_e = b.end_time THEN
        RAISE EXCEPTION 'That is the whole box. Take it off the board instead' USING ERRCODE = '22023';
      END IF;
      PERFORM public.schedule_carve(d.id, b.staff_id, v_s, v_e, ARRAY['work'], false);
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, updated_by)
      VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, b.work_area_id, v_s, v_e, 'break',
              CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, auth.uid());
      IF b.work_area_id IS NOT NULL AND COALESCE((o ->> 'cover')::boolean, true) THEN
        INSERT INTO schedule_blocks (day_id, center_id, service_date, work_area_id, start_time, end_time, kind, source, updated_by)
        VALUES (d.id, p_center_id, p_date, b.work_area_id, v_s, v_e, 'cover', 'added', auth.uid());
      END IF;
      PERFORM public.schedule_log(d, 'break', jsonb_build_object('staff_id', b.staff_id, 'room_id', b.work_area_id,
        'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e), 'cover', b.work_area_id IS NOT NULL AND COALESCE((o ->> 'cover')::boolean, true)));
      CONTINUE;
    END IF;

    IF v_op = 'remove' THEN
      IF b.shift_claim_id IS NOT NULL THEN
        RAISE EXCEPTION '% is here on a substitute shift. Cancel or change the shift to take them off', v_label USING ERRCODE = '22023';
      END IF;
      DELETE FROM schedule_blocks WHERE id = b.id;
      PERFORM public.schedule_log(d, 'remove', jsonb_build_object('block', b.id, 'staff_id', b.staff_id, 'room_id', b.work_area_id,
        'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)));
      CONTINUE;
    END IF;

    IF v_op = 'split' THEN
      PERFORM public.schedule_check_time(v_at, 'The move time');
      IF v_at <= b.start_time OR v_at >= b.end_time THEN
        RAISE EXCEPTION 'Pick a time between % and %', public.schedule_hhmi(b.start_time), public.schedule_hhmi(b.end_time) USING ERRCODE = '22023';
      END IF;
      UPDATE schedule_blocks SET end_time = v_at, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, v_room, v_at, b.end_time, 'work',
              CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, b.note, auth.uid());
      PERFORM public.schedule_log(d, 'split', jsonb_build_object('block', b.id, 'staff_id', b.staff_id, 'at', public.schedule_hhmi(v_at),
        'from_room', b.work_area_id, 'to_room', v_room));
      CONTINUE;
    END IF;

    -- add / update a working box
    IF v_op = 'update' THEN
      IF b.shift_claim_id IS NOT NULL AND ((o ? 'start' AND v_s <> b.start_time) OR (o ? 'end' AND v_e <> b.end_time)) THEN
        RAISE EXCEPTION '%''s hours come from their substitute shift. Change the shift to change them', v_label USING ERRCODE = '22023';
      END IF;
      IF o ? 'start' THEN PERFORM public.schedule_check_time(v_s, 'Start'); ELSE v_s := b.start_time; END IF;
      IF o ? 'end' THEN PERFORM public.schedule_check_time(v_e, 'End'); ELSE v_e := b.end_time; END IF;
      IF NOT o ? 'room_id' THEN v_room := b.work_area_id; END IF;
      IF NOT o ? 'note' THEN v_note := b.note; END IF;
    END IF;
    IF v_e <= v_s THEN RAISE EXCEPTION 'A box has to end after it starts' USING ERRCODE = '22023'; END IF;
    IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
      RAISE EXCEPTION '% to % is outside the center''s day (% to %)', public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
        public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
    END IF;
    IF v_cs IS NOT NULL THEN
      SELECT * INTO a FROM schedule_absences WHERE day_id = d.id AND center_staff_id = v_cs;
      IF FOUND AND (a.start_time IS NULL OR (a.start_time < v_e AND a.end_time > v_s)) THEN
        RAISE EXCEPTION '% is off % today. Undo the call-out first', v_label,
          CASE WHEN a.start_time IS NULL THEN 'all day' ELSE 'from ' || public.schedule_hhmi(a.start_time) || ' to ' || public.schedule_hhmi(a.end_time) END
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM schedule_blocks x WHERE x.day_id = d.id AND x.staff_id = v_staff AND x.id IS DISTINCT FROM b.id
               AND x.start_time < v_e AND x.end_time > v_s) THEN
      RAISE EXCEPTION '% is already on the schedule for part of % to %', v_label, public.schedule_hhmi(v_s), public.schedule_hhmi(v_e) USING ERRCODE = '22023';
    END IF;

    IF v_op = 'add' THEN
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, kind, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, v_staff, v_cs, v_room, v_s, v_e, 'work', 'added', v_note, auth.uid());
      PERFORM public.schedule_log(d, 'add', jsonb_build_object('staff_id', v_staff, 'room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e)));
    ELSE
      UPDATE schedule_blocks SET work_area_id = v_room, start_time = v_s, end_time = v_e, note = v_note, updated_at = now(), updated_by = auth.uid()
      WHERE id = b.id;
      PERFORM public.schedule_log(d, 'update', jsonb_build_object('block', b.id, 'staff_id', v_staff,
        'from', jsonb_build_object('room_id', b.work_area_id, 'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)),
        'to', jsonb_build_object('room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e))));
    END IF;
  END LOOP;

  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

-- 6. Call-outs and resets keep break covers (a cover the person was on goes back to "needs someone") ------------
CREATE OR REPLACE FUNCTION public.schedule_call_out(
  p_center_id uuid, p_date date, p_version integer, p_center_staff_id uuid, p_kind text,
  p_start time DEFAULT NULL, p_end time DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; cs center_staff%ROWTYPE; x uuid; v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id AND status = 'active' AND employment_class = 'regular';
  IF NOT FOUND THEN RAISE EXCEPTION 'Call-outs are for this center''s regular staff' USING ERRCODE = '22023'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('called_out', 'sick', 'pto', 'other') THEN
    RAISE EXCEPTION 'Pick a reason' USING ERRCODE = '22023';
  END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) THEN RAISE EXCEPTION 'Give both a from and an until time, or neither for the whole day' USING ERRCODE = '22023'; END IF;
  IF p_start IS NOT NULL THEN
    PERFORM public.schedule_check_time(p_start, 'From'); PERFORM public.schedule_check_time(p_end, 'Until');
    IF p_end <= p_start THEN RAISE EXCEPTION 'Until has to be after from' USING ERRCODE = '22023'; END IF;
  END IF;
  IF length(v_note) > 200 THEN RAISE EXCEPTION 'Notes are 200 characters at most' USING ERRCODE = '22023'; END IF;

  INSERT INTO schedule_absences (day_id, center_id, service_date, center_staff_id, kind, start_time, end_time, note, recorded_by)
  VALUES (d.id, p_center_id, p_date, cs.id, p_kind, p_start, p_end, v_note, auth.uid())
  ON CONFLICT (day_id, center_staff_id) DO UPDATE
    SET kind = EXCLUDED.kind, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, note = EXCLUDED.note,
        recorded_by = EXCLUDED.recorded_by, recorded_at = now();

  FOR x IN SELECT id FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind = 'cover'
             AND (p_start IS NULL OR (start_time < p_end AND end_time > p_start)) LOOP
    PERFORM public.schedule_cover_release(d, x, false);
  END LOOP;
  IF p_start IS NULL THEN
    DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind <> 'cover';
  ELSE
    PERFORM public.schedule_carve(d.id, cs.staff_id, p_start, p_end, ARRAY['work', 'break'], false);
  END IF;

  PERFORM public.schedule_log(d, 'call_out', jsonb_build_object('staff_id', cs.staff_id, 'kind', p_kind,
    'start', public.schedule_hhmi(p_start), 'end', public.schedule_hhmi(p_end)));
  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_call_out_undo(p_center_id uuid, p_date date, p_version integer, p_center_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; cs center_staff%ROWTYPE;
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM schedule_absences WHERE day_id = d.id AND center_staff_id = cs.id) THEN
    RAISE EXCEPTION 'There is no call-out to undo' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM schedule_absences WHERE day_id = d.id AND center_staff_id = cs.id;
  DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind <> 'cover';
  IF cs.status = 'active' AND cs.employment_class = 'regular' THEN PERFORM public.schedule_fill_fixed(d, cs); END IF;
  PERFORM public.schedule_log(d, 'call_out_undo', jsonb_build_object('staff_id', cs.staff_id));
  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_reset_person(p_center_id uuid, p_date date, p_version integer, p_center_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; cs center_staff%ROWTYPE;
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id AND status = 'active' AND employment_class = 'regular';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only this center''s regular staff have a fixed schedule' USING ERRCODE = '22023'; END IF;
  DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind <> 'cover';
  PERFORM public.schedule_fill_fixed(d, cs);
  PERFORM public.schedule_log(d, 'reset', jsonb_build_object('staff_id', cs.staff_id));
  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

-- 7. Notices: a day's fingerprint and summary include breaks and covers -------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_person_hash(p_day_id uuid, p_staff_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(COALESCE(string_agg(b.kind || ':' || COALESCE(b.work_area_id::text, '-') || '@' || public.schedule_hhmi(b.start_time) || '-' || public.schedule_hhmi(b.end_time),
                                 ',' ORDER BY b.start_time), ''))
  FROM schedule_blocks b WHERE b.day_id = p_day_id AND b.staff_id = p_staff_id $$;

CREATE OR REPLACE FUNCTION public.schedule_person_summary(p_day_id uuid, p_staff_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(string_agg(
           CASE b.kind WHEN 'break' THEN 'Break' WHEN 'cover' THEN 'Break cover ' || COALESCE(w.name, '') ELSE COALESCE(w.name, 'Floater') END
           || ' ' || public.schedule_hhmi(b.start_time) || '-' || public.schedule_hhmi(b.end_time), ' · ' ORDER BY b.start_time), '')
  FROM schedule_blocks b LEFT JOIN work_areas w ON w.id = b.work_area_id
  WHERE b.day_id = p_day_id AND b.staff_id = p_staff_id $$;


-- 8. Who may call what (new internal helpers: nobody but the functions above) ------------------------------------
REVOKE ALL ON FUNCTION public.schedule_insert_free(schedule_days, uuid, uuid, uuid, uuid, time, time, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_carve(uuid, uuid, time, time, text[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_merge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_cover_release(schedule_days, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_cover_assign(schedule_days, uuid, uuid) FROM PUBLIC, anon, authenticated;
