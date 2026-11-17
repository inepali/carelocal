-- ============================================================
-- Allergies on the child file (Medicines & Allergy tab).
--  - A Manage Data list 'Allergy' (center_lookups, childcare only) with common defaults. Center admins rename,
--    reorder, deactivate or add allergies in About → Manage Data; the Allergy card picks from the active list.
--  - child_allergies: one row per allergy for a child, entered by the owner or an admin: the allergen (the list
--    label, saved as text, ≤ 60), how serious, the reaction, and what to do. Like medicines, an allergy is removed
--    (active = false), never deleted, and every change is logged in the child's Activity.
--  - The same allergen can be on a child only once while active.
-- Rollback: supabase/rollbacks/20270119000000_child_allergies.down.sql
-- ============================================================

-- 1. The Manage Data list ---------------------------------------------------------------------------------------
INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key)
SELECT NULL, 'Allergy', t.label, t.value, true, t.sort_order, 'childcare'
FROM (VALUES
  ('Peanuts',              'peanuts',      1),
  ('Tree nuts',            'tree_nuts',    2),
  ('Milk / Dairy',         'milk',         3),
  ('Eggs',                 'eggs',         4),
  ('Wheat / Gluten',       'wheat',        5),
  ('Soy',                  'soy',          6),
  ('Fish',                 'fish',         7),
  ('Shellfish',            'shellfish',    8),
  ('Sesame',               'sesame',       9),
  ('Penicillin',           'penicillin',   10),
  ('Sulfa drugs',          'sulfa',        11),
  ('Bee / insect stings',  'insect_stings', 12),
  ('Latex',                'latex',        13),
  ('Pollen / Seasonal',    'pollen',       14),
  ('Pet dander',           'pet_dander',   15),
  ('Food dyes',            'food_dyes',    16)
) AS t(label, value, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.center_lookups cl
  WHERE cl.center_id IS NULL AND cl.group_name = 'Allergy' AND cl.value = t.value AND cl.domain_key = 'childcare'
);

-- 2. Allergies -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.child_allergies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id    uuid NOT NULL,
  child_id     uuid NOT NULL,
  allergen     text NOT NULL CHECK (char_length(btrim(allergen)) BETWEEN 1 AND 60),
  severity     text NOT NULL DEFAULT 'moderate' CHECK (severity IN ('mild', 'moderate', 'severe', 'life_threatening')),
  reaction     text CHECK (reaction IS NULL OR char_length(reaction) <= 200),       -- e.g. hives, swelling, trouble breathing
  action_plan  text CHECK (action_plan IS NULL OR char_length(action_plan) <= 500), -- e.g. give EpiPen, call 911 and the parent
  active       boolean NOT NULL DEFAULT true,                                       -- false = removed
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS child_allergies_child_idx ON public.child_allergies (child_id);
CREATE UNIQUE INDEX IF NOT EXISTS child_allergies_once ON public.child_allergies (child_id, lower(btrim(allergen))) WHERE active;

CREATE OR REPLACE FUNCTION public.child_allergies_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS child_allergies_touch ON public.child_allergies;
CREATE TRIGGER child_allergies_touch BEFORE UPDATE ON public.child_allergies FOR EACH ROW EXECUTE FUNCTION public.child_allergies_touch();

ALTER TABLE public.child_allergies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners and admins read child_allergies" ON public.child_allergies;
CREATE POLICY "Owners and admins read child_allergies" ON public.child_allergies
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins add child_allergies" ON public.child_allergies;
CREATE POLICY "Owners and admins add child_allergies" ON public.child_allergies
  FOR INSERT TO authenticated WITH CHECK (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins change child_allergies" ON public.child_allergies;
CREATE POLICY "Owners and admins change child_allergies" ON public.child_allergies
  FOR UPDATE TO authenticated USING (public.can_view_confidential(center_id)) WITH CHECK (public.can_view_confidential(center_id));
REVOKE ALL ON public.child_allergies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.child_allergies TO authenticated;   -- no DELETE: removed, never deleted
GRANT ALL ON public.child_allergies TO service_role;

-- 3. Activity log ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.child_allergies_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sev text := replace(NEW.severity, '_', '-'); v_fields text[]; v_summary text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_summary := 'Allergy added: ' || NEW.allergen || ' (' || v_sev || ')';
  ELSE
    v_fields := array_remove(ARRAY[
      CASE WHEN NEW.allergen IS DISTINCT FROM OLD.allergen THEN 'allergen' END,
      CASE WHEN NEW.severity IS DISTINCT FROM OLD.severity THEN 'severity' END,
      CASE WHEN NEW.reaction IS DISTINCT FROM OLD.reaction THEN 'reaction' END,
      CASE WHEN NEW.action_plan IS DISTINCT FROM OLD.action_plan THEN 'what to do' END,
      CASE WHEN NEW.active IS DISTINCT FROM OLD.active THEN 'active' END], NULL);
    IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
    v_summary := CASE
      WHEN 'active' = ANY (v_fields) AND NOT NEW.active THEN 'Allergy removed: ' || NEW.allergen
      WHEN 'active' = ANY (v_fields) THEN 'Allergy restored: ' || NEW.allergen || ' (' || v_sev || ')'
      ELSE 'Allergy changed: ' || NEW.allergen || ' (' || array_to_string(v_fields, ', ') || ')' END;
  END IF;
  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, changed_fields, summary)
  VALUES (NEW.center_id, NEW.child_id, 'child_allergies', NEW.id, lower(TG_OP), auth.uid(), COALESCE(v_fields, '{}'), left(v_summary, 300));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.child_allergies_log() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS child_allergies_log ON public.child_allergies;
CREATE TRIGGER child_allergies_log AFTER INSERT OR UPDATE ON public.child_allergies FOR EACH ROW EXECUTE FUNCTION public.child_allergies_log();
