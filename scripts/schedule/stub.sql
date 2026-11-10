-- Stand-ins for the Supabase and CareLocal objects the staff schedule migration uses (see fixed.test.sql)
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
CREATE TABLE public.staff_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, first_name text, last_name text, avatar_url text);
CREATE TABLE public.work_areas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name text NOT NULL, is_active boolean DEFAULT true, sort_order integer NOT NULL DEFAULT 0, on_roster boolean NOT NULL DEFAULT true);
CREATE TABLE public.center_staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'active',
  employment_class text NOT NULL DEFAULT 'substitute', home_work_area_id uuid REFERENCES work_areas(id) ON DELETE SET NULL);

CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.is_center_regular_staff(p_center_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
    WHERE sp.user_id = auth.uid() AND cs.center_id = p_center_id AND cs.status = 'active' AND cs.employment_class = 'regular') $$;
CREATE FUNCTION public.roster_today(p_center_id uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York'))::date $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_confidential(uuid), public.is_center_regular_staff(uuid), public.roster_today(uuid) TO authenticated, service_role;
