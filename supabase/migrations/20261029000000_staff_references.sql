-- Professional references a staff member provides (the app asks for at least two).
CREATE TABLE IF NOT EXISTS public.staff_references (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  email       text NOT NULL,
  phone       text NOT NULL,
  business    text NOT NULL,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_references_staff ON public.staff_references (staff_id);

ALTER TABLE public.staff_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff own their references" ON public.staff_references;
CREATE POLICY "Staff own their references"
  ON public.staff_references FOR ALL TO authenticated
  USING (public.is_own_staff_profile(staff_id))
  WITH CHECK (public.is_own_staff_profile(staff_id));

-- Admins of a center the person applied to, was invited to or works at can read their references
DROP POLICY IF EXISTS "Center admins can view references of their staff" ON public.staff_references;
CREATE POLICY "Center admins can view references of their staff"
  ON public.staff_references FOR SELECT TO authenticated
  USING (public.admin_can_see_staff(staff_id, false));

DROP POLICY IF EXISTS "Super admins can manage all staff references" ON public.staff_references;
CREATE POLICY "Super admins can manage all staff references"
  ON public.staff_references FOR ALL TO authenticated
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));
