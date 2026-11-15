-- Stand-ins for the Supabase and CareLocal objects 20270107000000_center_guardians.sql uses (see center-guardians.test.sql).
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY, name text, child_files_enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE TABLE public.children (id uuid PRIMARY KEY, center_id uuid NOT NULL REFERENCES centers(id), first_name text NOT NULL, UNIQUE (id, center_id));
CREATE TABLE public.child_guardians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL,
  name text NOT NULL, relationship text, phone text, email text, is_primary boolean NOT NULL DEFAULT false,
  can_pick_up boolean NOT NULL DEFAULT false, daily_report boolean NOT NULL DEFAULT false, can_message boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES children (id, center_id) ON DELETE CASCADE);
CREATE TABLE public.child_audit_log (child_id uuid, row_id uuid, action text, changed_fields text[]);
CREATE FUNCTION public.log_child_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO child_audit_log VALUES (COALESCE(NEW.child_id, OLD.child_id), COALESCE(NEW.id, OLD.id), lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN ARRAY(SELECT k FROM jsonb_object_keys(to_jsonb(NEW)) k
      WHERE k <> 'updated_at' AND to_jsonb(NEW) -> k IS DISTINCT FROM to_jsonb(OLD) -> k) ELSE '{}' END);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_audit_child_guardians AFTER INSERT OR UPDATE OR DELETE ON public.child_guardians
  FOR EACH ROW EXECUTE FUNCTION public.log_child_change();
CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.can_use_child_files(p_center_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_confidential(p_center_id) AND COALESCE((SELECT c.child_files_enabled FROM centers c WHERE c.id = p_center_id), false) $$;
ALTER TABLE public.child_guardians ENABLE ROW LEVEL SECURITY;
CREATE POLICY cg_all ON public.child_guardians TO authenticated USING (public.can_use_child_files(center_id)) WITH CHECK (public.can_use_child_files(center_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Fixtures that exist BEFORE the migration (the one-time copy runs on these)
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
INSERT INTO centers VALUES ('10000000-0000-0000-0000-000000000001', 'A', true), ('10000000-0000-0000-0000-000000000002', 'B', true),
                           ('10000000-0000-0000-0000-000000000003', 'Off', false);
INSERT INTO center_admins VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'owner'),
                                 ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'staff');
INSERT INTO children VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Maya'),
                            ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Leo'),
                            ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'B kid');
INSERT INTO child_guardians (id, center_id, child_id, name, relationship, phone, email, daily_report, can_pick_up) VALUES
  -- Mom on both siblings, same details up to case and spacing: one entry
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Ana Ruiz', 'Mother', '704-555-0101', 'ana@x.com', true, true),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'ana ruiz ', 'Mother', '(704) 555 0101', ' Ana@X.com', true, false),
  -- Grandpa: phone only
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Joe Ruiz', 'Grandfather', '704-555-0199', NULL, false, true),
  -- Neighbor: no phone, no email, stays unlinked
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Neighbor', NULL, NULL, NULL, false, false),
  -- Same name and email at center B: a separate entry for B
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', 'Ana Ruiz', NULL, NULL, 'ana@x.com', false, false);
TRUNCATE child_audit_log;   -- only what the migration writes counts
