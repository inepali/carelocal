-- Compliance review: a center admin can set an item's due date by hand (e.g. an extension, or a
-- deadline agreed with the employee). When set it replaces the calculated due date (start date +
-- due_within_days, or the next renewal); clearing it goes back to the calculation.

ALTER TABLE public.center_staff_document_status
  ADD COLUMN IF NOT EXISTS due_on date;

-- Staff writes keep due_on as it was, like the other admin-only fields (from 20261019000000).
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
    NEW.due_on := NULL;
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
    NEW.due_on := OLD.due_on;
    NEW.not_applicable := OLD.not_applicable;
    NEW.not_applicable_reason := OLD.not_applicable_reason;
    NEW.acknowledged_at := OLD.acknowledged_at;
    NEW.acknowledged_version := OLD.acknowledged_version;
    NEW.acknowledged_signature := OLD.acknowledged_signature;
  END IF;
  RETURN NEW;
END;
$$;
