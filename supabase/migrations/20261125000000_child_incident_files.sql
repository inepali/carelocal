-- ============================================================
-- Child incident forms: the owner and administrators can upload a scanned or photographed incident form
-- against a child. They are ordinary child files (same bucket, same access rules, same audit trail) that sit in
-- an incidents/ folder and carry category 'incident', so they never show up among the NC checklist records.
--   child/<center>/<child>/incidents/<id>.<ext>
-- ============================================================

ALTER TABLE public.child_files
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'record';

ALTER TABLE public.child_files DROP CONSTRAINT IF EXISTS child_files_category_check;
ALTER TABLE public.child_files ADD CONSTRAINT child_files_category_check CHECK (category IN ('record', 'incident'));

CREATE INDEX IF NOT EXISTS idx_child_files_incidents
  ON public.child_files (child_id, created_at DESC) WHERE category = 'incident';

-- Key rules: every child file sits under child/<center>/<child>/. Incident forms sit in incidents/ and are not
-- tied to a checklist item; checklist records never sit in incidents/.
CREATE OR REPLACE FUNCTION public.check_child_file_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text := 'child/' || NEW.center_id || '/' || NEW.child_id || '/';
  v_incidents text := 'child/' || NEW.center_id || '/' || NEW.child_id || '/incidents/';
BEGIN
  IF left(NEW.file_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.category = 'incident' THEN
    IF left(NEW.file_key, length(v_incidents)) <> v_incidents THEN
      RAISE EXCEPTION 'An incident form must be stored in the incidents folder' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.requirement_id IS NOT NULL THEN
      RAISE EXCEPTION 'An incident form is not part of the record checklist' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF left(NEW.file_key, length(v_incidents)) = v_incidents THEN
    RAISE EXCEPTION 'Only incident forms can be stored in the incidents folder' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_child_file_key ON public.child_files;
CREATE TRIGGER trg_check_child_file_key
  BEFORE INSERT OR UPDATE OF file_key, category, requirement_id ON public.child_files
  FOR EACH ROW EXECUTE FUNCTION public.check_child_file_key();

-- Activity log wording (names only, never form contents)
CREATE OR REPLACE FUNCTION public.log_child_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_child uuid; v_center uuid; v_row uuid;
  v_fields text[] := '{}'; v_summary text; v_req text; k text; v_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW);
  ELSE v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_child := COALESCE(v_new, v_old)->>'id';
  ELSE
    v_child := COALESCE(v_new, v_old)->>'child_id';
  END IF;
  v_center := COALESCE(v_new, v_old)->>'center_id';
  v_row := COALESCE(v_new, v_old)->>'id';

  IF NOT EXISTS (SELECT 1 FROM children WHERE id = v_child) THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k <> 'updated_at' AND (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN v_fields := v_fields || k; END IF;
    END LOOP;
    IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_summary := CASE WHEN TG_OP = 'INSERT' THEN 'Child added' ELSE 'Changed: ' || array_to_string(v_fields, ', ') END;
  ELSIF TG_TABLE_NAME = 'child_guardians' THEN
    v_summary := CASE TG_OP
      WHEN 'INSERT' THEN 'Added ' || (v_new->>'name') || CASE WHEN (v_new->>'can_pick_up')::boolean THEN ', authorized to pick up' ELSE '' END
      WHEN 'DELETE' THEN 'Removed ' || (v_old->>'name')
      ELSE (v_new->>'name') || ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'can_pick_up' = ANY (v_fields)
                   THEN CASE WHEN (v_new->>'can_pick_up')::boolean THEN ' (pick-up authorized)' ELSE ' (pick-up removed)' END
                   ELSE '' END
    END;
  ELSIF TG_TABLE_NAME = 'child_documents' THEN
    SELECT document_name INTO v_req FROM center_document_requirements WHERE id = (COALESCE(v_new, v_old)->>'requirement_id')::uuid;
    v_summary := COALESCE(v_req, 'Record') || CASE TG_OP
      WHEN 'INSERT' THEN ': record created'
      WHEN 'DELETE' THEN ': record removed'
      ELSE ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'status' = ANY (v_fields) THEN ' (' || (v_old->>'status') || ' to ' || (v_new->>'status') || ')' ELSE '' END
    END;
  ELSE  -- child_files
    v_kind := CASE WHEN COALESCE(v_new->>'category', v_old->>'category') = 'incident' THEN 'Incident form ' ELSE 'File ' END;
    v_summary := CASE TG_OP WHEN 'INSERT' THEN v_kind || 'added: ' WHEN 'DELETE' THEN v_kind || 'removed: ' ELSE v_kind || 'changed: ' END
                 || COALESCE(v_new->>'file_name', v_old->>'file_name');
  END IF;

  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, changed_fields, summary)
  VALUES (v_center, v_child, TG_TABLE_NAME, v_row, lower(TG_OP), auth.uid(), v_fields, left(v_summary, 300));
  RETURN NULL;
END $$;
