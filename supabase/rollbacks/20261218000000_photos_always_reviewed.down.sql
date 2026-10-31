-- Rollback for 20261218000000_photos_always_reviewed.sql: photos an owner or admin takes are approved at once again.
-- As in 20261216000000_photo_review.sql
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
