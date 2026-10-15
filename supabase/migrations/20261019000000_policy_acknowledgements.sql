-- ============================================================
-- Phase 2: digital policy acknowledgements
--  * Requirements fulfilled by acknowledgement carry a policy version. When the
--    policy changes the center bumps the version and everyone must acknowledge again.
--  * Staff acknowledge through acknowledge_requirement(): records who, when, which
--    version and a typed signature, and completes the item without a review step.
-- ============================================================

ALTER TABLE public.center_document_requirements
  ADD COLUMN IF NOT EXISTS policy_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS policy_updated_at timestamptz;

ALTER TABLE public.center_staff_document_status
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_version integer,
  ADD COLUMN IF NOT EXISTS acknowledged_signature text;

-- Trusted server-side writes (the RPC below) bypass the staff field guard.
CREATE OR REPLACE FUNCTION public.guard_document_status_admin_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR current_setting('app.trusted_status_write', true) = 'on'
     OR (public.is_center_admin(NEW.center_id) AND NOT public.is_own_staff(NEW.staff_id)) THEN
    RETURN NEW;
  END IF;

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
    NEW.acknowledged_at := NULL;
    NEW.acknowledged_version := NULL;
    NEW.acknowledged_signature := NULL;
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_notes := OLD.review_notes;
    NEW.completed_on := OLD.completed_on;
    NEW.hours := OLD.hours;
    NEW.expires_on := OLD.expires_on;
    NEW.not_applicable := OLD.not_applicable;
    NEW.not_applicable_reason := OLD.not_applicable_reason;
    NEW.acknowledged_at := OLD.acknowledged_at;
    NEW.acknowledged_version := OLD.acknowledged_version;
    NEW.acknowledged_signature := OLD.acknowledged_signature;
  END IF;
  RETURN NEW;
END;
$$;

-- Staff acknowledge a policy / plan for their own record
CREATE OR REPLACE FUNCTION public.acknowledge_requirement(p_requirement_id uuid, p_signature text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req record;
  v_staff_id uuid;
BEGIN
  IF coalesce(trim(p_signature), '') = '' THEN
    RAISE EXCEPTION 'Type your full name to sign' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, center_id, evidence_type, policy_version INTO v_req
  FROM center_document_requirements WHERE id = p_requirement_id;
  IF v_req.id IS NULL OR v_req.evidence_type <> 'acknowledgement' THEN
    RAISE EXCEPTION 'This item cannot be acknowledged' USING ERRCODE = 'check_violation';
  END IF;

  SELECT cs.staff_id INTO v_staff_id
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE cs.center_id = v_req.center_id AND sp.user_id = auth.uid() AND cs.status::text <> 'removed';
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'You are not an employee of this center' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('app.trusted_status_write', 'on', true);

  INSERT INTO center_staff_document_status AS s (
    center_id, staff_id, requirement_id, status, center_reviewed, completed_on,
    acknowledged_at, acknowledged_version, acknowledged_signature
  ) VALUES (
    v_req.center_id, v_staff_id, v_req.id, 'accepted', false, current_date,
    now(), v_req.policy_version, trim(p_signature)
  )
  ON CONFLICT (center_id, staff_id, requirement_id) DO UPDATE SET
    status = 'accepted',
    completed_on = current_date,
    acknowledged_at = now(),
    acknowledged_version = EXCLUDED.acknowledged_version,
    acknowledged_signature = EXCLUDED.acknowledged_signature,
    not_applicable = false;

  PERFORM set_config('app.trusted_status_write', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_requirement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_requirement(uuid, text) TO authenticated;

-- Center: the policy changed, everyone must acknowledge again
CREATE OR REPLACE FUNCTION public.publish_policy_update(p_requirement_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version integer;
BEGIN
  UPDATE center_document_requirements
  SET policy_version = policy_version + 1, policy_updated_at = now()
  WHERE id = p_requirement_id
    AND evidence_type = 'acknowledgement'
    AND public.is_center_admin(center_id)
  RETURNING policy_version INTO v_version;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'Requirement not found' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_policy_update(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_policy_update(uuid) TO authenticated;
