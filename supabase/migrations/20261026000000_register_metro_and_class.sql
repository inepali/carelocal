-- Registration: choose a metro area (centers and staff) and, for staff, a preferred job classification.
--
-- 1. Active metros for the sign-up form. The visitor is not signed in yet, so expose only the
--    columns the dropdown needs through a function instead of opening the metro_areas table.
CREATE OR REPLACE FUNCTION public.list_active_metros()
RETURNS TABLE (id uuid, name text, state_code text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT m.id, m.name, m.state_code
  FROM public.metro_areas m
  WHERE m.is_active
  ORDER BY m.name;
$$;
REVOKE ALL ON FUNCTION public.list_active_metros() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_metros() TO anon, authenticated;

-- 2. Staff job classification chosen at sign-up. This is only a request: the employee class
--    that drives compliance rules and shift eligibility stays on center_staff.employment_class,
--    which only a center admin can set. The admin sees the request on the team member page.
ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS requested_employment_class text;

ALTER TABLE public.staff_profiles DROP CONSTRAINT IF EXISTS staff_requested_employment_class_check;
ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_requested_employment_class_check
  CHECK (requested_employment_class IS NULL OR requested_employment_class IN ('regular', 'substitute'));
