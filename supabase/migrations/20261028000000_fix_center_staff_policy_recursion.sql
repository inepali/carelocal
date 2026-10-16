-- Fix: "infinite recursion detected in policy for relation center_staff" when a staff member
-- applies to a center.
--
-- center_staff policies read staff_profiles, and staff_profiles policies read center_staff, so
-- evaluating either table's policies loops. The fix is to do the cross-table lookups inside
-- SECURITY DEFINER functions, which read without applying row-level security.

-- Is this staff profile the signed-in user's own?
CREATE OR REPLACE FUNCTION public.is_own_staff_profile(p_staff_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_profiles WHERE id = p_staff_id AND user_id = auth.uid());
$$;

-- Does the signed-in user administer a center this staff member applied to / was invited to / works at?
CREATE OR REPLACE FUNCTION public.admin_can_see_staff(p_staff_id uuid, p_active_only boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.center_staff cs
    JOIN public.center_admins ca ON ca.center_id = cs.center_id
    WHERE cs.staff_id = p_staff_id
      AND ca.user_id = auth.uid()
      AND (cs.status::text = 'active' OR (NOT p_active_only AND cs.status::text IN ('invited', 'applying')))
  );
$$;

REVOKE ALL ON FUNCTION public.is_own_staff_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_can_see_staff(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_own_staff_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_can_see_staff(uuid, boolean) TO authenticated;

-- center_staff policies (no direct staff_profiles reference any more)
DROP POLICY IF EXISTS "Staff can see their own center relationships" ON public.center_staff;
CREATE POLICY "Staff can see their own center relationships"
  ON public.center_staff FOR SELECT
  USING (public.is_own_staff_profile(staff_id));

DROP POLICY IF EXISTS "Staff can apply to a center" ON public.center_staff;
CREATE POLICY "Staff can apply to a center"
  ON public.center_staff FOR INSERT TO authenticated
  WITH CHECK (public.is_own_staff_profile(staff_id));

-- staff_profiles policies (no direct center_staff reference any more)
DROP POLICY IF EXISTS "Center admins can view their center's staff profiles" ON public.staff_profiles;
CREATE POLICY "Center admins can view their center's staff profiles"
  ON public.staff_profiles FOR SELECT
  USING (public.admin_can_see_staff(id, true));

DROP POLICY IF EXISTS "Center admins can view applicant profiles" ON public.staff_profiles;
CREATE POLICY "Center admins can view applicant profiles"
  ON public.staff_profiles FOR SELECT TO authenticated
  USING (public.admin_can_see_staff(id, false));
