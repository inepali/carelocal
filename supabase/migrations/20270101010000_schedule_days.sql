-- ============================================================
-- Staff schedule (phase 2): the daily board
--
--  - schedule_days: one row per center per date, draft until published. `version` goes up on every change, so two
--    admins editing at 7 am can't overwrite each other: every write sends the version it saw.
--  - schedule_blocks: who is in which room when on that day. A block belongs to a regular teacher (center_staff_id)
--    or to a substitute's confirmed shift claim (shift_claim_id). room NULL = the Floaters row.
--  - Building a day (the first time anyone opens it) copies each active regular teacher's fixed schedule for that
--    weekday. After that the day belongs to the admin: fixed schedule changes don't rewrite it, and "Reset to fixed"
--    redoes one teacher on purpose. Regular teachers with no block are "available" (the tray), not on the board.
--  - Substitutes come from confirmed shift claims for that date and are synced every time the day is opened:
--    a new claim adds a box (times from the shift, rounded out to 15 minutes), a cancelled one removes it.
--    Their times are the shift's; the admin can move them to another room or split them, not stretch them.
--  - schedule_absences: a call-out (sick, PTO, other), for the whole day or from/until. Recording one clears or trims
--    that teacher's blocks; undoing it puts their fixed schedule back.
--  - schedule_changes: append-only log of every change (who, when, what).
--  - Nobody writes these tables directly. Owners and admins read them (RLS) and change them through the functions;
--    every function returns the whole day so the board redraws from one answer.
--  - Teachers' read-only views come in phase 3.
-- Needs 20270101000000_staff_schedules.sql. Rollback: supabase/rollbacks/20270101010000_schedule_days.down.sql
-- ============================================================

-- 1. Tables -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  version       integer NOT NULL DEFAULT 1,
  built_at      timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  published_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT schedule_days_one_per_day UNIQUE (center_id, service_date)
);

CREATE TABLE IF NOT EXISTS public.schedule_blocks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id             uuid NOT NULL REFERENCES public.schedule_days(id) ON DELETE CASCADE,
  center_id          uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date       date NOT NULL,
  staff_id           uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,   -- the person, regular or sub
  center_staff_id    uuid REFERENCES public.center_staff(id) ON DELETE CASCADE,              -- regular teacher
  shift_claim_id     uuid REFERENCES public.shift_claims(id) ON DELETE CASCADE,              -- substitute's shift
  work_area_id       uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,               -- NULL = Floaters row
  start_time         time NOT NULL,
  end_time           time NOT NULL,
  source             text NOT NULL CHECK (source IN ('fixed', 'added', 'sub')),
  fixed_schedule_id  uuid REFERENCES public.staff_fixed_schedules(id) ON DELETE SET NULL,
  note               text CHECK (note IS NULL OR length(note) <= 200),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT schedule_blocks_one_owner CHECK (num_nonnulls(center_staff_id, shift_claim_id) = 1),
  CONSTRAINT schedule_blocks_sub_source CHECK ((shift_claim_id IS NOT NULL) = (source = 'sub')),
  CONSTRAINT schedule_blocks_times CHECK (
    end_time > start_time
    AND extract(second FROM start_time) = 0 AND extract(minute FROM start_time)::int % 15 = 0
    AND extract(second FROM end_time) = 0 AND extract(minute FROM end_time)::int % 15 = 0
  )
);
CREATE INDEX IF NOT EXISTS schedule_blocks_day_idx ON public.schedule_blocks (day_id, staff_id);
CREATE INDEX IF NOT EXISTS schedule_blocks_center_day_idx ON public.schedule_blocks (center_id, service_date);
CREATE INDEX IF NOT EXISTS schedule_blocks_claim_idx ON public.schedule_blocks (shift_claim_id) WHERE shift_claim_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.schedule_absences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id           uuid NOT NULL REFERENCES public.schedule_days(id) ON DELETE CASCADE,
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date     date NOT NULL,
  center_staff_id  uuid NOT NULL REFERENCES public.center_staff(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('called_out', 'sick', 'pto', 'other')),
  start_time       time,                    -- both NULL = the whole day
  end_time         time,
  note             text CHECK (note IS NULL OR length(note) <= 200),
  recorded_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_absences_one_per_day UNIQUE (day_id, center_staff_id),
  CONSTRAINT schedule_absences_window CHECK (
    (start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

CREATE TABLE IF NOT EXISTS public.schedule_changes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_id        uuid NOT NULL REFERENCES public.schedule_days(id) ON DELETE CASCADE,
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  action        text NOT NULL,           -- build, add, update, remove, split, call_out, call_out_undo, reset, publish, sub_sync
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  at            timestamptz NOT NULL DEFAULT now(),
  by_user       uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS schedule_changes_day_idx ON public.schedule_changes (day_id, at DESC);

-- Backstop: a block's room is the center's, a teacher's block is for a teacher of that center, and one person's
-- blocks never overlap on a day. The functions check the same with kinder messages.
CREATE OR REPLACE FUNCTION public.check_schedule_block()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schedule_days d WHERE d.id = NEW.day_id AND d.center_id = NEW.center_id AND d.service_date = NEW.service_date) THEN
    RAISE EXCEPTION 'That block is not on this center''s day' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.work_area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM work_areas w WHERE w.id = NEW.work_area_id AND w.center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'That room belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.center_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM center_staff cs WHERE cs.id = NEW.center_staff_id AND cs.center_id = NEW.center_id AND cs.staff_id = NEW.staff_id
  ) THEN
    RAISE EXCEPTION 'That staff member belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM schedule_blocks b
    WHERE b.day_id = NEW.day_id AND b.staff_id = NEW.staff_id AND b.id <> NEW.id
      AND b.start_time < NEW.end_time AND b.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'This block overlaps another block for the same person' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_schedule_block() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_check_schedule_block ON public.schedule_blocks;
CREATE TRIGGER trg_check_schedule_block BEFORE INSERT OR UPDATE ON public.schedule_blocks
  FOR EACH ROW EXECUTE FUNCTION public.check_schedule_block();

ALTER TABLE public.schedule_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_days, public.schedule_blocks, public.schedule_absences, public.schedule_changes FROM anon, authenticated;
GRANT SELECT ON public.schedule_days, public.schedule_blocks, public.schedule_absences, public.schedule_changes TO authenticated;
GRANT ALL ON public.schedule_days, public.schedule_blocks, public.schedule_absences, public.schedule_changes TO service_role;

DROP POLICY IF EXISTS "Center admins read schedule_days" ON public.schedule_days;
CREATE POLICY "Center admins read schedule_days" ON public.schedule_days FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Center admins read schedule_blocks" ON public.schedule_blocks;
CREATE POLICY "Center admins read schedule_blocks" ON public.schedule_blocks FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Center admins read schedule_absences" ON public.schedule_absences;
CREATE POLICY "Center admins read schedule_absences" ON public.schedule_absences FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Center admins read schedule_changes" ON public.schedule_changes;
CREATE POLICY "Center admins read schedule_changes" ON public.schedule_changes FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));

-- 2. Small helpers (internal) -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_mins(p_time time)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (extract(hour FROM p_time) * 60 + extract(minute FROM p_time))::integer $$;

CREATE OR REPLACE FUNCTION public.schedule_time(p_mins integer)
RETURNS time LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT time '00:00' + make_interval(mins => GREATEST(0, LEAST(p_mins, 24 * 60 - 1))) $$;

-- A time on a 15-minute mark, or an error that names the field
CREATE OR REPLACE FUNCTION public.schedule_check_time(p_time time, p_what text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_time IS NULL THEN RAISE EXCEPTION '% is missing', p_what USING ERRCODE = '22023'; END IF;
  IF extract(second FROM p_time) <> 0 OR extract(minute FROM p_time)::int % 15 <> 0 THEN
    RAISE EXCEPTION '% has to be on a 15-minute step', p_what USING ERRCODE = '22023';
  END IF;
END $$;

-- Display name for messages: "Ana L."
CREATE OR REPLACE FUNCTION public.schedule_person_label(p_staff_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT NULLIF(btrim(sp.first_name), '') || COALESCE(' ' || NULLIF(left(btrim(sp.last_name), 1), '') || '.', '')
                   FROM staff_profiles sp WHERE sp.id = p_staff_id), 'This person') $$;

-- Add a block for a teacher, leaving out the part inside their call-out window (if any). Used when building a day,
-- resetting a teacher and undoing a call-out. Assumes the caller holds the day lock.
CREATE OR REPLACE FUNCTION public.schedule_add_trimmed(
  p_day schedule_days, p_cs center_staff, p_room uuid, p_start time, p_end time, p_source text, p_fixed uuid, p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a schedule_absences%ROWTYPE; v_c centers%ROWTYPE; v_s time; v_e time;
BEGIN
  SELECT * INTO v_c FROM centers WHERE id = p_day.center_id;
  v_s := GREATEST(p_start, v_c.schedule_day_start);
  v_e := LEAST(p_end, v_c.schedule_day_end);
  IF v_e <= v_s THEN RETURN; END IF;
  SELECT * INTO a FROM schedule_absences WHERE day_id = p_day.id AND center_staff_id = p_cs.id;
  IF FOUND AND a.start_time IS NULL THEN RETURN; END IF;     -- off all day
  IF FOUND AND a.start_time < v_e AND a.end_time > v_s THEN
    IF v_s < a.start_time THEN
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, source, fixed_schedule_id, note, updated_by)
      VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.staff_id, p_cs.id, p_room, v_s, a.start_time, p_source, p_fixed, p_note, auth.uid());
    END IF;
    IF a.end_time < v_e THEN
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, source, fixed_schedule_id, note, updated_by)
      VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.staff_id, p_cs.id, p_room, a.end_time, v_e, p_source, p_fixed, p_note, auth.uid());
    END IF;
    RETURN;
  END IF;
  INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, source, fixed_schedule_id, note, updated_by)
  VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.staff_id, p_cs.id, p_room, v_s, v_e, p_source, p_fixed, p_note, auth.uid());
END $$;

-- One teacher's fixed schedule for the day (in effect on that date, that weekday), minus their call-out
CREATE OR REPLACE FUNCTION public.schedule_fill_fixed(p_day schedule_days, p_cs center_staff)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f staff_fixed_schedules%ROWTYPE; v_n integer := 0;
BEGIN
  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    PERFORM public.schedule_add_trimmed(p_day, p_cs,
      CASE WHEN EXISTS (SELECT 1 FROM work_areas w WHERE w.id = f.work_area_id AND COALESCE(w.is_active, true)) THEN f.work_area_id END,
      f.start_time, f.end_time, 'fixed', f.id, f.notes);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Substitutes: one box per confirmed claim for the day (times from the shift, rounded out to 15 minutes and kept
-- inside the board's day); boxes for claims that are no longer confirmed go. Returns true when anything changed.
CREATE OR REPLACE FUNCTION public.schedule_sync_subs(p_day schedule_days)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_c centers%ROWTYPE; v_s time; v_e time; v_changed boolean := false; v_n integer;
BEGIN
  SELECT * INTO v_c FROM centers WHERE id = p_day.center_id;

  DELETE FROM schedule_blocks b
  WHERE b.day_id = p_day.id AND b.shift_claim_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
      WHERE sc.id = b.shift_claim_id AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled'
        AND s.center_id = p_day.center_id AND s.shift_date = p_day.service_date
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_changed := v_n > 0;

  FOR r IN
    SELECT sc.id AS claim_id, sc.staff_id, s.start_time, s.end_time, s.work_area_id
    FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
    WHERE s.center_id = p_day.center_id AND s.shift_date = p_day.service_date
      AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled' AND NOT COALESCE(s.is_archived, false)
      AND NOT EXISTS (SELECT 1 FROM schedule_blocks b WHERE b.day_id = p_day.id AND b.shift_claim_id = sc.id)
    ORDER BY s.start_time
  LOOP
    v_s := public.schedule_time((public.schedule_mins(r.start_time) / 15) * 15);
    v_e := public.schedule_time(((public.schedule_mins(r.end_time) + 14) / 15) * 15);
    IF r.end_time <= r.start_time THEN CONTINUE; END IF;          -- overnight shifts don't fit a day board
    v_s := GREATEST(v_s, v_c.schedule_day_start);
    v_e := LEAST(v_e, v_c.schedule_day_end);
    IF v_e <= v_s THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM schedule_blocks b WHERE b.day_id = p_day.id AND b.staff_id = r.staff_id AND b.start_time < v_e AND b.end_time > v_s) THEN
      CONTINUE;                                                    -- already on the board for those hours
    END IF;
    INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, shift_claim_id, work_area_id, start_time, end_time, source)
    VALUES (p_day.id, p_day.center_id, p_day.service_date, r.staff_id, r.claim_id,
            CASE WHEN EXISTS (SELECT 1 FROM work_areas w WHERE w.id = r.work_area_id AND w.center_id = p_day.center_id) THEN r.work_area_id END,
            v_s, v_e, 'sub');
    v_changed := true;
  END LOOP;
  RETURN v_changed;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_log(p_day schedule_days, p_action text, p_detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO schedule_changes (day_id, center_id, service_date, action, detail, by_user)
  VALUES (p_day.id, p_day.center_id, p_day.service_date, p_action, COALESCE(p_detail, '{}'::jsonb), auth.uid()) $$;

-- The whole day, as the board draws it
--  { settings, day: {id, date, weekday, status, version, published_at}, rooms: [{id, name, on_roster, ratio, enrolled}],
--    people: [{staff_id, center_staff_id, kind 'regular'|'sub', first_name, last_name, avatar_url, home_room_id,
--              absence: {kind, start, end, note} | null}],
--    blocks: [{id, staff_id, center_staff_id, shift_claim_id, room_id, start, end, source, note}] }
CREATE OR REPLACE FUNCTION public.schedule_day_payload(p_day_id uuid)
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
                                          'source', b.source, 'note', b.note)
                       ORDER BY b.start_time)
      FROM schedule_blocks b WHERE b.day_id = d.id), '[]'::jsonb)
  );
END $$;

-- The day row for a write, locked, after the access, date and version checks
CREATE OR REPLACE FUNCTION public.schedule_lock_day(p_center_id uuid, p_date date, p_version integer)
RETURNS schedule_days LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE;
BEGIN
  IF NOT public.schedule_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open this day first' USING ERRCODE = 'P0002';
  END IF;
  IF p_version IS DISTINCT FROM d.version THEN
    RAISE EXCEPTION 'Someone else just changed this day. It has been reloaded; try again' USING ERRCODE = '40001';
  END IF;
  RETURN d;
END $$;

-- 3. Owner/admin: open a day (builds it the first time, syncs substitutes) ---------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_day_open(p_center_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; v_today date; v_new boolean := false; cs center_staff%ROWTYPE; v_n integer := 0;
BEGIN
  IF NOT public.schedule_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you do not have access to it' USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(p_center_id);
  IF p_date IS NULL OR p_date < v_today - 31 OR p_date > v_today + 62 THEN
    RAISE EXCEPTION 'Pick a day from the last month to two months ahead' USING ERRCODE = '22023';
  END IF;

  INSERT INTO schedule_days (center_id, service_date) VALUES (p_center_id, p_date)
  ON CONFLICT (center_id, service_date) DO NOTHING
  RETURNING * INTO d;
  v_new := FOUND;
  IF NOT v_new THEN
    SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date FOR UPDATE;
  END IF;

  IF v_new THEN
    FOR cs IN SELECT * FROM center_staff WHERE center_id = p_center_id AND status = 'active' AND employment_class = 'regular' LOOP
      v_n := v_n + public.schedule_fill_fixed(d, cs);
    END LOOP;
    PERFORM public.schedule_sync_subs(d);
    PERFORM public.schedule_log(d, 'build', jsonb_build_object('fixed_blocks', v_n));
  ELSIF public.schedule_sync_subs(d) THEN
    UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
    PERFORM public.schedule_log(d, 'sub_sync', '{}'::jsonb);
  END IF;

  RETURN public.schedule_day_payload(d.id);
END $$;

-- 4. Owner/admin: change blocks ------------------------------------------------------------------------------
--  p_ops, applied in order, all or nothing:
--   {op:'add', center_staff_id, room_id, start, end, note}      a regular teacher's new block
--   {op:'update', id, room_id?, start?, end?, note?}             only the keys sent change (a sub's times can't)
--   {op:'remove', id}                                            not for substitutes (cancel the shift instead)
--   {op:'split', id, at, room_id}                                the block ends at `at`; from `at` it is in room_id
CREATE OR REPLACE FUNCTION public.schedule_apply(p_center_id uuid, p_date date, p_version integer, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d schedule_days%ROWTYPE; v_c centers%ROWTYPE; o jsonb; b schedule_blocks%ROWTYPE; cs center_staff%ROWTYPE;
  v_op text; v_room uuid; v_s time; v_e time; v_at time; v_note text; v_staff uuid; v_cs uuid; v_label text;
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
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'A change has a time or room that can''t be read' USING ERRCODE = '22023';
    END;
    v_note := NULLIF(btrim(COALESCE(o ->> 'note', '')), '');
    IF length(v_note) > 200 THEN RAISE EXCEPTION 'Notes are 200 characters at most' USING ERRCODE = '22023'; END IF;
    IF o ? 'room_id' AND v_room IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM work_areas w WHERE w.id = v_room AND w.center_id = p_center_id AND COALESCE(w.is_active, true)
    ) THEN
      RAISE EXCEPTION 'That room isn''t one of this center''s active rooms' USING ERRCODE = '22023';
    END IF;

    IF v_op = 'add' THEN
      SELECT * INTO cs FROM center_staff WHERE id = NULLIF(o ->> 'center_staff_id', '')::uuid AND center_id = p_center_id;
      IF NOT FOUND OR cs.status <> 'active' OR cs.employment_class <> 'regular' THEN
        RAISE EXCEPTION 'Only this center''s active regular staff can be added. Substitutes come in through their shifts' USING ERRCODE = '22023';
      END IF;
      v_staff := cs.staff_id; v_cs := cs.id;
      PERFORM public.schedule_check_time(v_s, 'Start'); PERFORM public.schedule_check_time(v_e, 'End');
      b := NULL;
    ELSIF v_op IN ('update', 'remove', 'split') THEN
      SELECT * INTO b FROM schedule_blocks WHERE id = NULLIF(o ->> 'id', '')::uuid AND day_id = d.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That box is no longer on this day. It has been reloaded' USING ERRCODE = 'P0002';
      END IF;
      v_staff := b.staff_id; v_cs := b.center_staff_id;
    ELSE
      RAISE EXCEPTION 'Unknown change "%"', COALESCE(v_op, '') USING ERRCODE = '22023';
    END IF;
    v_label := public.schedule_person_label(v_staff);

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
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, v_room, v_at, b.end_time,
              CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, b.note, auth.uid());
      PERFORM public.schedule_log(d, 'split', jsonb_build_object('block', b.id, 'staff_id', b.staff_id, 'at', public.schedule_hhmi(v_at),
        'from_room', b.work_area_id, 'to_room', v_room));
      CONTINUE;
    END IF;

    -- add / update: the new times and room
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
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, v_staff, v_cs, v_room, v_s, v_e, 'added', v_note, auth.uid());
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

-- 5. Owner/admin: call-outs ------------------------------------------------------------------------------------
--  Whole day (p_start and p_end NULL) or from/until. Clears or trims the teacher's blocks in that window; recording
--  it again replaces the earlier call-out.
CREATE OR REPLACE FUNCTION public.schedule_call_out(
  p_center_id uuid, p_date date, p_version integer, p_center_staff_id uuid, p_kind text,
  p_start time DEFAULT NULL, p_end time DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; cs center_staff%ROWTYPE; b schedule_blocks%ROWTYPE; v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
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

  IF p_start IS NULL THEN
    DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id;
  ELSE
    FOR b IN SELECT * FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND start_time < p_end AND end_time > p_start LOOP
      IF b.start_time >= p_start AND b.end_time <= p_end THEN
        DELETE FROM schedule_blocks WHERE id = b.id;                                   -- inside the window
      ELSIF b.start_time < p_start AND b.end_time > p_end THEN                         -- window in the middle: split
        UPDATE schedule_blocks SET end_time = p_start, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
        INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, source, fixed_schedule_id, note, updated_by)
        VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.work_area_id, p_end, b.end_time, b.source, b.fixed_schedule_id, b.note, auth.uid());
      ELSIF b.start_time < p_start THEN
        UPDATE schedule_blocks SET end_time = p_start, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
      ELSE
        UPDATE schedule_blocks SET start_time = p_end, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.schedule_log(d, 'call_out', jsonb_build_object('staff_id', cs.staff_id, 'kind', p_kind,
    'start', public.schedule_hhmi(p_start), 'end', public.schedule_hhmi(p_end)));
  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

-- Undo a call-out: the teacher's fixed schedule for the day comes back (their other boxes are replaced)
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
  DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id;
  IF cs.status = 'active' AND cs.employment_class = 'regular' THEN PERFORM public.schedule_fill_fixed(d, cs); END IF;
  PERFORM public.schedule_log(d, 'call_out_undo', jsonb_build_object('staff_id', cs.staff_id));
  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

-- Reset one teacher to their fixed schedule for the day (respecting a call-out)
CREATE OR REPLACE FUNCTION public.schedule_reset_person(p_center_id uuid, p_date date, p_version integer, p_center_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; cs center_staff%ROWTYPE;
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id AND status = 'active' AND employment_class = 'regular';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only this center''s regular staff have a fixed schedule' USING ERRCODE = '22023'; END IF;
  DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id;
  PERFORM public.schedule_fill_fixed(d, cs);
  PERFORM public.schedule_log(d, 'reset', jsonb_build_object('staff_id', cs.staff_id));
  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

-- 6. Owner/admin: publish (teachers see published days in phase 3; later edits are live and logged) ----------------
CREATE OR REPLACE FUNCTION public.schedule_publish(p_center_id uuid, p_date date, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE;
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  IF d.status = 'published' THEN RETURN public.schedule_day_payload(d.id); END IF;
  UPDATE schedule_days SET status = 'published', published_at = now(), published_by = auth.uid(), version = version + 1 WHERE id = d.id;
  PERFORM public.schedule_log(d, 'publish', '{}'::jsonb);
  RETURN public.schedule_day_payload(d.id);
END $$;

-- 7. Who may call what ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.schedule_mins(time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_time(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_check_time(time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_person_label(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_add_trimmed(schedule_days, center_staff, uuid, time, time, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_fill_fixed(schedule_days, center_staff) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_sync_subs(schedule_days) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_log(schedule_days, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_day_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_lock_day(uuid, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_day_open(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_apply(uuid, date, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_call_out(uuid, date, integer, uuid, text, time, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_call_out_undo(uuid, date, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_reset_person(uuid, date, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_publish(uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_mins(time), public.schedule_time(integer), public.schedule_check_time(time, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_day_open(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_apply(uuid, date, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_call_out(uuid, date, integer, uuid, text, time, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_call_out_undo(uuid, date, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_reset_person(uuid, date, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_publish(uuid, date, integer) TO authenticated;
