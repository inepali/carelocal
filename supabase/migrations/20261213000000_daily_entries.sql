-- ============================================================
-- Daily activities, phase B: what teachers record about a child's day.
--  - child_daily_entries: one row per thing recorded (meal, bottle, diaper, bathroom, activity, note;
--    naps, sleep checks, medicine and photos come in the next phases and are refused until then).
--  - Read through row-level security (can_use_roster); written only through these functions:
--      daily_entry_add()    one entry for one child
--      daily_class_entry()  the same kind for several children at once (Meal served, Activity with class)
--      daily_entry_void()   corrections: an entry is voided with a reason, never deleted
--      daily_day()          a child's entries for a day, with who recorded them, for the child card
--  - A retried tap saves once (client_key; batch_id for class entries).
--  - Added to the Realtime publication so two tablets in one room stay in sync.
-- Rollback: supabase/rollbacks/20261213000000_daily_entries.down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.child_daily_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  child_id      uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  service_date  date NOT NULL,                            -- the center's local day
  kind          text NOT NULL CHECK (kind IN ('nap', 'sleep_check', 'meal', 'bottle', 'medicine', 'diaper',
                                              'bathroom', 'photo', 'activity', 'note')),
  at            timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz,                              -- naps (phase C)
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,       -- checked per kind by daily_details()
  nap_id        uuid REFERENCES public.child_daily_entries(id) ON DELETE CASCADE,   -- a sleep check's nap (phase C)
  medication_id uuid,                                     -- the authorized medicine (phase C adds the table)
  plan_item_id  uuid,                                     -- the lesson plan item, once the plan exists
  batch_id      uuid,                                     -- one class action
  client_key    uuid UNIQUE,                              -- the app's id for one tap; a retry is a no-op
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  voided_at     timestamptz,
  voided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason   text,
  CONSTRAINT child_daily_entries_void_reason CHECK ((voided_at IS NULL) = (void_reason IS NULL)),
  CONSTRAINT child_daily_entries_ends_after CHECK (ends_at IS NULL OR ends_at >= at)
);
CREATE INDEX IF NOT EXISTS child_daily_entries_child_day_idx ON public.child_daily_entries (child_id, service_date, at DESC);
CREATE INDEX IF NOT EXISTS child_daily_entries_center_day_idx ON public.child_daily_entries (center_id, service_date);
CREATE INDEX IF NOT EXISTS child_daily_entries_batch_idx ON public.child_daily_entries (batch_id) WHERE batch_id IS NOT NULL;

-- 1. The details each kind may carry. Returns a clean copy (unknown keys dropped) or refuses with a plain message.
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

-- 2. The checks every write shares: roster access, the child is enrolled here, the time is today and not ahead.
CREATE OR REPLACE FUNCTION public.daily_check_write(p_center_id uuid, p_child_id uuid, p_at timestamptz)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tz text; v_day date;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND center_id = p_center_id AND status = 'enrolled') THEN
    RAISE EXCEPTION 'That child is not enrolled at this center.' USING ERRCODE = '42501';
  END IF;
  v_tz := public.roster_timezone(p_center_id);
  v_day := (p_at AT TIME ZONE v_tz)::date;
  IF v_day <> public.roster_today(p_center_id) THEN
    RAISE EXCEPTION 'Entries can only be added for today.' USING ERRCODE = '22023';
  END IF;
  IF p_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'That time has not happened yet.' USING ERRCODE = '22023';
  END IF;
  RETURN v_day;
END $$;

-- 3. One entry for one child. Returns the entry id (the existing one when the same tap is retried).
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

-- 4. The same kind for several children at once. p_items: [{"child_id": "...", "details": {...}}, ...].
--    All or nothing; one batch_id (the app's key, so a retried Save is a no-op). Returns how many were saved.
CREATE OR REPLACE FUNCTION public.daily_class_entry(
  p_center_id uuid, p_kind text, p_items jsonb, p_at timestamptz DEFAULT NULL, p_batch_key uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch uuid := COALESCE(p_batch_key, gen_random_uuid());
  v_at    timestamptz := COALESCE(p_at, now());
  v_item  jsonb;
  v_child uuid;
  v_day   date;
  v_n     integer := 0;
BEGIN
  IF p_kind NOT IN ('meal', 'activity', 'note') THEN
    RAISE EXCEPTION 'That cannot be logged for the whole class.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pick at least one child.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'That is more children than one room holds.' USING ERRCODE = '22023';
  END IF;
  IF p_batch_key IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM child_daily_entries WHERE batch_id = p_batch_key AND center_id = p_center_id;
    IF v_n > 0 THEN RETURN v_n; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_child := (v_item->>'child_id')::uuid;
    EXCEPTION WHEN others THEN v_child := NULL; END;
    IF v_child IS NULL THEN RAISE EXCEPTION 'A child in the list is not valid.' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM child_daily_entries WHERE batch_id = v_batch AND child_id = v_child) THEN
      CONTINUE;                                                -- the same child twice in one list: once
    END IF;
    v_day := public.daily_check_write(p_center_id, v_child, v_at);
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, created_by)
    VALUES (p_center_id, v_child, v_day, p_kind, v_at, public.daily_details(p_kind, v_item->'details'), v_batch, auth.uid());
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 5. Corrections. The person who recorded it can void it the same day; owners and admins can void any entry.
CREATE OR REPLACE FUNCTION public.daily_entry_void(p_entry_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e child_daily_entries; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  SELECT * INTO e FROM child_daily_entries WHERE id = p_entry_id;
  IF NOT FOUND OR NOT public.can_use_roster(e.center_id) THEN
    RAISE EXCEPTION 'Entry not found, or you do not have access to it.' USING ERRCODE = '42501';
  END IF;
  IF e.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This entry was already removed.' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.can_view_confidential(e.center_id)
          OR (e.created_by = auth.uid() AND e.service_date = public.roster_today(e.center_id))) THEN
    RAISE EXCEPTION 'Only the person who recorded this (today) or a director can remove it.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'Say why it is being removed (up to 200 characters).' USING ERRCODE = '22023';
  END IF;
  UPDATE child_daily_entries SET voided_at = now(), voided_by = auth.uid(), void_reason = v_reason WHERE id = p_entry_id;
END $$;

-- 6. A short name for whoever recorded an entry: the staff name, else the account name, else "Director"
CREATE OR REPLACE FUNCTION public.daily_person_label(p_user uuid, p_center_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_user IS NULL THEN NULL ELSE COALESCE(
    (SELECT sp.first_name || ' ' || left(sp.last_name, 1) || '.' FROM staff_profiles sp WHERE sp.user_id = p_user LIMIT 1),
    (SELECT NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '') FROM auth.users u WHERE u.id = p_user),
    CASE WHEN EXISTS (SELECT 1 FROM center_admins a WHERE a.user_id = p_user AND a.center_id = p_center_id) THEN 'Director' END,
    'Staff') END;
$$;

-- 7. A child's day for the card: every entry, voided ones too (shown struck through), newest first.
CREATE OR REPLACE FUNCTION public.daily_day(p_center_id uuid, p_child_id uuid, p_day date DEFAULT NULL)
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
  void_reason  text
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
           e.voided_at, public.daily_person_label(e.voided_by, e.center_id), e.void_reason
    FROM child_daily_entries e
    WHERE e.center_id = p_center_id AND e.child_id = p_child_id AND e.service_date = v_day
    ORDER BY e.at DESC, e.created_at DESC;
END $$;

-- 8. Row-level security: read for roster users; no direct writes for anyone
ALTER TABLE public.child_daily_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Roster users read child_daily_entries" ON public.child_daily_entries;
CREATE POLICY "Roster users read child_daily_entries" ON public.child_daily_entries
  FOR SELECT TO authenticated USING (public.can_use_roster(center_id));
REVOKE ALL ON public.child_daily_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.child_daily_entries TO authenticated;

-- 9. Function grants
REVOKE ALL ON FUNCTION public.daily_details(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_check_write(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_person_label(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_entry_add(uuid, uuid, text, jsonb, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_class_entry(uuid, text, jsonb, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_entry_void(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_day(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_entry_add(uuid, uuid, text, jsonb, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_class_entry(uuid, text, jsonb, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_entry_void(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_day(uuid, uuid, date) TO authenticated;

-- 10. Realtime: child cards refresh when another tablet logs something (row-level security still applies)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'child_daily_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.child_daily_entries;
  END IF;
END $$;
