-- ============================================================
-- Lesson Plans becomes a per-center module a super admin can switch off, like the live roster and menu planning.
--
--  - centers.lesson_plans_enabled defaults to true, so every center keeps Lesson Plans until a super admin turns
--    it off.
--  - Only super admins (or the service role) may change it; anyone else keeps the old value.
--  - The switch hides Lesson Plans in the app (navigation and pages). Lesson plan data and its row level security
--    are unchanged; turning it off deletes nothing.
-- Rollback: supabase/rollbacks/20261227000000_lesson_plans_toggle.down.sql
-- ============================================================

ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS lesson_plans_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.guard_lesson_plans_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lesson_plans_enabled IS NOT DISTINCT FROM OLD.lesson_plans_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.lesson_plans_enabled := OLD.lesson_plans_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_lesson_plans_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_lesson_plans_flag ON public.centers;
CREATE TRIGGER trg_guard_lesson_plans_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_lesson_plans_flag();
