-- ============================================================
-- Menu planning: a monthly meal calendar per center, built by dropping meal presets onto days.
--
--  - centers.menu_planning_enabled: the module switch (super admin only, like roster_enabled).
--  - centers.cacfp_enabled: CACFP component tracking and reports on top of it (super admin only).
--  - centers.menu_slots: the meals the center serves, in order (center admins choose).
--  - center_staff.menu_editor: a regular employee (usually the cook) who may edit menus. Only the center's
--    admins set it, so a staff member cannot give themselves access by editing their own profile.
--  - menu_food_items: foods with their CACFP component, whole-grain-rich / grain-dessert flags and allergens.
--  - menu_presets + menu_preset_items: reusable combos ("Pancake, Banana, Milk") tagged with the meal slots
--    they may be served at.
--  - menu_months: draft / published per center per month. Only published months are visible to staff.
--  - menu_entries: one preset per day per slot. The preset's foods are copied onto the entry when it is placed
--    (items snapshot), so later preset edits never rewrite a menu that was already served.
--  - menu_closed_days: holidays and closures.
--
-- Who may do what (enforced here, not only in the UI), and only while menu planning is on:
--  - Editors: center owners/admins, and active regular staff marked menu_editor. They manage foods, presets,
--    menus, closed days and publishing, and see drafts.
--  - Active regular staff of the center: read foods, presets, closed days and published months.
--  - Super admins: read everything.
--  - Parents: none yet (they get read access to published months when the parent portal exists).
-- Infant meal patterns are out of scope for this phase.
-- Rollback: supabase/rollbacks/20261226000000_menu_planning.down.sql
-- ============================================================

-- 1. Switches and settings -------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS menu_planning_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS cacfp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS menu_slots text[] NOT NULL DEFAULT ARRAY['breakfast', 'lunch', 'pm_snack'];

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_menu_slots_check;
ALTER TABLE public.centers ADD CONSTRAINT centers_menu_slots_check CHECK (
  cardinality(menu_slots) BETWEEN 1 AND 5
  AND menu_slots <@ ARRAY['breakfast', 'am_snack', 'lunch', 'pm_snack', 'supper']
);

-- Only super admins (or the service role) may flip the two switches; anyone else keeps the old values
CREATE OR REPLACE FUNCTION public.guard_menu_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.menu_planning_enabled IS NOT DISTINCT FROM OLD.menu_planning_enabled
     AND NEW.cacfp_enabled IS NOT DISTINCT FROM OLD.cacfp_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.menu_planning_enabled := OLD.menu_planning_enabled;
  NEW.cacfp_enabled := OLD.cacfp_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_menu_flags() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_menu_flags ON public.centers;
CREATE TRIGGER trg_guard_menu_flags BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_menu_flags();

-- Menu editor flag on a center membership; only the center's admins (or super admins) may change it
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS menu_editor boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_center_staff_menu_editor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.menu_editor IS NOT DISTINCT FROM OLD.menu_editor THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.menu_editor THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false)
     AND NOT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id) THEN
    NEW.menu_editor := CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.menu_editor END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_center_staff_menu_editor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_center_staff_menu_editor ON public.center_staff;
CREATE TRIGGER trg_guard_center_staff_menu_editor BEFORE INSERT OR UPDATE OF menu_editor ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_menu_editor();

-- 2. Tables ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_food_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name             text NOT NULL,
  component        text NOT NULL DEFAULT 'other',   -- CACFP component this food credits toward
  whole_grain_rich boolean NOT NULL DEFAULT false,
  grain_dessert    boolean NOT NULL DEFAULT false,   -- grain-based desserts do not credit toward grains
  allergens        text[] NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_food_items_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT menu_food_items_component_check CHECK (component IN ('milk', 'grain', 'meat_alt', 'vegetable', 'fruit', 'other')),
  CONSTRAINT menu_food_items_wgr_check CHECK (NOT whole_grain_rich OR component = 'grain'),
  CONSTRAINT menu_food_items_dessert_check CHECK (NOT grain_dessert OR component = 'grain'),
  CONSTRAINT menu_food_items_allergens_check CHECK (cardinality(allergens) <= 12),
  CONSTRAINT menu_food_items_id_center_key UNIQUE (id, center_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS menu_food_items_name_key ON public.menu_food_items(center_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.menu_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  meal_types  text[] NOT NULL,                       -- slots this preset may be placed in
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_presets_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT menu_presets_meal_types_check CHECK (
    cardinality(meal_types) >= 1 AND meal_types <@ ARRAY['breakfast', 'am_snack', 'lunch', 'pm_snack', 'supper']),
  CONSTRAINT menu_presets_notes_check CHECK (notes IS NULL OR length(notes) <= 1000),
  CONSTRAINT menu_presets_id_center_key UNIQUE (id, center_id)
);

CREATE TABLE IF NOT EXISTS public.menu_preset_items (
  preset_id    uuid NOT NULL,
  food_item_id uuid NOT NULL,
  center_id    uuid NOT NULL,
  serving_note text,                                 -- e.g. "1/2 cup", "1 slice"
  sort_order   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (preset_id, food_item_id),
  CONSTRAINT menu_preset_items_note_check CHECK (serving_note IS NULL OR length(serving_note) <= 120),
  CONSTRAINT menu_preset_items_preset_fkey FOREIGN KEY (preset_id, center_id)
    REFERENCES public.menu_presets(id, center_id) ON DELETE CASCADE,
  CONSTRAINT menu_preset_items_food_fkey FOREIGN KEY (food_item_id, center_id)
    REFERENCES public.menu_food_items(id, center_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.menu_months (
  center_id         uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  month             date NOT NULL,                   -- first day of the month
  status            text NOT NULL DEFAULT 'draft',
  published_at      timestamptz,
  published_by_name text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (center_id, month),
  CONSTRAINT menu_months_first_check CHECK (extract(day FROM month) = 1),
  CONSTRAINT menu_months_status_check CHECK (status IN ('draft', 'published'))
);

CREATE TABLE IF NOT EXISTS public.menu_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  slot          text NOT NULL,
  preset_id     uuid,
  preset_name   text NOT NULL DEFAULT '',            -- snapshot, filled by the trigger
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- snapshot of the preset's foods, filled by the trigger
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_entries_slot_check CHECK (slot IN ('breakfast', 'am_snack', 'lunch', 'pm_snack', 'supper')),
  CONSTRAINT menu_entries_note_check CHECK (note IS NULL OR length(note) <= 300),
  CONSTRAINT menu_entries_day_slot_key UNIQUE (center_id, service_date, slot),
  CONSTRAINT menu_entries_preset_fkey FOREIGN KEY (preset_id, center_id)
    REFERENCES public.menu_presets(id, center_id) ON DELETE SET NULL (preset_id)
);

CREATE TABLE IF NOT EXISTS public.menu_closed_days (
  center_id    uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (center_id, service_date),
  CONSTRAINT menu_closed_days_reason_check CHECK (reason IS NULL OR length(reason) <= 120)
);

CREATE INDEX IF NOT EXISTS menu_food_items_center_idx ON public.menu_food_items(center_id, component, sort_order);
CREATE INDEX IF NOT EXISTS menu_presets_center_idx ON public.menu_presets(center_id, sort_order);
CREATE INDEX IF NOT EXISTS menu_preset_items_food_idx ON public.menu_preset_items(food_item_id);
CREATE INDEX IF NOT EXISTS menu_entries_center_date_idx ON public.menu_entries(center_id, service_date);
CREATE INDEX IF NOT EXISTS menu_entries_preset_idx ON public.menu_entries(preset_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['menu_food_items', 'menu_presets', 'menu_months', 'menu_entries'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- 3. Helpers ---------------------------------------------------------------------------------------------------
-- public.is_center_admin(center) and public.is_center_regular_staff(center) already exist.

CREATE OR REPLACE FUNCTION public.menu_planning_on(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT c.menu_planning_enabled FROM centers c WHERE c.id = p_center_id), false);
$$;

-- Owner/admin, or an active regular employee the center marked as menu editor; and the module is on
CREATE OR REPLACE FUNCTION public.can_edit_menu(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.menu_planning_on(p_center_id) AND (
    public.is_center_admin(p_center_id)
    OR EXISTS (
      SELECT 1 FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
      WHERE sp.user_id = auth.uid() AND cs.center_id = p_center_id
        AND cs.status = 'active' AND cs.employment_class = 'regular' AND cs.menu_editor
    ));
$$;

-- Anyone at the center who may see published menus (parents come later)
CREATE OR REPLACE FUNCTION public.can_read_menu(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.menu_planning_on(p_center_id)
     AND (public.is_center_admin(p_center_id) OR public.is_center_regular_staff(p_center_id));
$$;

CREATE OR REPLACE FUNCTION public.menu_month_published(p_center_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM menu_months m
                 WHERE m.center_id = p_center_id AND m.month = date_trunc('month', p_date)::date AND m.status = 'published');
$$;

REVOKE ALL ON FUNCTION public.menu_planning_on(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_menu(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_menu(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.menu_month_published(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_planning_on(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_menu(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_menu(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.menu_month_published(uuid, date) TO authenticated;

-- An entry must use a preset allowed for its slot, in a slot the center serves; the preset's foods are copied on
CREATE OR REPLACE FUNCTION public.fill_menu_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_types text[]; v_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.center_id IS DISTINCT FROM OLD.center_id OR NEW.service_date IS DISTINCT FROM OLD.service_date) THEN
    RAISE EXCEPTION 'Move a menu entry by deleting it and placing it again' USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.slot IS DISTINCT FROM OLD.slot)
     AND NOT (NEW.slot = ANY (COALESCE((SELECT menu_slots FROM centers WHERE id = NEW.center_id), '{}'))) THEN
    RAISE EXCEPTION 'This center does not serve that meal' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.preset_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Choose a meal preset' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;                                                  -- preset deleted later: keep the snapshot
  END IF;
  IF TG_OP = 'INSERT' OR NEW.preset_id IS DISTINCT FROM OLD.preset_id OR NEW.slot IS DISTINCT FROM OLD.slot
     OR COALESCE(current_setting('carelocal.menu_refresh', true), '') = 'on' THEN
    SELECT p.meal_types, p.name INTO v_types, v_name FROM menu_presets p WHERE p.id = NEW.preset_id AND p.center_id = NEW.center_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That preset belongs to another center' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (NEW.slot = ANY (v_types)) THEN
      RAISE EXCEPTION 'That preset is not set up for this meal' USING ERRCODE = 'check_violation';
    END IF;
    NEW.preset_name := v_name;
    NEW.items := COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'food_item_id', f.id, 'name', f.name, 'component', f.component,
               'whole_grain_rich', f.whole_grain_rich, 'grain_dessert', f.grain_dessert,
               'allergens', to_jsonb(f.allergens), 'serving_note', pi.serving_note)
             ORDER BY pi.sort_order, f.name)
      FROM menu_preset_items pi JOIN menu_food_items f ON f.id = pi.food_item_id
      WHERE pi.preset_id = NEW.preset_id), '[]'::jsonb);
  ELSE
    NEW.preset_name := OLD.preset_name;                          -- snapshots only change with the preset
    NEW.items := OLD.items;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fill_menu_entry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fill_menu_entry ON public.menu_entries;
CREATE TRIGGER trg_fill_menu_entry BEFORE INSERT OR UPDATE ON public.menu_entries
  FOR EACH ROW EXECUTE FUNCTION public.fill_menu_entry();

-- Publishing stamps who and when; going back to draft clears it
CREATE OR REPLACE FUNCTION public.stamp_menu_month()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status <> 'published') THEN
    NEW.published_at := now();
    NEW.published_by_name := public.lesson_plan_actor_name();
  ELSIF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
    NEW.published_by_name := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.published_at := OLD.published_at;
    NEW.published_by_name := OLD.published_by_name;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_menu_month() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_menu_month ON public.menu_months;
CREATE TRIGGER trg_stamp_menu_month BEFORE INSERT OR UPDATE ON public.menu_months
  FOR EACH ROW EXECUTE FUNCTION public.stamp_menu_month();

-- Re-copy a preset's current foods onto entries of unpublished months (editors use it after editing a preset)
CREATE OR REPLACE FUNCTION public.menu_refresh_preset(p_preset_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  PERFORM set_config('carelocal.menu_refresh', 'on', true);
  UPDATE menu_entries e SET updated_at = now()
  WHERE e.preset_id = p_preset_id AND NOT public.menu_month_published(e.center_id, e.service_date);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('carelocal.menu_refresh', '', true);
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.menu_refresh_preset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_refresh_preset(uuid) TO authenticated;

-- 4. Row level security ----------------------------------------------------------------------------------------
ALTER TABLE public.menu_food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_preset_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_closed_days ENABLE ROW LEVEL SECURITY;

-- Library, months and closed days: center readers read, editors write
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['menu_food_items', 'menu_presets', 'menu_preset_items', 'menu_months', 'menu_closed_days'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Center staff read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.can_read_menu(center_id))',
                   'Center staff read ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Menu editors write ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.can_edit_menu(center_id)) WITH CHECK (public.can_edit_menu(center_id))',
                   'Menu editors write ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Super admins read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (((auth.jwt() -> ''app_metadata'' ->> ''is_super_admin'')::boolean = true))',
                   'Super admins read ' || t, t);
  END LOOP;
END $$;

-- Entries: editors see drafts; everyone else only published months
DROP POLICY IF EXISTS "Menu editors manage menu_entries" ON public.menu_entries;
CREATE POLICY "Menu editors manage menu_entries" ON public.menu_entries FOR ALL
  USING (public.can_edit_menu(center_id)) WITH CHECK (public.can_edit_menu(center_id));
DROP POLICY IF EXISTS "Center staff read published menu_entries" ON public.menu_entries;
CREATE POLICY "Center staff read published menu_entries" ON public.menu_entries FOR SELECT
  USING (public.can_read_menu(center_id) AND public.menu_month_published(center_id, service_date));
DROP POLICY IF EXISTS "Super admins read menu_entries" ON public.menu_entries;
CREATE POLICY "Super admins read menu_entries" ON public.menu_entries FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));

-- 5. Starter library -------------------------------------------------------------------------------------------
-- Loads a starter set of foods and presets into a center that has none yet. Runs as the caller, so RLS decides
-- who may seed which center. Returns the number of presets created.
CREATE OR REPLACE FUNCTION public.seed_menu_library(p_center_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_presets integer := 0;
  r record;
  v_preset uuid;
  v_food text;
  v_i integer;
BEGIN
  IF EXISTS (SELECT 1 FROM menu_food_items WHERE center_id = p_center_id) THEN
    RAISE EXCEPTION 'This center already has foods. Add more from the library instead.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO menu_food_items (center_id, name, component, whole_grain_rich, grain_dessert, allergens, sort_order)
  SELECT p_center_id, f.name, f.component, f.wgr, f.dessert, f.allergens, f.ord
  FROM (VALUES
    ('Milk (1%)',                  'milk',      false, false, ARRAY['milk'],            10),
    ('Whole milk (age 1)',         'milk',      false, false, ARRAY['milk'],            11),
    ('Whole-wheat pancake',        'grain',     true,  false, ARRAY['wheat', 'egg', 'milk'], 20),
    ('Whole-grain cereal',         'grain',     true,  false, ARRAY['wheat'],           21),
    ('Oatmeal',                    'grain',     true,  false, ARRAY[]::text[],          22),
    ('Whole-wheat toast',          'grain',     true,  false, ARRAY['wheat'],           23),
    ('Brown rice',                 'grain',     true,  false, ARRAY[]::text[],          24),
    ('Whole-wheat pasta',          'grain',     true,  false, ARRAY['wheat'],           25),
    ('Whole-grain crackers',       'grain',     true,  false, ARRAY['wheat'],           26),
    ('Tortilla',                   'grain',     false, false, ARRAY['wheat'],           27),
    ('Baked chicken',              'meat_alt',  false, false, ARRAY[]::text[],          30),
    ('Turkey meatballs',           'meat_alt',  false, false, ARRAY['egg', 'wheat'],    31),
    ('Black beans',                'meat_alt',  false, false, ARRAY[]::text[],          32),
    ('Cheese',                     'meat_alt',  false, false, ARRAY['milk'],            33),
    ('Yogurt',                     'meat_alt',  false, false, ARRAY['milk'],            34),
    ('Scrambled eggs',             'meat_alt',  false, false, ARRAY['egg'],             35),
    ('Banana',                     'fruit',     false, false, ARRAY[]::text[],          40),
    ('Apple slices',               'fruit',     false, false, ARRAY[]::text[],          41),
    ('Orange wedges',              'fruit',     false, false, ARRAY[]::text[],          42),
    ('Peaches',                    'fruit',     false, false, ARRAY[]::text[],          43),
    ('Strawberries',               'fruit',     false, false, ARRAY[]::text[],          44),
    ('Broccoli',                   'vegetable', false, false, ARRAY[]::text[],          50),
    ('Carrots',                    'vegetable', false, false, ARRAY[]::text[],          51),
    ('Green beans',                'vegetable', false, false, ARRAY[]::text[],          52),
    ('Corn',                       'vegetable', false, false, ARRAY[]::text[],          53),
    ('Cucumber slices',            'vegetable', false, false, ARRAY[]::text[],          54),
    ('Tomato sauce',               'vegetable', false, false, ARRAY[]::text[],          55)
  ) AS f(name, component, wgr, dessert, allergens, ord);

  FOR r IN
    SELECT * FROM (VALUES
      ('Pancake, Banana, Milk',                    ARRAY['breakfast'],             ARRAY['Whole-wheat pancake', 'Banana', 'Milk (1%)'], 10),
      ('Cereal, Strawberries, Milk',               ARRAY['breakfast'],             ARRAY['Whole-grain cereal', 'Strawberries', 'Milk (1%)'], 11),
      ('Oatmeal, Peaches, Milk',                   ARRAY['breakfast'],             ARRAY['Oatmeal', 'Peaches', 'Milk (1%)'], 12),
      ('Eggs, Toast, Orange, Milk',                ARRAY['breakfast'],             ARRAY['Scrambled eggs', 'Whole-wheat toast', 'Orange wedges', 'Milk (1%)'], 13),
      ('Chicken, Rice, Broccoli, Apple, Milk',     ARRAY['lunch', 'supper'],       ARRAY['Baked chicken', 'Brown rice', 'Broccoli', 'Apple slices', 'Milk (1%)'], 20),
      ('Meatballs, Pasta, Green Beans, Peaches, Milk', ARRAY['lunch', 'supper'],   ARRAY['Turkey meatballs', 'Whole-wheat pasta', 'Tomato sauce', 'Green beans', 'Peaches', 'Milk (1%)'], 21),
      ('Bean Tacos, Corn, Orange, Milk',           ARRAY['lunch', 'supper'],       ARRAY['Black beans', 'Tortilla', 'Cheese', 'Corn', 'Orange wedges', 'Milk (1%)'], 22),
      ('Crackers & Cheese',                        ARRAY['am_snack', 'pm_snack'],  ARRAY['Whole-grain crackers', 'Cheese'], 30),
      ('Yogurt & Strawberries',                    ARRAY['am_snack', 'pm_snack'],  ARRAY['Yogurt', 'Strawberries'], 31),
      ('Apple & Milk',                             ARRAY['am_snack', 'pm_snack'],  ARRAY['Apple slices', 'Milk (1%)'], 32),
      ('Cucumbers & Crackers',                     ARRAY['am_snack', 'pm_snack'],  ARRAY['Cucumber slices', 'Whole-grain crackers'], 33)
    ) AS p(name, meal_types, foods, ord)
  LOOP
    INSERT INTO menu_presets (center_id, name, meal_types, sort_order)
    VALUES (p_center_id, r.name, r.meal_types, r.ord) RETURNING id INTO v_preset;
    v_i := 0;
    FOREACH v_food IN ARRAY r.foods LOOP
      v_i := v_i + 1;
      INSERT INTO menu_preset_items (preset_id, food_item_id, center_id, sort_order)
      SELECT v_preset, f.id, p_center_id, v_i FROM menu_food_items f
      WHERE f.center_id = p_center_id AND f.name = v_food;
    END LOOP;
    v_presets := v_presets + 1;
  END LOOP;
  RETURN v_presets;
END $$;
REVOKE ALL ON FUNCTION public.seed_menu_library(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_menu_library(uuid) TO authenticated;
