-- Once an incident form has a description it is part of the child's record: nobody can delete it, and the
-- description can be reworded but never cleared (clearing it would unlock the delete).
-- Enforced here so it holds no matter which app path does the write.
CREATE OR REPLACE FUNCTION public.child_files_incident_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Removing the child itself (ON DELETE CASCADE, e.g. center data cleanup) still takes its files with it
    IF OLD.category = 'incident' AND OLD.incident_note IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.children WHERE id = OLD.child_id) THEN
      RAISE EXCEPTION 'An incident form with a description cannot be deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.incident_note IS NOT NULL AND NEW.incident_note IS NULL THEN
    RAISE EXCEPTION 'The description of an incident form cannot be removed once added.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS child_files_incident_lock ON public.child_files;
CREATE TRIGGER child_files_incident_lock
  BEFORE UPDATE OF incident_note OR DELETE ON public.child_files
  FOR EACH ROW EXECUTE FUNCTION public.child_files_incident_lock();
