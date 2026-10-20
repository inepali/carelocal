-- Upload from phone: a center admin opens a QR code on the desktop, scans it with a phone, takes
-- photos and they arrive on the desktop for the admin to attach to an employee's checklist item.
--
-- The phone page needs no sign-in. Instead each handoff carries a one-time secret token (only its
-- SHA-256 hash is stored), lasts 10 minutes, is scoped to one employee + item, and can only UPLOAD.
-- Nothing is attached until the admin confirms it on the desktop.
-- All access goes through server actions (service role); no client reads or writes this table.
CREATE TABLE IF NOT EXISTS public.upload_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES public.center_document_requirements(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'attached', 'discarded')),
  file_key text,                 -- issued to the phone; confirmed when the upload completes
  file_name text,
  content_type text,
  size_bytes integer,
  upload_attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_handoffs_center ON public.upload_handoffs (center_id, created_at DESC);

ALTER TABLE public.upload_handoffs ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (server actions) touches this table.
