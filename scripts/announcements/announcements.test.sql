-- Database tests for center announcements (20261230000000_announcements.sql), run on a throwaway local Postgres,
-- never a Supabase project:
--   createdb ann && psql -q -d ann -f scripts/parent/portal-stub.sql -f scripts/announcements/stub.sql \
--     -f supabase/migrations/20261225000000_parent_messages.sql \
--     -f supabase/migrations/20261230000000_announcements.sql -f scripts/announcements/announcements.test.sql
-- It prints ALL PASSED or stops at the first failed check.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.as_user(u text, super boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false),
         set_config('request.jwt.claims', json_build_object('app_metadata', json_build_object('is_super_admin', super))::text, false); $$;
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(t::bytea), 'hex') $$;
-- The error a statement raises, or NULL when it runs
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

\set A '''10000000-0000-0000-0000-000000000001'''
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000000a', 'owner@a.com'),
  ('00000000-0000-0000-0000-00000000000b', 'owner@b.com'), ('00000000-0000-0000-0000-00000000000d', 'Sub@X.com');
INSERT INTO centers (id, name, email) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A', 'hello@a.com'),
                                             ('10000000-0000-0000-0000-000000000002', 'Center B', 'hello@b.com');
INSERT INTO center_admins VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO work_areas (id, center_id, name) VALUES
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Toddler 2'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Pre-K'),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'B room');
INSERT INTO children (id, center_id, first_name, classroom_id, status) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Maya', '40000000-0000-0000-0000-000000000001', 'enrolled'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Leo',  '40000000-0000-0000-0000-000000000001', 'enrolled'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Ava',  '40000000-0000-0000-0000-000000000002', 'enrolled'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Zed',  '40000000-0000-0000-0000-000000000002', 'withdrawn'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'B kid', '40000000-0000-0000-0000-000000000009', 'enrolled');
INSERT INTO child_guardians (center_id, child_id, name, email, is_primary, can_pick_up, can_message) VALUES
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mom', 'mom@x.com', true, true, true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Mom', ' MOM@x.com ', true, true, true),   -- sibling, same person
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Dad', 'dad@x.com', false, true, true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Ava mom', 'ava@x.com', true, true, true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Grandma', NULL, false, true, true),      -- no email
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Sitter', 'sit@x.com', false, true, false), -- can_message off
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Neighbor', 'nb@x.com', false, false, true), -- not a pick-up
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'Zed mom', 'zed@x.com', true, true, true),  -- withdrawn child
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', 'B parent', 'b@x.com', true, true, true);
INSERT INTO staff_profiles (id, user_id, first_name, last_name, email) VALUES
  ('50000000-0000-0000-0000-000000000001', NULL, 'Tia', 'Teacher', 't@x.com'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'Sam', 'Sub', NULL),  -- email from auth.users
  ('50000000-0000-0000-0000-000000000003', NULL, 'Rae', 'Removed', 'r@x.com'),
  ('50000000-0000-0000-0000-000000000004', NULL, 'Dan', 'Dad', 'DAD@x.com');   -- Maya's dad also works here
INSERT INTO center_staff (center_id, staff_id, status, employment_class) VALUES
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'active', 'regular'),
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'active', 'substitute'),
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'removed', 'regular'),
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004', 'active', 'regular');

SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
DO $$ BEGIN
  -- 1. Module off by default; an owner cannot switch it on, a super admin can
  ASSERT pg_temp.err($q$SELECT announcement_preview('10000000-0000-0000-0000-000000000001', '{"parents":"all"}')$q$) LIKE '%not turned on%', 'module off blocks';
  UPDATE centers SET announcements_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
  ASSERT NOT (SELECT announcements_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'owner cannot flip the switch';
END $$;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000ff', true);
UPDATE centers SET announcements_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

DO $$
DECLARE p jsonb; c uuid := '10000000-0000-0000-0000-000000000001';
BEGIN
  ASSERT (SELECT announcements_enabled FROM centers WHERE id = c), 'super admin flips the switch';

  -- 2. All parents: Mom once for two kids, Dad, Ava mom; Grandma counted as no email; sitter, neighbor, withdrawn out
  p := announcement_preview(c, '{"parents":"all"}');
  ASSERT (p->>'parents')::int = 3 AND (p->>'staff')::int = 0 AND (p->>'no_email')::int = 1, 'all parents: ' || p::text;
  ASSERT p->>'label' = 'All parents', 'label all parents';

  -- 3. One class
  p := announcement_preview(c, '{"parents":{"classes":["40000000-0000-0000-0000-000000000001"]}}');
  ASSERT (p->>'total')::int = 2 AND (p->>'no_email')::int = 0, 'Toddler 2 parents: ' || p::text;
  ASSERT p->>'label' = 'Toddler 2 parents', 'class label';

  -- 4. Parents + all staff: Dad is a parent (not a second copy); removed staff out; sub's email from auth
  p := announcement_preview(c, '{"parents":"all","staff":"all"}');
  ASSERT (p->>'total')::int = 5 AND (p->>'parents')::int = 3 AND (p->>'staff')::int = 2, 'parents + staff: ' || p::text;
  ASSERT p->'people' @> '[{"kind":"staff","email":"sub@x.com"}]', 'sub email from auth.users';

  -- 5. Regular staff only (Dad counts as staff when parents are not picked)
  p := announcement_preview(c, '{"staff":"regular"}');
  ASSERT (p->>'total')::int = 2 AND p->>'label' = 'Regular staff', 'regular staff: ' || p::text;

  -- 6. Bad input
  ASSERT pg_temp.err($q$SELECT announcement_preview('10000000-0000-0000-0000-000000000001', '{"parents":{"classes":["40000000-0000-0000-0000-000000000009"]}}')$q$) LIKE '%not at this center%', 'other center class';
  ASSERT pg_temp.err($q$SELECT announcement_preview('10000000-0000-0000-0000-000000000001', '{}')$q$) LIKE '%Pick who%', 'empty audience';
  ASSERT pg_temp.err($q$SELECT announcement_preview('10000000-0000-0000-0000-000000000001', '{"everyone":true}')$q$) LIKE '%Pick who%', 'unknown key';
  ASSERT pg_temp.err($q$SELECT announcement_create('10000000-0000-0000-0000-000000000001', 'Hi', 'Body', '{"parents":"all"}', '{sms}', false, false, gen_random_uuid())$q$) LIKE '%Only email%', 'sms not yet';
END $$;

-- 7. Send to parents + all staff; a retried Send returns the same announcement
SELECT announcement_create(:A, 'Closed Friday', 'We are closed Friday for a teacher workday.', '{"parents":"all","staff":"all"}',
  '{email}', true, false, '60000000-0000-0000-0000-000000000001') AS first_id \gset
DO $$
DECLARE a announcements%ROWTYPE; c uuid := '10000000-0000-0000-0000-000000000001';
BEGIN
  ASSERT announcement_create(c, 'Again', 'Again', '{"parents":"all"}', '{email}', false, false, '60000000-0000-0000-0000-000000000001')
         = (SELECT id FROM announcements WHERE client_key = '60000000-0000-0000-0000-000000000001'), 'idempotent send';
  SELECT * INTO a FROM announcements WHERE client_key = '60000000-0000-0000-0000-000000000001';
  ASSERT a.status = 'sending' AND a.recipient_count = 5 AND a.no_email_count = 1 AND a.urgent, 'announcement row';
  ASSERT a.audience_label = 'All parents · All staff', 'stored label';
  ASSERT (SELECT count(*) FROM announcement_recipients WHERE announcement_id = a.id) = 5, 'recipients';
  ASSERT (SELECT count(*) FROM announcement_deliveries WHERE announcement_id = a.id AND status = 'queued') = 5, 'deliveries';
  ASSERT (SELECT cardinality(child_ids) FROM announcement_recipients WHERE announcement_id = a.id AND email = 'mom@x.com') = 2, 'mom covers two kids';
  ASSERT (SELECT kind FROM announcement_recipients WHERE announcement_id = a.id AND email = 'dad@x.com') = 'parent', 'dad as parent';
  ASSERT pg_temp.err('SELECT view_token_hash FROM announcement_recipients') LIKE '%permission denied%', 'tokens hidden from owners';
  ASSERT pg_temp.err('SELECT * FROM announcement_claim()') LIKE '%permission denied%', 'sender is service role only';
  ASSERT pg_temp.err($q$INSERT INTO announcements (center_id, subject, body, audience, audience_label, sender_label, client_key) VALUES ('10000000-0000-0000-0000-000000000001', 's', 'b', '{}', 'x', 'y', gen_random_uuid())$q$) LIKE '%permission denied%', 'no direct writes';
END $$;

-- 8. Another center sees nothing and cannot send here
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM announcements) = 0, 'RLS: center B sees none';
  ASSERT (SELECT count(*) FROM announcement_recipients) = 0, 'RLS: center B sees no recipients';
  ASSERT pg_temp.err($q$SELECT announcement_preview('10000000-0000-0000-0000-000000000001', '{"parents":"all"}')$q$) LIKE '%owners and admins%', 'center B cannot preview A';
END $$;
RESET ROLE;

-- 9. The sender
SET ROLE service_role;
DO $$
DECLARE a uuid := (SELECT id FROM announcements WHERE client_key = '60000000-0000-0000-0000-000000000001');
        r record; n integer := 0; v jsonb;
BEGIN
  FOR r IN SELECT * FROM announcement_claim(a) LOOP
    n := n + 1;
    IF r.email = 'ava@x.com' THEN
      PERFORM announcement_delivery_result(r.delivery_id, false, NULL, 'Provider down');
    ELSE
      PERFORM announcement_delivery_result(r.delivery_id, true, 'prov-' || r.email, NULL, pg_temp.h('tok-' || r.email));
    END IF;
    ASSERT r.center_name = 'Center A' AND r.center_email = 'hello@a.com' AND r.subject = 'Closed Friday', 'claim row';
  END LOOP;
  ASSERT n = 5, 'claimed 5, got ' || n;
  ASSERT (SELECT count(*) FROM announcement_claim(a)) = 0, 'a delivery is claimed once';
  ASSERT (SELECT status FROM announcements WHERE id = a) = 'sending', 'one still queued';

  -- Cron retries the failed one after 10 minutes, up to 3 tries, then gives up
  FOR n IN 1..2 LOOP
    UPDATE announcement_deliveries SET last_attempt_at = now() - interval '11 minutes' WHERE announcement_id = a AND status = 'queued';
    FOR r IN SELECT * FROM announcement_claim() LOOP
      PERFORM announcement_delivery_result(r.delivery_id, false, NULL, 'Provider down');
    END LOOP;
  END LOOP;
  ASSERT (SELECT status FROM announcement_deliveries d JOIN announcement_recipients x ON x.id = d.recipient_id
           WHERE x.email = 'ava@x.com') = 'failed', 'failed after 3 tries';
  ASSERT (SELECT status FROM announcements WHERE id = a) = 'partial', 'partial';

  -- Webhooks
  ASSERT announcement_delivery_event('prov-mom@x.com', 'delivered'), 'delivered event';
  ASSERT announcement_delivery_event('prov-t@x.com', 'bounced'), 'bounce event';
  ASSERT NOT announcement_delivery_event('nope', 'bounced'), 'unknown provider id';
  ASSERT (SELECT count(*) FROM announcement_deliveries WHERE announcement_id = a AND status = 'bounced') = 1, 'one bounced';

  -- 10. The email link: opens, records the open, no acknowledgement when none was asked for
  v := announcement_open(pg_temp.h('tok-mom@x.com'));
  ASSERT v->>'subject' = 'Closed Friday' AND v->>'kind' = 'parent' AND (v->>'urgent')::boolean, 'open: ' || COALESCE(v::text, 'null');
  ASSERT (SELECT opened_at IS NOT NULL AND acknowledged_at IS NULL FROM announcement_recipients WHERE email = 'mom@x.com' AND announcement_id = a), 'opened, not acknowledged';
  ASSERT announcement_acknowledge(pg_temp.h('tok-mom@x.com')) IS NULL, 'no ack when not asked';
  ASSERT announcement_open(pg_temp.h('wrong')) IS NULL AND announcement_open('not-a-hash') IS NULL, 'bad links';
END $$;
RESET ROLE;

-- 11. An announcement that asks for acknowledgement
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
SELECT announcement_create(:A, 'Policy update', 'Please read the new sick policy.', '{"staff":"regular"}',
  '{email}', false, true, '60000000-0000-0000-0000-000000000002') IS NOT NULL;
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE r record; at timestamptz;
BEGIN
  FOR r IN SELECT * FROM announcement_claim((SELECT id FROM announcements WHERE client_key = '60000000-0000-0000-0000-000000000002')) LOOP
    PERFORM announcement_delivery_result(r.delivery_id, true, 'p2-' || r.email, NULL, pg_temp.h('ack-' || r.email));
  END LOOP;
  ASSERT (SELECT status FROM announcements WHERE client_key = '60000000-0000-0000-0000-000000000002') = 'sent', 'all sent';
  at := announcement_acknowledge(pg_temp.h('ack-t@x.com'));
  ASSERT at IS NOT NULL, 'acknowledged';
  ASSERT announcement_acknowledge(pg_temp.h('ack-t@x.com')) = at, 'second ack keeps the first time';
END $$;
RESET ROLE;

-- 12. Turning the module off closes the links and fails whatever is still queued
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
SELECT announcement_create(:A, 'Picnic', 'Picnic Saturday!', '{"parents":"all"}', '{email}', false, false,
  '60000000-0000-0000-0000-000000000003') IS NOT NULL;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000ff', true);
UPDATE centers SET announcements_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT announcement_open(pg_temp.h('tok-dad@x.com')) IS NULL, 'links closed when off';
  ASSERT (SELECT count(*) FROM announcement_claim()) = 0, 'nothing sent when off';
  ASSERT (SELECT status FROM announcements WHERE client_key = '60000000-0000-0000-0000-000000000003') = 'failed', 'queued fails when off';
END $$;
RESET ROLE;

\echo ALL PASSED
