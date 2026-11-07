-- Rollback for 20261227000000_lesson_plans_toggle.sql
DROP TRIGGER IF EXISTS trg_guard_lesson_plans_flag ON public.centers;
DROP FUNCTION IF EXISTS public.guard_lesson_plans_flag();
ALTER TABLE public.centers DROP COLUMN IF EXISTS lesson_plans_enabled;
