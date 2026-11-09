-- Extra stand-ins the announcements migration needs on top of scripts/parent/portal-stub.sql (see
-- scripts/announcements/announcements.test.sql for how to run them).
CREATE TABLE public.work_areas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id), name text NOT NULL);
ALTER TABLE public.children ADD COLUMN classroom_id uuid REFERENCES public.work_areas(id);
ALTER TABLE public.staff_profiles ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ADD COLUMN email text;
CREATE TABLE public.center_staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id), status text NOT NULL DEFAULT 'active',
  employment_class text NOT NULL DEFAULT 'substitute');
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
