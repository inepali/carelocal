-- A substitute cannot claim a shift while a document the shift's center requires is expired, rejected or overdue.
--
-- staff_claim_blockers() applies the same rules as computeCompliance() in src/lib/compliance.ts, keeping only the
-- states that mean "not in good standing": overdue, rejected, expired. A document waiting for review does not block,
-- unless the file attached to it is itself past its expiry date. Optional documents and center-only records never block.
-- The trigger enforces it for the staff member's own claims; centers confirming or assigning staff are not gated.

CREATE OR REPLACE FUNCTION public.staff_claim_blockers(p_staff_id uuid, p_center_id uuid)
RETURNS TABLE (requirement_id uuid, document_name text, reason text, due_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH rel AS (
    SELECT cs.employment_class::text AS employment_class, cs.employment_start_date
    FROM center_staff cs
    WHERE cs.center_id = p_center_id AND cs.staff_id = p_staff_id
  ),
  me AS (
    SELECT COALESCE((SELECT employment_class FROM rel), 'substitute') AS cls,
           (SELECT employment_start_date FROM rel) AS start_date
  )
  SELECT x.id, x.document_name, x.reason, x.due
  FROM (
    SELECT
      r.id,
      r.document_name,
      r.sort_order,
      COALESCE(c.next_due, c.initial_due, d.expiry_date) AS due,
      CASE
        WHEN s.status::text = 'expired' THEN 'expired'
        WHEN s.status::text = 'rejected' THEN 'rejected'
        WHEN s.status::text = 'accepted' THEN
          CASE
            WHEN r.renewal_type = 'policy_change' AND s.acknowledged_version IS NOT NULL
                 AND r.policy_version > s.acknowledged_version
                 AND COALESCE(s.due_on, r.policy_updated_at::date, CURRENT_DATE) < CURRENT_DATE THEN 'policy_changed'
            WHEN c.next_due < CURRENT_DATE THEN
              CASE WHEN r.renewal_type = 'document_expiry' THEN 'expired' ELSE 'renewal_due' END
          END
        WHEN s.status::text = 'pending_review' THEN
          CASE WHEN d.expiry_date < CURRENT_DATE THEN 'expired' END
        ELSE
          CASE WHEN c.initial_due < CURRENT_DATE THEN 'missing' END
      END AS reason
    FROM center_document_requirements r
    CROSS JOIN me
    LEFT JOIN center_staff_document_status s
      ON s.center_id = r.center_id AND s.staff_id = p_staff_id AND s.requirement_id = r.id
    LEFT JOIN staff_documents d ON d.id = s.matched_document_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(s.due_on, CASE WHEN me.start_date IS NOT NULL AND r.due_within_days IS NOT NULL
                                THEN me.start_date + r.due_within_days END) AS initial_due,
        CASE WHEN s.status::text = 'accepted' THEN
          COALESCE(
            s.due_on,
            CASE
              WHEN r.renewal_type = 'interval' AND r.renewal_months > 0
                THEN (COALESCE(s.completed_on, s.reviewed_at::date) + make_interval(months => r.renewal_months))::date
              WHEN r.renewal_type = 'document_expiry' THEN COALESCE(s.expires_on, d.expiry_date)
            END)
        END AS next_due
    ) c ON true
    WHERE r.center_id = p_center_id
      AND r.audience = 'staff'
      AND COALESCE(r.is_internal, false) = false
      AND r.evidence_type <> 'center_record'
      -- "if applicable" items only count once the staff member has a record for them
      AND (r.is_required OR (r.is_conditional AND s.id IS NOT NULL))
      AND (r.applies_to_class IS NULL OR cardinality(r.applies_to_class) = 0 OR me.cls = ANY (r.applies_to_class))
      AND COALESCE(s.not_applicable, false) = false
  ) x
  WHERE x.reason IS NOT NULL
  ORDER BY x.sort_order, x.document_name;
$$;

-- The checker takes any staff id, so it is not callable from the app; the wrapper below answers only for the caller.
REVOKE ALL ON FUNCTION public.staff_claim_blockers(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_claim_blockers(p_center_id uuid)
RETURNS TABLE (requirement_id uuid, document_name text, reason text, due_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.requirement_id, b.document_name, b.reason, b.due_on
  FROM staff_profiles sp
  CROSS JOIN LATERAL public.staff_claim_blockers(sp.id, p_center_id) b
  WHERE sp.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_claim_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_claim_blockers(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_shift_claim_documents()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_center uuid;
  v_list text;
BEGIN
  -- Only a new commitment is gated: interest, withdrawing, cancelling and the center's confirmation are not
  IF NEW.status::text <> 'pending' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'pending' THEN RETURN NEW; END IF;

  -- Only the staff member claiming for themselves; centers and the service role act on their behalf
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_profiles WHERE id = NEW.staff_id AND user_id = auth.uid()) THEN RETURN NEW; END IF;

  SELECT center_id INTO v_center FROM shifts WHERE id = NEW.shift_id;
  IF v_center IS NULL THEN RETURN NEW; END IF;

  SELECT string_agg(b.document_name || ' (' || replace(b.reason, '_', ' ') || ')', ', ')
  INTO v_list
  FROM public.staff_claim_blockers(NEW.staff_id, v_center) b;

  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'You cannot claim this shift until these required documents are fixed: %', v_list
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_shift_claim_documents ON public.shift_claims;
CREATE TRIGGER trg_guard_shift_claim_documents
  BEFORE INSERT OR UPDATE OF status ON public.shift_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_shift_claim_documents();
