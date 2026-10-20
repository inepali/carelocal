-- Regular hiring: an applicant can only move to Interview with an interview scheduled
-- (date + time, and where). Rescheduling keeps the stage and updates the details.

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_location text,      -- address, phone number or video link
  ADD COLUMN IF NOT EXISTS interview_note text;          -- shown to the applicant (what to bring, who to ask for)

-- Admin: schedule (or reschedule) the interview; moves the application to Interview
CREATE OR REPLACE FUNCTION public.schedule_job_interview(p_app_id uuid, p_at timestamptz, p_location text, p_note text)
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
  IF v_app.stage NOT IN ('applied', 'reviewing', 'interview') THEN
    RAISE EXCEPTION 'This application can no longer be moved to Interview' USING ERRCODE = 'check_violation';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'Choose the interview date and time' USING ERRCODE = 'check_violation';
  END IF;
  IF NULLIF(trim(COALESCE(p_location, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Add where the interview takes place' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carelocal.stage_note',
    CASE WHEN v_app.stage = 'interview' THEN 'Interview rescheduled' ELSE 'Interview scheduled' END, true);
  UPDATE job_applications
  SET stage = 'interview', interview_at = p_at, interview_location = trim(p_location),
      interview_note = NULLIF(trim(COALESCE(p_note, '')), '')
  WHERE id = p_app_id;

  -- A reschedule keeps the stage, so record it in the history explicitly
  IF v_app.stage = 'interview' THEN
    INSERT INTO job_application_events (application_id, from_stage, to_stage, actor_id, note)
    VALUES (p_app_id, 'interview', 'interview', auth.uid(), 'Interview rescheduled');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_job_interview(uuid, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_job_interview(uuid, timestamptz, text, text) TO authenticated;

-- Moving to Interview now always goes through schedule_job_interview
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
  IF p_stage = 'interview' THEN
    RAISE EXCEPTION 'Schedule the interview (date, time and place) to move an applicant to Interview' USING ERRCODE = 'check_violation';
  END IF;
  IF p_stage NOT IN ('applied', 'reviewing', 'rejected') THEN
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
