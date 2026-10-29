-- ============================================================
-- Live Roster (phase 1): rooms with ratio rules, where everyone is right now, and the day's moves
--
--  - Rooms are the existing work_areas. A room gets a ratio (1 teacher : N children), an age range in months
--    and an "on the roster" switch. A child's home room stays children.classroom_id.
--  - roster_presence holds where each child or staff member is TODAY: a room plus a zone
--    (classroom, playground, lobby) or 'home' (checked out / not yet arrived). One row per person per day.
--  - roster_events is the append-only log of every check-in, check-out and move. It is the attendance record.
--  - Nobody writes either table directly. Every change goes through public.roster_apply(), which checks
--    access, writes the event and updates presence in one transaction.
--  - Teachers (regular employees) use the roster but still cannot read the children table: they get roster
--    fields only (first name, last initial, photo key, age, home room) through public.roster_snapshot().
--  - The module is off until a super admin sets centers.roster_enabled, and it also needs Child Files on.
-- ============================================================

-- 1. Room rules on work_areas -----------------------------------------------------------------------------
ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS ratio_children integer;     -- the N in 1:N; NULL = not ratio-checked
ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS min_age_months integer;     -- inclusive
ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS max_age_months integer;     -- exclusive
ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS on_roster boolean NOT NULL DEFAULT true;

ALTER TABLE public.work_areas DROP CONSTRAINT IF EXISTS work_areas_ratio_children_check;
ALTER TABLE public.work_areas ADD CONSTRAINT work_areas_ratio_children_check
  CHECK (ratio_children IS NULL OR ratio_children BETWEEN 1 AND 50);
ALTER TABLE public.work_areas DROP CONSTRAINT IF EXISTS work_areas_age_range_check;
ALTER TABLE public.work_areas ADD CONSTRAINT work_areas_age_range_check
  CHECK (
    (min_age_months IS NULL OR min_age_months >= 0)
    AND (max_age_months IS NULL OR max_age_months > 0)
    AND (min_age_months IS NULL OR max_age_months IS NULL OR max_age_months > min_age_months)
  );

-- 2. Child headshot and a teacher's own room --------------------------------------------------------------
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS photo_key text;               -- R2 key, child/<center>/<child>/...
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS home_work_area_id uuid
  REFERENCES public.work_areas(id) ON DELETE SET NULL;

-- The photo lives in the child's own storage folder, like every other child file
CREATE OR REPLACE FUNCTION public.check_child_photo_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text := 'child/' || NEW.center_id || '/' || NEW.id || '/';
BEGIN
  IF NEW.photo_key IS NOT NULL AND left(NEW.photo_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Photo key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_child_photo_key() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_check_child_photo_key ON public.children;
CREATE TRIGGER trg_check_child_photo_key BEFORE INSERT OR UPDATE OF photo_key ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.check_child_photo_key();

-- A staff member's home room must be in the same center, and only the center's admins may set it
-- (non-admin writes keep the old value, like employment_class)
CREATE OR REPLACE FUNCTION public.guard_center_staff_home_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.home_work_area_id IS NOT DISTINCT FROM OLD.home_work_area_id THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false)
     AND NOT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    NEW.home_work_area_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.home_work_area_id END;
    RETURN NEW;
  END IF;
  IF NEW.home_work_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_areas w WHERE w.id = NEW.home_work_area_id AND w.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'That room belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_center_staff_home_room() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_center_staff_home_room ON public.center_staff;
CREATE TRIGGER trg_guard_center_staff_home_room BEFORE INSERT OR UPDATE OF home_work_area_id ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_home_room();

-- 3. The switch: off until a super admin turns it on (same rules as child_files_enabled) ------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS roster_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_roster_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.roster_enabled IS NOT DISTINCT FROM OLD.roster_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.roster_enabled := OLD.roster_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_roster_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_roster_flag ON public.centers;
CREATE TRIGGER trg_guard_roster_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_roster_flag();

-- 4. Tables ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roster_presence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date  date NOT NULL,                       -- the center's local day (centers.timezone)
  child_id      uuid REFERENCES public.children(id) ON DELETE CASCADE,
  staff_id      uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  work_area_id  uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,
  zone          text NOT NULL DEFAULT 'home' CHECK (zone IN ('home', 'classroom', 'playground', 'lobby')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT roster_presence_one_person CHECK (num_nonnulls(child_id, staff_id) = 1),
  CONSTRAINT roster_presence_room_when_in CHECK (zone = 'home' OR work_area_id IS NOT NULL),
  CONSTRAINT roster_presence_child_day UNIQUE (center_id, service_date, child_id),
  CONSTRAINT roster_presence_staff_day UNIQUE (center_id, service_date, staff_id)
);
CREATE INDEX IF NOT EXISTS roster_presence_center_day_idx ON public.roster_presence (center_id, service_date);

CREATE TABLE IF NOT EXISTS public.roster_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  child_id      uuid REFERENCES public.children(id) ON DELETE CASCADE,
  staff_id      uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('check_in', 'check_out', 'move_room', 'move_zone')),
  from_area_id  uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,
  to_area_id    uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,
  from_zone     text NOT NULL,
  to_zone       text NOT NULL,
  client_key    uuid UNIQUE,                          -- the app's id for this tap; a retry with the same key is a no-op
  at            timestamptz NOT NULL DEFAULT now(),
  by_user       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT roster_events_one_person CHECK (num_nonnulls(child_id, staff_id) = 1)
);
CREATE INDEX IF NOT EXISTS roster_events_center_day_idx ON public.roster_events (center_id, service_date, at DESC);
CREATE INDEX IF NOT EXISTS roster_events_child_idx ON public.roster_events (child_id, at DESC) WHERE child_id IS NOT NULL;

-- 5. Helpers -------------------------------------------------------------------------------------------------

-- Active regular employee of the center (the teachers who use the roster)
CREATE OR REPLACE FUNCTION public.is_center_regular_staff(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
    WHERE sp.user_id = auth.uid() AND cs.center_id = p_center_id
      AND cs.status = 'active' AND cs.employment_class = 'regular'
  );
$$;

-- The one gate every roster read and write uses: owner, admin or regular teacher of the center,
-- with both the roster and Child Files switched on. False for everyone else.
CREATE OR REPLACE FUNCTION public.can_use_roster(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (public.can_view_confidential(p_center_id) OR public.is_center_regular_staff(p_center_id))
     AND COALESCE((SELECT c.roster_enabled AND c.child_files_enabled FROM centers c WHERE c.id = p_center_id), false);
$$;

-- "Today" in the center's own timezone
CREATE OR REPLACE FUNCTION public.roster_today(p_center_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York'))::date;
$$;

-- Whole months between a birth date and a day
CREATE OR REPLACE FUNCTION public.roster_age_months(p_dob date, p_on date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT (extract(year FROM age(p_on, p_dob)) * 12 + extract(month FROM age(p_on, p_dob)))::integer;
$$;

-- 6. Reading: roster fields only ------------------------------------------------------------------------------
-- Everyone the board shows for a day: enrolled children and active staff of the center, with where they are.
-- Teachers get exactly these columns and nothing else from a child's record.
CREATE OR REPLACE FUNCTION public.roster_snapshot(p_center_id uuid, p_date date DEFAULT NULL)
RETURNS TABLE (
  kind          text,      -- 'child' | 'staff'
  person_id     uuid,
  first_name    text,
  last_initial  text,
  photo         text,      -- children: R2 key; staff: avatar_url
  age_months    integer,   -- children only
  home_area_id  uuid,
  employment    text,      -- staff only: 'regular' | 'substitute'
  work_area_id  uuid,      -- where they are today (NULL = not seen today)
  zone          text,      -- 'home' when checked out or not yet arrived
  updated_at    timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_day date;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  v_day := COALESCE(p_date, public.roster_today(p_center_id));

  RETURN QUERY
    SELECT 'child'::text, ch.id, COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name), left(ch.last_name, 1),
           ch.photo_key, public.roster_age_months(ch.date_of_birth, v_day), ch.classroom_id, NULL::text,
           p.work_area_id, COALESCE(p.zone, 'home'), p.updated_at
    FROM children ch
    LEFT JOIN roster_presence p ON p.center_id = ch.center_id AND p.service_date = v_day AND p.child_id = ch.id
    WHERE ch.center_id = p_center_id AND ch.status = 'enrolled'
    UNION ALL
    SELECT 'staff'::text, sp.id, sp.first_name, left(sp.last_name, 1),
           sp.avatar_url, NULL::integer, cs.home_work_area_id, cs.employment_class,
           p.work_area_id, COALESCE(p.zone, 'home'), p.updated_at
    FROM center_staff cs
    JOIN staff_profiles sp ON sp.id = cs.staff_id
    LEFT JOIN roster_presence p ON p.center_id = cs.center_id AND p.service_date = v_day AND p.staff_id = sp.id
    WHERE cs.center_id = p_center_id
      AND (cs.status = 'active' AND cs.employment_class = 'regular' OR p.id IS NOT NULL);
END $$;

-- Per room and zone for a day: children, teachers, the effective ratio and how many teachers that needs.
-- Effective ratio = the room's own ratio, tightened by the age ratio of the youngest child present
-- (the ratio of the on-roster room whose age range covers that child, else the child's home room).
-- The TypeScript engine (src/lib/roster-ratio.ts) applies the same rules; keep them in step.
CREATE OR REPLACE FUNCTION public.roster_room_status(p_center_id uuid, p_date date DEFAULT NULL)
RETURNS TABLE (
  work_area_id     uuid,
  zone             text,
  children         integer,
  teachers         integer,
  effective_ratio  integer,
  teachers_needed  integer,
  teachers_short   integer,
  room_capacity    integer,
  room_children    integer    -- every zone of the room, for the capacity check
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_day date;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  v_day := COALESCE(p_date, public.roster_today(p_center_id));

  RETURN QUERY
  WITH present AS (
    SELECT p.work_area_id, p.zone, p.child_id, p.staff_id,
           public.roster_age_months(ch.date_of_birth, v_day) AS age_m, ch.classroom_id AS home_area
    FROM roster_presence p
    LEFT JOIN children ch ON ch.id = p.child_id
    WHERE p.center_id = p_center_id AND p.service_date = v_day AND p.zone <> 'home'
  ),
  child_ratio AS (
    SELECT pr.work_area_id, pr.zone, pr.child_id,
           COALESCE(
             (SELECT w.ratio_children FROM work_areas w
               WHERE w.center_id = p_center_id AND w.is_active AND w.on_roster AND w.ratio_children IS NOT NULL
                 AND w.min_age_months IS NOT NULL AND w.max_age_months IS NOT NULL
                 AND pr.age_m >= w.min_age_months AND pr.age_m < w.max_age_months
               ORDER BY w.ratio_children LIMIT 1),
             (SELECT w.ratio_children FROM work_areas w WHERE w.id = pr.home_area)
           ) AS age_ratio
    FROM present pr WHERE pr.child_id IS NOT NULL
  ),
  groups AS (
    SELECT pr.work_area_id, pr.zone,
           count(pr.child_id)::integer AS kids,
           count(pr.staff_id)::integer AS staff
    FROM present pr GROUP BY pr.work_area_id, pr.zone
  ),
  rated AS (
    SELECT g.work_area_id, g.zone, g.kids, g.staff, w.capacity,
           NULLIF(LEAST(
             COALESCE(w.ratio_children, 2147483647),
             COALESCE((SELECT min(cr.age_ratio) FROM child_ratio cr
                        WHERE cr.work_area_id = g.work_area_id AND cr.zone = g.zone), 2147483647)
           ), 2147483647) AS eff
    FROM groups g JOIN work_areas w ON w.id = g.work_area_id
  )
  SELECT r.work_area_id, r.zone, r.kids, r.staff, r.eff,
         CASE WHEN r.eff IS NULL OR r.kids = 0 THEN 0 ELSE ceil(r.kids::numeric / r.eff)::integer END,
         CASE WHEN r.eff IS NULL OR r.kids = 0 THEN 0 ELSE greatest(ceil(r.kids::numeric / r.eff)::integer - r.staff, 0) END,
         r.capacity,
         (SELECT sum(x.kids) FROM rated x WHERE x.work_area_id = r.work_area_id)::integer
  FROM rated r
  ORDER BY r.work_area_id, r.zone;
END $$;

-- 7. Writing: the only way into roster_presence and roster_events --------------------------------------------
-- Put one person (a child OR a staff member) in a room and zone, or send them home (check out).
-- Returns the person's presence row after the change. Ratio is NOT enforced here: a teacher must be able to
-- move a child in the moment; the board and roster_room_status() show what the move did.
CREATE OR REPLACE FUNCTION public.roster_apply(
  p_center_id   uuid,
  p_child_id    uuid,
  p_staff_id    uuid,
  p_area_id     uuid,
  p_zone        text,
  p_client_key  uuid DEFAULT NULL
)
RETURNS public.roster_presence
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day        date;
  v_cur        roster_presence;
  v_home_area  uuid;
  v_from_area  uuid;
  v_from_zone  text;
  v_to_area    uuid;
  v_action     text;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_child_id, p_staff_id) <> 1 THEN
    RAISE EXCEPTION 'Move exactly one child or one staff member' USING ERRCODE = 'check_violation';
  END IF;
  IF p_zone IS NULL OR p_zone NOT IN ('home', 'classroom', 'playground', 'lobby') THEN
    RAISE EXCEPTION 'Unknown zone %', p_zone USING ERRCODE = 'check_violation';
  END IF;

  -- The person must belong to this center
  IF p_child_id IS NOT NULL THEN
    SELECT ch.classroom_id INTO v_home_area FROM children ch
     WHERE ch.id = p_child_id AND ch.center_id = p_center_id AND ch.status = 'enrolled';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That child is not enrolled at this center' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT cs.home_work_area_id INTO v_home_area FROM center_staff cs
     WHERE cs.staff_id = p_staff_id AND cs.center_id = p_center_id AND cs.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That staff member is not active at this center' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The room must be an active, on-roster room of this center
  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_areas w WHERE w.id = p_area_id AND w.center_id = p_center_id AND w.is_active AND w.on_roster
  ) THEN
    RAISE EXCEPTION 'That room is not on this center''s roster' USING ERRCODE = 'check_violation';
  END IF;
  IF p_zone <> 'home' AND p_area_id IS NULL THEN
    RAISE EXCEPTION 'Pick a room to check in to' USING ERRCODE = 'check_violation';
  END IF;

  v_day := public.roster_today(p_center_id);

  -- Same tap sent twice (double click, retry on bad wifi): return the current row, change nothing
  IF p_client_key IS NOT NULL AND EXISTS (SELECT 1 FROM roster_events WHERE client_key = p_client_key) THEN
    SELECT * INTO v_cur FROM roster_presence
     WHERE center_id = p_center_id AND service_date = v_day
       AND child_id IS NOT DISTINCT FROM p_child_id AND staff_id IS NOT DISTINCT FROM p_staff_id;
    RETURN v_cur;
  END IF;

  -- Where they are now (lock the row so two screens moving the same person queue up)
  SELECT * INTO v_cur FROM roster_presence
   WHERE center_id = p_center_id AND service_date = v_day
     AND child_id IS NOT DISTINCT FROM p_child_id AND staff_id IS NOT DISTINCT FROM p_staff_id
   FOR UPDATE;
  IF FOUND THEN
    v_from_area := v_cur.work_area_id;
    v_from_zone := v_cur.zone;
  ELSE
    v_from_area := v_home_area;
    v_from_zone := 'home';
  END IF;

  -- Checking out keeps the room they left; checking in with no room change is a zone move
  v_to_area := CASE WHEN p_zone = 'home' THEN COALESCE(p_area_id, v_from_area) ELSE p_area_id END;

  IF v_from_zone = p_zone AND v_from_area IS NOT DISTINCT FROM v_to_area THEN
    RETURN v_cur;                                     -- nothing changes, nothing logged
  END IF;

  v_action := CASE
    WHEN v_from_zone = 'home' AND p_zone <> 'home' THEN 'check_in'
    WHEN v_from_zone <> 'home' AND p_zone = 'home' THEN 'check_out'
    WHEN v_from_area IS DISTINCT FROM v_to_area THEN 'move_room'
    ELSE 'move_zone'
  END;

  BEGIN
    INSERT INTO roster_events (center_id, service_date, child_id, staff_id, action,
                               from_area_id, to_area_id, from_zone, to_zone, client_key, by_user)
    VALUES (p_center_id, v_day, p_child_id, p_staff_id, v_action,
            v_from_area, v_to_area, v_from_zone, p_zone, p_client_key, auth.uid());
  EXCEPTION WHEN unique_violation THEN
    -- The same client_key won a race on another connection: treat this call as the retry it is
    SELECT * INTO v_cur FROM roster_presence
     WHERE center_id = p_center_id AND service_date = v_day
       AND child_id IS NOT DISTINCT FROM p_child_id AND staff_id IS NOT DISTINCT FROM p_staff_id;
    RETURN v_cur;
  END;

  IF v_cur.id IS NOT NULL THEN
    UPDATE roster_presence
       SET work_area_id = v_to_area, zone = p_zone, updated_at = now(), updated_by = auth.uid()
     WHERE id = v_cur.id
     RETURNING * INTO v_cur;
  ELSIF p_child_id IS NOT NULL THEN
    INSERT INTO roster_presence (center_id, service_date, child_id, work_area_id, zone, updated_by)
    VALUES (p_center_id, v_day, p_child_id, v_to_area, p_zone, auth.uid())
    ON CONFLICT ON CONSTRAINT roster_presence_child_day DO UPDATE
      SET work_area_id = EXCLUDED.work_area_id, zone = EXCLUDED.zone, updated_at = now(), updated_by = EXCLUDED.updated_by
    RETURNING * INTO v_cur;
  ELSE
    INSERT INTO roster_presence (center_id, service_date, staff_id, work_area_id, zone, updated_by)
    VALUES (p_center_id, v_day, p_staff_id, v_to_area, p_zone, auth.uid())
    ON CONFLICT ON CONSTRAINT roster_presence_staff_day DO UPDATE
      SET work_area_id = EXCLUDED.work_area_id, zone = EXCLUDED.zone, updated_at = now(), updated_by = EXCLUDED.updated_by
    RETURNING * INTO v_cur;
  END IF;

  RETURN v_cur;
END $$;

-- 8. Row-level security: read-only for roster users, writes only through roster_apply() ---------------------
ALTER TABLE public.roster_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Roster users read roster_presence" ON public.roster_presence;
CREATE POLICY "Roster users read roster_presence" ON public.roster_presence
  FOR SELECT TO authenticated USING (public.can_use_roster(center_id));

DROP POLICY IF EXISTS "Roster users read roster_events" ON public.roster_events;
CREATE POLICY "Roster users read roster_events" ON public.roster_events
  FOR SELECT TO authenticated USING (public.can_use_roster(center_id));

REVOKE ALL ON public.roster_presence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.roster_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.roster_presence TO authenticated;
GRANT SELECT ON public.roster_events TO authenticated;

-- 9. Function grants ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_center_regular_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_use_roster(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_today(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_snapshot(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_room_status(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_apply(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_center_regular_staff(uuid) TO authenticated;   -- row-level security runs as the caller
GRANT EXECUTE ON FUNCTION public.can_use_roster(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_today(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_snapshot(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_room_status(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_apply(uuid, uuid, uuid, uuid, text, uuid) TO authenticated;

-- 10. Realtime: boards subscribe to presence changes (row-level security still applies) ------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roster_presence') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roster_presence;
  END IF;
END $$;
