-- About page content for centers: programs, leadership team bios, and free-form additional info.

CREATE TABLE IF NOT EXISTS public.center_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_range TEXT,
  schedule TEXT,
  capacity INTEGER,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.center_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  bio TEXT,
  email TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.center_about_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS center_programs_center_id_idx ON public.center_programs(center_id);
CREATE INDEX IF NOT EXISTS center_team_members_center_id_idx ON public.center_team_members(center_id);
CREATE INDEX IF NOT EXISTS center_about_items_center_id_idx ON public.center_about_items(center_id);

ALTER TABLE public.center_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_about_items ENABLE ROW LEVEL SECURITY;

-- Center admins manage their own center's About content.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['center_programs', 'center_team_members', 'center_about_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'Center admins can manage ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL
         USING (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))
         WITH CHECK (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))',
        'Center admins can manage ' || t, t
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'Super admins can manage ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL
         USING (((auth.jwt() -> ''app_metadata'' ->> ''is_super_admin'')::boolean = true))',
        'Super admins can manage ' || t, t
      );
    END IF;
  END LOOP;
END $$;
