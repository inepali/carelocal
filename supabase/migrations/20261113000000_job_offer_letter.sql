-- Offer letter: the center can attach a letter to an offer. The applicant opens it from Applications,
-- and an offer with a letter can only be accepted once the applicant has opened it.

-- 1. Columns ---------------------------------------------------------------------------------------
ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS offer_letter_file_key    text,
  ADD COLUMN IF NOT EXISTS offer_letter_bucket_name text,
  ADD COLUMN IF NOT EXISTS offer_letter_file_name   text,
  ADD COLUMN IF NOT EXISTS offer_letter_viewed_at   timestamptz;   -- first time the applicant opened it

-- 2. Send offer (now with an optional letter) ------------------------------------------------------
DROP FUNCTION IF EXISTS public.send_job_offer(uuid, date, numeric, text);

CREATE OR REPLACE FUNCTION public.send_job_offer(
  p_app_id uuid, p_start_date date, p_pay numeric, p_note text,
  p_letter_key text DEFAULT NULL, p_letter_bucket text DEFAULT NULL, p_letter_name text DEFAULT NULL
)
RETURNS integer   -- number of document requests raised
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app job_applications%ROWTYPE;
  v_missing text[];
  v_count integer := 0;
  v_prefix text;
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

  -- The letter must sit in this center's offer_letter/ folder
  v_prefix := 'offer_letter/' || v_app.center_id || '/';
  IF p_letter_key IS NOT NULL AND left(p_letter_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
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
      offer_note = NULLIF(trim(COALESCE(p_note, '')), ''), offer_sent_at = now(),
      offer_letter_file_key = p_letter_key,
      offer_letter_bucket_name = CASE WHEN p_letter_key IS NULL THEN NULL ELSE p_letter_bucket END,
      offer_letter_file_name = CASE WHEN p_letter_key IS NULL THEN NULL ELSE NULLIF(trim(COALESCE(p_letter_name, '')), '') END,
      offer_letter_viewed_at = NULL
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

REVOKE ALL ON FUNCTION public.send_job_offer(uuid, date, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_job_offer(uuid, date, numeric, text, text, text, text) TO authenticated;

-- 3. Applicant opened the letter (called when they open it) ----------------------------------------
CREATE OR REPLACE FUNCTION public.mark_offer_letter_viewed(p_app_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE job_applications
  SET offer_letter_viewed_at = COALESCE(offer_letter_viewed_at, now())
  WHERE id = p_app_id AND public.is_own_staff(staff_id) AND offer_letter_file_key IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_offer_letter_viewed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_offer_letter_viewed(uuid) TO authenticated;

-- 4. Letter rules on every stage change ------------------------------------------------------------
-- An offer with a letter is accepted only after the applicant opened it; re-applying clears the old letter.
CREATE OR REPLACE FUNCTION public.guard_job_offer_letter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'hired' AND OLD.stage = 'offer'
     AND NEW.offer_letter_file_key IS NOT NULL AND NEW.offer_letter_viewed_at IS NULL THEN
    RAISE EXCEPTION 'Open and review the offer letter before accepting' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.stage = 'applied' AND OLD.stage <> 'applied' THEN
    NEW.offer_letter_file_key := NULL;
    NEW.offer_letter_bucket_name := NULL;
    NEW.offer_letter_file_name := NULL;
    NEW.offer_letter_viewed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_job_offer_letter ON public.job_applications;
CREATE TRIGGER trg_guard_job_offer_letter
  BEFORE UPDATE OF stage ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_offer_letter();

-- 5. Access log accepts offer letters --------------------------------------------------------------
ALTER TABLE public.document_access_log DROP CONSTRAINT IF EXISTS document_access_log_document_kind_check;
ALTER TABLE public.document_access_log ADD CONSTRAINT document_access_log_document_kind_check
  CHECK (document_kind IN ('vault', 'internal', 'template', 'inspection', 'offer_letter'));
