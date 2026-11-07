-- Database tests for the parent portal (20261228000000_parent_portal.sql), run on a throwaway local Postgres:
--   createdb pp && psql -d pp -f scripts/parent/portal-stub.sql \
--     -f supabase/migrations/20261228000000_parent_portal.sql -f scripts/parent/portal.test.sql
-- It prints ALL PASSED or stops at the first failed check. Never run it against a Supabase project.
\set ON_ERROR_STOP on
-- Fixtures: center A (portal on) with admin, siblings Maya + Leo sharing mom's email, dad on Maya only; center B.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
INSERT INTO centers (id, name, timezone) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A', 'America/New_York'),
                                                ('10000000-0000-0000-0000-000000000002', 'Center B', 'America/New_York');
INSERT INTO center_admins VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO children (id, center_id, first_name) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Maya'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Leo'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Other'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'B kid');
INSERT INTO child_guardians (id, center_id, child_id, name, email, is_primary) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mom', 'Mom@x.com', true),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Mom', ' mom@x.com ', true),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Dad', 'dad@x.com', false),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', 'B parent', 'mom@x.com', false);
INSERT INTO child_daily_entries (center_id, child_id, service_date, kind, details, approved_at, voided_at) VALUES
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', roster_today('10000000-0000-0000-0000-000000000001'), 'meal', '{"meal":"lunch","amount":"all"}', NULL, NULL),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', roster_today('10000000-0000-0000-0000-000000000001'), 'note', '{"text":"voided"}', NULL, now()),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', roster_today('10000000-0000-0000-0000-000000000001'), 'photo', '{"photo_key":"child/10000000-0000-0000-0000-000000000001/x/a.jpg"}', now(), NULL),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', roster_today('10000000-0000-0000-0000-000000000001'), 'photo', '{"photo_key":"child/10000000-0000-0000-0000-000000000001/x/waiting.jpg"}', NULL, NULL);

-- helper to act as a signed-in user
CREATE FUNCTION pg_temp.as_user(u text, super boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claims', json_build_object('app_metadata', json_build_object('is_super_admin', super))::text, false); $$;
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(t::bytea), 'hex') $$;

-- 1. Portal off: issuing refuses; status says disabled; an owner cannot switch it on
SET ROLE authenticated; SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
DO $$ BEGIN
  ASSERT (parent_access_status('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') ->> 'enabled')::boolean = false;
  BEGIN PERFORM parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', pg_temp.h('c1'), 'ABCD');
    RAISE EXCEPTION 'issue should fail when off'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE centers SET parent_portal_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
  ASSERT NOT (SELECT parent_portal_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'owner switched it on';
END $$;
-- super admin switches it on
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a', true);
UPDATE centers SET parent_portal_enabled = true;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- 2. Issue for Mom on Maya: links Leo's Mom row too (same email, trimmed/case-insensitive), not center B's row
DO $$ DECLARE r jsonb; s jsonb; BEGIN
  r := parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', pg_temp.h('mom1'), 'MOM1');
  ASSERT (r ->> 'new_code')::boolean;
  s := parent_access_status('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  ASSERT (s -> 'contacts') @> '[{"guardian_id":"30000000-0000-0000-0000-000000000001","has_access":true,"also_covers":["Leo"]}]', s::text;
  ASSERT (s -> 'contacts') @> '[{"guardian_id":"30000000-0000-0000-0000-000000000003","has_access":false}]', s::text;
END $$;
-- Dad gets his own code
SELECT parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', pg_temp.h('dad1'), 'DAD1');

-- 3. Staff cannot link a contact directly or read the tables
DO $$ BEGIN
  UPDATE child_guardians SET parent_access_id = (SELECT parent_access_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000001')
   WHERE id = '30000000-0000-0000-0000-000000000003';
  ASSERT (SELECT parent_access_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000003')
         IS DISTINCT FROM (SELECT parent_access_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000001'), 'direct relink worked';
  BEGIN PERFORM 1 FROM parent_access; RAISE EXCEPTION 'read parent_access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM parent_login(pg_temp.h('mom1'), 'ip', pg_temp.h('t')); RAISE EXCEPTION 'authenticated called login'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- 4. Another center's owner cannot touch center A
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ BEGIN
  ASSERT (parent_access_status('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') ->> 'enabled')::boolean = false;
  BEGIN PERFORM parent_access_revoke('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cross-center revoke'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 5. Parent side as service role
SET ROLE service_role;
DO $$ DECLARE r jsonb; h jsonb; d jsonb; p jsonb; i int; BEGIN
  r := parent_login(pg_temp.h('mom1'), 'ip-1', pg_temp.h('tok-mom'), 'UA');
  ASSERT r ->> 'status' = 'ok', r::text;
  h := parent_portal_home(pg_temp.h('tok-mom'));
  ASSERT jsonb_array_length(h -> 'children') = 2, h::text;
  ASSERT h #>> '{parent,name}' = 'Mom';
  d := parent_portal_day(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001');
  ASSERT jsonb_array_length(d -> 'entries') = 2, d::text;   -- meal + approved photo; not voided, not waiting
  ASSERT parent_portal_day(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000003') IS NULL, 'saw another child';
  ASSERT parent_portal_day(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000009') IS NULL, 'saw center B child';
  ASSERT parent_portal_day(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001', roster_today('10000000-0000-0000-0000-000000000001') + 1) IS NULL, 'future day';
  ASSERT parent_portal_day(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001', roster_today('10000000-0000-0000-0000-000000000001') - 61) IS NULL, 'too old';
  p := parent_portal_photos(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001');
  ASSERT jsonb_array_length(p -> 'photos') = 1, p::text;
  -- Dad sees Maya only
  r := parent_login(pg_temp.h('dad1'), 'ip-1', pg_temp.h('tok-dad'));
  ASSERT jsonb_array_length(parent_portal_home(pg_temp.h('tok-dad')) -> 'children') = 1;
  ASSERT parent_portal_day(pg_temp.h('tok-dad'), '20000000-0000-0000-0000-000000000002') IS NULL, 'dad saw Leo';
  ASSERT parent_portal_home(pg_temp.h('nope')) IS NULL;
  -- Rate limit: 5 wrong codes from one IP, then blocked even with the right code; other IPs fine
  FOR i IN 1..5 LOOP r := parent_login(pg_temp.h('wrong' || i), 'ip-2', pg_temp.h('x' || i)); ASSERT r ->> 'status' = 'invalid', r::text; END LOOP;
  r := parent_login(pg_temp.h('mom1'), 'ip-2', pg_temp.h('tok-blocked'));
  ASSERT r ->> 'status' = 'rate_limited', r::text;
  ASSERT parent_login(pg_temp.h('mom1'), 'ip-3', pg_temp.h('tok-mom2')) ->> 'status' = 'ok';
END $$;
RESET ROLE;

-- 6. New code for Mom ends her devices; withdrawing Leo hides him; portal off signs everyone out
SET ROLE authenticated; SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
SELECT parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', pg_temp.h('mom2'), 'MOM2');
DO $$ BEGIN
  ASSERT parent_access_email_data('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', pg_temp.h('mom2')) ->> 'email' = 'Mom@x.com';
  ASSERT parent_access_email_data('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', pg_temp.h('mom1')) IS NULL, 'old code still emailable';
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT parent_portal_home(pg_temp.h('tok-mom')) IS NULL, 'old device survived new code';
  ASSERT parent_login(pg_temp.h('mom1'), 'ip-4', pg_temp.h('t-old')) ->> 'status' = 'invalid', 'old code still works';
  ASSERT parent_login(pg_temp.h('mom2'), 'ip-4', pg_temp.h('tok-mom3')) ->> 'status' = 'ok';
END $$;
RESET ROLE;
UPDATE children SET status = 'withdrawn' WHERE id = '20000000-0000-0000-0000-000000000002';
SET ROLE service_role;
DO $$ BEGIN
  ASSERT jsonb_array_length(parent_portal_home(pg_temp.h('tok-mom3')) -> 'children') = 1;
  ASSERT parent_portal_day(pg_temp.h('tok-mom3'), '20000000-0000-0000-0000-000000000002') IS NULL, 'withdrawn child visible';
END $$;
RESET ROLE;
-- 7. Revoke Dad: his device ends, his row is unlinked; then portal off kills Mom
SET ROLE authenticated; SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
SELECT parent_access_revoke('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003');
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN ASSERT parent_portal_home(pg_temp.h('tok-dad')) IS NULL, 'dad still in'; END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT parent_access_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000003') IS NULL; END $$;
SELECT set_config('request.jwt.claim.sub', '', false); UPDATE centers SET parent_portal_enabled = false;
SET ROLE service_role;
DO $$ BEGIN ASSERT parent_portal_home(pg_temp.h('tok-mom3')) IS NULL, 'portal off but signed in'; END $$;
RESET ROLE;
-- 8. Deleting a contact or a whole child still works with links in place
DELETE FROM children WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT 'ALL PASSED';
