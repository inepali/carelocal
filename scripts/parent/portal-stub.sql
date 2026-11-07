-- Stand-ins for the Supabase and CareLocal objects the parent portal migration uses (see portal.test.sql).
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, email text, phone text, timezone text,
  domain_key text DEFAULT 'childcare', is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE TABLE public.children (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  first_name text NOT NULL, preferred_name text, date_of_birth date NOT NULL DEFAULT '2023-01-01', status text NOT NULL DEFAULT 'enrolled',
  photo_key text, UNIQUE (id, center_id));
CREATE TABLE public.child_guardians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL,
  name text NOT NULL, email text, is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES children (id, center_id) ON DELETE CASCADE);
CREATE TABLE public.child_daily_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid, child_id uuid, service_date date,
  kind text, at timestamptz DEFAULT now(), ends_at timestamptz, details jsonb DEFAULT '{}', nap_id uuid, voided_at timestamptz, approved_at timestamptz);
CREATE TABLE public.roster_events (child_id uuid, service_date date, action text, at timestamptz DEFAULT now());
CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.roster_today(p_center_id uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York'))::date $$;
CREATE FUNCTION public.roster_timezone(p_center_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York') $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_confidential(uuid) TO authenticated;
