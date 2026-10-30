-- Rollback for 20261215000000_daily_photos.sql. Deletes the photo entries (the files stay in the bucket).
DROP FUNCTION IF EXISTS public.daily_photo_add(uuid, text, text, uuid, uuid, uuid[], timestamptz, uuid);
DROP FUNCTION IF EXISTS public.daily_photo_access(uuid, uuid, uuid);
DELETE FROM public.child_daily_entries WHERE kind = 'photo';
ALTER TABLE public.child_daily_entries DROP COLUMN IF EXISTS work_area_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'children' AND column_name = 'marketing_photos_allowed') THEN
    ALTER TABLE public.children RENAME COLUMN marketing_photos_allowed TO daily_photos_allowed;
  END IF;
END $$;
COMMENT ON COLUMN public.children.daily_photos_allowed IS NULL;

-- As in 20261212000000_child_card_fields.sql
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
REVOKE ALL ON FUNCTION public.roster_snapshot(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_snapshot(uuid, date) TO authenticated;

-- As in 20261214000000_naps_medicine.sql
CREATE OR REPLACE FUNCTION public.daily_entry_add(
  p_center_id uuid, p_child_id uuid, p_kind text, p_details jsonb,
  p_at timestamptz DEFAULT NULL, p_client_key uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_day date; v_at timestamptz := COALESCE(p_at, now()); v_details jsonb;
BEGIN
  IF p_kind IN ('nap', 'sleep_check', 'medicine') THEN
    RAISE EXCEPTION 'Naps, sleep checks and medicine are logged from their own buttons.' USING ERRCODE = '22023';
  END IF;
  IF p_client_key IS NOT NULL THEN
    SELECT id INTO v_id FROM child_daily_entries WHERE client_key = p_client_key AND center_id = p_center_id AND child_id = p_child_id;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  v_day := public.daily_check_write(p_center_id, p_child_id, v_at);
  v_details := public.daily_details(p_kind, p_details);

  INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, client_key, created_by)
  VALUES (p_center_id, p_child_id, v_day, p_kind, v_at, v_details, p_client_key, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
