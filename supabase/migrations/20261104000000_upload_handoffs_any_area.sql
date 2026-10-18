-- Upload from phone, everywhere: a handoff can now deliver a file for any upload area, not just an
-- employee's checklist item.
--   kind = 'internal'   center file for an employee (checklist)   -> employee_files/<center>/<staff>/
--          'inspection' inspection report                          -> inspection/<center>/
--          'template'   blank form on a document requirement       -> template/<center>/
--          'vault'      a staff member's own document library      -> vault/<user>/
-- The desktop that created the handoff (created_by) is the only one that can read or use it.
ALTER TABLE public.upload_handoffs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'internal';
ALTER TABLE public.upload_handoffs DROP CONSTRAINT IF EXISTS upload_handoffs_kind_check;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT upload_handoffs_kind_check
  CHECK (kind IN ('internal', 'inspection', 'template', 'vault'));

-- What the phone shows ("Inspection report", "CPR Certification", …)
ALTER TABLE public.upload_handoffs ADD COLUMN IF NOT EXISTS label text;

-- Center-wide uploads have no employee; a staff member's own upload has no center
ALTER TABLE public.upload_handoffs ALTER COLUMN center_id DROP NOT NULL;
ALTER TABLE public.upload_handoffs ALTER COLUMN staff_id DROP NOT NULL;
