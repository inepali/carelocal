-- Rollback for 20261214000000_naps_medicine.sql.
-- Deletes naps, sleep checks and medicine given, and every authorized medicine; restores the earlier functions.
DROP FUNCTION IF EXISTS public.daily_room_naps(uuid);
DROP FUNCTION IF EXISTS public.daily_child_status(uuid, uuid);
DROP FUNCTION IF EXISTS public.daily_medicine_give(uuid, uuid, uuid, text, timestamptz, text, uuid);
DROP FUNCTION IF EXISTS public.daily_medicines_today(uuid, uuid);
DROP FUNCTION IF EXISTS public.daily_sleep_check(uuid, jsonb, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.daily_nap_end(uuid, uuid[], timestamptz);
DROP FUNCTION IF EXISTS public.daily_nap_start(uuid, uuid[], timestamptz, uuid);
DROP FUNCTION IF EXISTS public.daily_open_nap(uuid, uuid);

DELETE FROM public.child_daily_entries WHERE kind IN ('nap', 'sleep_check', 'medicine');
DROP INDEX IF EXISTS public.child_daily_entries_open_nap_idx;
ALTER TABLE public.child_daily_entries DROP CONSTRAINT IF EXISTS child_daily_entries_medication_fk;
DELETE FROM public.child_audit_log WHERE table_name = 'child_medications';
DROP TABLE IF EXISTS public.child_medications;
DROP FUNCTION IF EXISTS public.child_medications_same_center();
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_sleep_check_minutes_range;
ALTER TABLE public.centers DROP COLUMN IF EXISTS sleep_check_minutes;

-- As in 20261213000000_daily_entries.sql
CREATE OR REPLACE FUNCTION public.daily_details(p_kind text, p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  d     jsonb := COALESCE(p_details, '{}'::jsonb);
  v_out jsonb;
  v_txt text;
  v_oz  numeric;
  v_note text := NULLIF(btrim(d->>'note'), '');
BEGIN
  IF jsonb_typeof(d) <> 'object' THEN
    RAISE EXCEPTION 'The entry details are not valid.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'Keep the note to 200 characters.' USING ERRCODE = '22023';
  END IF;

  CASE p_kind
  WHEN 'meal' THEN
    IF (d->>'meal' = ANY (ARRAY['breakfast', 'am_snack', 'lunch', 'pm_snack', 'supper'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'Pick the meal.' USING ERRCODE = '22023';
    END IF;
    IF (d->>'amount' = ANY (ARRAY['none', 'little', 'half', 'all', 'other'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'Pick how much was eaten.' USING ERRCODE = '22023';
    END IF;
    v_out := jsonb_build_object('meal', d->>'meal', 'amount', d->>'amount');
    IF d->>'amount' = 'other' THEN
      v_txt := NULLIF(btrim(d->>'other'), '');
      IF v_txt IS NULL OR char_length(v_txt) > 100 THEN
        RAISE EXCEPTION 'Describe how much was eaten (up to 100 characters).' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('other', v_txt);
    END IF;

  WHEN 'bottle' THEN
    BEGIN
      v_oz := (d->>'oz')::numeric;
    EXCEPTION WHEN others THEN v_oz := NULL; END;
    IF v_oz IS NULL OR v_oz < 0.5 OR v_oz > 12 OR v_oz % 0.5 <> 0 THEN
      RAISE EXCEPTION 'Pick the ounces: 0.5 to 12, in half ounces.' USING ERRCODE = '22023';
    END IF;
    IF (d->>'contents' = ANY (ARRAY['formula', 'breast_milk', 'milk', 'other'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'Pick what was in the bottle.' USING ERRCODE = '22023';
    END IF;
    v_out := jsonb_build_object('oz', v_oz, 'contents', d->>'contents');
    IF d->>'contents' = 'other' THEN
      v_txt := NULLIF(btrim(d->>'other'), '');
      IF v_txt IS NULL OR char_length(v_txt) > 100 THEN
        RAISE EXCEPTION 'Say what was in the bottle (up to 100 characters).' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('other', v_txt);
    END IF;

  WHEN 'diaper' THEN
    IF (d->>'result' = ANY (ARRAY['wet', 'bm', 'wet_bm', 'dry'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'Pick Wet, BM, Wet + BM or Dry.' USING ERRCODE = '22023';
    END IF;
    IF d ? 'cream' AND jsonb_typeof(d->'cream') <> 'boolean' THEN
      RAISE EXCEPTION 'Cream is yes or no.' USING ERRCODE = '22023';
    END IF;
    v_out := jsonb_build_object('result', d->>'result', 'cream', COALESCE((d->>'cream')::boolean, false));

  WHEN 'bathroom' THEN
    IF (d->>'result' = ANY (ARRAY['went', 'tried', 'accident'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'Pick Went, Tried or Accident.' USING ERRCODE = '22023';
    END IF;
    IF d->>'type' IS NOT NULL AND NOT (d->>'type' = ANY (ARRAY['wet', 'bm', 'wet_bm'])) THEN
      RAISE EXCEPTION 'Pick Wet, BM or both.' USING ERRCODE = '22023';
    END IF;
    v_out := jsonb_build_object('result', d->>'result');
    IF d->>'type' IS NOT NULL AND d->>'result' <> 'tried' THEN
      v_out := v_out || jsonb_build_object('type', d->>'type');
    END IF;

  WHEN 'activity' THEN
    v_txt := NULLIF(btrim(d->>'text'), '');
    IF v_txt IS NULL OR char_length(v_txt) > 200 THEN
      RAISE EXCEPTION 'Describe the activity (up to 200 characters).' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('text', v_txt);

  WHEN 'note' THEN
    v_txt := NULLIF(btrim(d->>'text'), '');
    IF v_txt IS NULL OR char_length(v_txt) > 500 THEN
      RAISE EXCEPTION 'Write the note (up to 500 characters).' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('text', v_txt);

  WHEN 'nap', 'sleep_check', 'medicine', 'photo' THEN
    RAISE EXCEPTION 'Logging this is not available yet.' USING ERRCODE = '0A000';
  ELSE
    RAISE EXCEPTION 'Unknown kind of entry.' USING ERRCODE = '22023';
  END CASE;

  IF v_note IS NOT NULL THEN v_out := v_out || jsonb_build_object('note', v_note); END IF;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.daily_entry_add(
  p_center_id uuid, p_child_id uuid, p_kind text, p_details jsonb,
  p_at timestamptz DEFAULT NULL, p_client_key uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_day date; v_at timestamptz := COALESCE(p_at, now()); v_details jsonb;
BEGIN
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
REVOKE ALL ON FUNCTION public.daily_details(text, jsonb) FROM PUBLIC, anon, authenticated;

-- As in 20261209000000_child_photo_log_wording.sql
CREATE OR REPLACE FUNCTION public.log_child_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_child uuid; v_center uuid; v_row uuid;
  v_fields text[] := '{}'; v_summary text; v_req text; k text; v_kind text;
  v_photo text; v_rest text[];
BEGIN
  IF TG_OP = 'DELETE' THEN v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW);
  ELSE v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_child := COALESCE(v_new, v_old)->>'id';
  ELSE
    v_child := COALESCE(v_new, v_old)->>'child_id';
  END IF;
  v_center := COALESCE(v_new, v_old)->>'center_id';
  v_row := COALESCE(v_new, v_old)->>'id';

  IF NOT EXISTS (SELECT 1 FROM children WHERE id = v_child) THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k <> 'updated_at' AND (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN v_fields := v_fields || k; END IF;
    END LOOP;
    IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    IF TG_OP = 'INSERT' THEN
      v_summary := 'Child added';
    ELSE
      -- The headshot reads as plain words; any other changed fields are listed as before
      v_photo := CASE WHEN 'photo_key' = ANY (v_fields) THEN
        CASE WHEN v_old->>'photo_key' IS NULL THEN 'Photo added'
             WHEN v_new->>'photo_key' IS NULL THEN 'Photo removed'
             ELSE 'Photo changed' END
      END;
      v_rest := array_remove(v_fields, 'photo_key');
      v_summary := concat_ws('; ', v_photo, CASE WHEN cardinality(v_rest) > 0 THEN 'Changed: ' || array_to_string(v_rest, ', ') END);
    END IF;
  ELSIF TG_TABLE_NAME = 'child_guardians' THEN
    v_summary := CASE TG_OP
      WHEN 'INSERT' THEN 'Added ' || (v_new->>'name') || CASE WHEN (v_new->>'can_pick_up')::boolean THEN ', authorized to pick up' ELSE '' END
      WHEN 'DELETE' THEN 'Removed ' || (v_old->>'name')
      ELSE (v_new->>'name') || ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'can_pick_up' = ANY (v_fields)
                   THEN CASE WHEN (v_new->>'can_pick_up')::boolean THEN ' (pick-up authorized)' ELSE ' (pick-up removed)' END
                   ELSE '' END
    END;
  ELSIF TG_TABLE_NAME = 'child_documents' THEN
    SELECT document_name INTO v_req FROM center_document_requirements WHERE id = (COALESCE(v_new, v_old)->>'requirement_id')::uuid;
    v_summary := COALESCE(v_req, 'Record') || CASE TG_OP
      WHEN 'INSERT' THEN ': record created'
      WHEN 'DELETE' THEN ': record removed'
      ELSE ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'status' = ANY (v_fields) THEN ' (' || (v_old->>'status') || ' to ' || (v_new->>'status') || ')' ELSE '' END
    END;
  ELSE  -- child_files
    v_kind := CASE WHEN COALESCE(v_new->>'category', v_old->>'category') = 'incident' THEN 'Incident form ' ELSE 'File ' END;
    v_summary := CASE TG_OP WHEN 'INSERT' THEN v_kind || 'added: ' WHEN 'DELETE' THEN v_kind || 'removed: ' ELSE v_kind || 'changed: ' END
                 || COALESCE(v_new->>'file_name', v_old->>'file_name');
  END IF;

  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, changed_fields, summary)
  VALUES (v_center, v_child, TG_TABLE_NAME, v_row, lower(TG_OP), auth.uid(), v_fields, left(v_summary, 300));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.log_child_change() FROM PUBLIC, anon, authenticated;
