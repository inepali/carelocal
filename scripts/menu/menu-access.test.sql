-- Access-rule tests for menu planning (supabase/migrations/20261226000000_menu_planning.sql).
--
-- WHAT IT PROVES: only super admins flip the switches; only center admins mark a menu editor; owners and
-- marked cooks edit, regular teachers read published months only, substitutes and other centers see nothing;
-- presets only go in their meal slots and slots the center serves; published menus keep their food snapshot.
--
-- Runs against a THROWAWAY local Postgres that has the full schema and all migrations applied, never a
-- Supabase project (it inserts fixtures with fixed ids and grants broad table access). It needs stub auth.uid()
-- and auth.jwt() that read request.jwt.claim.sub / request.jwt.claims, as Supabase's do.
--
--   psql -d <local test db> -tA -q -f scripts/menu/menu-access.test.sql
\set ON_ERROR_STOP 0
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Fixtures (as postgres, no auth.uid)
INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-0000-0000-00000000000a','owner@x.test'),
 ('00000000-0000-0000-0000-00000000000b','cook@x.test'),
 ('00000000-0000-0000-0000-00000000000c','teacher@x.test'),
 ('00000000-0000-0000-0000-00000000000d','sub@x.test'),
 ('00000000-0000-0000-0000-00000000000e','other@x.test');
INSERT INTO centers (id, slug, name, domain_key) VALUES
 ('10000000-0000-0000-0000-000000000001','c1','Center One','childcare'),
 ('10000000-0000-0000-0000-000000000002','c2','Center Two','childcare');
INSERT INTO center_admins (center_id, user_id, role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','owner'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000e','owner');
INSERT INTO staff_profiles (id, user_id, first_name, last_name, email, staff_type) VALUES
 ('20000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Cookie','C','cook@x.test','cook'),
 ('20000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','Tea','T','teacher@x.test','teacher'),
 ('20000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000d','Sub','S','sub@x.test','teacher');
INSERT INTO center_staff (center_id, staff_id, status, employment_class) VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-00000000000b','active','regular'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-00000000000c','active','regular'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-00000000000d','active','substitute');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text, superadmin boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u, false);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'app_metadata', json_build_object('is_super_admin', superadmin))::text, false);
END $$;
CREATE TEMP TABLE results (name text, ok boolean);
GRANT ALL ON results TO authenticated;

\echo == 1. Module off: owner cannot seed
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
DO $$ BEGIN PERFORM seed_menu_library('10000000-0000-0000-0000-000000000001'); INSERT INTO results VALUES ('seed blocked when off', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO results VALUES ('seed blocked when off', true); END $$;

\echo == 2. Owner cannot flip the switches; nor set cook editor? (owner CAN set editor)
UPDATE centers SET menu_planning_enabled = true, cacfp_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
INSERT INTO results SELECT 'owner cannot enable module', NOT menu_planning_enabled AND NOT cacfp_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001';
UPDATE center_staff SET menu_editor = true WHERE staff_id = '20000000-0000-0000-0000-00000000000b';
INSERT INTO results SELECT 'owner can mark cook as editor', menu_editor FROM center_staff WHERE staff_id = '20000000-0000-0000-0000-00000000000b';

\echo == 3. Teacher cannot mark themselves editor
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
UPDATE center_staff SET menu_editor = true WHERE staff_id = '20000000-0000-0000-0000-00000000000c';
RESET ROLE;
INSERT INTO results SELECT 'teacher cannot self-grant editor', NOT menu_editor FROM center_staff WHERE staff_id = '20000000-0000-0000-0000-00000000000c';

\echo == 4. Super admin turns it on
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000ff', true);
UPDATE centers SET menu_planning_enabled = true, cacfp_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
RESET ROLE;
INSERT INTO results SELECT 'super admin enables module', menu_planning_enabled AND cacfp_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001';

\echo == 5. Cook seeds library and plans a draft
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ DECLARE n int; BEGIN n := seed_menu_library('10000000-0000-0000-0000-000000000001'); INSERT INTO results VALUES ('cook seeds 11 presets', n = 11);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; INSERT INTO results VALUES ('cook seeds 11 presets', false); END $$;
INSERT INTO menu_entries (center_id, service_date, slot, preset_id)
  SELECT center_id, '2026-12-01', 'breakfast', id FROM menu_presets WHERE name = 'Pancake, Banana, Milk';
INSERT INTO results SELECT 'entry snapshots preset foods', jsonb_array_length(items) = 3 AND preset_name = 'Pancake, Banana, Milk' FROM menu_entries WHERE service_date = '2026-12-01';
DO $$ BEGIN
  INSERT INTO menu_entries (center_id, service_date, slot, preset_id)
    SELECT center_id, '2026-12-01', 'lunch', id FROM menu_presets WHERE name = 'Pancake, Banana, Milk';
  INSERT INTO results VALUES ('breakfast preset refused at lunch', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO results VALUES ('breakfast preset refused at lunch', true); END $$;
DO $$ BEGIN
  INSERT INTO menu_entries (center_id, service_date, slot, preset_id)
    SELECT center_id, '2026-12-01', 'am_snack', id FROM menu_presets WHERE name = 'Crackers & Cheese';
  INSERT INTO results VALUES ('unserved slot refused', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO results VALUES ('unserved slot refused', true); END $$;

\echo == 6. Teacher: no drafts, no writes
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
INSERT INTO results SELECT 'teacher reads presets', count(*) = 11 FROM menu_presets;
INSERT INTO results SELECT 'teacher cannot see draft month', count(*) = 0 FROM menu_entries;
DO $$ BEGIN
  INSERT INTO menu_entries (center_id, service_date, slot, preset_id)
    SELECT center_id, '2026-12-02', 'breakfast', id FROM menu_presets WHERE name = 'Pancake, Banana, Milk';
  INSERT INTO results VALUES ('teacher cannot add entries', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO results VALUES ('teacher cannot add entries', true); END $$;

\echo == 7. Cook publishes; teacher sees it; preset edit does not rewrite published menu
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
INSERT INTO menu_months (center_id, month, status) VALUES ('10000000-0000-0000-0000-000000000001', '2026-12-01', 'published');
INSERT INTO results SELECT 'publish stamps name', published_by_name = 'Cookie C' AND published_at IS NOT NULL FROM menu_months;
DELETE FROM menu_preset_items WHERE preset_id = (SELECT id FROM menu_presets WHERE name = 'Pancake, Banana, Milk')
  AND food_item_id = (SELECT id FROM menu_food_items WHERE name = 'Banana');
SELECT menu_refresh_preset((SELECT id FROM menu_presets WHERE name = 'Pancake, Banana, Milk'));
INSERT INTO results SELECT 'published snapshot unchanged', jsonb_array_length(items) = 3 FROM menu_entries WHERE service_date = '2026-12-01';
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
INSERT INTO results SELECT 'teacher sees published month', count(*) = 1 FROM menu_entries;

\echo == 8. Substitute and other center see nothing
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
INSERT INTO results SELECT 'substitute sees nothing', (SELECT count(*) FROM menu_entries) + (SELECT count(*) FROM menu_presets) = 0;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
INSERT INTO results SELECT 'other center owner sees nothing', (SELECT count(*) FROM menu_entries) + (SELECT count(*) FROM menu_presets) = 0;
DO $$ BEGIN
  INSERT INTO menu_food_items (center_id, name, component) VALUES ('10000000-0000-0000-0000-000000000001', 'Hack', 'fruit');
  INSERT INTO results VALUES ('other center cannot write', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO results VALUES ('other center cannot write', true); END $$;

\echo == 9. Unpublish + preset delete keeps snapshot; module off hides everything
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
UPDATE menu_months SET status = 'draft';
INSERT INTO results SELECT 'unpublish clears stamp', published_at IS NULL FROM menu_months;
DELETE FROM menu_presets WHERE name = 'Pancake, Banana, Milk';
INSERT INTO results SELECT 'deleted preset keeps snapshot', preset_id IS NULL AND jsonb_array_length(items) = 3 FROM menu_entries WHERE service_date = '2026-12-01';
RESET ROLE;
SELECT pg_temp.as_user('');
UPDATE centers SET menu_planning_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
INSERT INTO results SELECT 'module off hides from owner', (SELECT count(*) FROM menu_entries) + (SELECT count(*) FROM menu_presets) = 0;
RESET ROLE;

SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || name FROM results;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) || ' passed' FROM results;
