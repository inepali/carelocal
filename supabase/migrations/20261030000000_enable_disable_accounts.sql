-- Super admins can disable and re-enable staff accounts and whole centers.
--  * staff: staff_profiles.is_active (the sign-in itself is also banned through the auth admin API)
--  * center: centers.is_active; the center portal is closed to its admins while false
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Only super admins / server jobs may flip these flags (staff and center admins can edit their own
-- rows, so without this guard they could re-enable themselves).
CREATE OR REPLACE FUNCTION public.guard_account_active_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / server-side jobs
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.is_active := OLD.is_active;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_staff_active_flag ON public.staff_profiles;
CREATE TRIGGER trg_guard_staff_active_flag
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_active_flag();

DROP TRIGGER IF EXISTS trg_guard_center_active_flag ON public.centers;
CREATE TRIGGER trg_guard_center_active_flag
  BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_active_flag();
