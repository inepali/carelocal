-- ============================================================
-- Teacher view, Phase A: what the child card needs
--
--  - children.care_alert: a short warning on the child card (allergy, health need). Owners and admins set it.
--  - children.toilet_trained: NULL = decide by age (under 36 months shows Diaper); the room teacher can change
--    it from the card through daily_set_toilet_trained().
--  - children.daily_photos_allowed: family consent for activity photos (owners and admins).
--  - roster_snapshot() returns the three for children. Its columns change, so it is dropped and created again.
-- Rollback: supabase/rollbacks/20261212000000_child_card_fields.down.sql
-- ============================================================

ALTER TABLE public.children ADD COLUMN IF NOT EXISTS care_alert text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS toilet_trained boolean;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS daily_photos_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE public.children DROP CONSTRAINT IF EXISTS children_care_alert_length;
ALTER TABLE public.children ADD CONSTRAINT children_care_alert_length
  CHECK (care_alert IS NULL OR char_length(care_alert) <= 200);

DROP FUNCTION IF EXISTS public.roster_snapshot(uuid, date);
CREATE FUNCTION public.roster_snapshot(p_center_id uuid, p_date date DEFAULT NULL)
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
  updated_at    timestamptz,
  care_alert    text,      -- children only: the red line on the child card
  diaper_or_bathroom text, -- children only: 'diaper' | 'bathroom' (set, or by age: under 36 months = diaper)
  daily_photos_allowed boolean -- children only: family consent for activity photos
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
           p.work_area_id, COALESCE(p.zone, 'home'), p.updated_at,
           ch.care_alert,
           CASE WHEN ch.toilet_trained IS TRUE THEN 'bathroom'
                WHEN ch.toilet_trained IS FALSE THEN 'diaper'
                WHEN public.roster_age_months(ch.date_of_birth, v_day) < 36 THEN 'diaper'
                ELSE 'bathroom' END,
           ch.daily_photos_allowed
    FROM children ch
    LEFT JOIN roster_presence p ON p.center_id = ch.center_id AND p.service_date = v_day AND p.child_id = ch.id
    WHERE ch.center_id = p_center_id AND ch.status = 'enrolled'
    UNION ALL
    -- Regular teachers of the center, plus anyone on today's roster (a substitute placed by their shift
    -- check-in, even one with no link to the center)
    SELECT 'staff'::text, sp.id, sp.first_name, left(sp.last_name, 1),
           sp.avatar_url, NULL::integer, cs.home_work_area_id, COALESCE(cs.employment_class, 'substitute'),
           p.work_area_id, COALESCE(p.zone, 'home'), p.updated_at,
           NULL::text, NULL::text, NULL::boolean
    FROM staff_profiles sp
    LEFT JOIN center_staff cs ON cs.staff_id = sp.id AND cs.center_id = p_center_id
    LEFT JOIN roster_presence p ON p.center_id = p_center_id AND p.service_date = v_day AND p.staff_id = sp.id
    WHERE sp.id IN (
      SELECT c.staff_id FROM center_staff c WHERE c.center_id = p_center_id AND c.status = 'active' AND c.employment_class = 'regular'
      UNION
      SELECT r.staff_id FROM roster_presence r WHERE r.center_id = p_center_id AND r.service_date = v_day AND r.staff_id IS NOT NULL
    );
END $$;

-- The room teacher (or an owner/admin) marks a child toilet trained, in diapers, or back to "by age" (NULL).
-- A room teacher is a regular teacher whose home room is the child's home room, or the room the child is in today.
CREATE OR REPLACE FUNCTION public.daily_set_toilet_trained(p_center_id uuid, p_child_id uuid, p_value boolean)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room uuid; v_today_room uuid; v_age integer;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.' USING ERRCODE = '42501';
  END IF;
  SELECT ch.classroom_id, public.roster_age_months(ch.date_of_birth, public.roster_today(p_center_id))
    INTO v_room, v_age
    FROM children ch WHERE ch.id = p_child_id AND ch.center_id = p_center_id AND ch.status = 'enrolled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That child is not enrolled at this center' USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.work_area_id INTO v_today_room FROM roster_presence p
   WHERE p.center_id = p_center_id AND p.child_id = p_child_id AND p.service_date = public.roster_today(p_center_id);
  IF NOT public.can_view_confidential(p_center_id) AND NOT EXISTS (
    SELECT 1 FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
     WHERE sp.user_id = auth.uid() AND cs.center_id = p_center_id AND cs.status = 'active' AND cs.employment_class = 'regular'
       AND cs.home_work_area_id IS NOT NULL AND cs.home_work_area_id IN (v_room, v_today_room)
  ) THEN
    RAISE EXCEPTION 'Only this child''s room teacher or a director can change this.' USING ERRCODE = '42501';
  END IF;

  UPDATE children SET toilet_trained = p_value WHERE id = p_child_id;
  RETURN CASE WHEN p_value IS TRUE THEN 'bathroom' WHEN p_value IS FALSE THEN 'diaper'
              WHEN v_age < 36 THEN 'diaper' ELSE 'bathroom' END;
END $$;

REVOKE ALL ON FUNCTION public.roster_snapshot(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_snapshot(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.daily_set_toilet_trained(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_set_toilet_trained(uuid, uuid, boolean) TO authenticated;
