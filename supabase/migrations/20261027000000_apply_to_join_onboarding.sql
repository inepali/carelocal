-- Apply to Join: let both kinds of employee (regular / substitute) start onboarding and let the
-- center see and approve the application.
--
-- 1. 'applying' was used by the app but never added to the status enum.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'center_staff_status') THEN
    ALTER TYPE public.center_staff_status ADD VALUE IF NOT EXISTS 'applying';
  END IF;
END $$;

-- 2. The class the applicant asks for. employment_class itself stays admin-only
--    (guard_center_staff_employment_class); the admin confirms it when approving.
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS requested_employment_class text;
ALTER TABLE public.center_staff DROP CONSTRAINT IF EXISTS center_staff_requested_class_check;
ALTER TABLE public.center_staff ADD CONSTRAINT center_staff_requested_class_check
  CHECK (requested_employment_class IS NULL OR requested_employment_class IN ('regular', 'substitute'));

-- 3. Staff can start an application or onboarding (invited / applying) but never activate themselves.
CREATE OR REPLACE FUNCTION public.guard_center_staff_self_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text NOT IN ('invited', 'applying') THEN
      NEW.status := 'applying';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'active' THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_center_staff_self_status ON public.center_staff;
CREATE TRIGGER trg_guard_center_staff_self_status
  BEFORE INSERT OR UPDATE ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_self_status();

-- 4. Staff may create their own application row.
DROP POLICY IF EXISTS "Staff can apply to a center" ON public.center_staff;
CREATE POLICY "Staff can apply to a center"
  ON public.center_staff FOR INSERT TO authenticated
  WITH CHECK (staff_id IN (SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()));

-- 5. A center admin can see the profile of someone who applied or was invited
--    (the original policy only exposed active staff, so applicants showed up blank).
DROP POLICY IF EXISTS "Center admins can view applicant profiles" ON public.staff_profiles;
CREATE POLICY "Center admins can view applicant profiles"
  ON public.staff_profiles FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT cs.staff_id FROM public.center_staff cs
      JOIN public.center_admins ca ON ca.center_id = cs.center_id
      WHERE ca.user_id = auth.uid() AND cs.status::text IN ('invited', 'applying', 'active')
    )
  );
