-- ============================================================
-- Staff schedule (phase 3): what teachers see, and telling them when their day is ready or changes
--
--  - Teachers see published days only. Drafts stay with the owner and admins.
--  - my_schedule(): the signed-in person's own boxes for a range of days, at every center where they are on a
--    published day (regular teachers, and substitutes on their shift days). Shows whether they have seen the latest.
--  - schedule_board(): the whole published day, read-only, for the center's active regular teachers (and its
--    admins): rooms, names and boxes. No call-out reasons and no admin notes about absences.
--  - schedule_person_notices: per day and person, a fingerprint (room + hours of their boxes) of what they were last
--    told about and what they last looked at. "Updated" = what they see now differs from what they last looked at.
--  - Notices: publishing tells everyone on the day; for changes after that the board lists who changed since their
--    last notice and the admin sends one notice for all of them (schedule_notice_targets / schedule_notice_mark,
--    used by the notifySchedule server action).
-- Needs 20270101010000_schedule_days.sql. Rollback: supabase/rollbacks/20270101020000_schedule_teacher.down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schedule_person_notices (
  day_id         uuid NOT NULL REFERENCES public.schedule_days(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  notified_hash  text,
  notified_at    timestamptz,
  seen_hash      text,
  seen_at        timestamptz,
  PRIMARY KEY (day_id, staff_id)
);
ALTER TABLE public.schedule_person_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_person_notices FROM anon, authenticated;
GRANT ALL ON public.schedule_person_notices TO service_role;

-- 1. Helpers (internal) -------------------------------------------------------------------------------------------

-- A person's day in one string: rooms and hours of their boxes ('' when they have none)
CREATE OR REPLACE FUNCTION public.schedule_person_hash(p_day_id uuid, p_staff_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(COALESCE(string_agg(COALESCE(b.work_area_id::text, '-') || '@' || public.schedule_hhmi(b.start_time) || '-' || public.schedule_hhmi(b.end_time),
                                 ',' ORDER BY b.start_time), ''))
  FROM schedule_blocks b WHERE b.day_id = p_day_id AND b.staff_id = p_staff_id $$;

-- "Infant A 7:00-11:00 · Toddler 11:00-15:00", or "" when they have no boxes
CREATE OR REPLACE FUNCTION public.schedule_person_summary(p_day_id uuid, p_staff_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(string_agg(COALESCE(w.name, 'Floater') || ' ' || public.schedule_hhmi(b.start_time) || '-' || public.schedule_hhmi(b.end_time),
                             ' · ' ORDER BY b.start_time), '')
  FROM schedule_blocks b LEFT JOIN work_areas w ON w.id = b.work_area_id
  WHERE b.day_id = p_day_id AND b.staff_id = p_staff_id $$;

-- The signed-in person's staff profile
CREATE OR REPLACE FUNCTION public.schedule_my_staff_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM staff_profiles WHERE user_id = auth.uid() LIMIT 1 $$;

-- People on a published day whose boxes differ from what they were last told (including someone taken off the board
-- after a notice). Draft days: nobody.
CREATE OR REPLACE FUNCTION public.schedule_unnotified(p_day_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(x.staff_id ORDER BY x.staff_id), '{}')
  FROM (
    SELECT DISTINCT b.staff_id FROM schedule_blocks b WHERE b.day_id = p_day_id
    UNION
    SELECT n.staff_id FROM schedule_person_notices n WHERE n.day_id = p_day_id AND n.notified_hash IS NOT NULL
  ) x
  JOIN schedule_days d ON d.id = p_day_id AND d.status = 'published'
  LEFT JOIN schedule_person_notices n ON n.day_id = p_day_id AND n.staff_id = x.staff_id
  WHERE public.schedule_person_hash(p_day_id, x.staff_id) IS DISTINCT FROM n.notified_hash
    -- someone never notified and still not on the board has nothing to hear about
    AND NOT (n.notified_hash IS NULL AND public.schedule_person_hash(p_day_id, x.staff_id) = md5(''))
$$;

-- The admin's day now also lists who changed since their last notice (empty on a draft)
DO $$ BEGIN
  IF to_regprocedure('public.schedule_day_payload_base(uuid)') IS NULL THEN   -- first run only (re-runs keep the base)
    ALTER FUNCTION public.schedule_day_payload(uuid) RENAME TO schedule_day_payload_base;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.schedule_day_payload(p_day_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.schedule_day_payload_base(p_day_id) || jsonb_build_object('unnotified', to_jsonb(public.schedule_unnotified(p_day_id))) $$;

-- 2. Teachers (and anyone on a published day): their own boxes -------------------------------------------------
--  [{center_id, center_name, date, weekday, off: {start, end} | null, seen, published_at,
--    blocks: [{room_id, room_name, start, end, note, sub}]}]  one entry per published day they are on, or a regular
--  teacher of the center with no boxes (a day off), date order. Up to 31 days.
CREATE OR REPLACE FUNCTION public.my_schedule(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff uuid := public.schedule_my_staff_id();
BEGIN
  IF v_staff IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'Pick up to a month of days' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'center_id', d.center_id, 'center_name', c.name, 'date', d.service_date, 'weekday', extract(dow FROM d.service_date)::int,
             'published_at', d.published_at,
             'seen', n.seen_hash IS NOT DISTINCT FROM public.schedule_person_hash(d.id, v_staff),
             'off', (SELECT jsonb_build_object('start', public.schedule_hhmi(a.start_time), 'end', public.schedule_hhmi(a.end_time))
                     FROM schedule_absences a JOIN center_staff cs ON cs.id = a.center_staff_id
                     WHERE a.day_id = d.id AND cs.staff_id = v_staff),
             'blocks', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('room_id', b.work_area_id, 'room_name', w.name, 'start', public.schedule_hhmi(b.start_time),
                                                   'end', public.schedule_hhmi(b.end_time), 'note', b.note, 'sub', b.shift_claim_id IS NOT NULL)
                                ORDER BY b.start_time)
               FROM schedule_blocks b LEFT JOIN work_areas w ON w.id = b.work_area_id
               WHERE b.day_id = d.id AND b.staff_id = v_staff), '[]'::jsonb))
           ORDER BY d.service_date, c.name)
    FROM schedule_days d
    JOIN centers c ON c.id = d.center_id AND c.schedule_enabled
    LEFT JOIN schedule_person_notices n ON n.day_id = d.id AND n.staff_id = v_staff
    WHERE d.status = 'published' AND d.service_date BETWEEN p_from AND p_to
      AND (EXISTS (SELECT 1 FROM schedule_blocks b WHERE b.day_id = d.id AND b.staff_id = v_staff)
           OR EXISTS (SELECT 1 FROM center_staff cs WHERE cs.center_id = d.center_id AND cs.staff_id = v_staff
                        AND cs.status = 'active' AND cs.employment_class = 'regular'))
  ), '[]'::jsonb);
END $$;

-- They looked at that day: clears its "Updated" badge
CREATE OR REPLACE FUNCTION public.my_schedule_seen(p_center_id uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff uuid := public.schedule_my_staff_id(); d schedule_days%ROWTYPE;
BEGIN
  IF v_staff IS NULL THEN RETURN; END IF;
  SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date AND status = 'published';
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO schedule_person_notices (day_id, staff_id, seen_hash, seen_at)
  VALUES (d.id, v_staff, public.schedule_person_hash(d.id, v_staff), now())
  ON CONFLICT (day_id, staff_id) DO UPDATE SET seen_hash = EXCLUDED.seen_hash, seen_at = now();
END $$;

-- 3. Regular teachers: the whole published day, read-only ------------------------------------------------------
--  { published: false, settings } when the day isn't published yet; otherwise the admin's day shape without the
--  admin-only parts: rooms {id, name, on_roster} (no ratios or children), people {staff_id, kind, names,
--  avatar_url} (no call-outs), blocks {id, staff_id, room_id, start, end, note, shift_claim_id (only whether it is a sub)}.
CREATE OR REPLACE FUNCTION public.schedule_board(p_center_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE;
BEGIN
  IF NOT (public.can_view_confidential(p_center_id) OR public.is_center_regular_staff(p_center_id))
     OR NOT COALESCE((SELECT schedule_enabled FROM centers WHERE id = p_center_id), false) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you do not have access to it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date AND status = 'published';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('published', false, 'settings', public.schedule_settings(p_center_id), 'date', p_date);
  END IF;
  RETURN jsonb_build_object(
    'published', true,
    'settings', public.schedule_settings(p_center_id),
    'day', jsonb_build_object('id', d.id, 'date', d.service_date, 'weekday', extract(dow FROM d.service_date)::int,
                              'status', d.status, 'version', d.version, 'published_at', d.published_at),
    'me', public.schedule_my_staff_id(),
    'rooms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'on_roster', COALESCE(w.on_roster, true), 'ratio', NULL, 'enrolled', 0)
                                        ORDER BY w.sort_order, lower(w.name))
                       FROM work_areas w WHERE w.center_id = p_center_id AND COALESCE(w.is_active, true)), '[]'::jsonb),
    'people', COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', sp.id, 'center_staff_id', NULL,
                                           'kind', CASE WHEN EXISTS (SELECT 1 FROM center_staff cs WHERE cs.center_id = p_center_id AND cs.staff_id = sp.id
                                                                       AND cs.status = 'active' AND cs.employment_class = 'regular') THEN 'regular' ELSE 'sub' END,
                                           'first_name', sp.first_name, 'last_name', sp.last_name, 'avatar_url', sp.avatar_url,
                                           'home_room_id', NULL, 'absence', NULL)
                                         ORDER BY lower(COALESCE(sp.first_name, '')))
                        FROM staff_profiles sp WHERE sp.id IN (SELECT b.staff_id FROM schedule_blocks b WHERE b.day_id = d.id)), '[]'::jsonb),
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'staff_id', b.staff_id, 'center_staff_id', NULL,
                                           'shift_claim_id', CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' END,
                                           'room_id', b.work_area_id, 'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time),
                                           'source', b.source, 'note', b.note)
                                         ORDER BY b.start_time)
                        FROM schedule_blocks b WHERE b.day_id = d.id), '[]'::jsonb)
  );
END $$;

-- 4. Owner/admin (through the notifySchedule server action): who to tell, and recording that they were told ---
CREATE OR REPLACE FUNCTION public.schedule_notice_targets(p_center_id uuid, p_date date)
RETURNS TABLE (staff_id uuid, user_id uuid, first_name text, summary text, hash text, first_notice boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE d schedule_days%ROWTYPE;
BEGIN
  IF NOT public.schedule_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date AND status = 'published';
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    SELECT sp.id, sp.user_id, sp.first_name, public.schedule_person_summary(d.id, sp.id), public.schedule_person_hash(d.id, sp.id),
           NOT EXISTS (SELECT 1 FROM schedule_person_notices n WHERE n.day_id = d.id AND n.staff_id = sp.id AND n.notified_hash IS NOT NULL)
    FROM staff_profiles sp WHERE sp.id = ANY (public.schedule_unnotified(d.id));
END $$;

--  p_items: [{staff_id, hash}] as returned by schedule_notice_targets
CREATE OR REPLACE FUNCTION public.schedule_notice_mark(p_center_id uuid, p_date date, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d schedule_days%ROWTYPE; v_n integer;
BEGIN
  IF NOT public.schedule_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'The staff schedule is not turned on for your center, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM schedule_days WHERE center_id = p_center_id AND service_date = p_date;
  IF NOT FOUND OR jsonb_typeof(COALESCE(p_items, 'null'::jsonb)) <> 'array' THEN RETURN 0; END IF;
  INSERT INTO schedule_person_notices (day_id, staff_id, notified_hash, notified_at)
  SELECT d.id, (i ->> 'staff_id')::uuid, i ->> 'hash', now()
  FROM jsonb_array_elements(p_items) i
  WHERE (i ->> 'staff_id')::uuid IN (SELECT DISTINCT b.staff_id FROM schedule_blocks b WHERE b.day_id = d.id
                                     UNION SELECT n.staff_id FROM schedule_person_notices n WHERE n.day_id = d.id)
  ON CONFLICT (day_id, staff_id) DO UPDATE SET notified_hash = EXCLUDED.notified_hash, notified_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.schedule_log(d, 'notify', jsonb_build_object('people', v_n));
  RETURN v_n;
END $$;

-- 5. Who may call what ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.schedule_person_hash(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_person_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_my_staff_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_unnotified(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_day_payload_base(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_day_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_schedule(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_schedule_seen(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_board(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_notice_targets(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_notice_mark(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_schedule(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_schedule_seen(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_board(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_notice_targets(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_notice_mark(uuid, date, jsonb) TO authenticated;
