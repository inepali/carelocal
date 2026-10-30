-- ============================================================
-- Live Roster (phase 5): substitutes on the roster
--
--  - roster_move(): the move itself, split out of roster_apply() so the shift check-in trigger can use it.
--    Not callable from the app.
--  - roster_apply(): unchanged for the app; it also accepts a staff member who is already on today's roster
--    (a substitute placed by their check-in) so admins and teachers can move them.
--  - roster_snapshot(): also lists anyone on today's roster, not only the center's regular teachers.
--  - trg_roster_on_shift_claim: checking in to a confirmed shift places the person in the shift's room;
--    checking out sends them home. Never blocks the time clock.
-- Rollback: supabase/rollbacks/20261210000000_roster_substitutes.down.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.roster_move(
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
    -- Staff membership is checked by the caller (roster_apply, or the shift check-in trigger)
    SELECT cs.home_work_area_id INTO v_home_area FROM center_staff cs
     WHERE cs.staff_id = p_staff_id AND cs.center_id = p_center_id;
    IF NOT EXISTS (SELECT 1 FROM staff_profiles WHERE id = p_staff_id) THEN
      RAISE EXCEPTION 'Unknown staff member' USING ERRCODE = 'check_violation';
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
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  -- A staff member can be moved when they work here (active at the center), or are already on today's roster
  -- (a substitute placed by their shift check-in)
  IF p_staff_id IS NOT NULL AND p_child_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM center_staff cs WHERE cs.staff_id = p_staff_id AND cs.center_id = p_center_id AND cs.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM roster_presence p WHERE p.staff_id = p_staff_id AND p.center_id = p_center_id
                       AND p.service_date = public.roster_today(p_center_id)) THEN
    RAISE EXCEPTION 'That staff member is not active at this center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN public.roster_move(p_center_id, p_child_id, p_staff_id, p_area_id, p_zone, p_client_key);
END $$;

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
    -- Regular teachers of the center, plus anyone on today's roster (a substitute placed by their shift
    -- check-in, even one with no link to the center)
    SELECT 'staff'::text, sp.id, sp.first_name, left(sp.last_name, 1),
           sp.avatar_url, NULL::integer, cs.home_work_area_id, COALESCE(cs.employment_class, 'substitute'),
           p.work_area_id, COALESCE(p.zone, 'home'), p.updated_at
    FROM staff_profiles sp
    LEFT JOIN center_staff cs ON cs.staff_id = sp.id AND cs.center_id = p_center_id
    LEFT JOIN roster_presence p ON p.center_id = p_center_id AND p.service_date = v_day AND p.staff_id = sp.id
    WHERE sp.id IN (
      SELECT c.staff_id FROM center_staff c WHERE c.center_id = p_center_id AND c.status = 'active' AND c.employment_class = 'regular'
      UNION
      SELECT r.staff_id FROM roster_presence r WHERE r.center_id = p_center_id AND r.service_date = v_day AND r.staff_id IS NOT NULL
    );
END $$;

-- A substitute (or anyone) who checks in to a confirmed shift lands in the shift's room; checking out sends them
-- home. Runs for every time clock (web, phone apps) because it lives on shift_claims. It never blocks the time
-- clock: if the roster is off, the shift has no room, or anything else goes wrong, the check-in still saves.
CREATE OR REPLACE FUNCTION public.roster_on_shift_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift record;
BEGIN
  IF NEW.status::text <> 'confirmed' THEN RETURN NEW; END IF;
  SELECT s.center_id, s.work_area_id INTO v_shift FROM shifts s WHERE s.id = NEW.shift_id;
  IF v_shift.center_id IS NULL THEN RETURN NEW; END IF;
  IF NOT COALESCE((SELECT c.roster_enabled AND c.child_files_enabled FROM centers c WHERE c.id = v_shift.center_id), false) THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.check_out_time IS NOT NULL AND OLD.check_out_time IS NULL THEN
      PERFORM public.roster_move(v_shift.center_id, NULL, NEW.staff_id, NULL, 'home', NULL);
    ELSIF NEW.check_in_time IS NOT NULL AND OLD.check_in_time IS NULL AND v_shift.work_area_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM work_areas w WHERE w.id = v_shift.work_area_id AND w.is_active AND w.on_roster) THEN
      PERFORM public.roster_move(v_shift.center_id, NULL, NEW.staff_id, v_shift.work_area_id, 'classroom', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live roster: could not place staff % for shift %: %', NEW.staff_id, NEW.shift_id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_roster_on_shift_claim ON public.shift_claims;
CREATE TRIGGER trg_roster_on_shift_claim AFTER UPDATE OF check_in_time, check_out_time ON public.shift_claims
  FOR EACH ROW EXECUTE FUNCTION public.roster_on_shift_claim();

REVOKE ALL ON FUNCTION public.roster_move(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_on_shift_claim() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_apply(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_snapshot(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_apply(uuid, uuid, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_snapshot(uuid, date) TO authenticated;
