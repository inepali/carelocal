-- Phone upload (QR handoff) for child files: the handoff remembers which child the photo is for, so the file lands
-- in that child's folder of the child bucket. Two kinds: a checklist record, or an incident form.
ALTER TABLE public.upload_handoffs
  ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES public.children(id) ON DELETE CASCADE;

ALTER TABLE public.upload_handoffs DROP CONSTRAINT IF EXISTS upload_handoffs_kind_check;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT upload_handoffs_kind_check
  CHECK (kind IN ('internal', 'inspection', 'template', 'vault', 'receipt', 'child_record', 'child_incident'));

-- A child kind always names its child
ALTER TABLE public.upload_handoffs DROP CONSTRAINT IF EXISTS upload_handoffs_child_kind_check;
ALTER TABLE public.upload_handoffs ADD CONSTRAINT upload_handoffs_child_kind_check
  CHECK ((kind IN ('child_record', 'child_incident')) = (child_id IS NOT NULL));
