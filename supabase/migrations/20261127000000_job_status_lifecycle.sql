-- ============================================================
-- Job lifecycle:  draft -> published <-> paused -> closed -> archived
--                              \-> filled -> (reopen) published
--  * A filled job can be reopened by the center (it becomes published again).
--  * A paused job can be resumed any time until it is filled or closed.
--  * A closed job is final: it can never be reopened, only archived.
--  * Archived is final and just hides the job from the center's list.
--  * Hiring from a closed job (still allowed) never changes its status.
-- ============================================================

ALTER TABLE public.job_postings DROP CONSTRAINT IF EXISTS job_postings_status_check;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'closed', 'filled', 'archived'));

CREATE OR REPLACE FUNCTION public.guard_job_posting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
    IF NEW.status = 'archived' THEN
      RAISE EXCEPTION 'Only a closed job can be archived' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.center_id := OLD.center_id;                  -- a posting never moves between centers

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'archived' THEN
        RAISE EXCEPTION 'An archived job cannot be changed' USING ERRCODE = 'check_violation';
      ELSIF OLD.status = 'closed' THEN
        IF NEW.status = 'filled' AND public.hiring_in_progress() THEN
          NEW.status := 'closed';                    -- hiring from a closed job does not reopen it
        ELSIF NEW.status <> 'archived' THEN
          RAISE EXCEPTION 'A closed job cannot be reopened. Post a new job instead, or archive this one.' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.status = 'archived' AND OLD.status <> 'closed' THEN
        RAISE EXCEPTION 'Only a closed job can be archived' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- "filled" only comes from a hire
  IF NEW.status = 'filled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'filled') AND NOT public.hiring_in_progress() THEN
    RAISE EXCEPTION 'A job is marked filled automatically when its openings are hired' USING ERRCODE = 'check_violation';
  END IF;

  -- Publishing (paused -> published does not add an active posting; a reopened filled job does)
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
