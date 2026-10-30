-- ============================================================
-- Child activity log: a headshot change reads "Photo added", "Photo changed" or "Photo removed"
-- instead of "Changed: photo_key". Everything else in log_child_change() is unchanged
-- (copied from 20261125000000_child_incident_files.sql).
-- Existing log rows are not rewritten: the audit trail is never edited.
-- Rollback: supabase/rollbacks/20261209000000_child_photo_log_wording.down.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_child_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_child uuid; v_center uuid; v_row uuid;
  v_fields text[] := '{}'; v_summary text; v_req text; k text; v_kind text;
  v_photo text; v_rest text[];
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
    IF TG_OP = 'INSERT' THEN
      v_summary := 'Child added';
    ELSE
      -- The headshot reads as plain words; any other changed fields are listed as before
      v_photo := CASE WHEN 'photo_key' = ANY (v_fields) THEN
        CASE WHEN v_old->>'photo_key' IS NULL THEN 'Photo added'
             WHEN v_new->>'photo_key' IS NULL THEN 'Photo removed'
             ELSE 'Photo changed' END
      END;
      v_rest := array_remove(v_fields, 'photo_key');
      v_summary := concat_ws('; ', v_photo, CASE WHEN cardinality(v_rest) > 0 THEN 'Changed: ' || array_to_string(v_rest, ', ') END);
    END IF;
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
REVOKE ALL ON FUNCTION public.log_child_change() FROM PUBLIC, anon, authenticated;
