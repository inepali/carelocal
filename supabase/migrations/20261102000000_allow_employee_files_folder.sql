-- Center-held documents may live under internal/<center>/ (files the center uploads for the center)
-- or employee_files/<center>/ (employee documents the center keeps: uploads for an employee and copies
-- of accepted documents). The prefix still has to name the row's own center.
CREATE OR REPLACE FUNCTION public.enforce_document_key_namespace()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_prefix text;
  v_alt_prefix text;
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
    v_alt_prefix := 'employee_files/' || NEW.center_id || '/';
  ELSE -- center_document_requirements
    v_key := NEW.template_file_key;
    IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM OLD.template_file_key THEN RETURN NEW; END IF;
    v_prefix := 'template/' || NEW.center_id || '/';
  END IF;

  IF v_key IS NOT NULL
     AND (v_prefix IS NULL OR left(v_key, length(v_prefix)) <> v_prefix)
     AND (v_alt_prefix IS NULL OR left(v_key, length(v_alt_prefix)) <> v_alt_prefix) THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
