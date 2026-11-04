-- ============================================================
-- Weekly lesson plans: one plan per class (work_area) per week, built from the center's
-- learning areas → subjects → goals. Teachers write them; a center admin approves them.
--
--  - lesson_plans: class + Monday of the week, a theme, and a status:
--      draft → submitted → approved, or submitted → changes_requested → (edit) → submitted …
--    Only approved plans "apply" (what Daily Activities will pick from).
--  - lesson_plan_items: activities on a weekday (1 = Mon … 7 = Sun) with an optional time block.
--  - lesson_plan_item_goals: the goals each activity works on (learning area and subject come from the goal).
--
-- Who may do what (enforced here, not only in the UI):
--  - Center admins/owners: everything, and the only ones who approve or request changes.
--  - Active regular staff of the center (teachers): read the center's plans; create plans; edit a plan and
--    its activities only while it is a draft or has changes requested; submit; withdraw a submitted plan;
--    revise an approved plan (it goes back to draft and needs approval again).
--  - Status only changes through the lesson_plan_* functions below, never by a direct UPDATE.
--  - Teachers can also read the center's programs and curriculum so they can build plans.
-- Rollback: supabase/rollbacks/20261223000000_weekly_lesson_plans.down.sql
-- ============================================================

-- 1. Tables ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id         uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  work_area_id      uuid NOT NULL REFERENCES public.work_areas(id) ON DELETE CASCADE,
  week_start        date NOT NULL,
  theme             text,
  notes             text,
  status            text NOT NULL DEFAULT 'draft',
  created_by        uuid DEFAULT auth.uid(),
  created_by_name   text,
  submitted_at      timestamptz,
  submitted_by_name text,
  reviewed_at       timestamptz,
  reviewed_by_name  text,
  review_note       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_plans_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'changes_requested')),
  CONSTRAINT lesson_plans_week_monday_check CHECK (extract(isodow FROM week_start) = 1),
  CONSTRAINT lesson_plans_theme_check CHECK (theme IS NULL OR length(theme) <= 200),
  CONSTRAINT lesson_plans_class_week_key UNIQUE (work_area_id, week_start),
  CONSTRAINT lesson_plans_id_center_key UNIQUE (id, center_id)
);

CREATE TABLE IF NOT EXISTS public.lesson_plan_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL,
  plan_id     uuid NOT NULL,
  day         smallint NOT NULL,
  block       text,                        -- e.g. Circle Time, Centers, Outdoor
  title       text NOT NULL,
  description text,
  materials   text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_plan_items_day_check CHECK (day BETWEEN 1 AND 7),
  CONSTRAINT lesson_plan_items_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT lesson_plan_items_id_center_key UNIQUE (id, center_id),
  CONSTRAINT lesson_plan_items_plan_fkey FOREIGN KEY (plan_id, center_id)
    REFERENCES public.lesson_plans(id, center_id) ON DELETE CASCADE
);

-- Goals need (id, center_id) to be referenced together
ALTER TABLE public.lesson_goals DROP CONSTRAINT IF EXISTS lesson_goals_id_center_key;
ALTER TABLE public.lesson_goals ADD CONSTRAINT lesson_goals_id_center_key UNIQUE (id, center_id);

CREATE TABLE IF NOT EXISTS public.lesson_plan_item_goals (
  item_id   uuid NOT NULL,
  goal_id   uuid NOT NULL,
  center_id uuid NOT NULL,
  PRIMARY KEY (item_id, goal_id),
  CONSTRAINT lesson_plan_item_goals_item_fkey FOREIGN KEY (item_id, center_id)
    REFERENCES public.lesson_plan_items(id, center_id) ON DELETE CASCADE,
  CONSTRAINT lesson_plan_item_goals_goal_fkey FOREIGN KEY (goal_id, center_id)
    REFERENCES public.lesson_goals(id, center_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lesson_plans_center_week_idx ON public.lesson_plans(center_id, week_start);
CREATE INDEX IF NOT EXISTS lesson_plans_center_status_idx ON public.lesson_plans(center_id, status);
CREATE INDEX IF NOT EXISTS lesson_plan_items_plan_idx ON public.lesson_plan_items(plan_id, day, sort_order);
CREATE INDEX IF NOT EXISTS lesson_plan_item_goals_goal_idx ON public.lesson_plan_item_goals(goal_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_plans', 'lesson_plan_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- 2. Helpers --------------------------------------------------------------------------------------------------
-- public.is_center_admin(center) and public.is_center_regular_staff(center) already exist (secure documents, live roster)

-- A display name for the signed-in user (staff profile, else their email)
CREATE OR REPLACE FUNCTION public.lesson_plan_actor_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(concat_ws(' ', sp.first_name, sp.last_name)), '') FROM staff_profiles sp WHERE sp.user_id = auth.uid() LIMIT 1),
    (SELECT split_part(u.email, '@', 1) FROM auth.users u WHERE u.id = auth.uid()),
    'Unknown');
$$;
REVOKE ALL ON FUNCTION public.lesson_plan_actor_name() FROM PUBLIC, anon, authenticated;

-- A plan's class must be in the plan's center; authors are stamped; status may only change via the functions
CREATE OR REPLACE FUNCTION public.guard_lesson_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_areas w WHERE w.id = NEW.work_area_id AND w.center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'That class belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    NEW.created_by := auth.uid();
    NEW.created_by_name := public.lesson_plan_actor_name();
    NEW.submitted_at := NULL; NEW.submitted_by_name := NULL;
    NEW.reviewed_at := NULL; NEW.reviewed_by_name := NULL; NEW.review_note := NULL;
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('carelocal.lesson_plan_transition', true), '') <> 'on' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.submitted_by_name IS DISTINCT FROM OLD.submitted_by_name
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.reviewed_by_name IS DISTINCT FROM OLD.reviewed_by_name
       OR NEW.review_note IS DISTINCT FROM OLD.review_note
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name
       OR NEW.center_id IS DISTINCT FROM OLD.center_id OR NEW.work_area_id IS DISTINCT FROM OLD.work_area_id
       OR NEW.week_start IS DISTINCT FROM OLD.week_start THEN
      RAISE EXCEPTION 'Use submit, approve or request changes to move a lesson plan' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_lesson_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_lesson_plan ON public.lesson_plans;
CREATE TRIGGER trg_guard_lesson_plan BEFORE INSERT OR UPDATE ON public.lesson_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_lesson_plan();

-- Whether the signed-in user may change this plan's content right now
CREATE OR REPLACE FUNCTION public.can_edit_lesson_plan(p_plan_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM lesson_plans p
    WHERE p.id = p_plan_id
      AND (public.is_center_admin(p.center_id)
           OR (public.is_center_regular_staff(p.center_id) AND p.status IN ('draft', 'changes_requested')))
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_lesson_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_lesson_plan(uuid) TO authenticated;

-- 3. Row level security ---------------------------------------------------------------------------------------
ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_plan_item_goals ENABLE ROW LEVEL SECURITY;

-- Plans
DROP POLICY IF EXISTS "Center admins manage lesson_plans" ON public.lesson_plans;
CREATE POLICY "Center admins manage lesson_plans" ON public.lesson_plans FOR ALL
  USING (public.is_center_admin(center_id)) WITH CHECK (public.is_center_admin(center_id));
DROP POLICY IF EXISTS "Teachers read lesson_plans" ON public.lesson_plans;
CREATE POLICY "Teachers read lesson_plans" ON public.lesson_plans FOR SELECT
  USING (public.is_center_regular_staff(center_id));
DROP POLICY IF EXISTS "Teachers create lesson_plans" ON public.lesson_plans;
CREATE POLICY "Teachers create lesson_plans" ON public.lesson_plans FOR INSERT
  WITH CHECK (public.is_center_regular_staff(center_id));
DROP POLICY IF EXISTS "Teachers edit open lesson_plans" ON public.lesson_plans;
CREATE POLICY "Teachers edit open lesson_plans" ON public.lesson_plans FOR UPDATE
  USING (public.is_center_regular_staff(center_id) AND status IN ('draft', 'changes_requested'))
  WITH CHECK (public.is_center_regular_staff(center_id));
DROP POLICY IF EXISTS "Teachers delete draft lesson_plans" ON public.lesson_plans;
CREATE POLICY "Teachers delete draft lesson_plans" ON public.lesson_plans FOR DELETE
  USING (public.is_center_regular_staff(center_id) AND status = 'draft');
DROP POLICY IF EXISTS "Super admins read lesson_plans" ON public.lesson_plans;
CREATE POLICY "Super admins read lesson_plans" ON public.lesson_plans FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));

-- Activities and their goals follow the plan
DO $$
DECLARE t text; v_plan text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_plan_items', 'lesson_plan_item_goals'] LOOP
    v_plan := CASE t WHEN 'lesson_plan_items' THEN 'plan_id'
                     ELSE '(SELECT i.plan_id FROM public.lesson_plan_items i WHERE i.id = item_id)' END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Center staff read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_center_admin(center_id) OR public.is_center_regular_staff(center_id))',
                   'Center staff read ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Editors write ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.can_edit_lesson_plan(%s)) WITH CHECK (public.can_edit_lesson_plan(%s))',
                   'Editors write ' || t, t, v_plan, v_plan);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Super admins read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (((auth.jwt() -> ''app_metadata'' ->> ''is_super_admin'')::boolean = true))',
                   'Super admins read ' || t, t);
  END LOOP;
END $$;

-- Teachers read what they plan from: the curriculum and programs of their center (classes are already readable)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_learning_areas', 'lesson_subjects', 'lesson_goals', 'center_programs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Teachers read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_center_regular_staff(center_id))',
                   'Teachers read ' || t, t);
  END LOOP;
END $$;

-- 4. Workflow -------------------------------------------------------------------------------------------------
-- Teacher or admin: draft / changes requested → submitted
CREATE OR REPLACE FUNCTION public.lesson_plan_submit(p_plan_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p lesson_plans;
BEGIN
  SELECT * INTO p FROM lesson_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_center_admin(p.center_id) OR public.is_center_regular_staff(p.center_id)) THEN
    RAISE EXCEPTION 'Lesson plan not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'Only a draft or a plan with changes requested can be submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM lesson_plan_items WHERE plan_id = p_plan_id) THEN
    RAISE EXCEPTION 'Add at least one activity before submitting' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('carelocal.lesson_plan_transition', 'on', true);
  UPDATE lesson_plans SET status = 'submitted', submitted_at = now(), submitted_by_name = public.lesson_plan_actor_name()
  WHERE id = p_plan_id;
  PERFORM set_config('carelocal.lesson_plan_transition', '', true);
  RETURN 'submitted';
END $$;

-- Admin only: submitted → approved / changes_requested (a note is required when asking for changes)
CREATE OR REPLACE FUNCTION public.lesson_plan_review(p_plan_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p lesson_plans; v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'changes_requested' END;
BEGIN
  SELECT * INTO p FROM lesson_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_center_admin(p.center_id) THEN
    RAISE EXCEPTION 'Only a center admin can review lesson plans' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p.status <> 'submitted' THEN
    RAISE EXCEPTION 'This plan is not waiting for approval' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p_approve AND NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Say what needs to change' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('carelocal.lesson_plan_transition', 'on', true);
  UPDATE lesson_plans SET status = v_status, reviewed_at = now(), reviewed_by_name = public.lesson_plan_actor_name(),
         review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = p_plan_id;
  PERFORM set_config('carelocal.lesson_plan_transition', '', true);
  RETURN v_status;
END $$;

-- Teacher or admin: submitted → draft (withdraw) or approved → draft (revise; needs approval again)
CREATE OR REPLACE FUNCTION public.lesson_plan_reopen(p_plan_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p lesson_plans;
BEGIN
  SELECT * INTO p FROM lesson_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_center_admin(p.center_id) OR public.is_center_regular_staff(p.center_id)) THEN
    RAISE EXCEPTION 'Lesson plan not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status NOT IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'This plan is already open for editing' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('carelocal.lesson_plan_transition', 'on', true);
  UPDATE lesson_plans SET status = 'draft', submitted_at = NULL, submitted_by_name = NULL
  WHERE id = p_plan_id;
  PERFORM set_config('carelocal.lesson_plan_transition', '', true);
  RETURN 'draft';
END $$;

REVOKE ALL ON FUNCTION public.lesson_plan_submit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lesson_plan_review(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lesson_plan_reopen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lesson_plan_submit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lesson_plan_review(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lesson_plan_reopen(uuid) TO authenticated;
