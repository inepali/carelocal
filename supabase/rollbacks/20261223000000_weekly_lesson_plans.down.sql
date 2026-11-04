DROP FUNCTION IF EXISTS public.lesson_plan_reopen(uuid);
DROP FUNCTION IF EXISTS public.lesson_plan_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.lesson_plan_submit(uuid);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson_learning_areas', 'lesson_subjects', 'lesson_goals', 'center_programs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Teachers read ' || t, t);
  END LOOP;
END $$;
DROP TABLE IF EXISTS public.lesson_plan_item_goals;
DROP TABLE IF EXISTS public.lesson_plan_items;
DROP TABLE IF EXISTS public.lesson_plans;
DROP FUNCTION IF EXISTS public.can_edit_lesson_plan(uuid);
DROP FUNCTION IF EXISTS public.guard_lesson_plan();
DROP FUNCTION IF EXISTS public.lesson_plan_actor_name();
ALTER TABLE public.lesson_goals DROP CONSTRAINT IF EXISTS lesson_goals_id_center_key;
