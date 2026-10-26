-- Immunizations are tracked through the "Immunization Record" item on each child's file (upload, review,
-- accept); an exemption is recorded by marking that item not applicable with the reason. The separate
-- status column duplicated it and is no longer shown or set anywhere.
ALTER TABLE public.children DROP CONSTRAINT IF EXISTS children_immunization_status_check;
ALTER TABLE public.children DROP COLUMN IF EXISTS immunization_status;
