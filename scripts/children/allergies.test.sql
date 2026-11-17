-- Database tests for child allergies (20270119000000_child_allergies.sql), on a throwaway local Postgres:
--   createdb al && psql -q -d al -f scripts/tuition/stub.sql -f scripts/children/allergies.stub.sql \
--     -f supabase/migrations/20270119000000_child_allergies.sql -f scripts/children/allergies.test.sql
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; END $$;
CREATE FUNCTION pg_temp.fails(q text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION 'FAIL: expected an error like "%" from: %', pat, q;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' OR SQLERRM NOT ILIKE '%' || pat || '%' THEN RAISE EXCEPTION 'FAIL: % (got: %)', q, SQLERRM; END IF;
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false), set_config('request.jwt.claims', '{}', false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-000000000001', 'olive@a.test'), ('a0000000-0000-0000-0000-000000000003', 'tess@a.test');
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A');
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner');
INSERT INTO children (id, center_id, first_name, last_name, status, enrolled_on) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ava', 'A', 'enrolled', current_date);

SELECT pg_temp.ok((SELECT count(*) FROM center_lookups WHERE group_name = 'Allergy' AND center_id IS NULL) = 16, 'default allergy list');
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
INSERT INTO child_allergies (center_id, child_id, allergen, severity, reaction, action_plan)
VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Peanuts', 'life_threatening', 'Hives, swelling', 'EpiPen in the office; call 911 and the parent');
SELECT pg_temp.fails($$INSERT INTO child_allergies (center_id, child_id, allergen) VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', ' peanuts ')$$, 'child_allergies_once');
SELECT pg_temp.fails($$INSERT INTO child_allergies (center_id, child_id, allergen, severity) VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Eggs', 'deadly')$$, 'check');
UPDATE child_allergies SET active = false WHERE allergen = 'Peanuts';
INSERT INTO child_allergies (center_id, child_id, allergen) VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Peanuts');
SELECT pg_temp.fails($$DELETE FROM child_allergies$$, 'permission denied');
SELECT pg_temp.ok((SELECT count(*) FROM child_audit_log WHERE table_name = 'child_allergies') = 3, 'added, removed, added logged');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM child_audit_log WHERE summary = 'Allergy added: Peanuts (life-threatening)'), 'log wording');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM child_audit_log WHERE summary = 'Allergy removed: Peanuts'), 'removal logged');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.ok((SELECT count(*) FROM child_allergies) = 0, 'no dashboard access: no allergies');
SELECT pg_temp.fails($$INSERT INTO child_allergies (center_id, child_id, allergen) VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Soy')$$, 'row-level security');
RESET ROLE;
SELECT 'ALLERGIES ALL PASSED' AS result;
