-- "Getting started" checklist for new staff.
--  * The super admin adds a state (per vertical) when CareLocal rolls out there, and lists the documents staff need
--    in that state. Nothing is preloaded.
--  * Each staff member ticks items off by hand: five profile tasks that live in the app, plus the documents of their
--    own state. The list is informational: it reviews nothing and gates nothing.

CREATE TABLE IF NOT EXISTS public.onboarding_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code  text NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  domain_key  text NOT NULL CHECK (domain_key IN ('childcare', 'senior', 'healthcare')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_code, domain_key)
);

CREATE TABLE IF NOT EXISTS public.state_required_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id       uuid NOT NULL REFERENCES public.onboarding_states(id) ON DELETE CASCADE,
  document_name  text NOT NULL CHECK (char_length(btrim(document_name)) BETWEEN 1 AND 200),
  instructions   text CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  link_url       text CHECK (link_url IS NULL OR (link_url ~* '^https?://' AND char_length(link_url) <= 500)),
  is_required    boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS state_required_docs_state_idx ON public.state_required_docs (state_id, sort_order);

-- One row per ticked item: a row means done, deleting it unticks. Exactly one of task / doc_id is set.
CREATE TABLE IF NOT EXISTS public.staff_onboarding_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  task          text CHECK (task IN ('profile', 'id', 'education', 'credentials', 'availability')),
  doc_id        uuid REFERENCES public.state_required_docs(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((task IS NOT NULL) <> (doc_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_onboarding_task_unique ON public.staff_onboarding_items (staff_id, task) WHERE task IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_onboarding_doc_unique  ON public.staff_onboarding_items (staff_id, doc_id) WHERE doc_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.onboarding_states;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.onboarding_states FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.state_required_docs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.state_required_docs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.onboarding_states      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_required_docs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_onboarding_items ENABLE ROW LEVEL SECURITY;

-- Super admin writes states and their documents; every signed-in user may read them (staff see their own state's list)
DROP POLICY IF EXISTS "Super admins manage onboarding states" ON public.onboarding_states;
CREATE POLICY "Super admins manage onboarding states" ON public.onboarding_states FOR ALL TO authenticated
  USING (COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false))
  WITH CHECK (COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false));
DROP POLICY IF EXISTS "Signed-in users read onboarding states" ON public.onboarding_states;
CREATE POLICY "Signed-in users read onboarding states" ON public.onboarding_states FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super admins manage state required docs" ON public.state_required_docs;
CREATE POLICY "Super admins manage state required docs" ON public.state_required_docs FOR ALL TO authenticated
  USING (COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false))
  WITH CHECK (COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false));
DROP POLICY IF EXISTS "Signed-in users read state required docs" ON public.state_required_docs;
CREATE POLICY "Signed-in users read state required docs" ON public.state_required_docs FOR SELECT TO authenticated USING (true);

-- A staff member ticks and unticks only their own items; the super admin can look at (and fix) anyone's
DROP POLICY IF EXISTS "Staff manage their own onboarding items" ON public.staff_onboarding_items;
CREATE POLICY "Staff manage their own onboarding items" ON public.staff_onboarding_items FOR ALL TO authenticated
  USING (staff_id IN (SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()))
  WITH CHECK (staff_id IN (SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Super admins manage onboarding items" ON public.staff_onboarding_items;
CREATE POLICY "Super admins manage onboarding items" ON public.staff_onboarding_items FOR ALL TO authenticated
  USING (COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false))
  WITH CHECK (COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false));
