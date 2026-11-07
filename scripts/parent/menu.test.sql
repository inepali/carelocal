-- Database tests for the parent page menu (20261230000000_parent_menu.sql), on a throwaway local Postgres:
--   createdb pmenu && psql -d pmenu -f scripts/parent/portal-stub.sql -f scripts/parent/menu-stub.sql \
--     -f supabase/migrations/20261228000000_parent_portal.sql -f supabase/migrations/20261230000000_parent_menu.sql \
--     -f scripts/parent/menu.test.sql
-- It prints ALL PASSED or stops at the first failed check.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(t::bytea), 'hex') $$;
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000000a');
INSERT INTO centers (id, name, parent_portal_enabled, menu_planning_enabled) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A', true, true);
INSERT INTO center_admins VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner');
INSERT INTO children (id, center_id, first_name) VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Maya');
INSERT INTO child_guardians (id, center_id, child_id, name, email) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mom', 'mom@x.com');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', pg_temp.h('mom'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- This month published with two days; next month a draft; one closed day
INSERT INTO menu_months VALUES ('10000000-0000-0000-0000-000000000001', date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001'))::date, 'published'),
                               ('10000000-0000-0000-0000-000000000001', (date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001')) + interval '1 month')::date, 'draft');
INSERT INTO menu_entries (center_id, service_date, slot, preset_name, items, note) VALUES
  ('10000000-0000-0000-0000-000000000001', date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001'))::date + 2, 'lunch', 'Taco day',
   '[{"name":"Chicken taco","serving_note":"1 each","allergens":["wheat"],"component":"meat_alt"},{"name":"Corn","serving_note":"","allergens":[]}]', 'Mild'),
  ('10000000-0000-0000-0000-000000000001', date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001'))::date + 2, 'breakfast', 'Pancakes', '[{"name":"Pancake","allergens":["egg","milk"]}]', NULL),
  ('10000000-0000-0000-0000-000000000001', (date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001')) + interval '1 month')::date + 1, 'lunch', 'Draft lunch', '[]', NULL);
INSERT INTO menu_closed_days VALUES ('10000000-0000-0000-0000-000000000001', date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001'))::date + 9, 'Teacher workday');

SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
  PERFORM parent_login('10000000-0000-0000-0000-000000000001'::uuid, pg_temp.h('mom'), 'ip', pg_temp.h('tok'));
  ASSERT (parent_portal_home(pg_temp.h('tok')) #>> '{center,menu}')::boolean, 'home does not say menu is on';
  r := parent_portal_menu(pg_temp.h('tok'));
  ASSERT (r ->> 'published')::boolean, r::text;
  ASSERT jsonb_array_length(r -> 'entries') = 2, r::text;
  ASSERT r #>> '{entries,0,slot}' = 'breakfast', 'serving order';
  ASSERT r #>> '{entries,1,foods,0,name}' = 'Chicken taco' AND r #> '{entries,1,foods,0,allergens}' = '["wheat"]'::jsonb;
  ASSERT NOT (r #> '{entries,1,foods,0}') ? 'component', 'CACFP detail leaked';
  ASSERT r #> '{entries,1,foods,1,serving_note}' = 'null'::jsonb, 'empty serving note not null';
  ASSERT jsonb_array_length(r -> 'closed') = 1 AND jsonb_array_length(r -> 'months') = 1, r::text;
  -- The draft month shows nothing
  r := parent_portal_menu(pg_temp.h('tok'), (date_trunc('month', roster_today('10000000-0000-0000-0000-000000000001')) + interval '1 month')::date);
  ASSERT NOT (r ->> 'published')::boolean AND jsonb_array_length(r -> 'entries') = 0, r::text;
  -- Out of range, signed out
  ASSERT NOT (parent_portal_menu(pg_temp.h('tok'), '2020-01-01') ->> 'published')::boolean;
  ASSERT parent_portal_menu(pg_temp.h('nope')) IS NULL;
END $$;
RESET ROLE;
UPDATE centers SET menu_planning_enabled = false;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT parent_portal_menu(pg_temp.h('tok')) IS NULL, 'menu off but shown';
  ASSERT NOT (parent_portal_home(pg_temp.h('tok')) #>> '{center,menu}')::boolean;
END $$;
RESET ROLE;
SELECT 'ALL PASSED';
