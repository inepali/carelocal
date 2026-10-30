-- ============================================================
-- ROLLBACK for supabase/migrations/20261210000000_roster_substitutes.sql
-- Removes the shift check-in trigger and puts back roster_apply() and roster_snapshot() as they were in
-- 20261208000000_live_roster.sql. Substitutes already on today's roster stay in roster_presence; they just
-- stop showing on the board. Run by hand.
-- ============================================================
BEGIN;

DROP TRIGGER IF EXISTS trg_roster_on_shift_claim ON public.shift_claims;
DROP FUNCTION IF EXISTS public.roster_on_shift_claim();

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

DROP FUNCTION IF EXISTS public.roster_move(uuid, uuid, uuid, uuid, text, uuid);

REVOKE ALL ON FUNCTION public.roster_apply(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_snapshot(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_apply(uuid, uuid, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_snapshot(uuid, date) TO authenticated;

DO $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261210000000';
  END IF;
END $$;

COMMIT;
