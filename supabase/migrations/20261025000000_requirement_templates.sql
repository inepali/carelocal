-- Requirement templates: a super admin exports one center's document-requirement checklist
-- as a template; admins of other centers (same vertical) import it into their own checklist.
-- Items are stored as JSON rules only (no staff data, no attached files, no role restrictions,
-- which are specific to each center).
CREATE TABLE IF NOT EXISTS public.requirement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  domain_key text NOT NULL DEFAULT 'childcare',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_center_id uuid REFERENCES public.centers(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.requirement_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read requirement templates" ON public.requirement_templates;
CREATE POLICY "Authenticated users can read requirement templates"
  ON public.requirement_templates FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Super admins manage requirement templates" ON public.requirement_templates;
CREATE POLICY "Super admins manage requirement templates"
  ON public.requirement_templates FOR ALL TO authenticated
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true))
  WITH CHECK (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));
