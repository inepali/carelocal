-- ============================================================
-- Inspection reports: keep the paper record of every inspection
--  * Files (inspection reports, certificates, invoices…) attached to an inspection
--    and optionally to the specific history entry they document.
--  * Stored in the private center bucket under inspection/<center id>/…, viewed only
--    through short-lived signed links, every view written to document_access_log.
--  * Records are kept: an inspection with reports can't be deleted, and deleting a
--    history entry keeps its reports on the inspection.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.center_inspection_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES public.center_inspections(id) ON DELETE RESTRICT,
  log_id uuid REFERENCES public.center_inspection_logs(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_key text NOT NULL,
  bucket_name text NOT NULL,
  content_type text,
  size_bytes integer,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_center_inspection_files_inspection ON public.center_inspection_files(inspection_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_center_inspection_files_log ON public.center_inspection_files(log_id);

ALTER TABLE public.center_inspection_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Center admins manage inspection files" ON public.center_inspection_files;
CREATE POLICY "Center admins manage inspection files"
  ON public.center_inspection_files FOR ALL
  USING (public.is_center_admin(center_id))
  WITH CHECK (public.is_center_admin(center_id));

DROP POLICY IF EXISTS "Super admins read inspection files" ON public.center_inspection_files;
CREATE POLICY "Super admins read inspection files"
  ON public.center_inspection_files FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));

-- File must belong to the same center as its inspection / history entry, and its
-- storage key must be in this center's inspection namespace.
CREATE OR REPLACE FUNCTION public.check_inspection_file()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM center_inspections WHERE id = NEW.inspection_id AND center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'Inspection does not belong to this center';
  END IF;
  IF NEW.log_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM center_inspection_logs WHERE id = NEW.log_id AND inspection_id = NEW.inspection_id
  ) THEN
    RAISE EXCEPTION 'History entry does not belong to this inspection';
  END IF;
  IF auth.uid() IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.file_key IS DISTINCT FROM OLD.file_key)
     AND left(NEW.file_key, length('inspection/' || NEW.center_id || '/')) <> 'inspection/' || NEW.center_id || '/' THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_inspection_file ON public.center_inspection_files;
CREATE TRIGGER trg_check_inspection_file
  BEFORE INSERT OR UPDATE ON public.center_inspection_files
  FOR EACH ROW EXECUTE FUNCTION public.check_inspection_file();

-- Access log accepts inspection reports
ALTER TABLE public.document_access_log DROP CONSTRAINT IF EXISTS document_access_log_document_kind_check;
ALTER TABLE public.document_access_log ADD CONSTRAINT document_access_log_document_kind_check
  CHECK (document_kind IN ('vault', 'internal', 'template', 'inspection'));
