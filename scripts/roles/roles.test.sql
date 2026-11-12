-- Database tests for center roles (20270102000000_center_roles.sql), on a throwaway local Postgres:
--   createdb roles && psql -q -d roles -f scripts/roles/stub.sql \
--     -f supabase/migrations/20270102000000_center_roles.sql -f scripts/roles/roles.test.sql
-- It prints ALL PASSED or stops at the first failed check.
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
CREATE FUNCTION pg_temp.as_user(u text, super boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false),
         set_config('request.jwt.claims', CASE WHEN super THEN '{"app_metadata":{"is_super_admin":true}}' ELSE '{}' END, false) $$;
CREATE FUNCTION pg_temp.role_of(staff text) RETURNS text LANGUAGE sql AS $$
  SELECT center_role FROM center_staff WHERE center_id = '10000000-0000-0000-0000-000000000001' AND staff_id = staff::uuid $$;
CREATE FUNCTION pg_temp.access_of(u text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT role FROM center_admins WHERE center_id = '10000000-0000-0000-0000-000000000001' AND user_id = u::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

\set C '''10000000-0000-0000-0000-000000000001'''
\set DANA '''c0000000-0000-0000-0000-00000000000d'''
\set EVE '''c0000000-0000-0000-0000-00000000000e'''
\set SAM '''c0000000-0000-0000-0000-000000000005'''
\set OTTO '''c0000000-0000-0000-0000-0000000000ff'''
\set OWNER '''a0000000-0000-0000-0000-00000000000f'''

SET ROLE authenticated;

-- Owner makes Dana Director, Eve Cook
SELECT pg_temp.as_user(:OWNER);
SELECT public.set_center_role(:C, :DANA, 'director');
SELECT pg_temp.ok(pg_temp.role_of(:DANA) = 'director', 'Dana is director');
SELECT pg_temp.ok(pg_temp.access_of('a0000000-0000-0000-0000-00000000000d') = 'admin', 'Director gets dashboard access');
SELECT public.set_center_role(:C, :EVE, 'Cook ');
SELECT pg_temp.ok(pg_temp.role_of(:EVE) = 'cook', 'Eve is cook (normalized)');
SELECT pg_temp.ok(pg_temp.access_of('a0000000-0000-0000-0000-00000000000e') IS NULL, 'Cook gets no access');

-- Owner cannot make an owner, nor a substitute a director, nor a bad name
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', 'owner')$q$, 'support');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'assistant_director')$q$, 'Regular');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', 'x; drop')$q$, 'not valid');

-- Director: may give plain roles, not leadership; cannot touch self
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000d');
SELECT public.set_center_role(:C, :SAM, 'floater');
SELECT pg_temp.ok(pg_temp.role_of(:SAM) = 'floater', 'Director sets a plain role');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', 'assistant_director')$q$, 'Only the center owner');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000d', 'teacher')$q$, 'your own');

-- Direct writes to center_role are ignored
UPDATE center_staff SET center_role = 'owner' WHERE staff_id = :SAM;
SELECT pg_temp.ok(pg_temp.role_of(:SAM) = 'floater', 'Direct update of center_role is ignored');

-- Outsider cannot
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000099');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', 'teacher')$q$, 'Only the center owner');

-- Super admin makes Eve a co-owner; Otto (owner elsewhere) is refused
SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000aa', true);
SELECT public.set_center_role(:C, :EVE, 'owner');
SELECT pg_temp.ok(pg_temp.access_of('a0000000-0000-0000-0000-00000000000e') = 'owner', 'Super admin adds an owner');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000ff', 'owner')$q$, 'another center');

-- Owner cannot demote a co-owner
SELECT pg_temp.as_user(:OWNER);
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', NULL)$q$, 'support');

-- Super admin removes Eve as owner (another owner remains); then can't remove the last staff owner when alone
SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000aa', true);
SELECT public.set_center_role(:C, :EVE, 'teacher');
SELECT pg_temp.ok(pg_temp.access_of('a0000000-0000-0000-0000-00000000000e') IS NULL AND pg_temp.role_of(:EVE) = 'teacher', 'Owner removed, now teacher');
RESET ROLE;
DELETE FROM center_admins WHERE user_id = :OWNER;
SET ROLE authenticated;
SELECT public.set_center_role(:C, :EVE, 'owner');
SELECT pg_temp.fails($q$SELECT public.set_center_role('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000e', 'director')$q$, 'at least one owner');

-- Director demoted to substitute loses role and access
RESET ROLE;
UPDATE center_staff SET employment_class = 'substitute' WHERE staff_id = :DANA;
SELECT pg_temp.ok(pg_temp.access_of('a0000000-0000-0000-0000-00000000000d') IS NULL AND pg_temp.role_of(:DANA) IS NULL, 'Demoted director loses role');

-- Registration: may claim only a brand-new, unclaimed center, and only as someone with no center
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000003', 'New');
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000077');
SELECT pg_temp.fails($q$INSERT INTO center_admins (center_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000077', 'owner')$q$, 'row-level security');
SELECT pg_temp.fails($q$INSERT INTO center_admins (center_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000077', 'admin')$q$, 'row-level security');
INSERT INTO center_admins (center_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000077', 'owner');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000078');
SELECT pg_temp.fails($q$INSERT INTO center_admins (center_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000078', 'owner')$q$, 'row-level security');

\echo ALL PASSED
