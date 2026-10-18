-- Copy-on-accept: when a center accepts a staff document, it keeps its own copy in the center's
-- document repository (center_internal_documents), independent of the employee's vault file.
-- Unlinking, replacing or deleting the original no longer removes what the center accepted.

-- Where a center copy came from (NULL for files the center uploaded itself). The copy outlives
-- the original: deleting the staff document just clears the pointer.
ALTER TABLE public.center_internal_documents
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL;

-- The copy has to keep the confidentiality of the request it answered, including ad-hoc requests
-- that have no checklist item to inherit it from.
ALTER TABLE public.center_internal_documents
  ADD COLUMN IF NOT EXISTS is_confidential boolean NOT NULL DEFAULT false;

-- One copy per source document per center: makes the copy step safe to run again
CREATE UNIQUE INDEX IF NOT EXISTS center_internal_documents_source_unique
  ON public.center_internal_documents (center_id, source_document_id)
  WHERE source_document_id IS NOT NULL;

-- Reads: the existing checklist-item rule, plus the copy's own confidential flag
DROP POLICY IF EXISTS "Center admins read internal docs" ON public.center_internal_documents;
CREATE POLICY "Center admins read internal docs"
  ON public.center_internal_documents FOR SELECT
  USING (
    public.is_center_admin(center_id)
    AND (NOT is_confidential OR public.can_view_confidential(center_id))
    AND (
      requirement_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.center_document_requirements r WHERE r.id = requirement_id AND r.is_confidential)
      OR public.can_view_confidential(center_id)
    )
  );
