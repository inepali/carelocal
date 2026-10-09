-- Center admins could not see staff experience/credentials: the original policies only
-- allowed the staff member and super admins. Grant read-only access to admins of any
-- center the staff member is linked to (pending or active, so applicants can be reviewed).

DROP POLICY IF EXISTS "Center admins can view linked staff experiences" ON public.staff_experiences;
CREATE POLICY "Center admins can view linked staff experiences"
  ON public.staff_experiences FOR SELECT TO authenticated
  USING (
    staff_id IN (
      SELECT cs.staff_id FROM public.center_staff cs
      JOIN public.center_admins ca ON ca.center_id = cs.center_id
      WHERE ca.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Center admins can view linked staff credentials" ON public.staff_credentials;
CREATE POLICY "Center admins can view linked staff credentials"
  ON public.staff_credentials FOR SELECT TO authenticated
  USING (
    staff_id IN (
      SELECT cs.staff_id FROM public.center_staff cs
      JOIN public.center_admins ca ON ca.center_id = cs.center_id
      WHERE ca.user_id = auth.uid()
    )
  );
