-- ============================================================
-- Daily activities, phase D: photos.
--  - Anyone who can use the roster (owner, admin, room teacher) can photograph any enrolled child:
--      a single photo is tagged to one child; a class photo is tagged to the room and added to the day of
--      every child the teacher keeps ticked (the children in the room by default).
--  - Photos live in the child bucket: child/<center>/<child>/daily/<date>/... for one child,
--    child/<center>/class/<room>/<date>/... for a class photo. daily_photo_add() refuses any other key.
--  - Consent is only for marketing and social media: children.daily_photos_allowed becomes
--    marketing_photos_allowed. It never blocks daily photos; it tells staff whose photos must not be posted.
--  - Photos are removed like any entry (voided with a reason); the file stays with the record.
-- Rollback: supabase/rollbacks/20261215000000_daily_photos.down.sql
-- ============================================================

-- 1. Consent is for marketing and social media only
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'children' AND column_name = 'daily_photos_allowed') THEN
    ALTER TABLE public.children RENAME COLUMN daily_photos_allowed TO marketing_photos_allowed;
  END IF;
END $$;
COMMENT ON COLUMN public.children.marketing_photos_allowed IS
  'Parents allow the child''s photos to be used for marketing and social media. Daily photos do not need it.';

-- 2. roster_snapshot() returns the renamed column (its columns change, so it is dropped and created again)
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
  marketing_photos_allowed boolean -- children only: parents allow photos for marketing and social media
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
           ch.marketing_photos_allowed
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

-- 3. A class photo remembers its room
ALTER TABLE public.child_daily_entries ADD COLUMN IF NOT EXISTS work_area_id uuid REFERENCES public.work_areas(id) ON DELETE SET NULL;

-- 4. Photos have their own function; the general one refuses them (otherwise as in 20261214)
CREATE OR REPLACE FUNCTION public.daily_entry_add(
  p_center_id uuid, p_child_id uuid, p_kind text, p_details jsonb,
  p_at timestamptz DEFAULT NULL, p_client_key uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_day date; v_at timestamptz := COALESCE(p_at, now()); v_details jsonb;
BEGIN
  IF p_kind IN ('nap', 'sleep_check', 'medicine', 'photo') THEN
    RAISE EXCEPTION 'Naps, sleep checks, medicine and photos are logged from their own buttons.' USING ERRCODE = '22023';
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

-- 5. May the caller photograph this child, or this room? (the upload link is signed only when this says yes)
CREATE OR REPLACE FUNCTION public.daily_photo_access(p_center_id uuid, p_child_id uuid DEFAULT NULL, p_room_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_use_roster(p_center_id)
     AND num_nonnulls(p_child_id, p_room_id) = 1
     AND (p_child_id IS NULL OR EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND center_id = p_center_id AND status = 'enrolled'))
     AND (p_room_id IS NULL OR EXISTS (SELECT 1 FROM work_areas WHERE id = p_room_id AND center_id = p_center_id AND on_roster));
$$;

-- 6. Save an uploaded photo. One child: p_child_id. Class photo: p_room_id and the children tagged (p_child_ids).
--    Returns how many children it was added to. A retried Save (same p_key) adds nothing.
CREATE OR REPLACE FUNCTION public.daily_photo_add(
  p_center_id uuid, p_photo_key text, p_caption text DEFAULT NULL,
  p_child_id uuid DEFAULT NULL, p_room_id uuid DEFAULT NULL, p_child_ids uuid[] DEFAULT NULL,
  p_at timestamptz DEFAULT NULL, p_key uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_at      timestamptz := COALESCE(p_at, now());
  v_key     uuid := COALESCE(p_key, gen_random_uuid());
  v_caption text := NULLIF(btrim(p_caption), '');
  v_prefix  text;
  v_child   uuid;
  v_day     date;
  v_details jsonb;
  v_n       integer := 0;
BEGIN
  IF NOT public.daily_photo_access(p_center_id, p_child_id, p_room_id) THEN
    RAISE EXCEPTION 'You cannot add photos for that child or room.' USING ERRCODE = '42501';
  END IF;
  IF v_caption IS NOT NULL AND char_length(v_caption) > 200 THEN
    RAISE EXCEPTION 'Keep the caption to 200 characters.' USING ERRCODE = '22023';
  END IF;
  v_prefix := CASE WHEN p_child_id IS NOT NULL THEN format('child/%s/%s/daily/', p_center_id, p_child_id)
                   ELSE format('child/%s/class/%s/', p_center_id, p_room_id) END;
  IF p_photo_key IS NULL OR left(p_photo_key, length(v_prefix)) <> v_prefix OR p_photo_key LIKE '%..%'
     OR char_length(p_photo_key) > 300 THEN
    RAISE EXCEPTION 'That photo is not in the right folder.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM child_daily_entries WHERE batch_id = v_key AND center_id = p_center_id) THEN
    SELECT count(*) INTO v_n FROM child_daily_entries WHERE batch_id = v_key;
    RETURN v_n;
  END IF;
  v_details := jsonb_build_object('photo_key', p_photo_key) || CASE WHEN v_caption IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('caption', v_caption) END;

  IF p_child_id IS NOT NULL THEN
    v_day := public.daily_check_write(p_center_id, p_child_id, v_at);
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, created_by)
    VALUES (p_center_id, p_child_id, v_day, 'photo', v_at, v_details, v_key, auth.uid());
    RETURN 1;
  END IF;

  IF p_child_ids IS NULL OR cardinality(p_child_ids) = 0 THEN
    RAISE EXCEPTION 'Tag at least one child in the class photo.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_child_ids) > 60 THEN
    RAISE EXCEPTION 'That is more children than one room holds.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_child IN ARRAY (SELECT array_agg(DISTINCT c) FROM unnest(p_child_ids) c) LOOP
    v_day := public.daily_check_write(p_center_id, v_child, v_at);
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, work_area_id, created_by)
    VALUES (p_center_id, v_child, v_day, 'photo', v_at, v_details || '{"class": true}'::jsonb, v_key, p_room_id, auth.uid());
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 7. Grants
REVOKE ALL ON FUNCTION public.daily_photo_access(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_photo_add(uuid, text, text, uuid, uuid, uuid[], timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_photo_access(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_photo_add(uuid, text, text, uuid, uuid, uuid[], timestamptz, uuid) TO authenticated;
