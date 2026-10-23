-- Child Files, Phase 1a: the tables that hold a center's enrolled children and their records.
--
-- SECURITY MODEL (read before changing anything here)
--  * Every policy uses can_view_confidential(center_id): the center's OWNER and ADMIN roles only.
--    Never use is_center_admin() here (it is true for any center_admins row), never add a super-admin
--    policy (platform staff do not browse minors' records), and never add a policy for staff or parents.
--  * Child rows are linked by composite foreign keys (child_id, center_id), so a row can never point at a
--    child of another center.
--  * The audit trail is written by triggers only. Nobody can insert, change or delete it from the app.
--  * Files live under child/<center>/<child>/ in their own storage bucket (R2_CHILD_BUCKET).
-- Tested by scripts/rls/child-access.test.mjs (run against the dev database only).

-- 1. Requirement rules: child rules live in their own sections ---------------------------------------
ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_section_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_section_check
  CHECK (section IN ('personnel', 'health', 'training', 'health_safety', 'policies', 'evaluations')
         OR section LIKE 'custom:%'
         OR section LIKE 'child\_%' ESCAPE '\');

-- A rule is a child rule exactly when it sits in a child section
ALTER TABLE public.center_document_requirements DROP CONSTRAINT IF EXISTS cdr_audience_section_check;
ALTER TABLE public.center_document_requirements ADD CONSTRAINT cdr_audience_section_check
  CHECK ((audience = 'child') = (section LIKE 'child\_%' ESCAPE '\'));

-- 2. Children ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.children (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id              uuid NOT NULL REFERENCES public.centers(id) ON DELETE RESTRICT,   -- purge deliberately, never by cascade
  first_name             text NOT NULL CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 80),
  last_name              text NOT NULL CHECK (char_length(btrim(last_name)) BETWEEN 1 AND 80),
  preferred_name         text CHECK (preferred_name IS NULL OR char_length(preferred_name) <= 80),   -- "the name the child is to be called" (.0801(a)(2))
  date_of_birth          date NOT NULL CHECK (date_of_birth > DATE '1990-01-01'),
  classroom_id           uuid REFERENCES public.work_areas(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'withdrawn')),
  enrolled_on            date NOT NULL DEFAULT current_date,
  first_attended_on      date,                      -- starts the 30-day immunization and health assessment windows
  withdrawn_on           date,                      -- starts the 1-year retention clock (10A NCAC 09 .2318)
  immunization_status    text NOT NULL DEFAULT 'missing'
                           CHECK (immunization_status IN ('missing', 'complete', 'in_progress', 'medical_exemption', 'religious_exemption')),
  custody_restriction    boolean NOT NULL DEFAULT false,
  custody_note           text CHECK (custody_note IS NULL OR char_length(custody_note) <= 1000),
  source_tour_request_id uuid REFERENCES public.center_tour_requests(id) ON DELETE SET NULL,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id),
  CONSTRAINT children_withdrawn_has_date CHECK (status = 'enrolled' OR withdrawn_on IS NOT NULL),
  CONSTRAINT children_withdrawn_after_enrolled CHECK (withdrawn_on IS NULL OR withdrawn_on >= enrolled_on)
);
CREATE INDEX IF NOT EXISTS idx_children_center_status ON public.children (center_id, status);
CREATE INDEX IF NOT EXISTS idx_children_center_name ON public.children (center_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_children_withdrawn ON public.children (withdrawn_on) WHERE withdrawn_on IS NOT NULL;

-- 3. Guardians and authorized pick-up contacts --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.child_guardians (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id            uuid NOT NULL,
  child_id             uuid NOT NULL,
  name                 text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  relationship         text CHECK (relationship IS NULL OR char_length(relationship) <= 60),
  phone                text CHECK (phone IS NULL OR char_length(phone) <= 30),
  email                text CHECK (email IS NULL OR char_length(email) <= 254),
  is_primary           boolean NOT NULL DEFAULT false,
  is_emergency_contact boolean NOT NULL DEFAULT false,
  can_pick_up          boolean NOT NULL DEFAULT false,     -- release a child only to someone explicitly authorized (.0801(c))
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_child_guardians_child ON public.child_guardians (child_id);

-- 4. Per-child record status (mirrors center_staff_document_status) ----------------------------------
CREATE TABLE IF NOT EXISTS public.child_documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id            uuid NOT NULL,
  child_id             uuid NOT NULL,
  requirement_id       uuid NOT NULL REFERENCES public.center_document_requirements(id) ON DELETE CASCADE,
  status               public.doc_review_status NOT NULL DEFAULT 'missing',
  completed_on         date,
  expires_on           date,
  due_on               date,                                -- center-set due date (for example a physician extension)
  not_applicable       boolean NOT NULL DEFAULT false,
  not_applicable_reason text CHECK (not_applicable_reason IS NULL OR char_length(not_applicable_reason) <= 500),
  acknowledged_version integer,                             -- unused for children; keeps the shape computeCompliance reads
  review_notes         text CHECK (review_notes IS NULL OR char_length(review_notes) <= 1000),
  reviewed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (child_id, requirement_id),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_child_documents_center ON public.child_documents (center_id, status);

-- 5. Uploaded files ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.child_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid NOT NULL,
  child_id       uuid NOT NULL,
  requirement_id uuid REFERENCES public.center_document_requirements(id) ON DELETE SET NULL,   -- null = not filed yet
  file_key       text NOT NULL,
  bucket_name    text NOT NULL,
  file_name      text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  content_type   text,
  size_bytes     integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
  source         text NOT NULL DEFAULT 'center' CHECK (source IN ('center', 'parent')),
  uploaded_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_child_files_child ON public.child_files (child_id, requirement_id);

-- 6. Audit trail: who changed pick-up, custody, status or files, and when -----------------------------
CREATE TABLE IF NOT EXISTS public.child_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid NOT NULL REFERENCES public.centers(id) ON DELETE RESTRICT,
  child_id       uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  table_name     text NOT NULL,
  row_id         uuid,
  action         text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- null when the server itself made the change
  changed_at     timestamptz NOT NULL DEFAULT now(),
  changed_fields text[] NOT NULL DEFAULT '{}',
  summary        text                                                  -- names and flags only, never health details
);
CREATE INDEX IF NOT EXISTS idx_child_audit_child ON public.child_audit_log (child_id, changed_at DESC);

-- 7. Access log learns about children ------------------------------------------------------------------
ALTER TABLE public.document_access_log
  ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES public.children(id) ON DELETE SET NULL;
ALTER TABLE public.document_access_log DROP CONSTRAINT IF EXISTS document_access_log_document_kind_check;
ALTER TABLE public.document_access_log ADD CONSTRAINT document_access_log_document_kind_check
  CHECK (document_kind IN ('vault', 'internal', 'template', 'inspection', 'offer_letter', 'child'));
CREATE INDEX IF NOT EXISTS idx_document_access_log_child
  ON public.document_access_log (child_id, created_at DESC) WHERE child_id IS NOT NULL;

-- 8. Rules enforced in the database --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_child_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.center_id <> OLD.center_id THEN
    RAISE EXCEPTION 'A child cannot move to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.classroom_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_areas w WHERE w.id = NEW.classroom_id AND w.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'That classroom belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;

-- Plan limit: trial centers have everything; Starter is capped; Growth and above are unlimited.
-- (Change the number here and nowhere else.)
CREATE OR REPLACE FUNCTION public.child_limit(p_center_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN c.subscription_status::text = 'trialing' THEN NULL
    WHEN c.subscription_tier::text = 'starter' THEN 25
    ELSE NULL
  END FROM centers c WHERE c.id = p_center_id;
$$;

CREATE OR REPLACE FUNCTION public.enforce_child_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit integer;
BEGIN
  IF NEW.status = 'enrolled' AND (TG_OP = 'INSERT' OR OLD.status <> 'enrolled') THEN
    v_limit := public.child_limit(NEW.center_id);
    IF v_limit IS NOT NULL AND (
      SELECT count(*) FROM children WHERE center_id = NEW.center_id AND status = 'enrolled' AND id <> NEW.id
    ) >= v_limit THEN
      RAISE EXCEPTION 'Your plan includes up to % enrolled children. Upgrade to enroll more.', v_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.check_child_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audience text; v_center uuid;
BEGIN
  IF NEW.requirement_id IS NULL THEN RETURN NEW; END IF;
  SELECT audience, center_id INTO v_audience, v_center FROM center_document_requirements WHERE id = NEW.requirement_id;
  IF v_audience IS DISTINCT FROM 'child' OR v_center IS DISTINCT FROM NEW.center_id THEN
    RAISE EXCEPTION 'That is not a child requirement of this center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.check_child_file_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text := 'child/' || NEW.center_id || '/' || NEW.child_id || '/';
BEGIN
  IF left(NEW.file_key, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'File key is outside the allowed storage location' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Audit: field names and flags only. Skipped while a cascade is removing a child's rows.
CREATE OR REPLACE FUNCTION public.log_child_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_child uuid; v_center uuid; v_row uuid;
  v_fields text[] := '{}'; v_summary text; v_req text; k text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW);
  ELSE v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_child := COALESCE(v_new, v_old)->>'id';
  ELSE
    v_child := COALESCE(v_new, v_old)->>'child_id';
  END IF;
  v_center := COALESCE(v_new, v_old)->>'center_id';
  v_row := COALESCE(v_new, v_old)->>'id';

  IF NOT EXISTS (SELECT 1 FROM children WHERE id = v_child) THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k <> 'updated_at' AND (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN v_fields := v_fields || k; END IF;
    END LOOP;
    IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF TG_TABLE_NAME = 'children' THEN
    v_summary := CASE WHEN TG_OP = 'INSERT' THEN 'Child added' ELSE 'Changed: ' || array_to_string(v_fields, ', ') END;
  ELSIF TG_TABLE_NAME = 'child_guardians' THEN
    v_summary := CASE TG_OP
      WHEN 'INSERT' THEN 'Added ' || (v_new->>'name') || CASE WHEN (v_new->>'can_pick_up')::boolean THEN ', authorized to pick up' ELSE '' END
      WHEN 'DELETE' THEN 'Removed ' || (v_old->>'name')
      ELSE (v_new->>'name') || ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'can_pick_up' = ANY (v_fields)
                   THEN CASE WHEN (v_new->>'can_pick_up')::boolean THEN ' (pick-up authorized)' ELSE ' (pick-up removed)' END
                   ELSE '' END
    END;
  ELSIF TG_TABLE_NAME = 'child_documents' THEN
    SELECT document_name INTO v_req FROM center_document_requirements WHERE id = (COALESCE(v_new, v_old)->>'requirement_id')::uuid;
    v_summary := COALESCE(v_req, 'Record') || CASE TG_OP
      WHEN 'INSERT' THEN ': record created'
      WHEN 'DELETE' THEN ': record removed'
      ELSE ': ' || array_to_string(v_fields, ', ')
           || CASE WHEN 'status' = ANY (v_fields) THEN ' (' || (v_old->>'status') || ' to ' || (v_new->>'status') || ')' ELSE '' END
    END;
  ELSE  -- child_files
    v_summary := CASE TG_OP WHEN 'INSERT' THEN 'File added: ' WHEN 'DELETE' THEN 'File removed: ' ELSE 'File changed: ' END
                 || COALESCE(v_new->>'file_name', v_old->>'file_name');
  END IF;

  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, changed_fields, summary)
  VALUES (v_center, v_child, TG_TABLE_NAME, v_row, lower(TG_OP), auth.uid(), v_fields, left(v_summary, 300));
  RETURN NULL;
END $$;

-- 9. Triggers ------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_guard_child_row ON public.children;
CREATE TRIGGER trg_guard_child_row BEFORE INSERT OR UPDATE ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.guard_child_row();
DROP TRIGGER IF EXISTS trg_enforce_child_limit ON public.children;
CREATE TRIGGER trg_enforce_child_limit BEFORE INSERT OR UPDATE OF status ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_limit();
DROP TRIGGER IF EXISTS trg_check_child_document_requirement ON public.child_documents;
CREATE TRIGGER trg_check_child_document_requirement BEFORE INSERT OR UPDATE OF requirement_id, center_id ON public.child_documents
  FOR EACH ROW EXECUTE FUNCTION public.check_child_requirement();
DROP TRIGGER IF EXISTS trg_check_child_file_requirement ON public.child_files;
CREATE TRIGGER trg_check_child_file_requirement BEFORE INSERT OR UPDATE OF requirement_id, center_id ON public.child_files
  FOR EACH ROW EXECUTE FUNCTION public.check_child_requirement();
DROP TRIGGER IF EXISTS trg_check_child_file_key ON public.child_files;
CREATE TRIGGER trg_check_child_file_key BEFORE INSERT OR UPDATE OF file_key ON public.child_files
  FOR EACH ROW EXECUTE FUNCTION public.check_child_file_key();

DROP TRIGGER IF EXISTS set_updated_at ON public.children;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.children FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.child_guardians;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.child_guardians FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.child_documents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.child_documents FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_audit_children ON public.children;
CREATE TRIGGER trg_audit_children AFTER INSERT OR UPDATE ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
DROP TRIGGER IF EXISTS trg_audit_child_guardians ON public.child_guardians;
CREATE TRIGGER trg_audit_child_guardians AFTER INSERT OR UPDATE OR DELETE ON public.child_guardians
  FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
DROP TRIGGER IF EXISTS trg_audit_child_documents ON public.child_documents;
CREATE TRIGGER trg_audit_child_documents AFTER INSERT OR UPDATE OR DELETE ON public.child_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
DROP TRIGGER IF EXISTS trg_audit_child_files ON public.child_files;
CREATE TRIGGER trg_audit_child_files AFTER INSERT OR UPDATE OR DELETE ON public.child_files
  FOR EACH ROW EXECUTE FUNCTION public.log_child_change();

-- 10. Row-level security: owner and admin of the child's center, nobody else -----------------------------
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['children', 'child_guardians', 'child_documents', 'child_files'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_confidential(center_id))', 'Owners and admins read ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins add ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_view_confidential(center_id))', 'Owners and admins add ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins change ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_view_confidential(center_id)) WITH CHECK (public.can_view_confidential(center_id))', 'Owners and admins change ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins delete ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_view_confidential(center_id))', 'Owners and admins delete ' || t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- The audit trail is read-only for the app
DROP POLICY IF EXISTS "Owners and admins read child_audit_log" ON public.child_audit_log;
CREATE POLICY "Owners and admins read child_audit_log" ON public.child_audit_log
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
REVOKE ALL ON public.child_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.child_audit_log TO authenticated;
