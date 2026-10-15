-- ============================================================
-- Phase 0: secure document storage
--  * Confidential requirements (medical file) readable only by center owner/admin roles
--  * Storage keys must live in the owner's namespace (prevents pointing a row at
--    someone else's file and viewing it through that row)
--  * Accepted documents are center records: they cannot be deleted / unlinked by staff
--  * Access log for every document view
-- Viewing/uploading goes through server actions that read rows with the user's session
-- (so these RLS rules decide access) and sign 5-minute URLs.
-- ============================================================

-- 1. Confidential flag + role helper ----------------------------------------
ALTER TABLE public.center_document_requirements
  ADD COLUMN IF NOT EXISTS is_confidential boolean NOT NULL DEFAULT false;

-- Roles allowed to open confidential (medical) records. center_admins.role today: 'owner'.
CREATE OR REPLACE FUNCTION public.can_view_confidential(p_center_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM center_admins
    WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_center_admin(p_center_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id);
$$;

-- 2. Center access to staff vault documents (respecting confidentiality) ---------
DROP POLICY IF EXISTS "Center admins can view linked staff documents" ON public.staff_documents;
CREATE POLICY "Center admins can view linked staff documents"
  ON public.staff_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.center_staff_document_status csds
      LEFT JOIN public.center_document_requirements r ON r.id = csds.requirement_id
      WHERE csds.matched_document_id = public.staff_documents.id
        AND public.is_center_admin(csds.center_id)
        AND (COALESCE(r.is_confidential, false) = false OR public.can_view_confidential(csds.center_id))
    )
  );

-- Center-held documents: same confidentiality rule for reads
DROP POLICY IF EXISTS "Centers can manage their internal docs" ON public.center_internal_documents;

DROP POLICY IF EXISTS "Center admins read internal docs" ON public.center_internal_documents;
CREATE POLICY "Center admins read internal docs"
  ON public.center_internal_documents FOR SELECT
  USING (
    public.is_center_admin(center_id)
    AND (
      requirement_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.center_document_requirements r WHERE r.id = requirement_id AND r.is_confidential)
      OR public.can_view_confidential(center_id)
    )
  );

DROP POLICY IF EXISTS "Center admins write internal docs" ON public.center_internal_documents;
CREATE POLICY "Center admins write internal docs"
  ON public.center_internal_documents FOR INSERT
  WITH CHECK (public.is_center_admin(center_id));

DROP POLICY IF EXISTS "Center admins update internal docs" ON public.center_internal_documents;
CREATE POLICY "Center admins update internal docs"
  ON public.center_internal_documents FOR UPDATE
  USING (public.is_center_admin(center_id))
  WITH CHECK (public.is_center_admin(center_id));

DROP POLICY IF EXISTS "Center admins delete internal docs" ON public.center_internal_documents;
CREATE POLICY "Center admins delete internal docs"
  ON public.center_internal_documents FOR DELETE
  USING (public.is_center_admin(center_id));

-- 3. Storage key namespaces ---------------------------------------------------
-- New keys: vault/<owner user id>/…, internal/<center id>/…, template/<center id>/…
-- Existing rows keep their legacy keys; the check only runs when file_key is set/changed.
CREATE OR REPLACE FUNCTION public.enforce_document_key_namespace()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_prefix text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / server jobs

  IF TG_TABLE_NAME = 'staff_documents' THEN
    v_key := NEW.file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.file_key THEN RETURN NEW; END IF;
    SELECT 'vault/' || user_id || '/' INTO v_prefix FROM staff_profiles WHERE id = NEW.staff_id;
  ELSIF TG_TABLE_NAME = 'center_internal_documents' THEN
    v_key := NEW.file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.file_key THEN RETURN NEW; END IF;
    v_prefix := 'internal/' || NEW.center_id || '/';
  ELSE -- center_document_requirements
    v_key := NEW.template_file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.template_file_key THEN RETURN NEW; END IF;
    v_prefix := 'template/' || NEW.center_id || '/';
  END IF;

  IF v_key IS NOT NULL AND (v_prefix IS NULL OR left(v_key, length(v_prefix)) <> v_prefix) THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_documents_key_namespace ON public.staff_documents;
CREATE TRIGGER trg_staff_documents_key_namespace
  BEFORE INSERT OR UPDATE ON public.staff_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_key_namespace();

DROP TRIGGER IF EXISTS trg_internal_documents_key_namespace ON public.center_internal_documents;
CREATE TRIGGER trg_internal_documents_key_namespace
  BEFORE INSERT OR UPDATE ON public.center_internal_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_key_namespace();

DROP TRIGGER IF EXISTS trg_requirement_template_key_namespace ON public.center_document_requirements;
CREATE TRIGGER trg_requirement_template_key_namespace
  BEFORE INSERT OR UPDATE ON public.center_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_key_namespace();

-- 4. Accepted documents are center records ------------------------------------
-- Staff cannot delete a vault document a center has accepted (the center keeps it
-- even after the employee is deactivated). They can still link a newer replacement.
CREATE OR REPLACE FUNCTION public.protect_accepted_staff_document()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF EXISTS (
    SELECT 1 FROM center_staff_document_status
    WHERE matched_document_id = OLD.id AND status::text = 'accepted'
  ) THEN
    RAISE EXCEPTION 'This document was accepted by a center and is part of its records, so it cannot be deleted. Link a newer document to replace it.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_accepted_staff_document ON public.staff_documents;
CREATE TRIGGER trg_protect_accepted_staff_document
  BEFORE DELETE ON public.staff_documents
  FOR EACH ROW EXECUTE FUNCTION public.protect_accepted_staff_document();

-- Only the center can remove an accepted checklist entry
CREATE OR REPLACE FUNCTION public.protect_accepted_document_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_center_admin(OLD.center_id) THEN RETURN OLD; END IF;
  IF OLD.status::text = 'accepted' THEN
    RAISE EXCEPTION 'An accepted document can only be removed by the center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_accepted_document_status ON public.center_staff_document_status;
CREATE TRIGGER trg_protect_accepted_document_status
  BEFORE DELETE ON public.center_staff_document_status
  FOR EACH ROW EXECUTE FUNCTION public.protect_accepted_document_status();

-- 5. Access log ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_kind text NOT NULL CHECK (document_kind IN ('vault', 'internal', 'template')),
  document_id uuid NOT NULL,
  center_id uuid REFERENCES public.centers(id) ON DELETE CASCADE,  -- center the viewer acted for
  staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL, -- whose document it is
  is_confidential boolean NOT NULL DEFAULT false,
  action text NOT NULL DEFAULT 'view',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_access_log_center ON public.document_access_log(center_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_access_log_staff ON public.document_access_log(staff_id, created_at DESC);

ALTER TABLE public.document_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users log their own access" ON public.document_access_log;
CREATE POLICY "Users log their own access"
  ON public.document_access_log FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Center owner/admin roles review their center's log; staff see who opened their documents
DROP POLICY IF EXISTS "Center admins read access log" ON public.document_access_log;
CREATE POLICY "Center admins read access log"
  ON public.document_access_log FOR SELECT
  USING (center_id IS NOT NULL AND public.can_view_confidential(center_id));

DROP POLICY IF EXISTS "Staff read access to their documents" ON public.document_access_log;
CREATE POLICY "Staff read access to their documents"
  ON public.document_access_log FOR SELECT
  USING (staff_id IN (SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Super admins read access log" ON public.document_access_log;
CREATE POLICY "Super admins read access log"
  ON public.document_access_log FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));
