-- Stand-ins for the Supabase and CareLocal objects the tuition migration uses (see tuition.test.sql)
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;   -- as on Supabase
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, timezone text);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE TABLE public.center_programs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name text NOT NULL, is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.work_areas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name text NOT NULL, program_id uuid REFERENCES center_programs(id) ON DELETE SET NULL);
CREATE TABLE public.children (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  first_name text NOT NULL, last_name text NOT NULL DEFAULT 'X', classroom_id uuid REFERENCES work_areas(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'enrolled', enrolled_on date NOT NULL DEFAULT current_date, withdrawn_on date, UNIQUE (id, center_id));
CREATE TABLE public.child_guardians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL,
  name text NOT NULL, relationship text, email text, is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES children (id, center_id) ON DELETE CASCADE);
CREATE TABLE public.child_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL,
  file_name text NOT NULL, category text NOT NULL DEFAULT 'record', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES children (id, center_id) ON DELETE CASCADE);
CREATE TABLE public.child_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  table_name text NOT NULL, row_id uuid, action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')), changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(), changed_fields text[] NOT NULL DEFAULT '{}', summary text);

CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.roster_today(p_center_id uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York'))::date $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_confidential(uuid), public.roster_today(uuid) TO authenticated, service_role;
