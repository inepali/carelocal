-- ============================================================
-- Daily activities, phase D (continued): owners and admins review photos.
--  - A teacher's photo waits for review; only approved photos go with the child's daily activities (and the
--    parent report). Photos an owner or admin takes are approved at once.
--  - daily_photo_review(): approve, or delete (removes the photo from every child it was on, with a reason;
--    the app then deletes the file). Owners and admins only.
--  - daily_photos_for_review(): the photos waiting (or approved) in the last days, one row per photo with the
--    children it is on and their marketing consent.
--  - daily_day() also says whether a photo is approved (its columns change, so it is dropped and created again).
--  - Photos already saved before this migration count as approved.
-- Rollback: supabase/rollbacks/20261216000000_photo_review.down.sql
-- ============================================================

ALTER TABLE public.child_daily_entries ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.child_daily_entries ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.child_daily_entries SET approved_at = created_at, approved_by = created_by WHERE kind = 'photo' AND approved_at IS NULL;
CREATE INDEX IF NOT EXISTS child_daily_entries_photo_review_idx ON public.child_daily_entries (center_id, service_date)
  WHERE kind = 'photo' AND voided_at IS NULL;

-- 1. Saving a photo: approved at once when an owner or admin took it (otherwise as in 20261215)
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
  -- Photos taken by an owner or admin are approved at once; a teacher's wait for review
  v_ok_at   timestamptz := CASE WHEN public.can_view_confidential(p_center_id) THEN now() END;
  v_ok_by   uuid := CASE WHEN public.can_view_confidential(p_center_id) THEN auth.uid() END;
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
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, created_by, approved_at, approved_by)
    VALUES (p_center_id, p_child_id, v_day, 'photo', v_at, v_details, v_key, auth.uid(), v_ok_at, v_ok_by);
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
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, work_area_id, created_by, approved_at, approved_by)
    VALUES (p_center_id, v_child, v_day, 'photo', v_at, v_details || '{"class": true}'::jsonb, v_key, p_room_id, auth.uid(), v_ok_at, v_ok_by);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 2. Approve or delete one photo (on every child it is on). Returns how many entries changed.
CREATE OR REPLACE FUNCTION public.daily_photo_review(p_center_id uuid, p_photo_key text, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer; v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Not approved');
BEGIN
  IF NOT (public.can_view_confidential(p_center_id) AND public.can_use_roster(p_center_id)) THEN
    RAISE EXCEPTION 'Only the owner and administrators can review photos.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'Keep the reason to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_approve THEN
    UPDATE child_daily_entries SET approved_at = now(), approved_by = auth.uid()
    WHERE center_id = p_center_id AND kind = 'photo' AND details->>'photo_key' = p_photo_key
      AND voided_at IS NULL AND approved_at IS NULL;
  ELSE
    UPDATE child_daily_entries SET voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
    WHERE center_id = p_center_id AND kind = 'photo' AND details->>'photo_key' = p_photo_key AND voided_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- 3. Photos to review: one row per photo, newest first, from the last p_days days
CREATE OR REPLACE FUNCTION public.daily_photos_for_review(p_center_id uuid, p_waiting boolean DEFAULT true, p_days integer DEFAULT 14)
RETURNS TABLE (
  photo_key   text,
  caption     text,
  is_class    boolean,
  room_name   text,
  taken_at    timestamptz,
  taken_by    text,
  approved_at timestamptz,
  children    jsonb      -- [{"id", "name", "marketing_ok"}]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public.can_view_confidential(p_center_id) AND public.can_use_roster(p_center_id)) THEN
    RAISE EXCEPTION 'Only the owner and administrators can review photos.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.details->>'photo_key',
           max(e.details->>'caption'),
           bool_or(COALESCE((e.details->>'class')::boolean, false)),
           max(w.name),
           min(e.at),
           public.daily_person_label((array_agg(e.created_by))[1], p_center_id),
           max(e.approved_at),
           jsonb_agg(jsonb_build_object(
             'id', ch.id,
             'name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name) || ' ' || left(ch.last_name, 1) || '.',
             'marketing_ok', ch.marketing_photos_allowed) ORDER BY ch.first_name)
    FROM child_daily_entries e
    JOIN children ch ON ch.id = e.child_id
    LEFT JOIN work_areas w ON w.id = e.work_area_id
    WHERE e.center_id = p_center_id AND e.kind = 'photo' AND e.voided_at IS NULL
      AND e.service_date >= public.roster_today(p_center_id) - GREATEST(0, LEAST(COALESCE(p_days, 14), 90))
      AND (e.approved_at IS NULL) = COALESCE(p_waiting, true)
    GROUP BY e.details->>'photo_key'
    ORDER BY min(e.at) DESC;
END $$;

-- 4. The child card knows whether each photo is approved
DROP FUNCTION IF EXISTS public.daily_day(uuid, uuid, date);
CREATE FUNCTION public.daily_day(p_center_id uuid, p_child_id uuid, p_day date DEFAULT NULL)
RETURNS TABLE (
  id           uuid,
  kind         text,
  at           timestamptz,
  ends_at      timestamptz,
  details      jsonb,
  batch_id     uuid,
  recorded_by  text,
  mine         boolean,
  can_void     boolean,
  voided_at    timestamptz,
  voided_by    text,
  void_reason  text,
  approved     boolean      -- photos: false while waiting for an owner or admin to review; NULL for other kinds
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_day date; v_director boolean; v_today date;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(p_center_id);
  v_day := COALESCE(p_day, v_today);
  v_director := public.can_view_confidential(p_center_id);
  RETURN QUERY
    SELECT e.id, e.kind, e.at, e.ends_at, e.details, e.batch_id,
           public.daily_person_label(e.created_by, e.center_id),
           e.created_by IS NOT DISTINCT FROM auth.uid(),
           e.voided_at IS NULL AND (v_director OR (e.created_by = auth.uid() AND e.service_date = v_today)),
           e.voided_at, public.daily_person_label(e.voided_by, e.center_id), e.void_reason,
           CASE WHEN e.kind = 'photo' THEN e.approved_at IS NOT NULL END
    FROM child_daily_entries e
    WHERE e.center_id = p_center_id AND e.child_id = p_child_id AND e.service_date = v_day
    ORDER BY e.at DESC, e.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.daily_day(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_day(uuid, uuid, date) TO authenticated;

-- 5. Grants
REVOKE ALL ON FUNCTION public.daily_photo_review(uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_photos_for_review(uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_photo_review(uuid, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_photos_for_review(uuid, boolean, integer) TO authenticated;
