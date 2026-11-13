-- ============================================================
-- Part-time employees
--  * "Regular" is now shown as Full-time, and Part-time is added. Both are employment_class 'regular' and work
--    exactly the same everywhere (one center, no marketplace shifts, home room, schedule, roster, lesson plans,
--    Director roles, the same document requirements). Only center_staff.part_time tells them apart.
--  * Like employment_class, only the center's admins (or super admins / the service role) can set it, and it is
--    always false for substitutes.
-- ============================================================

ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS part_time boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_center_staff_part_time()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false)
     AND NOT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    NEW.part_time := CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.part_time END;
  END IF;
  IF NEW.employment_class <> 'regular' THEN
    NEW.part_time := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_center_staff_part_time ON public.center_staff;
CREATE TRIGGER trg_guard_center_staff_part_time
  BEFORE INSERT OR UPDATE OF part_time, employment_class ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_part_time();
