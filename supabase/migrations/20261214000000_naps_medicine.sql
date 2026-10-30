-- ============================================================
-- Daily activities, phase C: naps, sleep checks and medicine.
--  - centers.sleep_check_minutes: how often sleep checks come due (default 15; NC requires in-person checks
--    at least every 15 minutes for infants 12 months and younger, 10A NCAC 09 .0606).
--  - child_medications: the medicines an owner or admin authorized from the child's medical form, with the
--    date the parent signed permission (10A NCAC 09 .0803). Kept, never deleted: a medicine is stopped.
--    Changes are logged in the child's activity log.
--  - Naps: daily_nap_start() / daily_nap_end() for one child or the room; an open nap has no ends_at.
--  - Sleep checks: daily_sleep_check() for one child or every sleeping child in the room; each belongs to
--    an open nap and records a status.
--  - Medicine: daily_medicine_give() only for a medicine on the child's active list, within its dates.
--  - daily_child_status() (the card) and daily_room_naps() (the board) tell teachers who is asleep, when
--    the last check was, and which medicines they may give. Teachers still never read the children table.
-- Rollback: supabase/rollbacks/20261214000000_naps_medicine.down.sql
-- ============================================================

-- 1. Center setting --------------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS sleep_check_minutes integer NOT NULL DEFAULT 15;
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_sleep_check_minutes_range;
ALTER TABLE public.centers ADD CONSTRAINT centers_sleep_check_minutes_range CHECK (sleep_check_minutes BETWEEN 5 AND 60);

-- 2. Authorized medicines --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.child_medications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id             uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  child_id              uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  name                  text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  dose                  text NOT NULL CHECK (char_length(btrim(dose)) BETWEEN 1 AND 60),
  schedule              text CHECK (schedule IS NULL OR char_length(schedule) <= 120),       -- when or how often
  instructions          text CHECK (instructions IS NULL OR char_length(instructions) <= 500),
  permission_signed_on  date NOT NULL,                       -- the parent's signed permission
  starts_on             date NOT NULL DEFAULT current_date,
  ends_on               date,
  active                boolean NOT NULL DEFAULT true,       -- false = stopped
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT child_medications_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS child_medications_child_idx ON public.child_medications (child_id);

-- The medicine must belong to the child's own center
CREATE OR REPLACE FUNCTION public.child_medications_same_center()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM children WHERE id = NEW.child_id AND center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'That child is not at this center.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_child_medications_same_center ON public.child_medications;
CREATE TRIGGER trg_child_medications_same_center BEFORE INSERT OR UPDATE ON public.child_medications
  FOR EACH ROW EXECUTE FUNCTION public.child_medications_same_center();
DROP TRIGGER IF EXISTS set_updated_at ON public.child_medications;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.child_medications FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.child_medications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners and admins read child_medications" ON public.child_medications;
CREATE POLICY "Owners and admins read child_medications" ON public.child_medications
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins add child_medications" ON public.child_medications;
CREATE POLICY "Owners and admins add child_medications" ON public.child_medications
  FOR INSERT TO authenticated WITH CHECK (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins change child_medications" ON public.child_medications;
CREATE POLICY "Owners and admins change child_medications" ON public.child_medications
  FOR UPDATE TO authenticated USING (public.can_view_confidential(center_id)) WITH CHECK (public.can_view_confidential(center_id));
REVOKE ALL ON public.child_medications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.child_medications TO authenticated;   -- no DELETE: stopped, never removed

ALTER TABLE public.child_daily_entries DROP CONSTRAINT IF EXISTS child_daily_entries_medication_fk;
ALTER TABLE public.child_daily_entries ADD CONSTRAINT child_daily_entries_medication_fk
  FOREIGN KEY (medication_id) REFERENCES public.child_medications(id);   -- a given dose keeps its medicine
CREATE INDEX IF NOT EXISTS child_daily_entries_open_nap_idx ON public.child_daily_entries (child_id, service_date)
  WHERE kind = 'nap' AND ends_at IS NULL AND voided_at IS NULL;

-- 3. The child's activity log now covers medicines too (otherwise unchanged from 20261209) -------------------
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
  ELSIF TG_TABLE_NAME = 'child_medications' THEN
    v_summary := CASE
      WHEN TG_OP = 'INSERT' THEN 'Medicine authorized: ' || (v_new->>'name') || ', ' || (v_new->>'dose')
      WHEN TG_OP = 'DELETE' THEN 'Medicine removed: ' || (v_old->>'name')
      WHEN 'active' = ANY (v_fields) AND NOT (v_new->>'active')::boolean THEN 'Medicine stopped: ' || (v_new->>'name')
      WHEN 'active' = ANY (v_fields) THEN 'Medicine restarted: ' || (v_new->>'name')
      ELSE 'Medicine changed: ' || (v_new->>'name') || ' (' || array_to_string(v_fields, ', ') || ')'
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

DROP TRIGGER IF EXISTS trg_audit_child_medications ON public.child_medications;
CREATE TRIGGER trg_audit_child_medications AFTER INSERT OR UPDATE OR DELETE ON public.child_medications
  FOR EACH ROW EXECUTE FUNCTION public.log_child_change();

-- 4. Details for the new kinds (meal ... note unchanged from 20261213) ----------------------------------------
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

  WHEN 'nap' THEN
    v_out := '{}'::jsonb;

  WHEN 'sleep_check' THEN
    IF (d->>'status' = ANY (ARRAY['back', 'other', 'restless', 'awake'])) IS NOT TRUE THEN
      RAISE EXCEPTION 'Pick Asleep on back, Asleep (other position), Restless or Awake.' USING ERRCODE = '22023';
    END IF;
    v_out := jsonb_build_object('status', d->>'status');

  WHEN 'medicine' THEN
    v_txt := NULLIF(btrim(d->>'dose'), '');
    IF v_txt IS NULL OR char_length(v_txt) > 60 THEN
      RAISE EXCEPTION 'Enter the dose given (up to 60 characters).' USING ERRCODE = '22023';
    END IF;
    v_out := jsonb_build_object('dose', v_txt);
    IF NULLIF(btrim(d->>'name'), '') IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('name', left(btrim(d->>'name'), 100));
    END IF;

  WHEN 'photo' THEN
    RAISE EXCEPTION 'Logging this is not available yet.' USING ERRCODE = '0A000';
  ELSE
    RAISE EXCEPTION 'Unknown kind of entry.' USING ERRCODE = '22023';
  END CASE;

  IF v_note IS NOT NULL THEN v_out := v_out || jsonb_build_object('note', v_note); END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.daily_details(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Naps, sleep checks and medicine have their own functions; the general one refuses them
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

-- 5. Naps --------------------------------------------------------------------------------------------------------
-- A child's open nap today (fell asleep, not yet woke up, not removed)
CREATE OR REPLACE FUNCTION public.daily_open_nap(p_center_id uuid, p_child_id uuid)
RETURNS child_daily_entries LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM child_daily_entries
  WHERE center_id = p_center_id AND child_id = p_child_id AND service_date = public.roster_today(p_center_id)
    AND kind = 'nap' AND ends_at IS NULL AND voided_at IS NULL
  ORDER BY at DESC LIMIT 1;
$$;

-- Start naps for one child or the room. Children already asleep are skipped. Returns how many naps started.
CREATE OR REPLACE FUNCTION public.daily_nap_start(p_center_id uuid, p_child_ids uuid[], p_at timestamptz DEFAULT NULL, p_key uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz := COALESCE(p_at, now()); v_key uuid := COALESCE(p_key, gen_random_uuid());
        v_child uuid; v_day date; v_n integer := 0;
BEGIN
  IF p_child_ids IS NULL OR cardinality(p_child_ids) = 0 THEN
    RAISE EXCEPTION 'Pick at least one child.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM child_daily_entries WHERE batch_id = v_key AND center_id = p_center_id) THEN
    SELECT count(*) INTO v_n FROM child_daily_entries WHERE batch_id = v_key;
    RETURN v_n;                                                  -- the same Save, retried
  END IF;
  FOREACH v_child IN ARRAY p_child_ids LOOP
    v_day := public.daily_check_write(p_center_id, v_child, v_at);
    IF (public.daily_open_nap(p_center_id, v_child)).id IS NOT NULL THEN CONTINUE; END IF;
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, created_by)
    VALUES (p_center_id, v_child, v_day, 'nap', v_at, '{}'::jsonb, v_key, auth.uid());
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Woke up: ends the open nap of each child given. Returns how many naps ended.
CREATE OR REPLACE FUNCTION public.daily_nap_end(p_center_id uuid, p_child_ids uuid[], p_at timestamptz DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz := COALESCE(p_at, now()); v_child uuid; v_nap child_daily_entries; v_n integer := 0;
BEGIN
  IF p_child_ids IS NULL OR cardinality(p_child_ids) = 0 THEN
    RAISE EXCEPTION 'Pick at least one child.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_child IN ARRAY p_child_ids LOOP
    PERFORM public.daily_check_write(p_center_id, v_child, v_at);
    v_nap := public.daily_open_nap(p_center_id, v_child);
    IF v_nap.id IS NULL THEN CONTINUE; END IF;                   -- already up
    IF v_at < v_nap.at THEN
      RAISE EXCEPTION 'The wake-up time is before the child fell asleep.' USING ERRCODE = '22023';
    END IF;
    UPDATE child_daily_entries SET ends_at = v_at WHERE id = v_nap.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 6. Sleep checks: p_items [{"child_id": "...", "status": "back"|"other"|"restless"|"awake", "note": "..."}]
CREATE OR REPLACE FUNCTION public.daily_sleep_check(p_center_id uuid, p_items jsonb, p_at timestamptz DEFAULT NULL, p_key uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz := COALESCE(p_at, now()); v_key uuid := COALESCE(p_key, gen_random_uuid());
        v_item jsonb; v_child uuid; v_day date; v_nap child_daily_entries; v_n integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pick at least one child.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM child_daily_entries WHERE batch_id = v_key AND center_id = p_center_id) THEN
    SELECT count(*) INTO v_n FROM child_daily_entries WHERE batch_id = v_key;
    RETURN v_n;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_child := (v_item->>'child_id')::uuid;
    EXCEPTION WHEN others THEN v_child := NULL; END;
    IF v_child IS NULL THEN RAISE EXCEPTION 'A child in the list is not valid.' USING ERRCODE = '22023'; END IF;
    v_day := public.daily_check_write(p_center_id, v_child, v_at);
    v_nap := public.daily_open_nap(p_center_id, v_child);
    IF v_nap.id IS NULL THEN
      RAISE EXCEPTION 'A child in the list is not napping.' USING ERRCODE = '22023';
    END IF;
    IF v_at < v_nap.at THEN
      RAISE EXCEPTION 'The check time is before the nap started.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, nap_id, batch_id, created_by)
    VALUES (p_center_id, v_child, v_day, 'sleep_check', v_at, public.daily_details('sleep_check', v_item - 'child_id'), v_nap.id, v_key, auth.uid());
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 7. Medicine ------------------------------------------------------------------------------------------------------
-- The medicines a teacher may give a child today: active, started, not ended. Name, dose and directions only.
CREATE OR REPLACE FUNCTION public.daily_medicines_today(p_center_id uuid, p_child_id uuid)
RETURNS TABLE (id uuid, name text, dose text, schedule text, instructions text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.name, m.dose, m.schedule, m.instructions
  FROM child_medications m
  WHERE m.center_id = p_center_id AND m.child_id = p_child_id AND m.active
    AND m.starts_on <= public.roster_today(p_center_id)
    AND (m.ends_on IS NULL OR m.ends_on >= public.roster_today(p_center_id))
  ORDER BY m.name;
$$;

CREATE OR REPLACE FUNCTION public.daily_medicine_give(
  p_center_id uuid, p_child_id uuid, p_medication_id uuid, p_dose text,
  p_at timestamptz DEFAULT NULL, p_note text DEFAULT NULL, p_key uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz := COALESCE(p_at, now()); v_day date; v_med record; v_id uuid;
BEGIN
  IF p_key IS NOT NULL THEN
    SELECT id INTO v_id FROM child_daily_entries WHERE client_key = p_key AND center_id = p_center_id AND child_id = p_child_id;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  v_day := public.daily_check_write(p_center_id, p_child_id, v_at);
  SELECT * INTO v_med FROM public.daily_medicines_today(p_center_id, p_child_id) WHERE id = p_medication_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That medicine is not on this child''s authorized list for today. Ask a director.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, medication_id, client_key, created_by)
  VALUES (p_center_id, p_child_id, v_day, 'medicine', v_at,
          public.daily_details('medicine', jsonb_build_object('name', v_med.name, 'dose', COALESCE(NULLIF(btrim(p_dose), ''), v_med.dose), 'note', p_note)),
          p_medication_id, p_key, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 8. What the card and the board need -------------------------------------------------------------------------------
-- One child: the open nap (with its last check), how often checks are due, and today's medicines
CREATE OR REPLACE FUNCTION public.daily_child_status(p_center_id uuid, p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nap child_daily_entries; v_check child_daily_entries;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'That child is not at this center.' USING ERRCODE = '42501';
  END IF;
  v_nap := public.daily_open_nap(p_center_id, p_child_id);
  IF v_nap.id IS NOT NULL THEN
    SELECT * INTO v_check FROM child_daily_entries
    WHERE nap_id = v_nap.id AND kind = 'sleep_check' AND voided_at IS NULL ORDER BY at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'check_minutes', (SELECT sleep_check_minutes FROM centers WHERE id = p_center_id),
    'open_nap', CASE WHEN v_nap.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_nap.id, 'at', v_nap.at, 'last_check_at', v_check.at, 'last_status', v_check.details->>'status') END,
    'medications', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.daily_medicines_today(p_center_id, p_child_id) m), '[]'::jsonb));
END $$;

-- Every child asleep now, for the board's room actions and due checks
CREATE OR REPLACE FUNCTION public.daily_room_naps(p_center_id uuid)
RETURNS TABLE (child_id uuid, nap_id uuid, started_at timestamptz, last_check_at timestamptz, last_status text, check_minutes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT n.child_id, n.id, n.at, c.at, c.details->>'status', (SELECT sleep_check_minutes FROM centers WHERE id = p_center_id)
    FROM child_daily_entries n
    LEFT JOIN LATERAL (
      SELECT s.at, s.details FROM child_daily_entries s
      WHERE s.nap_id = n.id AND s.kind = 'sleep_check' AND s.voided_at IS NULL ORDER BY s.at DESC LIMIT 1
    ) c ON true
    WHERE n.center_id = p_center_id AND n.service_date = public.roster_today(p_center_id)
      AND n.kind = 'nap' AND n.ends_at IS NULL AND n.voided_at IS NULL;
END $$;

-- 9. Grants ---------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.child_medications_same_center() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_open_nap(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_medicines_today(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_nap_start(uuid, uuid[], timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_nap_end(uuid, uuid[], timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_sleep_check(uuid, jsonb, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_medicine_give(uuid, uuid, uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_child_status(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_room_naps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_nap_start(uuid, uuid[], timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_nap_end(uuid, uuid[], timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_sleep_check(uuid, jsonb, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_medicine_give(uuid, uuid, uuid, text, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_child_status(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_room_naps(uuid) TO authenticated;
