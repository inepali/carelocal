-- Child Files, Phase 0: a requirement rule now says who it is for. Every existing rule is a staff rule
-- (the default), so nothing changes for centers today. Child rules arrive in Phase 1; every query that
-- lists requirements for staff screens must filter on audience = 'staff' (scripts/check-audience.mjs
-- fails the build check when one forgets).
ALTER TABLE public.center_document_requirements
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'staff';

ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_audience_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_audience_check
  CHECK (audience IN ('staff', 'child'));

CREATE INDEX IF NOT EXISTS idx_cdr_center_audience
  ON public.center_document_requirements (center_id, audience);
