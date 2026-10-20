-- Regular hiring: what a staff member needs to read before they belong to a center.
--  * The checklist items a published job asks for (and, after applying, those of jobs they applied to),
--    so the apply sheet can list them by name.
--  * The center's active programs, shown on the job page as "About the center".
-- Read-only and additive: existing policies are unchanged.

DROP POLICY IF EXISTS "Staff read requirements of open jobs" ON public.center_document_requirements;
CREATE POLICY "Staff read requirements of open jobs" ON public.center_document_requirements FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.job_posting_requirements jr
      JOIN public.job_postings p ON p.id = jr.job_id
      WHERE jr.requirement_id = center_document_requirements.id
        AND (
          p.status = 'published'
          OR EXISTS (SELECT 1 FROM public.job_applications a WHERE a.job_id = p.id AND public.is_own_staff(a.staff_id))
        )
    )
  );

DROP POLICY IF EXISTS "Staff read programs of centers that are hiring" ON public.center_programs;
CREATE POLICY "Staff read programs of centers that are hiring" ON public.center_programs FOR SELECT TO authenticated
  USING (
    is_active
    AND EXISTS (SELECT 1 FROM public.job_postings p WHERE p.center_id = center_programs.center_id AND p.status = 'published')
  );
