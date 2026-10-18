-- ============================================================
-- Regular hiring, Phase 1 (see "CareLocal Regular Hiring Spec", Oct 18 2026)
--  * Centers post regular full-time / part-time jobs; staff apply with their vault documents;
--    accepting an offer turns the applicant's center_staff row into an active regular employee.
--  * Adds 5 tables and 6 functions. Nothing on shifts / shift_claims changes.
--
-- Deviations from the spec, agreed during review:
--  1. accept_job_offer sets a transaction-local "hiring" flag that the existing center_staff guards
--     honour; without it they would silently undo the hire (staff cannot change their own class/status).
--  2. Requests raised on accept are inserted directly (create_document_requests is admin-only).
--  4. A trigger on job_postings enforces the tier limit, the past-due block, pay-to-publish and
--     "filled only through a hire", so direct writes cannot bypass them.
--  5. Tier limits: trialing 1, starter 2, growth 5, network / enterprise unlimited.
--  6. document_category is text since 20261015: "Resume" is added as a default Document Type.
--  7. The readiness cache is written by server actions / the daily cron (it needs computeCompliance).
--  9. apply_to_job never relinks a checklist item the center already accepted or is reviewing.
--  +  The internal rejection reason lives only in the stage history note (admins only), and the
--     resume is stored on the application (resume_document_id) so admins can open it.
-- ============================================================

-- 0. Feature flag + Resume document type ---------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS jobs_enabled boolean NOT NULL DEFAULT false;

INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key)
SELECT NULL, 'Document Type', 'Resume', 'resume', true, 9, 'childcare'
WHERE NOT EXISTS (
  SELECT 1 FROM public.center_lookups
  WHERE center_id IS NULL AND group_name = 'Document Type' AND value = 'resume' AND domain_key = 'childcare'
);

-- 1. The hiring flag ------------------------------------------------------------------------------
-- Set only inside accept_job_offer (set_config(..., true) = this transaction only).
CREATE OR REPLACE FUNCTION public.hiring_in_progress()
RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(current_setting('carelocal.hiring', true), '') = 'on' $$;

-- Existing guards, unchanged except for honouring the flag
CREATE OR REPLACE FUNCTION public.guard_center_staff_employment_class()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.hiring_in_progress() THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id)
     AND NOT public.is_own_staff(NEW.staff_id) THEN
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

CREATE OR REPLACE FUNCTION public.guard_center_staff_self_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.hiring_in_progress() THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text NOT IN ('invited', 'applying') THEN
      NEW.status := 'applying';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'active' THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Single-center rule: applying / invited rows elsewhere no longer count as an association -----
CREATE OR REPLACE FUNCTION public.enforce_regular_single_center()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'removed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM center_staff
    WHERE staff_id = NEW.staff_id
      AND center_id <> NEW.center_id
      AND employment_class = 'regular'
      AND status::text NOT IN ('removed', 'applying', 'invited')
  ) THEN
    RAISE EXCEPTION 'This staff member is a regular employee at another center and cannot join additional centers'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.employment_class = 'regular'
     AND (TG_OP = 'INSERT' OR OLD.employment_class IS DISTINCT FROM 'regular')
     AND EXISTS (
       SELECT 1 FROM center_staff
       WHERE staff_id = NEW.staff_id
         AND center_id <> NEW.center_id
         AND status::text NOT IN ('removed', 'applying', 'invited')
     ) THEN
    RAISE EXCEPTION 'This staff member is associated with other centers and cannot become a regular employee here until they leave them'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Tables ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_postings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  domain_key       text NOT NULL DEFAULT 'childcare',   -- copied from the center
  slug             text NOT NULL,
  title            text NOT NULL,
  role_value       text,                                -- a 'Role' lookup value
  employment_type  text NOT NULL CHECK (employment_type IN ('full_time', 'part_time')),
  description      text NOT NULL,
  schedule_summary text,
  hours_per_week   numeric(4,1),
  pay_min          numeric(8,2),
  pay_max          numeric(8,2),
  pay_unit         text NOT NULL DEFAULT 'hour' CHECK (pay_unit IN ('hour', 'year')),
  benefits         text[] NOT NULL DEFAULT '{}',
  start_date       date,                                -- NULL = ASAP
  openings         int NOT NULL DEFAULT 1 CHECK (openings > 0),
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'paused', 'closed', 'filled')),
  published_at     timestamptz,
  closes_at        timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (center_id, slug),
  CHECK (pay_max IS NULL OR pay_min IS NULL OR pay_max >= pay_min),
  CHECK (status = 'draft' OR pay_min IS NOT NULL)        -- a pay range or fixed pay to publish
);
CREATE INDEX IF NOT EXISTS idx_job_postings_feed ON public.job_postings (domain_key, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_center ON public.job_postings (center_id, status);

CREATE TABLE IF NOT EXISTS public.job_posting_requirements (
  job_id         uuid NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES public.center_document_requirements(id) ON DELETE CASCADE,
  needed_at      text NOT NULL DEFAULT 'apply' CHECK (needed_at IN ('apply', 'offer', 'start')),
  PRIMARY KEY (job_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS public.job_applications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  center_id          uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id           uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  center_staff_id    uuid NOT NULL REFERENCES public.center_staff(id) ON DELETE CASCADE,
  stage              text NOT NULL DEFAULT 'applied'
                       CHECK (stage IN ('applied', 'reviewing', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
  cover_note         text CHECK (char_length(cover_note) <= 2000),
  resume_document_id uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  readiness          jsonb NOT NULL DEFAULT '{}',
  offer_start_date   date,
  offer_pay          numeric(8,2),
  offer_note         text,
  offer_sent_at      timestamptz,
  decided_at         timestamptz,
  applied_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_job_applications_job ON public.job_applications (job_id, stage);
CREATE INDEX IF NOT EXISTS idx_job_applications_staff ON public.job_applications (staff_id, stage);
CREATE INDEX IF NOT EXISTS idx_job_applications_center ON public.job_applications (center_id, stage);

CREATE TABLE IF NOT EXISTS public.job_application_documents (
  application_id  uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  requirement_id  uuid NOT NULL REFERENCES public.center_document_requirements(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  expiry_at_apply date,
  shared_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS public.job_application_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  from_stage     text,
  to_stage       text NOT NULL,
  actor_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note           text,                                -- internal (includes rejection reasons)
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_application_events_app ON public.job_application_events (application_id, created_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.job_postings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.job_postings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.job_applications;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. Posting rules (cannot be bypassed by direct writes) -------------------------------------------
CREATE OR REPLACE FUNCTION public.job_post_limit(p_center_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.subscription_status::text = 'trialing' THEN 1
    WHEN c.subscription_tier::text = 'starter' THEN 2
    WHEN c.subscription_tier::text = 'growth' THEN 5
    ELSE NULL                                        -- network / enterprise: unlimited
  END
  FROM centers c WHERE c.id = p_center_id;
$$;

CREATE OR REPLACE FUNCTION public.guard_job_posting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_center centers%ROWTYPE;
  v_limit integer;
  v_active integer;
BEGIN
  SELECT * INTO v_center FROM centers WHERE id = NEW.center_id;
  IF TG_OP = 'INSERT' THEN
    NEW.domain_key := COALESCE(v_center.domain_key, NEW.domain_key);
    IF NOT COALESCE(v_center.jobs_enabled, false) THEN
      RAISE EXCEPTION 'Job postings are not enabled for this center yet' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.center_id := OLD.center_id;                  -- a posting never moves between centers
  END IF;

  -- "filled" only comes from a hire
  IF NEW.status = 'filled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'filled') AND NOT public.hiring_in_progress() THEN
    RAISE EXCEPTION 'A job is marked filled automatically when its openings are hired' USING ERRCODE = 'check_violation';
  END IF;

  -- Publishing (paused -> published does not add an active posting)
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('published', 'paused')) THEN
    IF v_center.subscription_status::text = 'past_due' THEN
      RAISE EXCEPTION 'Your subscription is past due. Update billing to publish new jobs.' USING ERRCODE = 'check_violation';
    END IF;
    v_limit := public.job_post_limit(NEW.center_id);
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_active FROM job_postings
      WHERE center_id = NEW.center_id AND status IN ('published', 'paused') AND id <> NEW.id;
      IF v_active >= v_limit THEN
        RAISE EXCEPTION 'Your plan allows % active job posting%. Close or fill one, or upgrade, to publish another.',
          v_limit, CASE WHEN v_limit = 1 THEN '' ELSE 's' END USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_job_posting ON public.job_postings;
CREATE TRIGGER trg_guard_job_posting
  BEFORE INSERT OR UPDATE ON public.job_postings
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_posting();

-- Only super admins / server jobs turn hiring on for a center
CREATE OR REPLACE FUNCTION public.guard_jobs_enabled_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.jobs_enabled IS NOT DISTINCT FROM OLD.jobs_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.jobs_enabled := OLD.jobs_enabled;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_jobs_enabled_flag ON public.centers;
CREATE TRIGGER trg_guard_jobs_enabled_flag
  BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_jobs_enabled_flag();

-- 5. Stage history ----------------------------------------------------------------------------------
-- Functions pass a note through carelocal.stage_note (transaction-local).
CREATE OR REPLACE FUNCTION public.log_job_application_stage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW; END IF;
  INSERT INTO job_application_events (application_id, from_stage, to_stage, actor_id, note)
  VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage END, NEW.stage, auth.uid(),
          NULLIF(current_setting('carelocal.stage_note', true), ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_job_application_stage ON public.job_applications;
CREATE TRIGGER trg_log_job_application_stage
  AFTER INSERT OR UPDATE OF stage ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.log_job_application_stage();

-- 6. Row-level security ------------------------------------------------------------------------------
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_posting_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published jobs are public" ON public.job_postings;
CREATE POLICY "Published jobs are public" ON public.job_postings FOR SELECT
  USING (status = 'published');
DROP POLICY IF EXISTS "Center admins read their jobs" ON public.job_postings;
CREATE POLICY "Center admins read their jobs" ON public.job_postings FOR SELECT TO authenticated
  USING (public.is_center_admin(center_id));
DROP POLICY IF EXISTS "Applicants read jobs they applied to" ON public.job_postings;
CREATE POLICY "Applicants read jobs they applied to" ON public.job_postings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_applications a WHERE a.job_id = job_postings.id AND public.is_own_staff(a.staff_id)));
DROP POLICY IF EXISTS "Center admins create jobs" ON public.job_postings;
CREATE POLICY "Center admins create jobs" ON public.job_postings FOR INSERT TO authenticated
  WITH CHECK (public.is_center_admin(center_id));
DROP POLICY IF EXISTS "Center admins update jobs" ON public.job_postings;
CREATE POLICY "Center admins update jobs" ON public.job_postings FOR UPDATE TO authenticated
  USING (public.is_center_admin(center_id)) WITH CHECK (public.is_center_admin(center_id));
DROP POLICY IF EXISTS "Center admins delete draft jobs" ON public.job_postings;
CREATE POLICY "Center admins delete draft jobs" ON public.job_postings FOR DELETE TO authenticated
  USING (public.is_center_admin(center_id) AND status = 'draft');

DROP POLICY IF EXISTS "Job requirements follow the job" ON public.job_posting_requirements;
CREATE POLICY "Job requirements follow the job" ON public.job_posting_requirements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.job_postings p WHERE p.id = job_id));
DROP POLICY IF EXISTS "Center admins manage job requirements" ON public.job_posting_requirements;
CREATE POLICY "Center admins manage job requirements" ON public.job_posting_requirements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_postings p WHERE p.id = job_id AND public.is_center_admin(p.center_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_postings p WHERE p.id = job_id AND public.is_center_admin(p.center_id)));

-- Applications: read only; every write goes through the functions below
DROP POLICY IF EXISTS "Applicants and center admins read applications" ON public.job_applications;
CREATE POLICY "Applicants and center admins read applications" ON public.job_applications FOR SELECT TO authenticated
  USING (public.is_own_staff(staff_id) OR public.is_center_admin(center_id));

DROP POLICY IF EXISTS "Application documents follow the application" ON public.job_application_documents;
CREATE POLICY "Application documents follow the application" ON public.job_application_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_applications a WHERE a.id = application_id));

DROP POLICY IF EXISTS "Center admins read stage history" ON public.job_application_events;
CREATE POLICY "Center admins read stage history" ON public.job_application_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_applications a WHERE a.id = application_id AND public.is_center_admin(a.center_id)));

-- Staff see their own stage moves without the internal notes
CREATE OR REPLACE VIEW public.job_application_stage_history WITH (security_barrier = true) AS
  SELECT e.id, e.application_id, e.from_stage, e.to_stage, e.created_at
  FROM public.job_application_events e
  JOIN public.job_applications a ON a.id = e.application_id
  WHERE public.is_own_staff(a.staff_id) OR public.is_center_admin(a.center_id);
REVOKE ALL ON public.job_application_stage_history FROM PUBLIC, anon;
GRANT SELECT ON public.job_application_stage_history TO authenticated;

-- Admins can open the resume and the documents an applicant shared with their application
-- (checklist-linked documents are already visible through center_staff_document_status)
DROP POLICY IF EXISTS "Center admins view documents shared with an application" ON public.staff_documents;
CREATE POLICY "Center admins view documents shared with an application" ON public.staff_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.job_applications a
      WHERE a.resume_document_id = staff_documents.id AND public.is_center_admin(a.center_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.job_application_documents d
      JOIN public.job_applications a ON a.id = d.application_id
      JOIN public.center_document_requirements r ON r.id = d.requirement_id
      WHERE d.document_id = staff_documents.id
        AND public.is_center_admin(a.center_id)
        AND (NOT r.is_confidential OR public.can_view_confidential(a.center_id))
    )
  );

-- 7. Functions -----------------------------------------------------------------------------------------

-- Staff: apply with documents from their own vault. p_items = [{"requirement_id": uuid, "document_id": uuid}, ...]
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_cover_note text, p_items jsonb, p_resume_document_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_job job_postings%ROWTYPE;
  v_cs center_staff%ROWTYPE;
  v_app_id uuid;
  v_existing job_applications%ROWTYPE;
  v_req record;
  v_doc_id uuid;
  v_missing text[] := '{}';
BEGIN
  SELECT id INTO v_staff_id FROM staff_profiles WHERE user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Only staff members can apply' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_job FROM job_postings WHERE id = p_job_id;
  IF v_job.id IS NULL OR v_job.status <> 'published' THEN
    RAISE EXCEPTION 'This job is not accepting applications' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM center_staff
    WHERE staff_id = v_staff_id AND center_id <> v_job.center_id AND employment_class = 'regular'
      AND status::text NOT IN ('removed', 'applying', 'invited')
  ) THEN
    RAISE EXCEPTION 'You are a regular employee at another center, so you cannot apply for regular jobs elsewhere'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_resume_document_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM staff_documents WHERE id = p_resume_document_id AND staff_id = v_staff_id AND document_category = 'resume'
  ) THEN
    RAISE EXCEPTION 'Add your resume to apply' USING ERRCODE = 'check_violation';
  END IF;

  -- Every "apply" item needs a document from the applicant's vault, or a record the center already has
  FOR v_req IN
    SELECT r.id, r.document_name FROM job_posting_requirements jr
    JOIN center_document_requirements r ON r.id = jr.requirement_id
    WHERE jr.job_id = p_job_id AND jr.needed_at = 'apply'
  LOOP
    v_doc_id := NULL;
    SELECT (i ->> 'document_id')::uuid INTO v_doc_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
    WHERE (i ->> 'requirement_id')::uuid = v_req.id LIMIT 1;

    IF v_doc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff_documents WHERE id = v_doc_id AND staff_id = v_staff_id) THEN
      RAISE EXCEPTION 'Choose documents from your own library' USING ERRCODE = 'check_violation';
    END IF;

    IF v_doc_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM center_staff_document_status s
      WHERE s.center_id = v_job.center_id AND s.staff_id = v_staff_id AND s.requirement_id = v_req.id
        AND (s.status::text IN ('accepted', 'pending_review') OR s.not_applicable)
    ) THEN
      v_missing := v_missing || v_req.document_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Still needed to apply: %', array_to_string(v_missing, ', ') USING ERRCODE = 'check_violation';
  END IF;

  -- The applicant's link to the center: reuse it (never downgrade an active row) or create it
  SELECT * INTO v_cs FROM center_staff WHERE center_id = v_job.center_id AND staff_id = v_staff_id;
  IF v_cs.id IS NULL THEN
    INSERT INTO center_staff (center_id, staff_id, status, requested_employment_class)
    VALUES (v_job.center_id, v_staff_id, 'applying', 'regular')
    RETURNING * INTO v_cs;
  ELSIF v_cs.status::text IN ('removed', 'inactive') THEN
    UPDATE center_staff SET status = 'applying', requested_employment_class = 'regular' WHERE id = v_cs.id RETURNING * INTO v_cs;
  ELSIF v_cs.status::text IN ('applying', 'invited') THEN
    UPDATE center_staff SET requested_employment_class = 'regular' WHERE id = v_cs.id RETURNING * INTO v_cs;
  END IF;

  -- One application per job; a withdrawn one can be submitted again
  SELECT * INTO v_existing FROM job_applications WHERE job_id = p_job_id AND staff_id = v_staff_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.stage <> 'withdrawn' THEN
      RAISE EXCEPTION 'You have already applied for this job' USING ERRCODE = 'unique_violation';
    END IF;
    DELETE FROM job_application_documents WHERE application_id = v_existing.id;
    PERFORM set_config('carelocal.stage_note', 'Applied again', true);
    UPDATE job_applications SET stage = 'applied', cover_note = NULLIF(trim(COALESCE(p_cover_note, '')), ''),
      resume_document_id = p_resume_document_id, center_staff_id = v_cs.id, applied_at = now(), decided_at = NULL,
      offer_start_date = NULL, offer_pay = NULL, offer_note = NULL, offer_sent_at = NULL, readiness = '{}'
    WHERE id = v_existing.id;
    v_app_id := v_existing.id;
  ELSE
    INSERT INTO job_applications (job_id, center_id, staff_id, center_staff_id, cover_note, resume_document_id)
    VALUES (p_job_id, v_job.center_id, v_staff_id, v_cs.id, NULLIF(trim(COALESCE(p_cover_note, '')), ''), p_resume_document_id)
    RETURNING id INTO v_app_id;
  END IF;

  -- Share documents for the job's items only; never relink an item already accepted or in review
  FOR v_req IN
    SELECT jr.requirement_id, (i ->> 'document_id')::uuid AS document_id
    FROM job_posting_requirements jr
    LEFT JOIN LATERAL (
      SELECT i FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
      WHERE (i ->> 'requirement_id')::uuid = jr.requirement_id LIMIT 1
    ) x ON true
    WHERE jr.job_id = p_job_id
  LOOP
    IF v_req.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM staff_documents WHERE id = v_req.document_id AND staff_id = v_staff_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM center_staff_document_status s
        WHERE s.center_id = v_job.center_id AND s.staff_id = v_staff_id AND s.requirement_id = v_req.requirement_id
          AND s.status::text IN ('accepted', 'pending_review')
      ) THEN
        INSERT INTO center_staff_document_status (center_id, staff_id, requirement_id, matched_document_id, status, center_reviewed)
        VALUES (v_job.center_id, v_staff_id, v_req.requirement_id, v_req.document_id, 'pending_review', false)
        ON CONFLICT (center_id, staff_id, requirement_id) DO UPDATE
          SET matched_document_id = EXCLUDED.matched_document_id, status = 'pending_review', center_reviewed = false;
      END IF;
      INSERT INTO job_application_documents (application_id, requirement_id, document_id, expiry_at_apply)
      SELECT v_app_id, v_req.requirement_id, d.id, d.expiry_date FROM staff_documents d WHERE d.id = v_req.document_id
      ON CONFLICT (application_id, requirement_id) DO NOTHING;
    ELSE
      -- Already on file at this center: record what was used
      INSERT INTO job_application_documents (application_id, requirement_id, document_id, expiry_at_apply)
      SELECT v_app_id, v_req.requirement_id, s.matched_document_id, d.expiry_date
      FROM center_staff_document_status s LEFT JOIN staff_documents d ON d.id = s.matched_document_id
      WHERE s.center_id = v_job.center_id AND s.staff_id = v_staff_id AND s.requirement_id = v_req.requirement_id
        AND s.matched_document_id IS NOT NULL
      ON CONFLICT (application_id, requirement_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_app_id;
END;
$$;

-- Staff: withdraw before being hired
CREATE OR REPLACE FUNCTION public.withdraw_job_application(p_app_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage IN ('hired', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'This application is already closed' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE job_applications SET stage = 'withdrawn', decided_at = now() WHERE id = p_app_id;
END;
$$;

-- Admin: move between applied / reviewing / interview, or reject (reason stays internal)
CREATE OR REPLACE FUNCTION public.move_application_stage(p_app_id uuid, p_stage text, p_note text, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_center_admin(v_app.center_id) OR public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_stage NOT IN ('applied', 'reviewing', 'interview', 'rejected') THEN
    RAISE EXCEPTION 'Use Send offer to make an offer; a hire happens when the applicant accepts' USING ERRCODE = 'check_violation';
  END IF;
  IF v_app.stage NOT IN ('applied', 'reviewing', 'interview') THEN
    RAISE EXCEPTION 'This application can no longer be moved' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carelocal.stage_note',
    NULLIF(trim(concat_ws(' · ', NULLIF(trim(COALESCE(p_note, '')), ''),
      CASE WHEN p_stage = 'rejected' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NOT NULL THEN 'Reason: ' || trim(p_reason) END)), ''),
    true);
  UPDATE job_applications
  SET stage = p_stage, decided_at = CASE WHEN p_stage = 'rejected' THEN now() ELSE decided_at END
  WHERE id = p_app_id;
END;
$$;

-- Admin: send an offer. Every apply item must be accepted or in review; offer items become requests.
CREATE OR REPLACE FUNCTION public.send_job_offer(p_app_id uuid, p_start_date date, p_pay numeric, p_note text)
RETURNS integer   -- number of document requests raised
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applications%ROWTYPE;
  v_missing text[];
  v_count integer := 0;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_center_admin(v_app.center_id) OR public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage NOT IN ('applied', 'reviewing', 'interview') THEN
    RAISE EXCEPTION 'This application has already moved on' USING ERRCODE = 'check_violation';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'Choose a start date for the offer' USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(r.document_name ORDER BY r.document_name) INTO v_missing
  FROM job_posting_requirements jr
  JOIN center_document_requirements r ON r.id = jr.requirement_id
  LEFT JOIN center_staff_document_status s
    ON s.center_id = v_app.center_id AND s.staff_id = v_app.staff_id AND s.requirement_id = jr.requirement_id
  WHERE jr.job_id = v_app.job_id AND jr.needed_at = 'apply'
    AND NOT (COALESCE(s.status::text, '') IN ('accepted', 'pending_review') OR COALESCE(s.not_applicable, false));
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Before an offer, these need to be accepted or in review: %', array_to_string(v_missing, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carelocal.stage_note', NULLIF(trim(COALESCE(p_note, '')), ''), true);
  UPDATE job_applications
  SET stage = 'offer', offer_start_date = p_start_date, offer_pay = p_pay,
      offer_note = NULLIF(trim(COALESCE(p_note, '')), ''), offer_sent_at = now()
  WHERE id = p_app_id;

  -- Offer-stage items the person does not have yet become document requests
  INSERT INTO document_requests (center_id, staff_id, requirement_id, title, is_confidential, requested_by)
  SELECT v_app.center_id, v_app.staff_id, r.id, r.document_name, r.is_confidential, auth.uid()
  FROM job_posting_requirements jr
  JOIN center_document_requirements r ON r.id = jr.requirement_id
  WHERE jr.job_id = v_app.job_id AND jr.needed_at = 'offer'
    AND NOT EXISTS (
      SELECT 1 FROM center_staff_document_status s
      WHERE s.center_id = v_app.center_id AND s.staff_id = v_app.staff_id AND s.requirement_id = r.id
        AND (s.status::text IN ('accepted', 'pending_review') OR s.not_applicable))
    AND NOT EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.staff_id = v_app.staff_id AND dr.requirement_id = r.id AND dr.status IN ('open', 'submitted'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Staff: accept the offer. One transaction: hire, close other applications, raise start items, fill the job.
CREATE OR REPLACE FUNCTION public.accept_job_offer(p_app_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applications%ROWTYPE;
  v_job job_postings%ROWTYPE;
  v_other_centers text;
  v_hired integer;
  v_filled boolean := false;
  v_withdrawn uuid[];
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage <> 'offer' THEN
    RAISE EXCEPTION 'There is no open offer on this application' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_job FROM job_postings WHERE id = v_app.job_id FOR UPDATE;

  -- A regular works at one center: active links elsewhere must end first
  SELECT string_agg(c.name, ', ') INTO v_other_centers
  FROM center_staff cs JOIN centers c ON c.id = cs.center_id
  WHERE cs.staff_id = v_app.staff_id AND cs.center_id <> v_app.center_id AND cs.status::text IN ('active', 'inactive');
  IF v_other_centers IS NOT NULL THEN
    RAISE EXCEPTION 'Before accepting, leave your other center(s) from My Centers: %', v_other_centers
      USING ERRCODE = 'check_violation';
  END IF;

  -- The hire (the guards honour this flag for the rest of the transaction only)
  PERFORM set_config('carelocal.hiring', 'on', true);
  UPDATE center_staff
  SET status = 'active', employment_class = 'regular', requested_employment_class = 'regular',
      employment_start_date = COALESCE(v_app.offer_start_date, v_job.start_date, current_date)
  WHERE id = v_app.center_staff_id;

  PERFORM set_config('carelocal.stage_note', 'Offer accepted', true);
  UPDATE job_applications SET stage = 'hired', decided_at = now() WHERE id = p_app_id;

  -- Other open applications close; their applying links end on the usual 30-day rule
  PERFORM set_config('carelocal.stage_note', 'Withdrawn automatically: hired elsewhere', true);
  WITH closed AS (
    UPDATE job_applications SET stage = 'withdrawn', decided_at = now()
    WHERE staff_id = v_app.staff_id AND id <> p_app_id AND stage IN ('applied', 'reviewing', 'interview', 'offer')
    RETURNING id
  )
  SELECT array_agg(id) INTO v_withdrawn FROM closed;

  -- Start-stage items become requests
  INSERT INTO document_requests (center_id, staff_id, requirement_id, title, is_confidential, requested_by)
  SELECT v_app.center_id, v_app.staff_id, r.id, r.document_name, r.is_confidential, v_job.created_by
  FROM job_posting_requirements jr
  JOIN center_document_requirements r ON r.id = jr.requirement_id
  WHERE jr.job_id = v_app.job_id AND jr.needed_at = 'start'
    AND NOT EXISTS (
      SELECT 1 FROM center_staff_document_status s
      WHERE s.center_id = v_app.center_id AND s.staff_id = v_app.staff_id AND s.requirement_id = r.id
        AND (s.status::text IN ('accepted', 'pending_review') OR s.not_applicable))
    AND NOT EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.staff_id = v_app.staff_id AND dr.requirement_id = r.id AND dr.status IN ('open', 'submitted'));

  -- Fill the job when its openings are hired
  SELECT count(*) INTO v_hired FROM job_applications WHERE job_id = v_app.job_id AND stage = 'hired';
  IF v_hired >= v_job.openings AND v_job.status <> 'filled' THEN
    UPDATE job_postings SET status = 'filled' WHERE id = v_job.id;
    v_filled := true;
  END IF;

  RETURN jsonb_build_object(
    'center_id', v_app.center_id, 'staff_id', v_app.staff_id, 'job_id', v_app.job_id,
    'filled', v_filled, 'withdrawn_application_ids', COALESCE(to_jsonb(v_withdrawn), '[]'::jsonb)
  );
END;
$$;

-- Staff: decline the offer (counts as a withdrawal)
CREATE OR REPLACE FUNCTION public.decline_job_offer(p_app_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM job_applications WHERE id = p_app_id FOR UPDATE;
  IF v_app.id IS NULL OR NOT public.is_own_staff(v_app.staff_id) THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.stage <> 'offer' THEN
    RAISE EXCEPTION 'There is no open offer on this application' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('carelocal.stage_note', COALESCE('Offer declined: ' || NULLIF(trim(COALESCE(p_note, '')), ''), 'Offer declined'), true);
  UPDATE job_applications SET stage = 'withdrawn', decided_at = now() WHERE id = p_app_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_to_job(uuid, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_job_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_application_stage(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_job_offer(uuid, date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_job_offer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_job_offer(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_post_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_job_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_application_stage(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_job_offer(uuid, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_job_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_job_offer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_post_limit(uuid) TO authenticated;
