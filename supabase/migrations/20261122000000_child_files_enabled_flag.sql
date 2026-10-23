-- Child Files switch: a center cannot store child records until a super admin turns the module on for it
-- (the way job postings launched). Later this is switched on when the owner accepts the child records data
-- addendum. Until then nobody, not even the center's owner, can read or write child rows, even through the API.
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS child_files_enabled boolean NOT NULL DEFAULT false;

-- Only super admins and server jobs can change the switch
CREATE OR REPLACE FUNCTION public.guard_child_files_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.child_files_enabled IS NOT DISTINCT FROM OLD.child_files_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.child_files_enabled := OLD.child_files_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_child_files_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_child_files_flag ON public.centers;
CREATE TRIGGER trg_guard_child_files_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_child_files_flag();

-- The one gate every child policy uses: the caller is the center's owner or admin AND the module is on.
-- False for everyone else, so it reveals nothing about other centers.
CREATE OR REPLACE FUNCTION public.can_use_child_files(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_confidential(p_center_id)
     AND COALESCE((SELECT c.child_files_enabled FROM centers c WHERE c.id = p_center_id), false);
$$;
REVOKE ALL ON FUNCTION public.can_use_child_files(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_child_files(uuid) TO authenticated;   -- row-level security runs as the caller

-- Re-point every child policy at the combined gate
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['children', 'child_guardians', 'child_documents', 'child_files'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_use_child_files(center_id))', 'Owners and admins read ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins add ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_use_child_files(center_id))', 'Owners and admins add ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins change ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_use_child_files(center_id)) WITH CHECK (public.can_use_child_files(center_id))', 'Owners and admins change ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins delete ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_use_child_files(center_id))', 'Owners and admins delete ' || t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Owners and admins read child_audit_log" ON public.child_audit_log;
CREATE POLICY "Owners and admins read child_audit_log" ON public.child_audit_log
  FOR SELECT TO authenticated USING (public.can_use_child_files(center_id));
