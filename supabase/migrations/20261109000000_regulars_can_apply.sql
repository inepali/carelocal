-- Regular hiring: a regular employee may apply for jobs at other centers.
-- They still work at one center at a time: accepting an offer elsewhere requires leaving their current
-- center first (accept_job_offer), and nobody can become active at a second center while they are a
-- regular somewhere (the trigger below now checks activation, not the application itself).

-- 1. Single-center rule: block becoming active/inactive (not applying) at another center
CREATE OR REPLACE FUNCTION public.enforce_regular_single_center()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'removed' THEN
    RETURN NEW;
  END IF;

  -- Joining (becoming active or inactive) while a regular employee elsewhere
  IF NEW.status::text IN ('active', 'inactive')
     AND (TG_OP = 'INSERT' OR OLD.status::text NOT IN ('active', 'inactive'))
     AND EXISTS (
       SELECT 1 FROM center_staff
       WHERE staff_id = NEW.staff_id
         AND center_id <> NEW.center_id
         AND employment_class = 'regular'
         AND status::text IN ('active', 'inactive')
     ) THEN
    RAISE EXCEPTION 'This staff member is a regular employee at another center and must leave it before joining another one'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Becoming regular while associated with another center
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

-- 2. apply_to_job without the "regular elsewhere" refusal (metro and other checks unchanged)
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

  IF NOT public.job_center_in_my_metro(v_job.center_id) THEN
    RAISE EXCEPTION 'This job is not available in your metro area' USING ERRCODE = 'check_violation';
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
