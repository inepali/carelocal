-- ============================================================
-- Phase 3: requesting documents from staff
--  * A center requests a checklist item or any ad-hoc document from one or many
--    employees, with a message and due date.
--  * Staff answer from their document library; only that document is shared.
--  * Requests tied to a checklist item flow into the normal review: accepting the
--    item completes the request, rejecting it reopens the request with the note.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES public.center_document_requirements(id) ON DELETE SET NULL,
  title text NOT NULL,
  message text,
  due_date date,
  is_confidential boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'completed', 'cancelled')),
  submitted_document_id uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  staff_note text,
  center_note text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_requests_center ON public.document_requests(center_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_requests_staff ON public.document_requests(staff_id, status);

ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Center admins read requests" ON public.document_requests;
CREATE POLICY "Center admins read requests"
  ON public.document_requests FOR SELECT
  USING (public.is_center_admin(center_id));

DROP POLICY IF EXISTS "Staff read their requests" ON public.document_requests;
CREATE POLICY "Staff read their requests"
  ON public.document_requests FOR SELECT
  USING (public.is_own_staff(staff_id));

-- All writes go through the functions below.

-- Center admins can open documents submitted to their requests (confidential rule applies)
DROP POLICY IF EXISTS "Center admins can view requested staff documents" ON public.staff_documents;
CREATE POLICY "Center admins can view requested staff documents"
  ON public.staff_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.document_requests dr
      WHERE dr.submitted_document_id = public.staff_documents.id
        AND public.is_center_admin(dr.center_id)
        AND (dr.is_confidential = false OR public.can_view_confidential(dr.center_id))
    )
  );

-- A document submitted to a request is part of the center's records
CREATE OR REPLACE FUNCTION public.protect_accepted_staff_document()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM center_staff_document_status WHERE matched_document_id = OLD.id AND status::text = 'accepted')
     OR EXISTS (SELECT 1 FROM document_requests WHERE submitted_document_id = OLD.id AND status = 'completed') THEN
    RAISE EXCEPTION 'This document was accepted by a center and is part of its records, so it cannot be deleted. Link a newer document to replace it.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- ── Center: create requests ────────────────────────────────────────────────────
-- One request per employee; skips employees who already have an open/submitted
-- request for the same checklist item. Returns the ids created.
CREATE OR REPLACE FUNCTION public.create_document_requests(
  p_center_id uuid,
  p_staff_ids uuid[],
  p_requirement_id uuid,
  p_title text,
  p_message text,
  p_due_date date
)
RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_confidential boolean := false;
BEGIN
  IF NOT public.is_center_admin(p_center_id) THEN
    RAISE EXCEPTION 'Only center admins can request documents' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_requirement_id IS NOT NULL THEN
    SELECT coalesce(v_title, document_name), is_confidential INTO v_title, v_confidential
    FROM center_document_requirements WHERE id = p_requirement_id AND center_id = p_center_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Checklist item not found' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Describe the document you are requesting' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  INSERT INTO document_requests (center_id, staff_id, requirement_id, title, message, due_date, is_confidential, requested_by)
  SELECT p_center_id, cs.staff_id, p_requirement_id, v_title, nullif(trim(coalesce(p_message, '')), ''), p_due_date, v_confidential, auth.uid()
  FROM center_staff cs
  WHERE cs.center_id = p_center_id
    AND cs.staff_id = ANY (p_staff_ids)
    AND cs.status::text NOT IN ('removed', 'inactive')
    AND NOT public.is_own_staff(cs.staff_id)
    AND (p_requirement_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM document_requests dr
      WHERE dr.staff_id = cs.staff_id AND dr.requirement_id = p_requirement_id AND dr.status IN ('open', 'submitted')
    ))
  RETURNING id;
END;
$$;

-- ── Staff: answer a request with a document from their library ─────────────────
CREATE OR REPLACE FUNCTION public.submit_document_request(p_request_id uuid, p_document_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req document_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM document_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR NOT public.is_own_staff(v_req.staff_id) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_req.status NOT IN ('open', 'submitted') THEN
    RAISE EXCEPTION 'This request is already closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_documents WHERE id = p_document_id AND staff_id = v_req.staff_id) THEN
    RAISE EXCEPTION 'Choose a document from your own library' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE document_requests
  SET status = 'submitted', submitted_document_id = p_document_id, submitted_at = now(),
      staff_note = nullif(trim(coalesce(p_note, '')), '')
  WHERE id = p_request_id;

  -- Checklist item: link the document for the normal review (status forced to pending_review)
  IF v_req.requirement_id IS NOT NULL THEN
    INSERT INTO center_staff_document_status (center_id, staff_id, requirement_id, matched_document_id, status, center_reviewed)
    VALUES (v_req.center_id, v_req.staff_id, v_req.requirement_id, p_document_id, 'pending_review', false)
    ON CONFLICT (center_id, staff_id, requirement_id) DO UPDATE
      SET matched_document_id = EXCLUDED.matched_document_id, status = 'pending_review', center_reviewed = false;
  END IF;
END;
$$;

-- ── Center: resolve an ad-hoc request, or cancel any request ─────────────────────
CREATE OR REPLACE FUNCTION public.resolve_document_request(p_request_id uuid, p_action text, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req document_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM document_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR NOT public.is_center_admin(v_req.center_id) OR public.is_own_staff(v_req.staff_id) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_action = 'accept' THEN
    IF v_req.status <> 'submitted' THEN
      RAISE EXCEPTION 'Nothing has been submitted yet' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE document_requests SET status = 'completed', center_note = nullif(trim(coalesce(p_note, '')), ''),
      resolved_by = auth.uid(), resolved_at = now()
    WHERE id = p_request_id;
  ELSIF p_action = 'reject' THEN
    IF coalesce(trim(p_note), '') = '' THEN
      RAISE EXCEPTION 'Add a note so the employee knows what to send instead' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE document_requests SET status = 'open', center_note = trim(p_note), submitted_document_id = NULL, submitted_at = NULL
    WHERE id = p_request_id;
  ELSIF p_action = 'cancel' THEN
    UPDATE document_requests SET status = 'cancelled', resolved_by = auth.uid(), resolved_at = now()
    WHERE id = p_request_id AND status IN ('open', 'submitted');
  ELSE
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ── Keep checklist-linked requests in step with the checklist review ─────────────
CREATE OR REPLACE FUNCTION public.sync_requests_with_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'accepted' OR NEW.not_applicable THEN
    UPDATE document_requests
    SET status = 'completed', resolved_by = auth.uid(), resolved_at = now()
    WHERE staff_id = NEW.staff_id AND requirement_id = NEW.requirement_id AND status IN ('open', 'submitted');
  ELSIF NEW.status::text = 'rejected' THEN
    UPDATE document_requests
    SET status = 'open', center_note = NEW.review_notes, submitted_document_id = NULL, submitted_at = NULL
    WHERE staff_id = NEW.staff_id AND requirement_id = NEW.requirement_id AND status = 'submitted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_requests_with_review ON public.center_staff_document_status;
CREATE TRIGGER trg_sync_requests_with_review
  AFTER INSERT OR UPDATE OF status, not_applicable ON public.center_staff_document_status
  FOR EACH ROW EXECUTE FUNCTION public.sync_requests_with_review();

REVOKE ALL ON FUNCTION public.create_document_requests(uuid, uuid[], uuid, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_document_request(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_document_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_document_requests(uuid, uuid[], uuid, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_document_request(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_document_request(uuid, text, text) TO authenticated;
