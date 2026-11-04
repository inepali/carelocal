-- ============================================================
-- Lessons in the day: teachers log activities from today's approved lesson plan, tag the children who took
-- part, link photos to a lesson activity, and leave class-level feedback on how each activity went.
--
--  - child_daily_entries.plan_item_id (already there, unused) now references lesson_plan_items. Deleting a
--    plan item keeps the entries (the activity's title is copied into details) and clears the link.
--  - daily_plan_items(center, room)        today's activities from the room's APPROVED plan, for the pickers
--  - daily_plan_activity(center, item, children[], note)
--                                          one activity entry per child who took part (one batch; a retried
--                                          Save is a no-op). The activity must be on an approved plan for today.
--  - daily_photo_add(..., p_plan_item_id)  as in 20261218, plus an optional lesson activity for the photo
--  - lesson_plan_feedback                  one row per activity per person: a rating and a note, saved with
--                                          lesson_feedback_save(); read by the center's admins and teachers
--  - lesson_plan_item_stats(plan)          per activity: children who took part, photos, feedback (for the
--                                          Weekly Lesson Plan page)
-- Rollback: supabase/rollbacks/20261224000000_lesson_activities.down.sql
-- ============================================================

-- 1. Entries link to lesson activities ---------------------------------------------------------------------------
UPDATE public.child_daily_entries e SET plan_item_id = NULL
WHERE plan_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lesson_plan_items i WHERE i.id = e.plan_item_id);
ALTER TABLE public.child_daily_entries DROP CONSTRAINT IF EXISTS child_daily_entries_plan_item_fk;
ALTER TABLE public.child_daily_entries ADD CONSTRAINT child_daily_entries_plan_item_fk
  FOREIGN KEY (plan_item_id) REFERENCES public.lesson_plan_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS child_daily_entries_plan_item_idx ON public.child_daily_entries (plan_item_id) WHERE plan_item_id IS NOT NULL;

-- 2. The activity must be on this center's approved plan, on this day ---------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_check_plan_item(p_center_id uuid, p_plan_item_id uuid, p_day date)
RETURNS public.lesson_plan_items LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item lesson_plan_items; v_plan lesson_plans;
BEGIN
  SELECT * INTO v_item FROM lesson_plan_items WHERE id = p_plan_item_id AND center_id = p_center_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lesson activity was not found.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM lesson_plans WHERE id = v_item.plan_id;
  IF v_plan.status <> 'approved' THEN
    RAISE EXCEPTION 'That lesson plan is not approved.' USING ERRCODE = '22023';
  END IF;
  IF v_plan.week_start + (v_item.day - 1) <> p_day THEN
    RAISE EXCEPTION 'That lesson activity is planned for another day.' USING ERRCODE = '22023';
  END IF;
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.daily_check_plan_item(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- 3. Today's activities for a room (approved plans only) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_plan_items(p_center_id uuid, p_room_id uuid)
RETURNS TABLE (
  id           uuid,
  title        text,
  block        text,
  description  text,
  materials    text,
  goals        text[],     -- goal codes (or the start of the goal when it has no code)
  theme        text,
  children     integer,    -- children already logged for it today
  my_rating    text,
  my_note      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_day date; v_week date; v_dow int;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  v_day := public.roster_today(p_center_id);
  v_dow := extract(isodow FROM v_day)::int;
  v_week := v_day - (v_dow - 1);
  RETURN QUERY
    SELECT i.id, i.title, i.block, i.description, i.materials,
           COALESCE((SELECT array_agg(COALESCE(g.code, left(g.name, 24)) ORDER BY g.sort_order)
                       FROM lesson_plan_item_goals ig JOIN lesson_goals g ON g.id = ig.goal_id
                      WHERE ig.item_id = i.id), '{}'::text[]),
           p.theme,
           (SELECT count(DISTINCT e.child_id)::int FROM child_daily_entries e
             WHERE e.plan_item_id = i.id AND e.kind = 'activity' AND e.voided_at IS NULL AND e.service_date = v_day),
           f.rating, f.note
    FROM lesson_plans p
    JOIN lesson_plan_items i ON i.plan_id = p.id
    LEFT JOIN lesson_plan_feedback f ON f.plan_item_id = i.id AND f.created_by = auth.uid()
    WHERE p.center_id = p_center_id AND p.work_area_id = p_room_id AND p.week_start = v_week
      AND p.status = 'approved' AND i.day = v_dow
    ORDER BY i.sort_order, i.created_at;
END $$;

-- 4. Log a lesson activity for the children who took part ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_plan_activity(
  p_center_id uuid, p_plan_item_id uuid, p_child_ids uuid[], p_note text DEFAULT NULL,
  p_at timestamptz DEFAULT NULL, p_key uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch   uuid := COALESCE(p_key, gen_random_uuid());
  v_at      timestamptz := COALESCE(p_at, now());
  v_note    text := NULLIF(btrim(p_note), '');
  v_item    lesson_plan_items;
  v_details jsonb;
  v_child   uuid;
  v_day     date;
  v_n       integer := 0;
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.'
      USING ERRCODE = '42501';
  END IF;
  IF p_child_ids IS NULL OR cardinality(p_child_ids) = 0 THEN
    RAISE EXCEPTION 'Tag at least one child who took part.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_child_ids) > 60 THEN
    RAISE EXCEPTION 'That is more children than one room holds.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'Keep the note to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_key IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM child_daily_entries WHERE batch_id = p_key AND center_id = p_center_id;
    IF v_n > 0 THEN RETURN v_n; END IF;
  END IF;
  v_item := public.daily_check_plan_item(p_center_id, p_plan_item_id, (v_at AT TIME ZONE public.roster_timezone(p_center_id))::date);
  v_details := jsonb_build_object('text', left(v_item.title, 200), 'lesson', true)
               || CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', v_note) END;

  FOREACH v_child IN ARRAY (SELECT array_agg(DISTINCT c) FROM unnest(p_child_ids) c) LOOP
    v_day := public.daily_check_write(p_center_id, v_child, v_at);
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, plan_item_id, batch_id, created_by)
    VALUES (p_center_id, v_child, v_day, 'activity', v_at, v_details, p_plan_item_id, v_batch, auth.uid());
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 5. Photos can belong to a lesson activity (otherwise exactly as in 20261218) ---------------------------------------
DROP FUNCTION IF EXISTS public.daily_photo_add(uuid, text, text, uuid, uuid, uuid[], timestamptz, uuid);
CREATE FUNCTION public.daily_photo_add(
  p_center_id uuid, p_photo_key text, p_caption text DEFAULT NULL,
  p_child_id uuid DEFAULT NULL, p_room_id uuid DEFAULT NULL, p_child_ids uuid[] DEFAULT NULL,
  p_at timestamptz DEFAULT NULL, p_key uuid DEFAULT NULL, p_plan_item_id uuid DEFAULT NULL)
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
  -- Every photo waits for an owner or admin to approve it, whoever took it
  v_ok_at   timestamptz := NULL;
  v_ok_by   uuid := NULL;
  v_item    lesson_plan_items;
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
  -- Part of today's lesson: the activity must be on the room's approved plan for today
  IF p_plan_item_id IS NOT NULL THEN
    v_item := public.daily_check_plan_item(p_center_id, p_plan_item_id, (v_at AT TIME ZONE public.roster_timezone(p_center_id))::date);
    v_details := v_details || jsonb_build_object('lesson', left(v_item.title, 200));
  END IF;

  IF p_child_id IS NOT NULL THEN
    v_day := public.daily_check_write(p_center_id, p_child_id, v_at);
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, plan_item_id, created_by, approved_at, approved_by)
    VALUES (p_center_id, p_child_id, v_day, 'photo', v_at, v_details, v_key, p_plan_item_id, auth.uid(), v_ok_at, v_ok_by);
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
    INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, at, details, batch_id, work_area_id, plan_item_id, created_by, approved_at, approved_by)
    VALUES (p_center_id, v_child, v_day, 'photo', v_at, v_details || '{"class": true}'::jsonb, v_key, p_room_id, p_plan_item_id, auth.uid(), v_ok_at, v_ok_by);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 6. Class-level feedback on each lesson activity ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_plan_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       uuid NOT NULL,
  plan_item_id    uuid NOT NULL,
  rating          text,
  note            text,
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_plan_feedback_rating_check CHECK (rating IS NULL OR rating IN ('great', 'okay', 'tough')),
  CONSTRAINT lesson_plan_feedback_note_check CHECK (note IS NULL OR char_length(note) <= 1000),
  CONSTRAINT lesson_plan_feedback_something CHECK (rating IS NOT NULL OR note IS NOT NULL),
  CONSTRAINT lesson_plan_feedback_one_each UNIQUE (plan_item_id, created_by),
  CONSTRAINT lesson_plan_feedback_item_fkey FOREIGN KEY (plan_item_id, center_id)
    REFERENCES public.lesson_plan_items(id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lesson_plan_feedback_center_idx ON public.lesson_plan_feedback(center_id);

ALTER TABLE public.lesson_plan_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Center staff read lesson_plan_feedback" ON public.lesson_plan_feedback;
CREATE POLICY "Center staff read lesson_plan_feedback" ON public.lesson_plan_feedback FOR SELECT
  USING (public.is_center_admin(center_id) OR public.is_center_regular_staff(center_id));
DROP POLICY IF EXISTS "Super admins read lesson_plan_feedback" ON public.lesson_plan_feedback;
CREATE POLICY "Super admins read lesson_plan_feedback" ON public.lesson_plan_feedback FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));
REVOKE INSERT, UPDATE, DELETE ON public.lesson_plan_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lesson_plan_feedback TO authenticated;

-- Save (or clear, with no rating and no note) the signed-in person's feedback on an approved plan's activity
CREATE OR REPLACE FUNCTION public.lesson_feedback_save(p_plan_item_id uuid, p_rating text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item lesson_plan_items; v_status text; v_note text := NULLIF(btrim(p_note), ''); v_rating text := NULLIF(p_rating, '');
BEGIN
  SELECT * INTO v_item FROM lesson_plan_items WHERE id = p_plan_item_id;
  IF NOT FOUND OR NOT (public.is_center_admin(v_item.center_id) OR public.is_center_regular_staff(v_item.center_id)) THEN
    RAISE EXCEPTION 'That lesson activity was not found.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM lesson_plans WHERE id = v_item.plan_id;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'Feedback is for activities on an approved plan.' USING ERRCODE = '22023';
  END IF;
  IF v_rating IS NOT NULL AND v_rating NOT IN ('great', 'okay', 'tough') THEN
    RAISE EXCEPTION 'Pick Went great, Okay or Tough.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Keep the feedback to 1,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_rating IS NULL AND v_note IS NULL THEN
    DELETE FROM lesson_plan_feedback WHERE plan_item_id = p_plan_item_id AND created_by = auth.uid();
    RETURN;
  END IF;
  INSERT INTO lesson_plan_feedback (center_id, plan_item_id, rating, note, created_by, created_by_name)
  VALUES (v_item.center_id, p_plan_item_id, v_rating, v_note, auth.uid(), public.lesson_plan_actor_name())
  ON CONFLICT (plan_item_id, created_by) DO UPDATE
    SET rating = EXCLUDED.rating, note = EXCLUDED.note, created_by_name = EXCLUDED.created_by_name, updated_at = now();
END $$;

-- 7. How each activity of a plan went: children who took part, photos, feedback (no child names) --------------------
CREATE OR REPLACE FUNCTION public.lesson_plan_item_stats(p_plan_id uuid)
RETURNS TABLE (item_id uuid, children integer, photos integer, feedback jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_center uuid;
BEGIN
  SELECT center_id INTO v_center FROM lesson_plans WHERE id = p_plan_id;
  IF v_center IS NULL OR NOT (public.is_center_admin(v_center) OR public.is_center_regular_staff(v_center)) THEN
    RAISE EXCEPTION 'Lesson plan not found' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id,
           (SELECT count(DISTINCT e.child_id)::int FROM child_daily_entries e
             WHERE e.plan_item_id = i.id AND e.kind = 'activity' AND e.voided_at IS NULL),
           (SELECT count(DISTINCT e.batch_id)::int FROM child_daily_entries e
             WHERE e.plan_item_id = i.id AND e.kind = 'photo' AND e.voided_at IS NULL),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('rating', f.rating, 'note', f.note, 'by', f.created_by_name, 'at', f.updated_at)
                                      ORDER BY f.updated_at)
                       FROM lesson_plan_feedback f WHERE f.plan_item_id = i.id), '[]'::jsonb)
    FROM lesson_plan_items i WHERE i.plan_id = p_plan_id;
END $$;

-- 8. Grants -------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.daily_plan_items(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_plan_activity(uuid, uuid, uuid[], text, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_photo_add(uuid, text, text, uuid, uuid, uuid[], timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lesson_feedback_save(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lesson_plan_item_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_plan_items(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_plan_activity(uuid, uuid, uuid[], text, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_photo_add(uuid, text, text, uuid, uuid, uuid[], timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lesson_feedback_save(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lesson_plan_item_stats(uuid) TO authenticated;
