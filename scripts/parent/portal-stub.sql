-- Stand-ins for the Supabase and CareLocal objects the parent portal migrations use (see portal.test.sql and
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;   -- as on Supabase
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, email text, phone text, timezone text,
  domain_key text DEFAULT 'childcare', is_active boolean NOT NULL DEFAULT true,
  roster_enabled boolean NOT NULL DEFAULT true, child_files_enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE TABLE public.children (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  first_name text NOT NULL, preferred_name text, date_of_birth date NOT NULL DEFAULT '2023-01-01', status text NOT NULL DEFAULT 'enrolled',
  photo_key text, UNIQUE (id, center_id));
CREATE TABLE public.child_guardians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL,
  name text NOT NULL, relationship text, email text, is_primary boolean NOT NULL DEFAULT false, can_pick_up boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
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
CREATE TABLE public.staff_profiles (user_id uuid, first_name text, last_name text);
CREATE FUNCTION public.is_center_regular_staff(p_center_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.can_use_roster(p_center_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (public.can_view_confidential(p_center_id) OR public.is_center_regular_staff(p_center_id))
     AND COALESCE((SELECT c.roster_enabled AND c.child_files_enabled FROM centers c WHERE c.id = p_center_id), false) $$;
CREATE FUNCTION public.daily_person_label(p_user uuid, p_center_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_user IS NULL THEN NULL ELSE COALESCE(
    (SELECT sp.first_name || ' ' || left(sp.last_name, 1) || '.' FROM staff_profiles sp WHERE sp.user_id = p_user LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM center_admins a WHERE a.user_id = p_user AND a.center_id = p_center_id) THEN 'Director' END, 'Staff') END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_confidential(uuid) TO authenticated;
