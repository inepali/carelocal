-- Stand-ins for the Supabase and CareLocal objects the center roles migration uses (see roles.test.sql)
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.center_admins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, center_id uuid NOT NULL REFERENCES centers(id),
  role text NOT NULL DEFAULT 'admin', UNIQUE (center_id, user_id));
ALTER TABLE public.center_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can see their own admin records" ON public.center_admins FOR SELECT USING (user_id = auth.uid());
CREATE TABLE public.staff_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, first_name text, staff_type text);
CREATE TABLE public.center_staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id), status text NOT NULL DEFAULT 'active',
  employment_class text NOT NULL DEFAULT 'substitute', UNIQUE (center_id, staff_id));

CREATE FUNCTION public.revoke_admin_when_not_regular() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_revoke_admin_when_not_regular AFTER UPDATE OF employment_class, status ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.revoke_admin_when_not_regular();

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Two centers. Users: o=owner (registered, no staff profile), d=director-to-be, t=teacher, s=substitute, x=outsider
INSERT INTO centers (id, name, created_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Sunny', now() - interval '1 year'),
  ('10000000-0000-0000-0000-000000000002', 'Other', now() - interval '1 year');
INSERT INTO center_admins (user_id, center_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-0000000000ff', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO staff_profiles (id, user_id, first_name, staff_type) VALUES
  ('c0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000d', 'Dana', 'teacher'),
  ('c0000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-00000000000e', 'Eve', 'teacher'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'Sam', 'floater'),
  ('c0000000-0000-0000-0000-0000000000ff', 'a0000000-0000-0000-0000-0000000000ff', 'Otto', 'admin');
INSERT INTO center_staff (center_id, staff_id, employment_class) VALUES
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000d', 'regular'),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', 'regular'),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'substitute'),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000ff', 'regular');
