-- Staff can leave a center they belong to (e.g. a substitute who is about to accept a regular job
-- elsewhere: accept_job_offer requires every other active link to end first).
--
-- Leaving ends the link (status 'removed') and withdraws pending shift requests there. It is refused
-- while the person still has work booked or open business at that center:
--   - an upcoming confirmed shift (the center must reassign it; staff cannot cancel confirmed shifts),
--   - an open job application there (withdraw it first),
--   - an admin role there (another admin removes it first, so a center is never left without one).

CREATE OR REPLACE FUNCTION public.leave_center(p_center_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_link center_staff%ROWTYPE;
  v_center centers%ROWTYPE;
  v_today date;
  v_shifts text;
  v_cancelled integer := 0;
BEGIN
  SELECT id INTO v_staff_id FROM staff_profiles WHERE user_id = auth.uid();
  SELECT * INTO v_link FROM center_staff
  WHERE staff_id = v_staff_id AND center_id = p_center_id AND status::text IN ('active', 'inactive')
  FOR UPDATE;
  IF v_staff_id IS NULL OR v_link.id IS NULL THEN
    RAISE EXCEPTION 'You are not part of this center' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_center FROM centers WHERE id = p_center_id;

  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'You are an admin at %. Ask another admin to remove your admin access before you leave', v_center.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM job_applications
    WHERE staff_id = v_staff_id AND center_id = p_center_id AND stage IN ('applied', 'reviewing', 'interview', 'offer')
  ) THEN
    RAISE EXCEPTION 'You have an open job application at %. Withdraw it from Applications before you leave', v_center.name
      USING ERRCODE = 'check_violation';
  END IF;

  -- "Upcoming" in the center's own time zone
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(v_center.timezone, ''), 'America/New_York'))::date;
  SELECT string_agg(to_char(s.shift_date, 'Mon FMDD'), ', ' ORDER BY s.shift_date) INTO v_shifts
  FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
  WHERE sc.staff_id = v_staff_id AND s.center_id = p_center_id
    AND sc.status::text = 'confirmed' AND s.status::text <> 'cancelled' AND s.shift_date >= v_today;
  IF v_shifts IS NOT NULL THEN
    RAISE EXCEPTION 'You are booked for shifts at % (%). Ask the center to reassign them before you leave', v_center.name, v_shifts
      USING ERRCODE = 'check_violation';
  END IF;

  -- Pending shift requests there are withdrawn
  UPDATE shift_claims sc
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Left the center'
  FROM shifts s
  WHERE sc.shift_id = s.id AND s.center_id = p_center_id AND sc.staff_id = v_staff_id
    AND sc.status::text IN ('pending', 'interested');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE center_staff SET status = 'removed' WHERE id = v_link.id;

  RETURN jsonb_build_object('center_name', v_center.name, 'domain_key', v_center.domain_key, 'cancelled_claims', v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_center(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_center(uuid) TO authenticated;

-- Apply to join a center again after leaving (or after a declined application): the (center, staff)
-- row already exists, so it goes back to 'applying' instead of being inserted.
CREATE OR REPLACE FUNCTION public.reapply_to_center(p_center_id uuid, p_class text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
BEGIN
  SELECT id INTO v_staff_id FROM staff_profiles WHERE user_id = auth.uid();
  UPDATE center_staff
  SET status = 'applying',
      requested_employment_class = CASE WHEN p_class IN ('regular', 'substitute') THEN p_class ELSE requested_employment_class END
  WHERE staff_id = v_staff_id AND center_id = p_center_id AND status::text = 'removed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no earlier link with this center to reopen' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reapply_to_center(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reapply_to_center(uuid, text) TO authenticated;
