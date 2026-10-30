-- ============================================================
-- ROLLBACK for supabase/migrations/20261212000000_child_card_fields.sql
-- Puts roster_snapshot() back as in 20261210000000_roster_substitutes.sql, removes daily_set_toilet_trained()
-- and the three child columns (their values are lost). Run by hand.
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS public.daily_set_toilet_trained(uuid, uuid, boolean);
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
REVOKE ALL ON FUNCTION public.roster_snapshot(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_snapshot(uuid, date) TO authenticated;

ALTER TABLE public.children DROP CONSTRAINT IF EXISTS children_care_alert_length;
ALTER TABLE public.children DROP COLUMN IF EXISTS daily_photos_allowed;
ALTER TABLE public.children DROP COLUMN IF EXISTS toilet_trained;
ALTER TABLE public.children DROP COLUMN IF EXISTS care_alert;

DO $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261212000000';
  END IF;
END $$;

COMMIT;
