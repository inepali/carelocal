-- ============================================================
-- Phase 1: compliance checklist model
--  * Requirement rules: section, evidence type, due window from employment start,
--    renewal, "if applicable", grouping, template de-duplication
--  * Employment start date per center relationship (admin-only)
--  * Per-staff record: completion date, training hours, expiry, N/A (admin-only)
-- Status (current / due soon / overdue / missing / N/A) is computed in the app
-- from these fields; nothing derived is stored.
-- ============================================================

-- 1. Requirement rules -----------------------------------------------------------
ALTER TABLE public.center_document_requirements
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'personnel',
  ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'staff_document',
  ADD COLUMN IF NOT EXISTS due_within_days integer,          -- days after employment start; 0 = by day 1; NULL = no deadline
  ADD COLUMN IF NOT EXISTS renewal_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS renewal_months integer,           -- for renewal_type = 'interval'
  ADD COLUMN IF NOT EXISTS is_conditional boolean NOT NULL DEFAULT false, -- "if applicable"
  ADD COLUMN IF NOT EXISTS group_label text,                 -- e.g. 'Health & Safety Training' topics
  ADD COLUMN IF NOT EXISTS template_key text;                -- set when created from a template

ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_section_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_section_check
  CHECK (section IN ('personnel', 'health', 'training', 'policies', 'evaluations'));

ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_evidence_type_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_evidence_type_check
  CHECK (evidence_type IN ('staff_document', 'center_record', 'acknowledgement', 'training'));

ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_renewal_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_renewal_check
  CHECK (
    renewal_type IN ('none', 'interval', 'document_expiry', 'policy_change')
    AND (renewal_type <> 'interval' OR (renewal_months IS NOT NULL AND renewal_months > 0))
  );

ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_due_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_due_check
  CHECK (due_within_days IS NULL OR due_within_days >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS cdr_center_template_key_unique
  ON public.center_document_requirements (center_id, template_key)
  WHERE template_key IS NOT NULL;

-- Existing center-only requirements are center records
UPDATE public.center_document_requirements
SET evidence_type = 'center_record'
WHERE is_internal = true AND evidence_type = 'staff_document';

-- 2. Employment start date -------------------------------------------------------
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS employment_start_date date;
UPDATE public.center_staff SET employment_start_date = added_at::date WHERE employment_start_date IS NULL;

-- Extend the admin-only guard (from 20261013000000) to cover the start date
CREATE OR REPLACE FUNCTION public.guard_center_staff_employment_class()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    IF TG_OP = 'INSERT' AND NEW.employment_start_date IS NULL THEN
      NEW.employment_start_date := COALESCE(NEW.added_at, now())::date;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.employment_class := 'substitute';
    NEW.employment_start_date := COALESCE(NEW.added_at, now())::date;
  ELSE
    NEW.employment_class := OLD.employment_class;
    NEW.employment_start_date := OLD.employment_start_date;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Per-staff compliance record ----------------------------------------------------
ALTER TABLE public.center_staff_document_status
  ADD COLUMN IF NOT EXISTS completed_on date,
  ADD COLUMN IF NOT EXISTS hours numeric(5,1) CHECK (hours IS NULL OR hours >= 0),
  ADD COLUMN IF NOT EXISTS expires_on date,                 -- admin-entered expiry (e.g. CPR card)
  ADD COLUMN IF NOT EXISTS not_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS not_applicable_reason text;

-- Only the center reviews and records completion details; staff may only link a
-- document, which always (re)enters review.
CREATE OR REPLACE FUNCTION public.guard_document_status_admin_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_center_admin(NEW.center_id) THEN RETURN NEW; END IF;

  NEW.status := 'pending_review';
  NEW.center_reviewed := false;

  IF TG_OP = 'INSERT' THEN
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_notes := NULL;
    NEW.completed_on := NULL;
    NEW.hours := NULL;
    NEW.expires_on := NULL;
    NEW.not_applicable := false;
    NEW.not_applicable_reason := NULL;
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_notes := OLD.review_notes;
    NEW.completed_on := OLD.completed_on;
    NEW.hours := OLD.hours;
    NEW.expires_on := OLD.expires_on;
    NEW.not_applicable := OLD.not_applicable;
    NEW.not_applicable_reason := OLD.not_applicable_reason;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_document_status_admin_fields ON public.center_staff_document_status;
CREATE TRIGGER trg_guard_document_status_admin_fields
  BEFORE INSERT OR UPDATE ON public.center_staff_document_status
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_status_admin_fields();
