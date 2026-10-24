-- A short description on each incident form, so incidents can be found by what happened.
-- Only incident forms carry one. It is covered by the same access rules as the file itself, and the activity
-- log records only that the description changed, never its words.
ALTER TABLE public.child_files ADD COLUMN IF NOT EXISTS incident_note text;

ALTER TABLE public.child_files DROP CONSTRAINT IF EXISTS child_files_incident_note_check;
ALTER TABLE public.child_files ADD CONSTRAINT child_files_incident_note_check
  CHECK (incident_note IS NULL OR (category = 'incident' AND char_length(incident_note) <= 500));
